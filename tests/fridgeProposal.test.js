import assert from "node:assert/strict";
import test from "node:test";

import { prepareChatMessagesForPersistence } from "../utils/chatStoragePolicy.js";
import {
  claimFridgeProposalAction,
  fridgeProposalCategoryLabels,
  fridgeProposalActionKey,
  isFridgeProposalActionConsumed,
  markFridgeProposalActionConsumed,
  normalizeFridgeProposalCategories,
  normalizeFridgeProposalQuantity,
  releaseFridgeProposalAction,
} from "../utils/fridgeProposal.js";

test("proposal confirmation preserves structured categories and string quantities", () => {
  const proposed = {
    name: "milk",
    quantity: "1 carton",
    categories: {
      storage: "Fridge",
      urgency: "Use soon",
      food_type: "Dairy",
      state: "Unopened",
    },
  };

  const confirmed = {
    ...proposed,
    quantity: normalizeFridgeProposalQuantity(proposed.quantity),
    categories: normalizeFridgeProposalCategories(proposed.categories),
  };

  assert.deepEqual(confirmed, proposed);
  assert.equal(typeof confirmed.quantity, "string");
  assert.deepEqual(fridgeProposalCategoryLabels(confirmed.categories), [
    "Fridge",
    "Use soon",
    "Dairy",
    "Unopened",
  ]);
});

test("legacy category arrays normalize without losing their category meanings", () => {
  assert.deepEqual(
    normalizeFridgeProposalCategories([
      "Freezer",
      "Lasts a while",
      "Meat",
      "Raw",
    ]),
    {
      storage: "Freezer",
      urgency: "Lasts a while",
      food_type: "Meat",
      state: "Raw",
    }
  );
});

test("an add-all proposal can append inventory only once", () => {
  const action = {
    kind: "add_all_to_fridge",
    actionId: "fridge-proposal-test-id",
    title: "Add all to fridge",
    items: [
      {
        name: "milk",
        quantity: "1 carton",
        categories: {
          storage: "Fridge",
          urgency: "Use soon",
          food_type: "Dairy",
        },
      },
    ],
  };
  const claimedKeys = new Set();
  const inventory = [];
  let messages = [
    { role: "assistant", type: "ui_action", action },
    {
      role: "assistant",
      content: [{ type: "output_text", text: "Keep me unchanged" }],
    },
  ];

  const applyAction = (candidate) => {
    if (!claimFridgeProposalAction(claimedKeys, candidate)) return false;
    inventory.push(...candidate.items);
    messages = markFridgeProposalActionConsumed(
      messages,
      candidate,
      "2026-08-13T12:00:00.000Z"
    );
    return true;
  };

  assert.equal(applyAction(action), true);
  assert.equal(applyAction(action), false);
  assert.equal(inventory.length, 1);
  assert.equal(messages[0].action.status, "completed");
  assert.equal(messages[0].action.consumed, true);
  assert.equal(messages[0].action.items[0].quantity, "1 carton");
  assert.deepEqual(messages[0].action.items[0].categories, {
    storage: "Fridge",
    urgency: "Use soon",
    food_type: "Dairy",
  });
  assert.equal(
    isFridgeProposalActionConsumed(messages[0].action),
    true
  );
  assert.equal(claimFridgeProposalAction(new Set(), messages[0].action), false);
  assert.equal(messages[1].content[0].text, "Keep me unchanged");

  const persisted = prepareChatMessagesForPersistence(messages);
  assert.equal(persisted[0].action.status, "completed");
  assert.equal(persisted[0].action.consumed, true);
});

test("proposal action keys survive cloning and failed claims can be released", () => {
  const legacyAction = {
    kind: "add_all_to_fridge",
    title: "Confirm items",
    items: [
      {
        name: "eggs",
        quantity: "1 dozen",
        categories: {
          storage: "Fridge",
          urgency: "Use soon",
          food_type: "Dairy",
        },
      },
    ],
  };
  const clonedAction = JSON.parse(JSON.stringify(legacyAction));
  const claimedKeys = new Set();

  assert.equal(
    fridgeProposalActionKey(clonedAction),
    fridgeProposalActionKey(legacyAction)
  );
  assert.equal(claimFridgeProposalAction(claimedKeys, legacyAction), true);
  assert.equal(claimFridgeProposalAction(claimedKeys, clonedAction), false);
  releaseFridgeProposalAction(claimedKeys, legacyAction);
  assert.equal(claimFridgeProposalAction(claimedKeys, clonedAction), true);
});
