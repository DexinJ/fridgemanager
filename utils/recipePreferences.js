export const RECIPE_PREFERENCES_SCHEMA_VERSION = 1;

export const RECIPE_ENERGY_PREFERENCES = Object.freeze([
  "any",
  "light",
  "balanced",
  "hearty",
]);

const ENERGY_PREFERENCE_SET = new Set(RECIPE_ENERGY_PREFERENCES);
const MAX_LIST_ITEMS = 50;
const MAX_LIST_ITEM_LENGTH = 80;
const MAX_SCORE_ENTRIES = 100;
const EXPLICIT_LIST_FIELDS = Object.freeze([
  "preferredCuisines",
  "dislikedCuisines",
  "allergens",
  "dietaryPatterns",
  "excludedIngredients",
  "dislikedIngredients",
]);
const PATCH_FIELD_LABELS = Object.freeze({
  preferredCuisines: "Preferred cuisines",
  dislikedCuisines: "Cuisines to show less often",
  allergens: "Allergens",
  dietaryPatterns: "Dietary patterns",
  excludedIngredients: "Always exclude",
  dislikedIngredients: "Ingredients to show less often",
});

const DEFAULT_EXPLICIT_PREFERENCES = Object.freeze({
  preferredCuisines: Object.freeze([]),
  dislikedCuisines: Object.freeze([]),
  allergens: Object.freeze([]),
  dietaryPatterns: Object.freeze([]),
  excludedIngredients: Object.freeze([]),
  dislikedIngredients: Object.freeze([]),
  preferredEnergy: "any",
  maxCaloriesPerServing: null,
  maxPrepMinutes: null,
  defaultServings: 2,
});

export const DEFAULT_RECIPE_PREFERENCES = Object.freeze({
  schemaVersion: RECIPE_PREFERENCES_SCHEMA_VERSION,
  explicit: DEFAULT_EXPLICIT_PREFERENCES,
  learned: Object.freeze({
    cuisineScores: Object.freeze({}),
    ingredientScores: Object.freeze({}),
  }),
  personalization: Object.freeze({
    enabled: true,
    learnFromActivity: false,
  }),
  updatedAt: null,
});

function isPlainRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeStringList(value) {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const unique = new Set();
  const normalized = [];

  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const item = candidate.trim().replace(/\s+/g, " ").slice(0, MAX_LIST_ITEM_LENGTH);
    const key = item.toLocaleLowerCase();
    if (!item || unique.has(key)) continue;
    unique.add(key);
    normalized.push(item);
    if (normalized.length >= MAX_LIST_ITEMS) break;
  }

  return normalized;
}

function normalizeNullableInteger(value, minimum, maximum) {
  if (value === null || value === undefined || value === "") return null;
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return null;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizePresentNullableInteger(value, minimum, maximum) {
  if (value === null || value === "") return null;
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return undefined;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeInteger(value, minimum, maximum, fallback) {
  return normalizeNullableInteger(value, minimum, maximum) ?? fallback;
}

function normalizeScores(value) {
  if (!isPlainRecord(value)) return {};

  const scores = {};
  for (const [rawName, rawScore] of Object.entries(value)) {
    const name = String(rawName || "")
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, MAX_LIST_ITEM_LENGTH);
    const score = Number(rawScore);
    if (!name || !Number.isFinite(score)) continue;
    scores[name] = Math.min(100, Math.max(-100, score));
    if (Object.keys(scores).length >= MAX_SCORE_ENTRIES) break;
  }
  return scores;
}

function normalizeUpdatedAt(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function createDefaultRecipePreferences() {
  return {
    schemaVersion: RECIPE_PREFERENCES_SCHEMA_VERSION,
    explicit: {
      ...DEFAULT_EXPLICIT_PREFERENCES,
      preferredCuisines: [],
      dislikedCuisines: [],
      allergens: [],
      dietaryPatterns: [],
      excludedIngredients: [],
      dislikedIngredients: [],
    },
    learned: {
      cuisineScores: {},
      ingredientScores: {},
    },
    personalization: {
      enabled: true,
      learnFromActivity: false,
    },
    updatedAt: null,
  };
}

export function normalizeRecipePreferences(value) {
  const source = isPlainRecord(value) ? value : {};
  const explicit = isPlainRecord(source.explicit) ? source.explicit : {};
  const learned = isPlainRecord(source.learned) ? source.learned : {};
  const personalization = isPlainRecord(source.personalization)
    ? source.personalization
    : {};
  const preferredEnergy = ENERGY_PREFERENCE_SET.has(explicit.preferredEnergy)
    ? explicit.preferredEnergy
    : DEFAULT_EXPLICIT_PREFERENCES.preferredEnergy;

  return {
    schemaVersion: RECIPE_PREFERENCES_SCHEMA_VERSION,
    explicit: {
      preferredCuisines: normalizeStringList(explicit.preferredCuisines),
      dislikedCuisines: normalizeStringList(explicit.dislikedCuisines),
      allergens: normalizeStringList(explicit.allergens),
      dietaryPatterns: normalizeStringList(explicit.dietaryPatterns),
      excludedIngredients: normalizeStringList(explicit.excludedIngredients),
      dislikedIngredients: normalizeStringList(explicit.dislikedIngredients),
      preferredEnergy,
      maxCaloriesPerServing: normalizeNullableInteger(
        explicit.maxCaloriesPerServing,
        100,
        2_500
      ),
      maxPrepMinutes: normalizeNullableInteger(explicit.maxPrepMinutes, 5, 480),
      defaultServings: normalizeInteger(explicit.defaultServings, 1, 12, 2),
    },
    learned: {
      cuisineScores: normalizeScores(learned.cuisineScores),
      ingredientScores: normalizeScores(learned.ingredientScores),
    },
    personalization: {
      enabled: personalization.enabled !== false,
      learnFromActivity: personalization.learnFromActivity === true,
    },
    updatedAt: normalizeUpdatedAt(source.updatedAt),
  };
}

export function normalizeRecipePreferencePatch(value) {
  const source = isPlainRecord(value) ? value : {};
  const patch = {};

  for (const field of EXPLICIT_LIST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, field)) {
      patch[field] = normalizeStringList(source[field]);
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(source, "preferredEnergy") &&
    ENERGY_PREFERENCE_SET.has(source.preferredEnergy)
  ) {
    patch.preferredEnergy = source.preferredEnergy;
  }

  for (const [field, minimum, maximum] of [
    ["maxCaloriesPerServing", 100, 2_500],
    ["maxPrepMinutes", 5, 480],
  ]) {
    if (!Object.prototype.hasOwnProperty.call(source, field)) continue;
    const normalized = normalizePresentNullableInteger(
      source[field],
      minimum,
      maximum
    );
    if (normalized !== undefined) patch[field] = normalized;
  }

  if (Object.prototype.hasOwnProperty.call(source, "defaultServings")) {
    const servings = normalizePresentNullableInteger(
      source.defaultServings,
      1,
      12
    );
    if (servings !== null && servings !== undefined) {
      patch.defaultServings = servings;
    }
  }

  return patch;
}

export function applyRecipePreferenceProposal(
  currentExplicitPreferences,
  proposedPatch,
  operation = "merge"
) {
  const current = normalizeRecipePreferences({
    explicit: currentExplicitPreferences,
  }).explicit;
  const patch = normalizeRecipePreferencePatch(proposedPatch);
  const normalizedOperation = ["merge", "remove", "replace"].includes(operation)
    ? operation
    : "merge";
  const result = { ...patch };

  for (const field of EXPLICIT_LIST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    if (normalizedOperation === "replace") {
      result[field] = patch[field];
      continue;
    }
    if (normalizedOperation === "remove") {
      const removals = new Set(
        patch[field].map((item) => item.toLocaleLowerCase())
      );
      result[field] = current[field].filter(
        (item) => !removals.has(item.toLocaleLowerCase())
      );
      continue;
    }
    result[field] = normalizeStringList([...current[field], ...patch[field]]);
  }

  return result;
}

function formatPreferenceList(value) {
  if (!value.length) return "None";
  const visible = value.slice(0, 5).join(", ");
  return value.length > 5 ? `${visible} (+${value.length - 5} more)` : visible;
}

export function formatRecipePreferencePatch(value) {
  const patch = normalizeRecipePreferencePatch(value);
  const lines = [];

  for (const field of EXPLICIT_LIST_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    lines.push(`${PATCH_FIELD_LABELS[field]}: ${formatPreferenceList(patch[field])}`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "preferredEnergy")) {
    const label =
      patch.preferredEnergy.charAt(0).toUpperCase() +
      patch.preferredEnergy.slice(1);
    lines.push(`Meal style: ${label}`);
  }
  if (Object.prototype.hasOwnProperty.call(patch, "maxCaloriesPerServing")) {
    lines.push(
      patch.maxCaloriesPerServing === null
        ? "Maximum calories: No limit"
        : `Maximum calories: ${patch.maxCaloriesPerServing} per serving`
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, "maxPrepMinutes")) {
    lines.push(
      patch.maxPrepMinutes === null
        ? "Maximum recipe time: No limit"
        : `Maximum recipe time: ${patch.maxPrepMinutes} minutes`
    );
  }
  if (Object.prototype.hasOwnProperty.call(patch, "defaultServings")) {
    lines.push(`Default servings: ${patch.defaultServings}`);
  }

  return lines.join("\n");
}

export function patchRecipePreferences(
  previousPreferences,
  patchOrUpdater,
  updatedAt = new Date().toISOString()
) {
  const current = normalizeRecipePreferences(previousPreferences);
  const requested =
    typeof patchOrUpdater === "function"
      ? patchOrUpdater(current)
      : patchOrUpdater;

  if (!isPlainRecord(requested)) return current;

  const merged = {
    ...current,
    ...requested,
    explicit: {
      ...current.explicit,
      ...(isPlainRecord(requested.explicit) ? requested.explicit : {}),
    },
    learned: {
      ...current.learned,
      ...(isPlainRecord(requested.learned) ? requested.learned : {}),
    },
    personalization: {
      ...current.personalization,
      ...(isPlainRecord(requested.personalization)
        ? requested.personalization
        : {}),
    },
    updatedAt,
  };

  return normalizeRecipePreferences(merged);
}

export function resetRecipePreferences(updatedAt = new Date().toISOString()) {
  return normalizeRecipePreferences({
    ...createDefaultRecipePreferences(),
    updatedAt,
  });
}
