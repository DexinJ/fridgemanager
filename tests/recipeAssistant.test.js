import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import babel from "@babel/core";
import transformModulesCommonJs from "@babel/plugin-transform-modules-commonjs";
import transformReactJsx from "@babel/plugin-transform-react-jsx";

import {
  buildRecipeContext,
  customRecipeToolPolicy,
  inferChatIntent,
  PROPOSE_RECIPE_PREFERENCE_UPDATE_TOOL,
  RECOMMEND_RECIPES_TOOL,
} from "../api/recipeAssistant.js";

function loadDirectAiTools() {
  const source = readFileSync(new URL("../api/gpt.js", import.meta.url), "utf8");
  const { code } = babel.transformSync(source, {
    filename: "gpt.js",
    plugins: [transformReactJsx, transformModulesCommonJs],
  });
  const module = { exports: {} };
  const stubs = new Map([
    [
      "react",
      {
        createContext: () => ({ Provider: "Provider" }),
        useCallback: (value) => value,
        useContext: () => ({}),
        useEffect: () => {},
        useRef: (value) => ({ current: value }),
      },
    ],
    ["react-native", { AppState: {} }],
    ["../auth/firebaseClient", { auth: {} }],
    ["../context/AccountSessionContext", { useAccountSession: () => ({}) }],
    [
      "../context/GlobalContext",
      { ChatActionsContext: {}, GlobalContext: {} },
    ],
    ["./backendConfig", { API_BASE_URL: "", BACKEND_WS_URL: "" }],
    ["./backendErrors", { createBackendResponseError: () => new Error() }],
    ["./buildSystemMessage", { buildSystemMessage: () => "" }],
    [
      "./gptTools",
      {
        claimClientOwnedGPTToolCalls: () => [],
        useGPTTools: () => ({}),
      },
    ],
    [
      "../utils/chatMessageOrder",
      {
        insertAssistantAboveActionCard: (previous, message) => [
          ...(Array.isArray(previous) ? previous : []),
          message,
        ],
      },
    ],
    [
      "./memoryManager",
      {
        addMessage: () => [],
        checkAndSummarize: () => ({}),
        formatConversationMemory: () => "",
      },
    ],
    ["./aiProviderSettings", { getCustomAiProviderSettings: () => ({}) }],
    ["./aiProviderPolicy", { resolveAiProvider: () => "pantrio" }],
    ["./chatLifecycle", { registerChatCancellation: () => () => {} }],
    [
      "../modules/apple-intelligence/src",
      { generateAppleIntelligenceToolTurn: async () => ({}) },
    ],
    [
      "./recipeAssistant",
      {
        buildRecipeContext,
        customRecipeToolPolicy,
        inferChatIntent,
        PROPOSE_RECIPE_PREFERENCE_UPDATE_TOOL,
        RECOMMEND_RECIPES_TOOL,
      },
    ],
  ]);
  const require = (specifier) => {
    if (stubs.has(specifier)) return stubs.get(specifier);
    throw new Error(`Unexpected test import: ${specifier}`);
  };

  vm.runInNewContext(
    `(function (require, module, exports) { ${code}\n})`,
    { console },
    { filename: "gpt.js" }
  )(require, module, module.exports);
  return module.exports.DIRECT_AI_TOOLS;
}

test("recipe intent detection covers direct requests without hijacking images or saved preferences", () => {
  for (const text of [
    "Show me five chicken recipes",
    "What can I cook with eggs and spinach?",
    "I want something light to eat",
    "Give me some dinner ideas",
    "Suggest an Asian meal",
    "I want an American dinner",
  ]) {
    assert.equal(inferChatIntent({ text }), "recipe_recommendation", text);
  }

  assert.equal(inferChatIntent({ text: "Add milk to my fridge" }), "chat");
  assert.equal(
    inferChatIntent({ text: "Always remember my recipe preferences" }),
    "chat"
  );
  assert.equal(
    inferChatIntent({
      text: "Find recipes from this photo",
      imageUri: "file:///fridge.jpg",
    }),
    "chat"
  );
  assert.equal(
    inferChatIntent({
      text: "ordinary chat",
      imageUri: "file:///fridge.jpg",
      intent: "recipe_recommendation",
    }),
    "recipe_recommendation"
  );
});

test("frontend recipe context bounds inventory and selected ingredients", () => {
  const preferences = { explicit: { preferredCuisines: ["Thai"] } };
  const inventory = Array.from({ length: 125 }, (_, index) => ({
    name: ` item-${index}-${"n".repeat(150)} `,
    quantity: ` ${"q".repeat(100)} `,
  }));
  const selectedIngredients = Array.from({ length: 40 }, (_, index) => ({
    name: ` selected-${index}-${"s".repeat(100)} `,
  }));

  const context = buildRecipeContext({
    fridgeItems: inventory,
    selectedIngredients,
    settings: { recipePreferences: preferences },
  });

  assert.equal(context.inventory.length, 100);
  assert.equal(context.inventory[0].name.length, 120);
  assert.equal(context.inventory[0].quantity.length, 80);
  assert.equal(context.selectedIngredients.length, 30);
  assert.equal(context.selectedIngredients[0].length, 80);
  assert.strictEqual(context.preferences, preferences);
  assert.deepEqual(
    buildRecipeContext({ fridgeItems: null, selectedIngredients: null }),
    { inventory: [], selectedIngredients: [], preferences: {} }
  );
});

test("custom recipe requests force one non-parallel recommendation call, then disable tools", () => {
  assert.equal(customRecipeToolPolicy("chat", 0), null);

  const firstRound = customRecipeToolPolicy("recipe_recommendation", 0);
  assert.deepEqual(
    firstRound.tools.map(({ function: tool }) => tool.name),
    ["recommendRecipes"]
  );
  assert.deepEqual(firstRound.tool_choice, {
    type: "function",
    function: { name: "recommendRecipes" },
  });
  assert.equal(firstRound.parallel_tool_calls, false);
  assert.deepEqual(customRecipeToolPolicy("recipe_recommendation", 1), {});
});

test("custom-provider tools retain recipe capabilities and recipe-safe descriptions", () => {
  const tools = loadDirectAiTools();
  const names = Array.from(tools, ({ function: tool }) => tool.name);
  const byName = new Map(tools.map(({ function: tool }) => [tool.name, tool]));

  assert.equal(new Set(names).size, names.length);
  assert.deepEqual(names, [
    "addFridgeItem",
    "addShoppingItem",
    "removeFridgeItem",
    "removeShoppingItem",
    "findInFridge",
    "findInShoppingList",
    "getFridgeContents",
    "getShoppingListContents",
    "streamlineLists",
    "proposeAddAllToFridge",
    "recommendRecipes",
    "proposeRecipePreferenceUpdate",
  ]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(byName.get("recommendRecipes"))),
    RECOMMEND_RECIPES_TOOL.function
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(byName.get("proposeRecipePreferenceUpdate"))),
    PROPOSE_RECIPE_PREFERENCE_UPDATE_TOOL.function
  );
  assert.match(
    byName.get("proposeAddAllToFridge").description,
    /Never use for recipes, recipe ingredients, meal ideas/i
  );
  assert.deepEqual(
    Array.from(
      byName.get("proposeAddAllToFridge").parameters.properties.items.items
        .required
    ),
    ["name", "categories", "expiresAt"]
  );
  assert.match(byName.get("recommendRecipes").description, /Call once/i);
});

test("Apple Intelligence can generate every direct tool advertised by the app", () => {
  const nativeSource = readFileSync(
    new URL(
      "../modules/apple-intelligence/ios/AppleIntelligenceModule.swift",
      import.meta.url
    ),
    "utf8"
  );

  for (const { function: tool } of loadDirectAiTools()) {
    assert.match(nativeSource, new RegExp(`"${tool.name}"`), tool.name);
  }
});
