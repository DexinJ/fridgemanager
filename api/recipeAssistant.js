const objectSchema = (properties, required = []) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

const stringArray = (maxItems) => ({
  type: "array",
  items: { type: "string" },
  maxItems,
});

export const RECOMMEND_RECIPES_TOOL = {
  type: "function",
  function: {
    name: "recommendRecipes",
    description:
      "Find and rank real recipes using the user's trusted fridge inventory and saved recipe preferences. Use for recipe ideas, meal ideas, and 'what can I cook?' requests. Call once. Include only constraints stated for this meal; the app supplies saved defaults and fridge items separately.",
    parameters: objectSchema({
      preferredCuisines: {
        ...stringArray(5),
        description: "Cuisines requested for this meal.",
      },
      energyPreference: {
        type: "string",
        enum: ["any", "light", "balanced", "hearty"],
      },
      maxCaloriesPerServing: {
        type: ["integer", "null"],
        minimum: 100,
        maximum: 2500,
      },
      maxPrepMinutes: {
        type: ["integer", "null"],
        minimum: 5,
        maximum: 480,
      },
      mealType: { type: ["string", "null"] },
      dietaryPatterns: stringArray(8),
      mustUseIngredients: stringArray(20),
      excludedIngredients: stringArray(20),
      servings: { type: "integer", minimum: 1, maximum: 12 },
      resultCount: { type: "integer", minimum: 1, maximum: 6 },
    }),
  },
};

export const PROPOSE_RECIPE_PREFERENCE_UPDATE_TOOL = {
  type: "function",
  function: {
    name: "proposeRecipePreferenceUpdate",
    description:
      "Show a confirmation card for saving persistent recipe preferences. Use when the user asks to remember/save/always/usually prefer something, or clearly states a durable allergy or dietary pattern. This does not save by itself. Never use it for a one-meal constraint such as 'no peanuts tonight'.",
    parameters: objectSchema(
      {
        operation: {
          type: "string",
          enum: ["merge", "remove", "replace"],
          description:
            "Use merge to add preferences (default), remove to delete named list values, and replace only when the user explicitly asks to replace or clear a field.",
        },
        patch: objectSchema({
          preferredCuisines: stringArray(20),
          dislikedCuisines: stringArray(20),
          allergens: stringArray(20),
          dietaryPatterns: stringArray(20),
          excludedIngredients: stringArray(30),
          dislikedIngredients: stringArray(30),
          preferredEnergy: {
            type: "string",
            enum: ["any", "light", "balanced", "hearty"],
          },
          maxCaloriesPerServing: {
            type: ["integer", "null"],
            minimum: 100,
            maximum: 2500,
          },
          maxPrepMinutes: {
            type: ["integer", "null"],
            minimum: 5,
            maximum: 480,
          },
          defaultServings: { type: "integer", minimum: 1, maximum: 12 },
        }),
        summary: { type: "string", maxLength: 160 },
      },
      ["patch"]
    ),
  },
};

const RECIPE_LANGUAGE =
  /\b(recipe|recipes|meal ideas?|dish ideas?|what (?:can|should) i (?:cook|make|eat)|what to (?:cook|make|eat)|breakfast ideas?|lunch ideas?|dinner ideas?|snack ideas?|(?:suggest|recommend|find|want|feel like|craving)\b.{0,40}\b(?:food|meal|dish|recipe|breakfast|lunch|dinner)|something (?:light|healthy|quick|hearty)(?: to eat)?|(?:under|below|less than) \d{2,4} calories|low[- ]calorie)\b/i;
const PERSISTENT_PREFERENCE_LANGUAGE =
  /\b(remember|save (?:that|my)|always|usually|set my (?:recipe|food|meal)|my (?:recipe|food|meal) preferences?)\b/i;

export function inferChatIntent({ text, imageUri, intent } = {}) {
  if (intent === "recipe_recommendation") return intent;
  if (intent === "chat") return intent;
  if (String(imageUri || "").trim()) return "chat";

  const message = String(text || "").trim();
  if (!message || PERSISTENT_PREFERENCE_LANGUAGE.test(message)) return "chat";
  return RECIPE_LANGUAGE.test(message) ? "recipe_recommendation" : "chat";
}

export function buildRecipeContext({
  fridgeItems,
  settings,
  selectedIngredients = [],
} = {}) {
  return {
    inventory: (Array.isArray(fridgeItems) ? fridgeItems : [])
      .slice(0, 100)
      .map((item) => ({
        name: String(item?.name || "").trim().slice(0, 120),
        quantity: String(item?.quantity || "").trim().slice(0, 80),
      }))
      .filter(({ name }) => name),
    selectedIngredients: (Array.isArray(selectedIngredients)
      ? selectedIngredients
      : [])
      .map((item) => String(item?.name ?? item ?? "").trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 30),
    preferences: settings?.recipePreferences || {},
  };
}

export function customRecipeToolPolicy(intent, step) {
  if (intent !== "recipe_recommendation") {
    return null;
  }
  if (step === 0) {
    return {
      tools: [RECOMMEND_RECIPES_TOOL],
      tool_choice: {
        type: "function",
        function: { name: "recommendRecipes" },
      },
      parallel_tool_calls: false,
    };
  }
  return {};
}
