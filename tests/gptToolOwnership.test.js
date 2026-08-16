import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

import babel from "@babel/core";
import transformModulesCommonJs from "@babel/plugin-transform-modules-commonjs";
import * as fridgeProposal from "../utils/fridgeProposal.js";

function loadToolOwnershipHelpers(contextValue = {}) {
  const source = readFileSync(
    new URL("../api/gptTools.js", import.meta.url),
    "utf8"
  );
  const { code } = babel.transformSync(source, {
    filename: "gptTools.js",
    plugins: [transformModulesCommonJs],
  });
  const module = { exports: {} };
  const require = (specifier) => {
    if (specifier === "react") return { useContext: () => contextValue };
    if (specifier === "../context/GlobalContext") {
      return { GlobalContext: {} };
    }
    if (specifier === "../utils/recipePreferences") {
      return { normalizeRecipePreferencePatch: (value) => value || {} };
    }
    if (specifier === "../utils/fridgeProposal") return fridgeProposal;
    throw new Error(`Unexpected test import: ${specifier}`);
  };
  vm.runInNewContext(
    `(function (require, module, exports) { ${code}\n})`,
    {},
    { filename: "gptTools.js" }
  )(require, module, module.exports);
  return module.exports;
}

test("mixed legacy batches assign only client tools and claim each ID once", () => {
  const { claimClientOwnedGPTToolCalls } = loadToolOwnershipHelpers();
  const claimedIds = new Set();
  const mixed = [
    { id: "server-search", function: { name: "webSearch" } },
    { id: "server-recipes", function: { name: "recommendRecipes" } },
    { id: "client-add", function: { name: "addFridgeItem" } },
  ];

  assert.deepEqual(
    claimClientOwnedGPTToolCalls(mixed, { claimedIds }).map(({ id }) => id),
    ["client-add"]
  );
  assert.deepEqual(
    claimClientOwnedGPTToolCalls(mixed, { claimedIds }).map(({ id }) => id),
    []
  );
  assert.deepEqual(
    claimClientOwnedGPTToolCalls([mixed[1]], {
      toolOwner: "client",
      round: 1,
      claimedIds,
    }).map(({ id }) => id),
    []
  );
});

test("explicit non-client ownership is never executed locally", () => {
  const { claimClientOwnedGPTToolCalls } = loadToolOwnershipHelpers();
  assert.equal(
    claimClientOwnedGPTToolCalls(
      [{ id: "unknown", function: { name: "addFridgeItem" } }],
      { toolOwner: "server" }
    ).length,
    0
  );
});

test("proposal tools acknowledge one confirmation card with semantic results", async () => {
  let messages = [];
  const setMessages = (updater) => {
    messages = typeof updater === "function" ? updater(messages) : updater;
  };
  const { useGPTTools } = loadToolOwnershipHelpers({ setMessages });
  const handlers = useGPTTools();

  const preference = await handlers.proposeRecipePreferenceUpdate({
    patch: { preferredCuisines: ["Thai"] },
    summary: "Prefer Thai recipes",
  });
  assert.equal(preference.ok, true);
  assert.equal(preference.proposalShown, true);
  assert.deepEqual(Array.from(preference.fields), ["preferredCuisines"]);
  assert.equal(messages[0].action.kind, "recipe_preference_update");

  const fridge = await handlers.proposeAddAllToFridge({
    items: [
      {
        name: "milk",
        quantity: "1 carton",
        categories: {
          storage: "Fridge",
          urgency: "Use soon",
          food_type: "Dairy",
        },
        expiresAt: "2026-08-20",
      },
    ],
  });
  assert.deepEqual(JSON.parse(JSON.stringify(fridge)), {
    ok: true,
    proposalShown: true,
    itemCount: 1,
    message: "A single add-to-fridge confirmation card was shown.",
  });
  assert.equal(messages[1].action.kind, "add_all_to_fridge");
  assert.match(messages[1].action.actionId, /^fridge-proposal-/);
  assert.equal(messages[1].id, messages[1].action.actionId);
  assert.equal(messages[1].action.status, "pending");
  assert.equal(messages[1].action.items[0].quantity, "1 carton");
  assert.deepEqual(
    JSON.parse(JSON.stringify(messages[1].action.items[0].categories)),
    {
      storage: "Fridge",
      urgency: "Use soon",
      food_type: "Dairy",
    }
  );
});
