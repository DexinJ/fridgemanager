import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_PERSISTED_CHAT_MESSAGES,
  boundRuntimeChatMessages,
  prepareChatMessagesForPersistence,
} from "../utils/chatStoragePolicy.js";

test("persistence strips inline image bytes but keeps managed file references", () => {
  const persisted = prepareChatMessagesForPersistence([
    {
      role: "user",
      content: [
        { type: "input_image", image_url: "data:image/jpeg;base64,AAAA" },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "input_image",
          image_url:
            "file:///documents/pantrio-chat-attachments/user/image.jpg",
        },
      ],
    },
  ]);

  assert.equal(JSON.stringify(persisted).includes("base64"), false);
  assert.equal(persisted[0].content[0].text, "[image]");
  assert.equal(
    persisted[1].content[0].image_url,
    "file:///documents/pantrio-chat-attachments/user/image.jpg"
  );
});

test("temporary web blob URLs are not persisted across restarts", () => {
  const persisted = prepareChatMessagesForPersistence([
    {
      role: "user",
      content: [{ type: "input_image", image_url: "blob:https://app.test/123" }],
    },
  ]);
  assert.equal(persisted[0].content[0].text, "[image]");
  assert.equal(JSON.stringify(persisted).includes("blob:"), false);
});

test("runtime and persisted histories are bounded to the newest messages", () => {
  const source = Array.from({ length: 180 }, (_, index) => ({
    role: "assistant",
    content: [{ type: "output_text", text: `message-${index}` }],
  }));
  const runtime = boundRuntimeChatMessages(source);
  const persisted = prepareChatMessagesForPersistence(source);

  assert.ok(runtime.length < source.length);
  assert.equal(persisted.length, MAX_PERSISTED_CHAT_MESSAGES);
  assert.equal(persisted.at(-1).content[0].text, "message-179");
});

test("runtime bounding reuses sanitized immutable messages", () => {
  const message = {
    id: "stable",
    role: "assistant",
    content: [{ type: "output_text", text: "hello" }],
  };
  const first = boundRuntimeChatMessages([message]);
  const second = boundRuntimeChatMessages([message]);
  assert.equal(second[0], first[0]);
  const withNewMessage = boundRuntimeChatMessages([
    ...first,
    { role: "assistant", content: "next" },
  ]);
  assert.equal(withNewMessage[0], first[0]);
});
