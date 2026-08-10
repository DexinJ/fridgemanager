import AsyncStorage from "@react-native-async-storage/async-storage";
import { auth } from "../auth/firebaseClient";
import { API_BASE_URL } from "./backendConfig";
import {
  createBackendResponseError,
  parseBackendResponseText,
} from "./backendErrors";
import { getUserStorageKeys } from "./storageKeys";

export const MAX_HISTORY = 20;
export const KEEP_RECENT = 6;
const MAX_SUMMARY_INPUT_MESSAGES = 40;
const MAX_SUMMARY_HISTORY_CHARACTERS = 9_000;
const MAX_PREVIOUS_SUMMARY_CHARACTERS = 3_000;
const SUMMARY_TIMEOUT_MS = 8_000;
const SUMMARY_RETRY_DELAY_MS = 60_000;
const MAX_PERSISTED_CHAT_MESSAGES = 500;
const summaryRetryAtByUser = new Map();
const chatGenerationByUser = new Map();

function isPlainRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sanitizeChatContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  return content
    .filter((part) => typeof part === "string" || isPlainRecord(part))
    .map((part) => (isPlainRecord(part) ? { ...part } : part));
}

export function sanitizePersistedChatMessages(value) {
  if (!Array.isArray(value)) {
    const error = new Error("Stored chat messages must be an array.");
    error.code = "INVALID_CHAT_STORAGE";
    throw error;
  }

  const sanitizedMessages = [];
  const retainedMessages = value.slice(-MAX_PERSISTED_CHAT_MESSAGES);

  for (const message of retainedMessages) {
    if (!isPlainRecord(message)) continue;

    if (message.type === "ui_action") {
      if (!isPlainRecord(message.action)) continue;
      sanitizedMessages.push({
        ...message,
        type: "ui_action",
        action: { ...message.action },
      });
      continue;
    }

    if (typeof message.role !== "string" || !message.role.trim()) continue;

    const content = sanitizeChatContent(message.content);
    const hasLegacyText = typeof message.text === "string";
    const hasLegacyImage = typeof message.imageUri === "string";
    if (content === null && !hasLegacyText && !hasLegacyImage) continue;

    const sanitizedMessage = {
      ...message,
      role: message.role.trim(),
    };
    if (content !== null) sanitizedMessage.content = content;
    if (hasLegacyText) sanitizedMessage.text = message.text;
    if (hasLegacyImage) sanitizedMessage.imageUri = message.imageUri;
    sanitizedMessages.push(sanitizedMessage);
  }

  return sanitizedMessages;
}

// --- Add message (text + optional image) ---
export function addMessage(setMessages, { role, text, imageUri }) {
  const content = [];
  if (role === "user" && text) content.push({ type: "input_text", text });
  if (role === "user" && imageUri) content.push({ type: "input_image", image_url: imageUri });
  if (role === "assistant" && text) content.push({ type: "output_text", text });

  if (content.length === 0) {
    console.warn("Skipping empty message:", { role, text, imageUri });
    return Promise.resolve(null);
  }

  const newMessage = { role, content };

  return new Promise((resolve) => {
    setMessages((prev) => {
      const updated = [...(Array.isArray(prev) ? prev : []), newMessage];
      resolve(updated);
      return updated;
    });
  });
}


// --- Get conversation with system prompt and summary ---
export function getConversation(messages, summary, systemPrompt) {
  const shortHistory = (Array.isArray(messages) ? messages : []).slice(
    -KEEP_RECENT
  );
  const conversation = [
    {
      role: "system",
      content: [{ type: "input_text", text: systemPrompt }],
    },
  ];

  const memoryInstruction = formatConversationMemory(summary);

  if (memoryInstruction) {
    conversation.push({
      role: "developer",
      content: [{ type: "input_text", text: memoryInstruction }],
    });
  }

  return [...conversation, ...shortHistory];
}

export function formatConversationMemory(summary) {
  const normalizedSummary = String(summary || "").trim();

  return normalizedSummary
    ? `Conversation memory from earlier messages:\n${normalizedSummary}`
    : "";
}

// --- Save summary separately ---
export async function saveSummary(uid, newSummary, setSummary) {
  const { chatSummary } = getUserStorageKeys(uid);
  const normalizedSummary = String(newSummary || "").trim();
  await AsyncStorage.setItem(chatSummary, normalizedSummary);
  setSummary?.(normalizedSummary);
}

// --- Load messages + summary on startup ---
export async function loadChatData(uid, setMessages, setSummary) {
  const { chatMessages, chatSummary } = getUserStorageKeys(uid);
  const [msgData, summaryData] = await Promise.all([
    AsyncStorage.getItem(chatMessages),
    AsyncStorage.getItem(chatSummary),
  ]);
  const parsedMessages = msgData ? JSON.parse(msgData) : [];
  const messages = sanitizePersistedChatMessages(parsedMessages);
  const summary = summaryData || "";

  setMessages?.(messages);
  setSummary?.(summary);

  return {
    messages,
    summary,
    sanitized: messages.length !== parsedMessages.length,
  };
}

// --- Clear all chat data ---
export async function clearChatData(uid, setMessages, setSummary) {
  const { chatMessages, chatSummary } = getUserStorageKeys(uid);
  const generationKey = String(uid || "").trim();

  if (generationKey) {
    chatGenerationByUser.set(
      generationKey,
      (chatGenerationByUser.get(generationKey) || 0) + 1
    );
    summaryRetryAtByUser.delete(generationKey);
  }

  try {
    await AsyncStorage.multiRemove([chatMessages, chatSummary]);
    setMessages?.([]);
    setSummary?.("");
    return { ok: true, error: null };
  } catch (err) {
    console.warn("Error clearing chat data:", err);
    return { ok: false, error: err };
  }
}

function messageTextAndImage(message) {
  const textParts = [];
  let hasImage = Boolean(message?.imageUri);

  if (typeof message?.content === "string") {
    textParts.push(message.content);
  } else if (Array.isArray(message?.content)) {
    for (const part of message.content) {
      if (typeof part === "string") {
        textParts.push(part);
        continue;
      }

      if (typeof part?.text === "string") {
        textParts.push(part.text);
      }

      if (
        part?.type === "input_image" ||
        part?.type === "image_url" ||
        part?.type === "image_uri" ||
        part?.image_url ||
        part?.imageUri ||
        part?.imageUrl
      ) {
        hasImage = true;
      }
    }
  }

  if (textParts.length === 0 && typeof message?.text === "string") {
    textParts.push(message.text);
  }

  const text = textParts
    .map((part) => String(part).trim())
    .filter(Boolean)
    .join("\n");

  return [text, hasImage ? "[image]" : ""].filter(Boolean).join("\n");
}

export function normalizeMessagesForSummary(messages) {
  return (Array.isArray(messages) ? messages : [])
    .map((message) => {
      if (message?.role !== "user" && message?.role !== "assistant") {
        return null;
      }

      const content = messageTextAndImage(message);

      return content ? { role: message.role, content } : null;
    })
    .filter(Boolean);
}

function boundedSummaryHistory(messages) {
  const selected = [];
  let remainingCharacters = MAX_SUMMARY_HISTORY_CHARACTERS;

  for (
    let index = messages.length - 1;
    index >= 0 &&
    selected.length < MAX_SUMMARY_INPUT_MESSAGES &&
    remainingCharacters > 0;
    index -= 1
  ) {
    const message = messages[index];
    const content = String(message?.content || "");
    if (!content) continue;

    const boundedContent =
      content.length > remainingCharacters
        ? content.slice(-remainingCharacters)
        : content;
    selected.unshift({ ...message, content: boundedContent });
    remainingCharacters -= boundedContent.length;
  }

  return selected;
}

function createSummaryAbortError(message = "Chat history summarization was cancelled.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

async function persistCompactedChat(
  uid,
  summary,
  messages,
  setSummary,
  setMessages,
  isCurrentUser
) {
  const { chatMessages, chatSummary } = getUserStorageKeys(uid);

  if (!isCurrentUser()) throw createSummaryAbortError();

  await AsyncStorage.multiSet([
    [chatSummary, summary],
    [chatMessages, JSON.stringify(messages)],
  ]);

  if (!isCurrentUser()) throw createSummaryAbortError();

  setSummary?.(summary);
  setMessages?.(messages);
}

export async function summarizeHistory({
  uid,
  messages,
  summary = "",
  setSummary,
  setMessages,
  language = "en",
  token,
  signal,
  fetchImpl = fetch,
}) {
  const allMessages = Array.isArray(messages) ? messages : [];
  const recentMessages = allMessages.slice(-KEEP_RECENT);
  const olderMessages = boundedSummaryHistory(
    normalizeMessagesForSummary(allMessages.slice(0, -KEEP_RECENT))
  );
  const previousSummary = String(summary || "")
    .trim()
    .slice(0, MAX_PREVIOUS_SUMMARY_CHARACTERS);

  if (olderMessages.length === 0) {
    return {
      messages: recentMessages,
      summary: previousSummary,
      summarized: false,
      error: null,
      quota: null,
    };
  }

  const controller = new AbortController();
  const initiatingUid = String(uid || "").trim();
  const initiatingUser = auth.currentUser;
  const initiatingChatGeneration = chatGenerationByUser.get(initiatingUid) || 0;
  const isCurrentUser = () =>
    Boolean(
      initiatingUid &&
        initiatingUser?.uid === initiatingUid &&
        auth.currentUser?.uid === initiatingUid &&
        (chatGenerationByUser.get(initiatingUid) || 0) === initiatingChatGeneration
    );
  const assertCurrentUser = () => {
    if (controller.signal.aborted || !isCurrentUser()) {
      throw createSummaryAbortError();
    }
  };
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timeout = setTimeout(() => controller.abort(), SUMMARY_TIMEOUT_MS);

  try {
    assertCurrentUser();
    const idToken =
      String(token || "").trim() ||
      (await initiatingUser.getIdToken());

    assertCurrentUser();

    if (!idToken) {
      throw new Error("You must be signed in before chat history can be summarized.");
    }

    const summaryMessages = previousSummary
      ? [
          {
            role: "system",
            content:
              "Incorporate this previously retained conversation memory into the updated summary:\n" +
              previousSummary,
          },
          ...olderMessages,
        ]
      : olderMessages;
    const response = await fetchImpl(`${API_BASE_URL}/summarize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: summaryMessages,
        language,
      }),
      signal: controller.signal,
    });

    const responseText = await response.text().catch(() => "");
    const payload = parseBackendResponseText(responseText);

    if (!response.ok) {
      throw createBackendResponseError(payload, {
        status: response.status,
        fallbackMessage: `Summarization failed with status ${response.status}.`,
      });
    }

    const nextSummary = String(payload?.summary || "").trim();

    if (!nextSummary) {
      throw new Error("The summary service returned an empty summary.");
    }

    assertCurrentUser();

    await persistCompactedChat(
      initiatingUid,
      nextSummary,
      recentMessages,
      setSummary,
      setMessages,
      isCurrentUser
    );

    return {
      messages: recentMessages,
      summary: nextSummary,
      summarized: true,
      error: null,
      quota: payload?.quota || null,
    };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function checkAndSummarize(
  messagesOrOptions,
  legacySetSummary,
  legacySetMessages
) {
  const options = Array.isArray(messagesOrOptions)
    ? {
        messages: messagesOrOptions,
        setSummary: legacySetSummary,
        setMessages: legacySetMessages,
      }
    : messagesOrOptions || {};
  const messages = Array.isArray(options.messages) ? options.messages : [];
  const summary = String(options.summary || "").trim();

  if (messages.length <= MAX_HISTORY) {
    return {
      messages,
      summary,
      summarized: false,
      error: null,
      quota: null,
    };
  }

  const retryKey = String(options.uid || "").trim() || "missing-user";
  const retryAt = summaryRetryAtByUser.get(retryKey) || 0;

  if (retryAt > Date.now()) {
    return {
      messages: messages.slice(-MAX_HISTORY),
      summary,
      summarized: false,
      error: null,
      quota: null,
      deferred: true,
    };
  }

  try {
    const result = await summarizeHistory({ ...options, messages, summary });
    summaryRetryAtByUser.delete(retryKey);
    return result;
  } catch (error) {
    if (error?.name !== "AbortError") {
      console.warn("Chat history summarization skipped:", error?.message || error);
    }

    if (error?.name !== "AbortError") {
      const quotaResetAt = Date.parse(error?.quota?.resetsAt || "");
      summaryRetryAtByUser.set(
        retryKey,
        error?.code === "QUOTA_EXHAUSTED" && Number.isFinite(quotaResetAt)
          ? quotaResetAt
          : Date.now() + SUMMARY_RETRY_DELAY_MS
      );
    }

    return {
      messages: messages.slice(-MAX_HISTORY),
      summary,
      summarized: false,
      error,
      quota: error?.quota || null,
    };
  }
}
