// useGpt.js (backend-powered + client-side tools)
// NOTE: Streams via your backend WS (/chat).
// Tools are executed on the frontend (this file + gptTools.js).

import { useContext, useRef } from "react";
import { auth } from "../auth/firebaseClient";
import { GlobalContext } from "../context/GlobalContext";
import { buildSystemMessage } from "./buildSystemMessage";
import { useGPTTools } from "./gptTools";
import { addMessage, checkAndSummarize } from "./memoryManager";

const BACKEND_WS_URL =
  process.env.EXPO_PUBLIC_WS_URL || "ws://192.168.0.163:3000/chat";

const DEFAULT_MODEL = "gpt-5";

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

export const useGpt = () => {
  const {
    settings,
    fridgeItems,
    shoppingListItems,
    setMessages,
    summary,
    setSummary,
    waiting,
    setWaiting,
  } = useContext(GlobalContext);

  const toolHandlers = useGPTTools();

  const wsRef = useRef(null);
  const wsReadyRef = useRef(false);

  // requestId -> { resolve, reject, text, currentAssistantMessage }
  const inflightRef = useRef(new Map());

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
        job.reject?.(new Error("WebSocket closed"));
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

      // 1) Assistant text stream
      if (type === "delta") {
        if(waiting){
            setWaiting(false);
        }
        const delta = msg.text || "";
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
        if(waiting){
            setWaiting(false);
        }
        const toolCalls = Array.isArray(msg.toolCalls) ? msg.toolCalls : [];
        const results = [];

        for (const tc of toolCalls) {
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

            // Optional: show tool outcome in chat for debugging / transparency
            if (resultObj?.__context) {
              console.log({
                role: "assistant",
                text: `[Tool:${name}] ${JSON.stringify(resultObj)}`,
              });
            } else if (resultObj?.message) {
              console.log({
                role: "assistant",
                text: `[fromTool] ${resultObj.message}`,
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
          job.reject?.(e);
          inflightRef.current.delete(requestId);
        }

        return;
      }

      // 3) Errors / Done
      if (type === "error") {
        if(waiting){
            setWaiting(false);
        }
        const errText = msg.message || "Unknown error";
        job.reject?.(new Error(errText));
        inflightRef.current.delete(requestId);
        return;
      }

      if (type === "done") {
        if(waiting){
            setWaiting(false);
        }
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
      const t = setTimeout(() => reject(new Error("WebSocket connect timeout")), 8000);

      const onOpen = () => {
        clearTimeout(t);
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onErr);
        resolve();
      };

      const onErr = () => {
        clearTimeout(t);
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onErr);
        reject(new Error("WebSocket failed to connect"));
      };

      ws.addEventListener("open", onOpen);
      ws.addEventListener("error", onErr);
    });
  }

  const streamMessage = async ({
    text,
    imageUri,
    trialId = null,
    language = "en",
  }) => {
    // 1) Add user message locally
    const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;

    const updatedMessages = await addMessage(setMessages, {
      role: "user",
      text,
      imageUri,
    });
    await checkAndSummarize(updatedMessages, setSummary);

    // 2) Build messages for backend (now includes image parts)
    const systemText = buildSystemMessage({
      settings,
      fridgeItems,
      shoppingListItems,
    });
    const img = imageUri || "";
    console.log("FE IMG:", img.slice(0, 30), "len=", img.length);
    const ccMessages = toChatCompletionsMessages(updatedMessages, systemText);

    // 3) Send start to backend
    const ws = ensureWs();
    await waitWsOpen(ws);

    const requestId = makeId();

    const payload = {
      type: "start",
      requestId,
      model: DEFAULT_MODEL,
      language,
      token: token || undefined,
      trialId: trialId || undefined,
      messages: ccMessages,
    };


    const fullText = await new Promise((resolve, reject) => {
      inflightRef.current.set(requestId, {
        resolve,  
        reject,
        text: "",
        currentAssistantMessage: null,
      });

      try {
        ws.send(JSON.stringify(payload));
      } catch (e) {
        inflightRef.current.delete(requestId);
        reject(e);
      }
    });
 
    return fullText;
  };

  const sendMessage = async ({
    text,
    imageUri,
    trialId = null,
    language = "en",
  }) => {
    const updatedMessages = await addMessage(setMessages, {
      role: "user",
      text,
      imageUri,
    });
    await checkAndSummarize(updatedMessages, setSummary);

    const replyText = await streamMessage({ text, imageUri, trialId, language });

    return {
      response: { output_text: replyText },
      updatedMessages,
    };
  };

  const cancel = (requestId) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "cancel", requestId }));
  };

  return { streamMessage, sendMessage, cancel };
};
