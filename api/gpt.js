// useGpt.js (backend-powered + client-side tools)
// NOTE: Streams via your backend WS (/chat).
// Tools are executed on the frontend (this file + gptTools.js).

import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { auth } from "../auth/firebaseClient";
import { useAccountSession } from "../context/AccountSessionContext";
import { ChatActionsContext, GlobalContext } from "../context/GlobalContext";
import { API_BASE_URL, BACKEND_WS_URL } from "./backendConfig";
import { createBackendResponseError } from "./backendErrors";
import { buildSystemMessage } from "./buildSystemMessage";
import {
  claimClientOwnedGPTToolCalls,
  useGPTTools,
} from "./gptTools";
import {
  addMessage,
  checkAndSummarize,
  formatConversationMemory,
} from "./memoryManager";
import { getCustomAiProviderSettings } from "./aiProviderSettings";
import { resolveAiProvider } from "./aiProviderPolicy";
import { registerChatCancellation } from "./chatLifecycle";
import {
  buildRecipeContext,
  customRecipeToolPolicy,
  inferChatIntent,
  PROPOSE_RECIPE_PREFERENCE_UPDATE_TOOL,
  RECOMMEND_RECIPES_TOOL,
} from "./recipeAssistant";
import { generateAppleIntelligenceToolTurn } from "../modules/apple-intelligence/src";

const DEFAULT_MODEL = "gpt-5";
const REQUEST_TIMEOUT_MS = 180_000;
const STREAM_RENDER_INTERVAL_MS = 50;
const WS_IDLE_CLOSE_MS = 30_000;
const APPLE_AI_ISOLATED_TOOL_NAMES = new Set([
  "recommendRecipes",
  "proposeRecipePreferenceUpdate",
  "proposeAddAllToFridge",
]);
// const MAX_IMAGE_REQUEST_URI_LENGTH = 4 * 1024 * 1024;
const GptContext = createContext(null);

const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

const stringField = { type: "string" };
const categoriesField = {
  type: "object",
  properties: {
    storage: stringField,
    urgency: stringField,
    food_type: stringField,
    state: stringField,
  },
  required: ["storage", "urgency", "food_type"],
  additionalProperties: false,
};

const proposedFridgeItemField = objectSchema(
  {
    name: stringField,
    quantity: stringField,
    categories: categoriesField,
    expiresAt: stringField,
  },
  ["name", "categories", "expiresAt"]
);

export const DIRECT_AI_TOOLS = [
  ["addFridgeItem", "Add an item to the fridge.", objectSchema({ name: stringField, quantity: stringField, categories: categoriesField, expiresAt: stringField }, ["name", "categories", "expiresAt"])],
  ["addShoppingItem", "Add an item to the shopping list.", objectSchema({ name: stringField, quantity: stringField, categories: categoriesField }, ["name", "categories"])],
  ["removeFridgeItem", "Remove a named fridge item.", objectSchema({ name: stringField }, ["name"])],
  ["removeShoppingItem", "Remove a named shopping-list item.", objectSchema({ name: stringField }, ["name"])],
  ["findInFridge", "Find a named fridge item.", objectSchema({ name: stringField }, ["name"])],
  ["findInShoppingList", "Find a named shopping-list item.", objectSchema({ name: stringField }, ["name"])],
  ["getFridgeContents", "Get all fridge items.", objectSchema({})],
  ["getShoppingListContents", "Get all shopping-list items.", objectSchema({})],
  ["streamlineLists", "Normalize and optionally retag list items.", objectSchema({ scope: { type: "string", enum: ["shopping", "fridge", "both"] }, retag: { type: "boolean" }, dryRun: { type: "boolean" } })],
  ["proposeAddAllToFridge", "After the user attaches a fridge image, or explicitly asks to add a listed batch, show one confirmation card. Never use for recipes, recipe ingredients, meal ideas, or ordinary bullet lists.", objectSchema({ items: { type: "array", minItems: 1, items: proposedFridgeItemField }, title: stringField }, ["items"])],
].map(([name, description, parameters]) => ({
  type: "function",
  function: { name, description, parameters },
})).concat([
  RECOMMEND_RECIPES_TOOL,
  PROPOSE_RECIPE_PREFERENCE_UPDATE_TOOL,
]);

function assistantText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || "").join("");
  }
  return "";
}

// ✅ Convert your app messages into Chat Completions format
// If a message has an image AND it is NOT the last message, replace image with "[image]"
function toChatCompletionsMessages(
  appMessages,
  systemText,
  lastImageRequestUri = ""
) {
    const out = [];
    const msgs = Array.isArray(appMessages) ? appMessages : [];
    const lastIdx = msgs.length - 1;
  
    if (systemText) out.push({ role: "system", content: systemText });
  
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      const isLast = i === lastIdx;
  
      // --------------------------
      // USER
      // --------------------------
      if (m?.role === "user") {
        let text = "";
        let imageUri = null;
  
        // 1) App-style: { text, imageUri }
        if (typeof m?.text === "string") text = m.text;
        if (m?.imageUri) imageUri = String(m.imageUri);
  
        // 2) Responses-style: { content: [{ type, text | image_uri }] }
        if (Array.isArray(m?.content)) {
          for (const c of m.content) {
            if (c?.type === "input_text" && typeof c?.text === "string") {
              text += c.text;
            }
            if (
              (c?.type === "input_image" || c?.type === "image_uri") &&
              (c?.image_uri || c?.imageUrl || c?.image_url)
            ) {
              imageUri = String(c.image_uri || c.imageUrl || c.image_url);
            }
          }
        }
  
        const hasImage = !!(imageUri && String(imageUri).trim().length);
  
        // If this isn't the last message, strip images and replace with placeholder
        if (hasImage && !isLast) {
          const combined = `${(text || "").trim()}${text?.trim() ? "\n" : ""}[image]`.trim();
          out.push({ role: "user", content: combined });
          continue;
        }
  
        // Otherwise keep multimodal for the last message
        const contentParts = [];
        if (text && text.trim().length) {
          contentParts.push({ type: "text", text });
        }
        if (hasImage) {
          const requestImageUri =
            isLast && lastImageRequestUri
              ? lastImageRequestUri
              : imageUri;
          contentParts.push({
            type: "image_url",
            image_url: { url: requestImageUri },
          });
        }
        if (contentParts.length === 0) {
          contentParts.push({ type: "text", text: "" });
        }
  
        out.push({ role: "user", content: contentParts });
        continue;
      }
  
      // --------------------------
      // ASSISTANT
      // --------------------------
      if (m?.role === "assistant") {
        if (typeof m?.text === "string") {
          out.push({ role: "assistant", content: m.text });
        } else if (Array.isArray(m?.content)) {
          const t =
            m.content.find((c) => c?.type === "output_text" && typeof c?.text === "string")
              ?.text ??
            m.content.find((c) => typeof c?.text === "string")?.text ??
            "";
          out.push({ role: "assistant", content: t });
        } else {
          out.push({ role: "assistant", content: "" });
        }
        continue;
      }
  
      // --------------------------
      // SYSTEM
      // --------------------------
      if (m?.role === "system") {
        out.push({ role: "system", content: String(m?.content ?? "") });
        continue;
      }
    }
  
    return out;
  }

function makeId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function safeJsonParse(str) {
  try {
    return { ok: true, value: JSON.parse(str) };
  } catch {
    return { ok: false, value: null };
  }
}

function backendErrorFromMessage(message, fallbackCode = "BACKEND_ERROR") {
  const error = createBackendResponseError(message, {
    fallbackMessage: "The request could not be completed.",
  });
  if (!error.code) error.code = fallbackCode;
  return error;
}

async function fetchWithLifecycleTimeout(
  url,
  options,
  { signal, timeoutMs = 90_000 } = {}
) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromLifecycle = () => controller.abort();

  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", abortFromLifecycle, { once: true });

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  } catch (error) {
    if (!controller.signal.aborted) throw error;
    const code = timedOut ? "REQUEST_TIMEOUT" : "REQUEST_CANCELLED";
    throw backendErrorFromMessage(
      {
        code,
        message: timedOut
          ? "The AI provider request timed out."
          : "The AI provider request was cancelled.",
      },
      code
    );
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abortFromLifecycle);
  }
}

const useGptRuntime = () => {
  const {
    settings,
    storageOwnerUid,
    fridgeItems,
    shoppingListItems,
  } = useContext(GlobalContext);
  const {
    setMessages,
    setSummary,
    setReceiving,
    setWaiting,
    getChatSnapshot,
  } = useContext(ChatActionsContext);
  const { applyRealtimeState } = useAccountSession();

  const toolHandlers = useGPTTools();
  const toolHandlersRef = useRef(toolHandlers);
  useEffect(() => {
    toolHandlersRef.current = toolHandlers;
  }, [toolHandlers]);

  const wsRef = useRef(null);
  const wsReadyRef = useRef(false);
  const wsIdleTimerRef = useRef(null);

  // requestId -> streamed response job
  const inflightRef = useRef(new Map());
  const activeStreamsRef = useRef(new Set());
  const lifecycleGenerationRef = useRef(1);
  const lifecycleAbortControllerRef = useRef(new AbortController());

  const clearWsIdleTimer = useCallback(() => {
    clearTimeout(wsIdleTimerRef.current);
    wsIdleTimerRef.current = null;
  }, []);

  const closeOwnedSocket = useCallback((ws = wsRef.current) => {
    if (!ws) {
      clearWsIdleTimer();
      return;
    }
    if (wsRef.current !== ws) return;
    clearWsIdleTimer();
    wsRef.current = null;
    wsReadyRef.current = false;
    ws.onopen = null;
    ws.onclose = null;
    ws.onerror = null;
    ws.onmessage = null;
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      try {
        ws.close();
      } catch {
        // Native WebSocket may already be transitioning to CLOSED.
      }
    }
  }, [clearWsIdleTimer]);

  const scheduleIdleSocketClose = useCallback((ws = wsRef.current) => {
    clearWsIdleTimer();
    if (!ws || inflightRef.current.size > 0) return;
    wsIdleTimerRef.current = setTimeout(() => {
      if (wsRef.current === ws && inflightRef.current.size === 0) {
        closeOwnedSocket(ws);
      }
    }, WS_IDLE_CLOSE_MS);
  }, [clearWsIdleTimer, closeOwnedSocket]);

  const cancelAllActiveRequests = useCallback(
    (reason = "The chat request was cancelled.") => {
      lifecycleGenerationRef.current += 1;
      lifecycleAbortControllerRef.current.abort();
      lifecycleAbortControllerRef.current = new AbortController();

      const ws = wsRef.current;
      const inflight = inflightRef.current;
      if (ws?.readyState === WebSocket.OPEN) {
        for (const requestId of inflight.keys()) {
          try {
            ws.send(JSON.stringify({ type: "cancel", requestId }));
          } catch {
            // Local cancellation below still prevents late state updates.
          }
        }
      }

      for (const job of inflight.values()) {
        clearTimeout(job.timeoutId);
        clearTimeout(job.deltaTimerId);
        job.reject?.(
          backendErrorFromMessage({ message: reason }, "REQUEST_CANCELLED")
        );
      }
      inflight.clear();
      activeStreamsRef.current.clear();
      setReceiving(false);
      setWaiting(false);
      scheduleIdleSocketClose(ws);
    },
    [scheduleIdleSocketClose, setReceiving, setWaiting]
  );

  useEffect(
    () => registerChatCancellation(cancelAllActiveRequests),
    [cancelAllActiveRequests]
  );

  useEffect(() => {
    if (lifecycleAbortControllerRef.current.signal.aborted) {
      lifecycleAbortControllerRef.current = new AbortController();
    }
    return () => {
      cancelAllActiveRequests(
        "The chat request was cancelled because the session ended."
      );
      closeOwnedSocket();
    };
  }, [cancelAllActiveRequests, closeOwnedSocket]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") return;
      cancelAllActiveRequests(
        "The chat request was cancelled because the app moved to the background."
      );
      closeOwnedSocket();
    });
    return () => subscription.remove();
  }, [cancelAllActiveRequests, closeOwnedSocket]);

  function flushAssistantDelta(job) {
    clearTimeout(job.deltaTimerId);
    job.deltaTimerId = null;
    const pendingDelta = job.pendingDelta;
    job.pendingDelta = "";
    if (!pendingDelta || lifecycleGenerationRef.current !== job.lifecycleGeneration) {
      return;
    }

    setMessages((previous) => {
      const prev = Array.isArray(previous) ? previous : [];
      const index = prev.findIndex((message) => message?.id === job.messageId);
      if (index < 0) {
        return [
          ...prev,
          {
            id: job.messageId,
            role: "assistant",
            content: [{ type: "output_text", text: pendingDelta }],
          },
        ];
      }

      const current = prev[index];
      const currentText = assistantText(current?.content);
      const updated = [...prev];
      updated[index] = {
        ...current,
        content: [
          { type: "output_text", text: `${currentText}${pendingDelta}` },
        ],
      };
      return updated;
    });
  }

  function assertCurrentLifecycle(generation) {
    if (lifecycleGenerationRef.current === generation) return;
    throw backendErrorFromMessage(
      { message: "The chat request was cancelled because the session ended." },
      "REQUEST_CANCELLED"
    );
  }

  function ensureWs() {
    clearWsIdleTimer();
    const existing = wsRef.current;
    if (
      existing &&
      (existing.readyState === WebSocket.OPEN ||
        existing.readyState === WebSocket.CONNECTING)
    ) {
      scheduleIdleSocketClose(existing);
      return existing;
    }

    const ws = new WebSocket(BACKEND_WS_URL);
    wsRef.current = ws;
    wsReadyRef.current = false;

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      wsReadyRef.current = true;
      scheduleIdleSocketClose(ws);
    };

    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      clearWsIdleTimer();
      wsRef.current = null;
      wsReadyRef.current = false;
      for (const [requestId, job] of inflightRef.current.entries()) {
        flushAssistantDelta(job);
        clearTimeout(job.timeoutId);
        job.reject?.(
          backendErrorFromMessage(
            { message: "The chat connection closed unexpectedly." },
            "CONNECTION_CLOSED"
          )
        );
        inflightRef.current.delete(requestId);
      }
      setReceiving(false);
      setWaiting(false);
    };

    ws.onerror = (e) => {
      if (wsRef.current !== ws) return;
      console.warn("WS error:", e?.message || e);
    };

    ws.onmessage = async (evt) => {
      if (wsRef.current !== ws) return;
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch {
        return;
      }

      const { type, requestId } = msg || {};

      // Some messages like { type:"hello" } may not have requestId
      if (!requestId) return;

      const job = inflightRef.current.get(requestId);
      if (!job) return;

      if (
        type === "started" ||
        type === "quota_budget" ||
        type === "quota_budget_update" ||
        type === "trial_budget" ||
        type === "trial_budget_update" ||
        type === "error"
      ) {
        applyRealtimeState(msg);
      }

      if (type === "started") return;

      if (
        type === "quota_budget" ||
        type === "quota_budget_update" ||
        type === "trial_budget" ||
        type === "trial_budget_update"
      ) {
        return;
      }

      // Compatibility with older gateways that reported rate limits as events.
      // A rate-limit event is terminal for this request and must settle its promise.
      if (type === "event" && (msg.event === "quota" || msg.event === "rate_limit")) {
        applyRealtimeState(msg);
        clearTimeout(job.timeoutId);
        job.reject?.(backendErrorFromMessage(msg, "RATE_LIMITED"));
        inflightRef.current.delete(requestId);
        scheduleIdleSocketClose(ws);
        return;
      }

      // 1) Assistant text stream
      if (type === "delta") {
        setWaiting(false);
        const delta =
          typeof msg.text === "string"
            ? msg.text
            : typeof msg.text === "number" || typeof msg.text === "boolean"
              ? String(msg.text)
              : "";
        if (!delta) return;
        job.text += delta;
        job.pendingDelta += delta;
        if (!job.deltaTimerId) {
          job.deltaTimerId = setTimeout(
            () => flushAssistantDelta(job),
            STREAM_RENDER_INTERVAL_MS
          );
        }

        return;
      }

      // 2) Tool call(s) from backend → execute locally → send tool_results back
      if (type === "tool_calls" || type === "awaiting_tool_results") {
        setWaiting(false);
        const toolCalls = Array.isArray(msg.toolCalls) ? msg.toolCalls : [];
        const claimedIds =
          job.claimedClientToolCallIds ||
          (job.claimedClientToolCallIds = new Set());
        const clientToolCalls = claimClientOwnedGPTToolCalls(toolCalls, {
          toolOwner: msg.toolOwner,
          round: msg.round || "legacy",
          claimedIds,
        });
        if (clientToolCalls.length === 0) return;
        const results = [];

        for (const tc of clientToolCalls) {
          if (inflightRef.current.get(requestId) !== job) return;
          const tool_call_id = tc?.id || tc?.tool_call_id || null;
          const name = tc?.function?.name || tc?.name || "";
          const rawArgs =
            tc?.function?.arguments ??
            tc?.arguments ??
            tc?.args ??
            "{}";

          let args = {};
          const parsed =
            typeof rawArgs === "string"
              ? safeJsonParse(rawArgs)
              : { ok: true, value: rawArgs };

          if (parsed.ok && parsed.value && typeof parsed.value === "object") {
            args = parsed.value;
          }

          const handler = toolHandlersRef.current?.[name];
          if (!handler) {
            results.push({
              tool_call_id,
              name,
              content: JSON.stringify({ error: `No handler for tool: ${name}` }),
            });
            continue;
          }

          try {
            const resultObj = await handler(args);
            if (inflightRef.current.get(requestId) !== job) return;

            // Optional: show tool outcome in chat for debugging / transparency
            if (__DEV__ && resultObj?.__context) {
              console.log({
                role: "assistant",
                text: `[Tool:${name}] completed`,
              });
            } else if (__DEV__ && resultObj?.message) {
              console.log({
                role: "assistant",
                text: `[fromTool:${name}] completed`,
              });
            }

            results.push({
              tool_call_id,
              name,
              content: JSON.stringify(resultObj ?? {}),
            });
          } catch (e) {
            results.push({
              tool_call_id,
              name,
              content: JSON.stringify({ error: e?.message || "Tool failed" }),
            });
          }
        }

        // Send results back to backend so it can continue the model run
        try {
          if (
            wsRef.current !== ws ||
            ws.readyState !== WebSocket.OPEN
          ) {
            throw new Error("The chat connection changed during tool execution.");
          }
          ws.send(JSON.stringify({
            type: "tool_results",
            requestId,
            results,
          }));
        } catch (e) {
          flushAssistantDelta(job);
          clearTimeout(job.timeoutId);
          job.reject?.(e);
          inflightRef.current.delete(requestId);
          scheduleIdleSocketClose(ws);
        }

        return;
      }

      // 3) Errors / Done
      if (type === "error") {
        setWaiting(false);
        flushAssistantDelta(job);
        clearTimeout(job.timeoutId);
        job.reject?.(backendErrorFromMessage(msg));
        inflightRef.current.delete(requestId);
        scheduleIdleSocketClose(ws);
        return;
      }

      if (type === "done") {
        setWaiting(false);
        flushAssistantDelta(job);
        clearTimeout(job.timeoutId);
        job.resolve?.(job.text);
        inflightRef.current.delete(requestId);
        scheduleIdleSocketClose(ws);
        return;
      }
    };

    return ws;
  }

  async function waitWsOpen(ws) {
    if (ws.readyState === WebSocket.OPEN) return;
    if (ws.readyState !== WebSocket.CONNECTING) throw new Error("WebSocket not open");

    await new Promise((resolve, reject) => {
      let timeoutId;

      const cleanup = () => {
        clearTimeout(timeoutId);
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onErr);
        ws.removeEventListener("close", onClose);
      };

      const onOpen = () => {
        cleanup();
        resolve();
      };

      const onErr = () => {
        cleanup();
        reject(new Error("WebSocket failed to connect"));
      };

      const onClose = () => {
        cleanup();
        reject(new Error("WebSocket closed before connecting"));
      };

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error("WebSocket connect timeout"));
      }, 8000);

      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onErr);
      ws.addEventListener("close", onClose);
    });
  }

  async function requestRecipeRecommendations(
    overrides,
    { signal, lifecycleGeneration, recipeContext }
  ) {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw backendErrorFromMessage(
        {
          code: "AUTH_REQUIRED",
          message: "Sign in is required to get recipe recommendations.",
        },
        "AUTH_REQUIRED"
      );
    }
    const token = await currentUser.getIdToken();
    assertCurrentLifecycle(lifecycleGeneration);
    const { response, data } = await fetchWithLifecycleTimeout(
      `${API_BASE_URL}/api/recipes/recommend`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ overrides, recipeContext }),
      },
      { signal }
    );
    assertCurrentLifecycle(lifecycleGeneration);
    if (!response.ok) {
      throw backendErrorFromMessage(data, "RECIPE_RECOMMENDATION_FAILED");
    }
    return data;
  }

  async function runCustomAi(
    messages,
    { signal, lifecycleGeneration, intent, recipeContext }
  ) {
    const baseUrl = String(settings?.advanced?.aiBaseUrl || "").trim().replace(/\/+$/, "");
    const configuredModel = String(settings?.advanced?.aiModel || "").trim();
    const { apiKey, model } = await getCustomAiProviderSettings(
      storageOwnerUid,
      baseUrl,
      {
        // GlobalContext completes (or fail-closes) the one-time migration
        // before the authenticated UI can issue custom-provider requests.
        // Re-running it here added several SecureStore reads to every prompt.
        migrateLegacy: false,
        fallbackModel: configuredModel,
      }
    );

    if (!apiKey) throw new Error("Add an API key in Settings > Advanced.");
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) throw new Error("The custom AI base URL is invalid.");
    if (!model) throw new Error("Add a model name in Settings > Advanced.");

    const conversation = [...messages];
    let recipeRecommendationCompleted = false;
    let toolsLockedAfterIsolatedAction = false;

    for (let step = 0; step < 6; step += 1) {
      assertCurrentLifecycle(lifecycleGeneration);
      const recipeToolPolicy = toolsLockedAfterIsolatedAction
        ? {}
        : customRecipeToolPolicy(
            intent === "recipe_recommendation" || recipeRecommendationCompleted
              ? "recipe_recommendation"
              : intent,
            step
          );
      const toolPolicy = recipeToolPolicy || {
        tools: DIRECT_AI_TOOLS,
        tool_choice: "auto",
        parallel_tool_calls: false,
      };
      const { response, data } = await fetchWithLifecycleTimeout(
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: conversation,
            ...toolPolicy,
          }),
        },
        { signal }
      );
      assertCurrentLifecycle(lifecycleGeneration);
      if (!response.ok) {
        throw new Error(data?.error?.message || data?.message || `AI provider request failed (${response.status}).`);
      }

      const message = data?.choices?.[0]?.message;
      if (!message) throw new Error("The AI provider returned no message.");
      conversation.push(message);

      const calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
      if (!calls.length) return assistantText(message.content);
      const recipeRecommendationCall = calls.find(
        (call) => call?.function?.name === "recommendRecipes"
      );
      const preferenceProposalCall = calls.find(
        (call) => call?.function?.name === "proposeRecipePreferenceUpdate"
      );
      const fridgeProposalCall = calls.find(
        (call) => call?.function?.name === "proposeAddAllToFridge"
      );
      const isolatedToolCall =
        recipeRecommendationCall || preferenceProposalCall || fridgeProposalCall;
      if (isolatedToolCall) {
        toolsLockedAfterIsolatedAction = true;
      }

      for (const call of calls) {
        const name = call?.function?.name || "";
        if (name === "recommendRecipes") {
          recipeRecommendationCompleted = true;
        }
        const parsed = safeJsonParse(call?.function?.arguments || "{}");
        const handler =
          name === "recommendRecipes"
            ? (args) =>
                requestRecipeRecommendations(args, {
                  signal,
                  lifecycleGeneration,
                  recipeContext,
                })
            : toolHandlers?.[name];
        let result;
        try {
          assertCurrentLifecycle(lifecycleGeneration);
          result =
            isolatedToolCall && call !== isolatedToolCall
              ? {
                  ok: false,
                  skipped: true,
                  reason:
                    "Recipe and preference actions are isolated from other tool actions.",
                }
              : handler
                ? await handler(parsed.ok ? parsed.value : {})
                : { error: `No handler for tool: ${name}` };
          assertCurrentLifecycle(lifecycleGeneration);
        } catch (error) {
          if (error?.code === "REQUEST_CANCELLED") throw error;
          result = { error: error?.message || "Tool failed" };
        }
        conversation.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify(result ?? {}),
        });
      }
    }

    throw new Error("The AI provider exceeded the tool-call limit.");
  }

  async function runAppleAi(
    messages,
    systemText,
    { signal, lifecycleGeneration, intent, recipeContext }
  ) {
    const conversation = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role,
        content:
          typeof message.content === "string"
            ? message.content
            : assistantText(message.content),
      }));
    const toolDescriptions = DIRECT_AI_TOOLS.map(({ function: tool }) =>
      `${tool.name}: ${tool.description} Arguments JSON Schema: ${JSON.stringify(tool.parameters)}`
    ).join("\n");
    const instructions = `${systemText}

You can use the app tools listed below. Choose type "tool" whenever you need to read or change app data. Choose type "final" only when you can answer the user without another tool. Never claim that an action succeeded until its tool result says it succeeded. Use only an exact tool name from this list.

${toolDescriptions}`;
    let recipeRecommendationCompleted = false;
    let toolsLockedAfterIsolatedAction = false;

    for (let step = 0; step < 6; step += 1) {
      assertCurrentLifecycle(lifecycleGeneration);
      const recipeToolRequired =
        intent === "recipe_recommendation" && !recipeRecommendationCompleted;
      const turnInstructions = recipeToolRequired
        ? `${instructions}\n\nFor this recipe request, your next step must be the recommendRecipes tool.`
        : toolsLockedAfterIsolatedAction
          ? `${instructions}\n\nThe requested isolated action is complete. Return a final answer now without calling another tool.`
          : instructions;
      const prompt = conversation
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n\n");
      const turn = await generateAppleIntelligenceToolTurn(
        turnInstructions,
        prompt
      );
      assertCurrentLifecycle(lifecycleGeneration);
      const type = String(turn?.type || "").trim().toLowerCase();

      if (type === "final") {
        if (recipeToolRequired) {
          conversation.push({
            role: "assistant",
            content: "I must use recommendRecipes before answering this recipe request.",
          });
          continue;
        }
        return String(turn?.text || "").trim();
      }
      if (type !== "tool") {
        throw new Error("Apple Intelligence returned an invalid response.");
      }

      const name = String(turn?.name || "").trim();
      const parsed = safeJsonParse(turn?.arguments || "{}");
      const handler =
        name === "recommendRecipes"
          ? (args) =>
              requestRecipeRecommendations(args, {
                signal,
                lifecycleGeneration,
                recipeContext,
              })
          : toolHandlersRef.current?.[name];
      const isolatedTool = APPLE_AI_ISOLATED_TOOL_NAMES.has(name);
      let result;

      try {
        assertCurrentLifecycle(lifecycleGeneration);
        result = toolsLockedAfterIsolatedAction
          ? {
              ok: false,
              skipped: true,
              reason: "The prior isolated action must be followed by a final answer.",
            }
          : handler
            ? await handler(
                parsed.ok &&
                  parsed.value &&
                  typeof parsed.value === "object"
                  ? parsed.value
                  : {}
              )
            : { error: `No handler for tool: ${name}` };
        assertCurrentLifecycle(lifecycleGeneration);
      } catch (error) {
        if (error?.code === "REQUEST_CANCELLED") throw error;
        result = { error: error?.message || "Tool failed" };
      }

      if (name === "recommendRecipes") recipeRecommendationCompleted = true;
      if (isolatedTool) toolsLockedAfterIsolatedAction = true;
      conversation.push({
        role: "assistant",
        content: `Tool call: ${name}(${turn?.arguments || "{}"})`,
      });
      conversation.push({
        role: "tool",
        content: `${name} result: ${JSON.stringify(result ?? {})}`,
      });
    }

    throw new Error("Apple Intelligence exceeded the tool-call limit.");
  }

  const runStreamMessage = async ({
    text,
    imageUri,
    imageRequestUri,
    language = "en",
    intent,
    selectedIngredients = [],
  }) => {
    const lifecycleGeneration = lifecycleGenerationRef.current;
    const normalizedText =
      typeof text === "string"
        ? text
        : typeof text === "number" || typeof text === "boolean"
          ? String(text)
          : "";
    const normalizedImageUri = typeof imageUri === "string" ? imageUri : "";
    const normalizedImageRequestUri =
      typeof imageRequestUri === "string" && imageRequestUri.trim()
        ? imageRequestUri.trim()
        : normalizedImageUri;
    // if (normalizedImageRequestUri.length > MAX_IMAGE_REQUEST_URI_LENGTH) {
    //   throw new Error("The selected image is too large to send.");
    // }
    if (!normalizedText.trim() && !normalizedImageUri.trim()) {
      throw new Error("A chat message must include text or an image.");
    }
    const requestIntent = inferChatIntent({
      text: normalizedText,
      imageUri: normalizedImageUri,
      intent,
    });
    const recipeContext = buildRecipeContext({
      fridgeItems,
      settings,
      selectedIngredients,
    });

    // 1) Add user message locally
    const updatedMessages = await addMessage(setMessages, {
      role: "user",
      text: normalizedText,
      imageUri: normalizedImageUri,
    });
    const selectedProvider = resolveAiProvider(
      settings?.advanced?.aiProvider,
      settings?.advanced?.useCustomAi
    );
    const incognito = Boolean(settings?.privacy?.incognito);
    const currentSummary = getChatSnapshot?.().summary || "";
    let requestMessages = updatedMessages.slice(-20);
    let requestSummary = incognito ? "" : currentSummary;

    if (selectedProvider === "pantrio" && !incognito) {
      const memory = await checkAndSummarize({
        uid: storageOwnerUid,
        messages: updatedMessages,
        summary: currentSummary,
        setSummary,
        setMessages,
        language,
        signal: lifecycleAbortControllerRef.current.signal,
      });
      if (memory.quota) {
        applyRealtimeState({ quota: memory.quota });
      }
      requestMessages = memory.messages;
      requestSummary = memory.summary;
    }
    assertCurrentLifecycle(lifecycleGeneration);

    // 2) Build messages for backend (now includes image parts)
    const baseSystemText = buildSystemMessage({
      settings,
      fridgeItems,
      shoppingListItems,
    });
    const memoryText = selectedProvider === "pantrio"
      ? formatConversationMemory(requestSummary)
      : "";
    const systemText = memoryText
      ? `${baseSystemText}\n\n${memoryText}`
      : baseSystemText;
    const img = normalizedImageUri;
    if (__DEV__ && img) {
      console.log("Attaching an image to the chat request");
    }
    const ccMessages = toChatCompletionsMessages(
      requestMessages,
      systemText,
      normalizedImageRequestUri
    );

    if (selectedProvider === "custom") {
      const fullText = await runCustomAi(ccMessages, {
        signal: lifecycleAbortControllerRef.current.signal,
        lifecycleGeneration,
        intent: requestIntent,
        recipeContext,
      });
      setWaiting(false);
      if (fullText) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: [{ type: "output_text", text: fullText }] },
        ]);
      }
      return fullText;
    }

    if (selectedProvider === "apple") {
      const fullText = await runAppleAi(ccMessages, systemText, {
        signal: lifecycleAbortControllerRef.current.signal,
        lifecycleGeneration,
        intent: requestIntent,
        recipeContext,
      });
      setWaiting(false);
      if (fullText) {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: [{ type: "output_text", text: fullText }],
          },
        ]);
      }
      return fullText;
    }

    // 3) Send start to backend
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw backendErrorFromMessage(
        { code: "AUTH_REQUIRED", message: "Sign in is required to use Pantrio AI." },
        "AUTH_REQUIRED"
      );
    }
    const token = await currentUser.getIdToken();
    assertCurrentLifecycle(lifecycleGeneration);
    const ws = ensureWs();
    await waitWsOpen(ws);
    assertCurrentLifecycle(lifecycleGeneration);

    const requestId = makeId();

    const payload = {
      type: "start",
      requestId,
      model: DEFAULT_MODEL,
      language,
      token,
      messages: ccMessages,
      intent: requestIntent,
      recipeContext,
    };


    const fullText = await new Promise((resolve, reject) => {
      const job = {
        resolve,  
        reject,
        text: "",
        messageId: `assistant-${requestId}`,
        pendingDelta: "",
        deltaTimerId: null,
        claimedClientToolCallIds: new Set(),
        timeoutId: null,
        lifecycleGeneration,
      };
      job.timeoutId = setTimeout(() => {
        if (inflightRef.current.get(requestId) !== job) return;
        flushAssistantDelta(job);
        try {
          ws.send(JSON.stringify({ type: "cancel", requestId }));
        } catch {
          // The timeout still rejects locally if the connection already closed.
        }
        inflightRef.current.delete(requestId);
        scheduleIdleSocketClose(ws);
        reject(
          backendErrorFromMessage(
            { message: "The chat request timed out. Please try again." },
            "REQUEST_TIMEOUT"
          )
        );
      }, REQUEST_TIMEOUT_MS);
      inflightRef.current.set(requestId, job);

      try {
        ws.send(JSON.stringify(payload));
      } catch (e) {
        clearTimeout(job.timeoutId);
        inflightRef.current.delete(requestId);
        scheduleIdleSocketClose(ws);
        reject(e);
      }
    });
 
    return fullText;
  };

  const streamMessage = async (request) => {
    const activityToken = Symbol("chat-stream");
    activeStreamsRef.current.add(activityToken);
    setReceiving(true);
    try {
      return await runStreamMessage(request);
    } finally {
      activeStreamsRef.current.delete(activityToken);
      if (activeStreamsRef.current.size === 0) setReceiving(false);
    }
  };

  const sendMessage = async ({
    text,
    imageUri,
    imageRequestUri,
    language = "en",
  }) => {
    const replyText = await streamMessage({
      text,
      imageUri,
      imageRequestUri,
      language,
    });

    return {
      response: { output_text: replyText },
    };
  };

  const cancel = (requestId) => {
    if (!requestId) {
      cancelAllActiveRequests();
      return;
    }
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "cancel", requestId }));
  };

  return { streamMessage, sendMessage, cancel, cancelAll: cancelAllActiveRequests };
};

export function GptProvider({ children }) {
  const runtime = useGptRuntime();
  return <GptContext.Provider value={runtime}>{children}</GptContext.Provider>;
}

export function useGpt() {
  const runtime = useContext(GptContext);
  if (!runtime) {
    throw new Error("useGpt must be used within GptProvider.");
  }
  return runtime;
}
