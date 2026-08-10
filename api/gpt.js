// useGpt.js (backend-powered + client-side tools)
// NOTE: Streams via your backend WS (/chat).
// Tools are executed on the frontend (this file + gptTools.js).

import { useContext, useEffect, useRef } from "react";
import { auth } from "../auth/firebaseClient";
import { useAccountSession } from "../context/AccountSessionContext";
import { GlobalContext } from "../context/GlobalContext";
import { BACKEND_WS_URL } from "./backendConfig";
import { createBackendResponseError } from "./backendErrors";
import { buildSystemMessage } from "./buildSystemMessage";
import { useGPTTools } from "./gptTools";
import {
  addMessage,
  checkAndSummarize,
  formatConversationMemory,
} from "./memoryManager";
import { getCustomAiProviderSettings } from "./aiProviderSettings";
import { generateAppleIntelligenceToolTurn } from "../modules/apple-intelligence/src";

const DEFAULT_MODEL = "gpt-5";
const REQUEST_TIMEOUT_MS = 180_000;

const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
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
};

const DIRECT_AI_TOOLS = [
  ["addFridgeItem", "Add an item to the fridge.", objectSchema({ name: stringField, quantity: stringField, categories: categoriesField, expiresAt: stringField }, ["name", "categories", "expiresAt"])],
  ["addShoppingItem", "Add an item to the shopping list.", objectSchema({ name: stringField, quantity: stringField, categories: categoriesField }, ["name", "categories"])],
  ["removeFridgeItem", "Remove a named fridge item.", objectSchema({ name: stringField }, ["name"])],
  ["removeShoppingItem", "Remove a named shopping-list item.", objectSchema({ name: stringField }, ["name"])],
  ["findInFridge", "Find a named fridge item.", objectSchema({ name: stringField }, ["name"])],
  ["findInShoppingList", "Find a named shopping-list item.", objectSchema({ name: stringField }, ["name"])],
  ["getFridgeContents", "Get all fridge items.", objectSchema({})],
  ["getShoppingListContents", "Get all shopping-list items.", objectSchema({})],
  ["streamlineLists", "Normalize and optionally retag list items.", objectSchema({ scope: { type: "string", enum: ["shopping", "fridge", "both"] }, retag: { type: "boolean" }, dryRun: { type: "boolean" } })],
  ["proposeAddAllToFridge", "Show a proposal for adding several items to the fridge.", objectSchema({ items: { type: "array", items: { type: "object" } }, title: stringField }, ["items"])],
].map(([name, description, parameters]) => ({
  type: "function",
  function: { name, description, parameters },
}));

function assistantText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => part?.text || "").join("");
  }
  return "";
}

// ✅ Convert your app messages into Chat Completions format
// If a message has an image AND it is NOT the last message, replace image with "[image]"
function toChatCompletionsMessages(appMessages, systemText) {
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
          contentParts.push({
            type: "image_url",
            image_url: { url: imageUri },
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

export const useGpt = () => {
  const {
    settings,
    storageHydrated,
    storageOwnerUid,
    fridgeItems,
    shoppingListItems,
    setMessages,
    summary,
    setSummary,
    setWaiting,
  } = useContext(GlobalContext);
  const { applyRealtimeState } = useAccountSession();

  const toolHandlers = useGPTTools();

  const wsRef = useRef(null);
  const wsReadyRef = useRef(false);

  // requestId -> { resolve, reject, text, currentAssistantMessage }
  const inflightRef = useRef(new Map());
  const lifecycleGenerationRef = useRef(1);
  const lifecycleAbortControllerRef = useRef(new AbortController());

  useEffect(() => {
    if (lifecycleAbortControllerRef.current.signal.aborted) {
      lifecycleAbortControllerRef.current = new AbortController();
    }
    const lifecycleController = lifecycleAbortControllerRef.current;
    const inflight = inflightRef.current;

    return () => {
      lifecycleGenerationRef.current += 1;
      lifecycleController.abort();
      const ws = wsRef.current;
      const requestIds = [...inflight.keys()];

      if (ws?.readyState === WebSocket.OPEN) {
        for (const requestId of requestIds) {
          try {
            ws.send(JSON.stringify({ type: "cancel", requestId }));
          } catch {
            // Closing the socket below also aborts active backend work.
          }
        }
      }

      for (const job of inflight.values()) {
        clearTimeout(job.timeoutId);
        job.reject?.(
          backendErrorFromMessage(
            { message: "The chat request was cancelled because the session ended." },
            "REQUEST_CANCELLED"
          )
        );
      }
      inflight.clear();

      wsRef.current = null;
      wsReadyRef.current = false;
      if (ws) {
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
            // The connection may already be closing on the native side.
          }
        }
      }
    };
  }, []);

  function assertCurrentLifecycle(generation) {
    if (lifecycleGenerationRef.current === generation) return;
    throw backendErrorFromMessage(
      { message: "The chat request was cancelled because the session ended." },
      "REQUEST_CANCELLED"
    );
  }

  function ensureWs() {
    const existing = wsRef.current;
    if (
      existing &&
      (existing.readyState === WebSocket.OPEN ||
        existing.readyState === WebSocket.CONNECTING)
    ) {
      return existing;
    }

    const ws = new WebSocket(BACKEND_WS_URL);
    wsRef.current = ws;
    wsReadyRef.current = false;

    ws.onopen = () => {
      wsReadyRef.current = true;
    };

    ws.onclose = () => {
      wsReadyRef.current = false;
      for (const [requestId, job] of inflightRef.current.entries()) {
        clearTimeout(job.timeoutId);
        job.reject?.(
          backendErrorFromMessage(
            { message: "The chat connection closed unexpectedly." },
            "CONNECTION_CLOSED"
          )
        );
        inflightRef.current.delete(requestId);
      }
    };

    ws.onerror = (e) => {
      console.warn("WS error:", e?.message || e);
    };

    ws.onmessage = async (evt) => {
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

        setMessages((prev) => {
          const updated = [...prev];

          if (!job.currentAssistantMessage) {
            job.currentAssistantMessage = {
              role: "assistant",
              content: [{ type: "output_text", text: delta }],
            };
            updated.push(job.currentAssistantMessage);
          } else {
            job.currentAssistantMessage.content[0].text += delta;
          }

          return updated;
        });

        return;
      }

      // 2) Tool call(s) from backend → execute locally → send tool_results back
      if (type === "tool_calls") {
        setWaiting(false);
        const toolCalls = Array.isArray(msg.toolCalls) ? msg.toolCalls : [];
        const results = [];

        for (const tc of toolCalls) {
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

          const handler = toolHandlers?.[name];
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
          wsRef.current?.send(
            JSON.stringify({
              type: "tool_results",
              requestId,
              results,
            })
          );
        } catch (e) {
          clearTimeout(job.timeoutId);
          job.reject?.(e);
          inflightRef.current.delete(requestId);
        }

        return;
      }

      // 3) Errors / Done
      if (type === "error") {
        setWaiting(false);
        clearTimeout(job.timeoutId);
        job.reject?.(backendErrorFromMessage(msg));
        inflightRef.current.delete(requestId);
        return;
      }

      if (type === "done") {
        setWaiting(false);
        clearTimeout(job.timeoutId);
        job.resolve?.(job.text);
        inflightRef.current.delete(requestId);
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

  async function runCustomAi(messages, { signal, lifecycleGeneration }) {
    const baseUrl = String(settings?.advanced?.aiBaseUrl || "").trim().replace(/\/+$/, "");
    const configuredModel = String(settings?.advanced?.aiModel || "").trim();
    const { apiKey, model } = await getCustomAiProviderSettings(
      storageOwnerUid,
      baseUrl,
      {
        migrateLegacy: storageHydrated,
        fallbackModel: configuredModel,
      }
    );

    if (!apiKey) throw new Error("Add an API key in Settings > Advanced.");
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) throw new Error("The custom AI base URL is invalid.");
    if (!model) throw new Error("Add a model name in Settings > Advanced.");

    const conversation = [...messages];

    for (let step = 0; step < 6; step += 1) {
      assertCurrentLifecycle(lifecycleGeneration);
      const { response, data } = await fetchWithLifecycleTimeout(
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model, messages: conversation, tools: DIRECT_AI_TOOLS }),
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

      for (const call of calls) {
        const name = call?.function?.name || "";
        const parsed = safeJsonParse(call?.function?.arguments || "{}");
        const handler = toolHandlers?.[name];
        let result;
        try {
          assertCurrentLifecycle(lifecycleGeneration);
          result = handler
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

  async function runAppleAi(messages, systemText, lifecycleGeneration) {
    const conversation = messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role,
        content: typeof message.content === "string"
          ? message.content
          : assistantText(message.content),
      }));
    const toolDescriptions = DIRECT_AI_TOOLS.map(({ function: tool }) =>
      `${tool.name}: ${tool.description} Arguments JSON Schema: ${JSON.stringify(tool.parameters)}`
    ).join("\n");
    const instructions = `${systemText}

You can use the app tools listed below. Choose type "tool" whenever you need to read or change app data. Choose type "final" only when you can answer the user without another tool. Never claim that an action succeeded until its tool result says it succeeded. Use only an exact tool name from this list.

${toolDescriptions}`;

    for (let step = 0; step < 6; step += 1) {
      assertCurrentLifecycle(lifecycleGeneration);
      const prompt = conversation
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n\n");
      const turn = await generateAppleIntelligenceToolTurn(instructions, prompt);
      assertCurrentLifecycle(lifecycleGeneration);
      const type = String(turn?.type || "").trim().toLowerCase();

      if (type !== "tool") return String(turn?.text || "").trim();

      const name = String(turn?.name || "").trim();
      const handler = toolHandlers?.[name];
      const parsed = safeJsonParse(turn?.arguments || "{}");
      let result;

      try {
        result = handler
          ? await handler(parsed.ok && parsed.value && typeof parsed.value === "object"
              ? parsed.value
              : {})
          : { error: `No handler for tool: ${name}` };
        assertCurrentLifecycle(lifecycleGeneration);
      } catch (error) {
        if (error?.code === "REQUEST_CANCELLED") throw error;
        result = { error: error?.message || "Tool failed" };
      }

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

  const streamMessage = async ({
    text,
    imageUri,
    language = "en",
  }) => {
    const lifecycleGeneration = lifecycleGenerationRef.current;
    const normalizedText =
      typeof text === "string"
        ? text
        : typeof text === "number" || typeof text === "boolean"
          ? String(text)
          : "";
    const normalizedImageUri = typeof imageUri === "string" ? imageUri : "";
    if (!normalizedText.trim() && !normalizedImageUri.trim()) {
      throw new Error("A chat message must include text or an image.");
    }

    // 1) Add user message locally
    const updatedMessages = await addMessage(setMessages, {
      role: "user",
      text: normalizedText,
      imageUri: normalizedImageUri,
    });
    // Custom and on-device providers never route summarization through our backend.
    const selectedProvider = settings?.advanced?.aiProvider ||
      (settings?.advanced?.useCustomAi ? "custom" : "pantrio");
    let requestMessages = updatedMessages.slice(-20);
    let requestSummary = summary;

    if (selectedProvider === "pantrio") {
      const memory = await checkAndSummarize({
        uid: storageOwnerUid,
        messages: updatedMessages,
        summary,
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
    const ccMessages = toChatCompletionsMessages(requestMessages, systemText);

    if (selectedProvider === "custom") {
      const fullText = await runCustomAi(ccMessages, {
        signal: lifecycleAbortControllerRef.current.signal,
        lifecycleGeneration,
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
      const fullText = await runAppleAi(
        ccMessages,
        systemText,
        lifecycleGeneration
      );
      setWaiting(false);
      if (fullText) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: [{ type: "output_text", text: fullText }] },
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
    };


    const fullText = await new Promise((resolve, reject) => {
      const job = {
        resolve,  
        reject,
        text: "",
        currentAssistantMessage: null,
        timeoutId: null,
        lifecycleGeneration,
      };
      job.timeoutId = setTimeout(() => {
        if (inflightRef.current.get(requestId) !== job) return;
        try {
          ws.send(JSON.stringify({ type: "cancel", requestId }));
        } catch {
          // The timeout still rejects locally if the connection already closed.
        }
        inflightRef.current.delete(requestId);
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
        reject(e);
      }
    });
 
    return fullText;
  };

  const sendMessage = async ({
    text,
    imageUri,
    language = "en",
  }) => {
    const replyText = await streamMessage({ text, imageUri, language });

    return {
      response: { output_text: replyText },
    };
  };

  const cancel = (requestId) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "cancel", requestId }));
  };

  return { streamMessage, sendMessage, cancel };
};
