export const MAX_RUNTIME_CHAT_MESSAGES = 120;
export const MAX_RUNTIME_CHAT_BYTES = 2 * 1024 * 1024;
export const MAX_PERSISTED_CHAT_MESSAGES = 100;
export const MAX_PERSISTED_CHAT_BYTES = 768 * 1024;

const MAX_TEXT_CHARACTERS = 60_000;
const DATA_IMAGE_PREFIX = "data:image/";
const MANAGED_ATTACHMENT_PATH = "/pantrio-chat-attachments/";
const textEncoder = typeof TextEncoder === "function" ? new TextEncoder() : null;
const runtimeSanitizedCache = new WeakMap();
const serializedByteCache = new WeakMap();

function isPlainRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function boundedText(value) {
  if (typeof value !== "string") return null;
  if (value.length <= MAX_TEXT_CHARACTERS) return value;
  return `${value.slice(0, MAX_TEXT_CHARACTERS)}\n[message truncated]`;
}

function imageUrlFromPart(part) {
  const value = part?.image_url ?? part?.imageUri ?? part?.imageUrl;
  if (typeof value === "string") return value.trim();
  if (isPlainRecord(value) && typeof value.url === "string") {
    return value.url.trim();
  }
  return "";
}

function isDurableManagedAttachment(uri) {
  const normalized = String(uri || "").trim().replace(/\\/g, "/");
  return (
    normalized.toLowerCase().startsWith("file://") &&
    normalized.includes(MANAGED_ATTACHMENT_PATH)
  );
}

function sanitizeContentPart(part, { persist }) {
  if (typeof part === "string") return boundedText(part);
  if (!isPlainRecord(part)) return null;

  const type = typeof part.type === "string" ? part.type : "";
  const text = boundedText(part.text);
  const imageUrl = imageUrlFromPart(part);
  const isImage =
    type === "input_image" ||
    type === "image_url" ||
    type === "image_uri" ||
    Boolean(imageUrl);

  if (isImage) {
    if (
      !imageUrl ||
      (persist &&
        (imageUrl.toLowerCase().startsWith(DATA_IMAGE_PREFIX) ||
          !isDurableManagedAttachment(imageUrl)))
    ) {
      return { type: "input_text", text: "[image]" };
    }
    return { type: "input_image", image_url: imageUrl };
  }

  if (text !== null) {
    return {
      type: type || "input_text",
      text,
    };
  }

  return null;
}

function sanitizeMessage(message, { persist }) {
  if (!isPlainRecord(message)) return null;

  if (message.type === "ui_action") {
    if (!isPlainRecord(message.action)) return null;
    return {
      ...(typeof message.id === "string" ? { id: message.id } : {}),
      type: "ui_action",
      action: { ...message.action },
    };
  }

  if (typeof message.role !== "string" || !message.role.trim()) return null;

  let content = null;
  if (typeof message.content === "string") {
    content = boundedText(message.content);
  } else if (Array.isArray(message.content)) {
    content = message.content
      .map((part) => sanitizeContentPart(part, { persist }))
      .filter(Boolean);
  }

  let text = boundedText(message.text);
  let imageUri = typeof message.imageUri === "string" ? message.imageUri.trim() : "";
  if (
    persist &&
    imageUri &&
    (imageUri.toLowerCase().startsWith(DATA_IMAGE_PREFIX) ||
      !isDurableManagedAttachment(imageUri))
  ) {
    imageUri = "";
    text = text || "[image]";
  }

  const hasContent =
    (typeof content === "string" && content.length > 0) ||
    (Array.isArray(content) && content.length > 0);
  if (!hasContent && !text && !imageUri) return null;

  return {
    ...(typeof message.id === "string" ? { id: message.id } : {}),
    role: message.role.trim(),
    ...(hasContent ? { content } : {}),
    ...(text ? { text } : {}),
    ...(imageUri ? { imageUri } : {}),
  };
}

function jsonBytes(value) {
  if (value && typeof value === "object" && serializedByteCache.has(value)) {
    return serializedByteCache.get(value);
  }
  try {
    const json = JSON.stringify(value);
    const size = textEncoder
      ? textEncoder.encode(json).length
      : json.length * 2;
    if (value && typeof value === "object") {
      serializedByteCache.set(value, size);
    }
    return size;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function sanitizeRuntimeMessage(message) {
  if (!isPlainRecord(message)) return null;
  const cached = runtimeSanitizedCache.get(message);
  if (cached !== undefined) return cached;
  const sanitized = sanitizeMessage(message, { persist: false });
  runtimeSanitizedCache.set(message, sanitized);
  if (sanitized && typeof sanitized === "object") {
    runtimeSanitizedCache.set(sanitized, sanitized);
  }
  return sanitized;
}

function boundNewest(messages, { maxMessages, maxBytes }) {
  const retained = [];
  let retainedBytes = 2;

  for (
    let index = messages.length - 1;
    index >= 0 && retained.length < maxMessages;
    index -= 1
  ) {
    const message = messages[index];
    const size = jsonBytes(message) + 1;
    if (!Number.isFinite(size) || size > maxBytes) continue;
    if (retainedBytes + size > maxBytes) break;
    retained.unshift(message);
    retainedBytes += size;
  }

  return retained;
}

export function boundRuntimeChatMessages(value) {
  const messages = (Array.isArray(value) ? value : [])
    .map(sanitizeRuntimeMessage)
    .filter(Boolean);

  return boundNewest(messages, {
    maxMessages: MAX_RUNTIME_CHAT_MESSAGES,
    maxBytes: MAX_RUNTIME_CHAT_BYTES,
  });
}

export function prepareChatMessagesForPersistence(value) {
  const messages = (Array.isArray(value) ? value : [])
    .map((message) => sanitizeMessage(message, { persist: true }))
    .filter(Boolean);

  return boundNewest(messages, {
    maxMessages: MAX_PERSISTED_CHAT_MESSAGES,
    maxBytes: MAX_PERSISTED_CHAT_BYTES,
  });
}

export function collectChatAttachmentUris(messages) {
  const uris = new Set();

  for (const message of Array.isArray(messages) ? messages : []) {
    if (typeof message?.imageUri === "string" && message.imageUri.trim()) {
      uris.add(message.imageUri.trim());
    }
    for (const part of Array.isArray(message?.content) ? message.content : []) {
      const imageUrl = imageUrlFromPart(part);
      if (imageUrl) uris.add(imageUrl);
    }
  }

  return [...uris];
}

export function replaceChatImagesWithPlaceholders(value) {
  const source = Array.isArray(value) ? value : [];
  let changed = false;
  const next = source.map((message) => {
    if (!message || typeof message !== "object" || message.type === "ui_action") {
      return message;
    }

    const hadLegacyImage = typeof message.imageUri === "string" && message.imageUri;
    let hadContentImage = false;
    const content = Array.isArray(message.content)
      ? message.content.map((part) => {
          const imageUrl = imageUrlFromPart(part);
          if (!imageUrl) return part;
          hadContentImage = true;
          return { type: "input_text", text: "[image]" };
        })
      : message.content;

    if (!hadLegacyImage && !hadContentImage) return message;
    changed = true;

    return {
      ...message,
      ...(content !== undefined ? { content } : {}),
      ...(hadLegacyImage && !message.text ? { text: "[image]" } : {}),
      imageUri: undefined,
    };
  });
  return changed ? next : source;
}

export function shouldPersistChat(settings) {
  return !Boolean(settings?.privacy?.incognito);
}

export function shouldClearChatOnIncognitoExit(
  wasIncognito,
  isIncognito
) {
  return Boolean(wasIncognito) && !Boolean(isIncognito);
}
