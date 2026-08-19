import assert from "node:assert/strict";
import test from "node:test";

import { insertAssistantAboveActionCard } from "../utils/chatMessageOrder.js";

test("insertAssistantAboveActionCard appends when no card is tracked", () => {
  const previous = [{ id: "user-1", role: "user", content: "hello" }];
  const assistant = { id: "assistant-1", role: "assistant", content: "hi" };

  assert.deepEqual(
    insertAssistantAboveActionCard(previous, assistant, null),
    [...previous, assistant]
  );
});

test("insertAssistantAboveActionCard appends when the card is missing", () => {
  const previous = [{ id: "user-1", role: "user", content: "hello" }];
  const assistant = { id: "assistant-1", role: "assistant", content: "hi" };

  assert.deepEqual(
    insertAssistantAboveActionCard(previous, assistant, "missing-card"),
    [...previous, assistant]
  );
});

test("insertAssistantAboveActionCard places the assistant above the card", () => {
  const previous = [
    { id: "user-1", role: "user", content: "add these" },
    {
      id: "fridge-proposal-1",
      role: "assistant",
      type: "ui_action",
      action: { kind: "add_all_to_fridge" },
    },
    { id: "user-2", role: "user", content: "later" },
  ];
  const assistant = { id: "assistant-1", role: "assistant", content: "review" };

  assert.deepEqual(
    insertAssistantAboveActionCard(previous, assistant, "fridge-proposal-1"),
    [
      previous[0],
      assistant,
      previous[1],
      previous[2],
    ]
  );
});

test("insertAssistantAboveActionCard preserves untouched messages", () => {
  const previous = [
    { id: "user-1", role: "user", content: "hello" },
    { id: "fridge-proposal-1", role: "assistant", type: "ui_action", action: {} },
  ];
  const assistant = { id: "assistant-1", role: "assistant", content: "ok" };

  const result = insertAssistantAboveActionCard(
    previous,
    assistant,
    "fridge-proposal-1"
  );

  assert.equal(result.length, 3);
  assert.equal(result[1].id, "assistant-1");
  assert.equal(result[2].id, "fridge-proposal-1");
  assert.deepEqual(previous[0], result[0]);
});
