import assert from "node:assert/strict";
import test from "node:test";

import {
  applyRecipePreferenceProposal,
  createDefaultRecipePreferences,
  formatRecipePreferencePatch,
  normalizeRecipePreferences,
  normalizeRecipePreferencePatch,
  patchRecipePreferences,
  resetRecipePreferences,
} from "../utils/recipePreferences.js";

test("recipe preference defaults are safe, independent values", () => {
  const first = createDefaultRecipePreferences();
  const second = createDefaultRecipePreferences();

  assert.deepEqual(first, second);
  assert.notEqual(first, second);
  assert.notEqual(first.explicit, second.explicit);
  assert.notEqual(first.explicit.preferredCuisines, second.explicit.preferredCuisines);
  assert.equal(first.explicit.preferredEnergy, "any");
  assert.equal(first.explicit.defaultServings, 2);
  assert.equal(first.personalization.learnFromActivity, false);
});

test("stored recipe preferences are normalized and bounded", () => {
  const normalized = normalizeRecipePreferences({
    schemaVersion: 99,
    explicit: {
      preferredCuisines: [" Thai ", "thai", "Japanese", 12],
      allergens: "Peanut, shellfish, peanut",
      dietaryPatterns: ["Vegetarian"],
      excludedIngredients: [" cilantro  leaves "],
      dislikedIngredients: ["olives"],
      preferredEnergy: "invalid",
      maxCaloriesPerServing: "450.4",
      maxPrepMinutes: 9_999,
      defaultServings: 0,
    },
    learned: {
      cuisineScores: { Thai: 400, Invalid: "not-a-number" },
      ingredientScores: { tofu: -500 },
    },
    personalization: {
      enabled: false,
      learnFromActivity: true,
    },
    updatedAt: "2026-08-13T20:00:00-07:00",
  });

  assert.deepEqual(normalized.explicit.preferredCuisines, ["Thai", "Japanese"]);
  assert.deepEqual(normalized.explicit.allergens, ["Peanut", "shellfish"]);
  assert.deepEqual(normalized.explicit.excludedIngredients, [
    "cilantro leaves",
  ]);
  assert.equal(normalized.explicit.preferredEnergy, "any");
  assert.equal(normalized.explicit.maxCaloriesPerServing, 450);
  assert.equal(normalized.explicit.maxPrepMinutes, 480);
  assert.equal(normalized.explicit.defaultServings, 1);
  assert.deepEqual(normalized.learned.cuisineScores, { Thai: 100 });
  assert.deepEqual(normalized.learned.ingredientScores, { tofu: -100 });
  assert.deepEqual(normalized.personalization, {
    enabled: false,
    learnFromActivity: true,
  });
  assert.equal(normalized.updatedAt, "2026-08-14T03:00:00.000Z");
});

test("normalization fills every nested field for partial or corrupt storage", () => {
  const partial = normalizeRecipePreferences({
    explicit: { preferredCuisines: ["American"] },
    learned: null,
    personalization: "invalid",
  });
  const corrupt = normalizeRecipePreferences("invalid");

  assert.deepEqual(partial.explicit.preferredCuisines, ["American"]);
  assert.deepEqual(partial.explicit.allergens, []);
  assert.equal(partial.explicit.defaultServings, 2);
  assert.deepEqual(partial.learned, {
    cuisineScores: {},
    ingredientScores: {},
  });
  assert.equal(partial.personalization.enabled, true);
  assert.deepEqual(corrupt, createDefaultRecipePreferences());
});

test("preference patches deep-merge sections and timestamp changes", () => {
  const updatedAt = "2026-08-14T04:00:00.000Z";
  const patched = patchRecipePreferences(
    {
      explicit: {
        preferredCuisines: ["Thai"],
        defaultServings: 4,
      },
      personalization: { learnFromActivity: false },
    },
    {
      explicit: { maxCaloriesPerServing: 500 },
      personalization: { learnFromActivity: true },
    },
    updatedAt
  );

  assert.deepEqual(patched.explicit.preferredCuisines, ["Thai"]);
  assert.equal(patched.explicit.defaultServings, 4);
  assert.equal(patched.explicit.maxCaloriesPerServing, 500);
  assert.equal(patched.personalization.enabled, true);
  assert.equal(patched.personalization.learnFromActivity, true);
  assert.equal(patched.updatedAt, updatedAt);
});

test("proposal patches preserve omission while sanitizing canonical fields", () => {
  const patch = normalizeRecipePreferencePatch({
    preferredCuisines: [" Korean ", "korean", "Thai"],
    allergens: [],
    preferredEnergy: "light",
    maxCaloriesPerServing: 9_999,
    maxPrepMinutes: null,
    defaultServings: 40,
    unknown: "ignored",
  });

  assert.deepEqual(patch, {
    preferredCuisines: ["Korean", "Thai"],
    allergens: [],
    preferredEnergy: "light",
    maxCaloriesPerServing: 2_500,
    maxPrepMinutes: null,
    defaultServings: 12,
  });
  assert.equal("dislikedIngredients" in patch, false);
});

test("proposal formatter produces concise confirmation copy", () => {
  assert.equal(
    formatRecipePreferencePatch({
      preferredCuisines: ["Thai", "Japanese"],
      allergens: [],
      preferredEnergy: "light",
      maxCaloriesPerServing: 450,
      maxPrepMinutes: null,
      defaultServings: 2,
    }),
    [
      "Preferred cuisines: Thai, Japanese",
      "Allergens: None",
      "Meal style: Light",
      "Maximum calories: 450 per serving",
      "Maximum recipe time: No limit",
      "Default servings: 2",
    ].join("\n")
  );
});

test("chat proposals merge, remove, or replace list preferences explicitly", () => {
  const current = {
    preferredCuisines: ["Japanese"],
    allergens: ["Peanut", "Shellfish"],
  };

  assert.deepEqual(
    applyRecipePreferenceProposal(
      current,
      { preferredCuisines: ["Thai", "japanese"] },
      "merge"
    ).preferredCuisines,
    ["Japanese", "Thai"]
  );
  assert.deepEqual(
    applyRecipePreferenceProposal(
      current,
      { allergens: ["peanut"] },
      "remove"
    ).allergens,
    ["Shellfish"]
  );
  assert.deepEqual(
    applyRecipePreferenceProposal(
      current,
      { preferredCuisines: [] },
      "replace"
    ).preferredCuisines,
    []
  );
});

test("preference updater receives normalized state and reset clears all values", () => {
  const patched = patchRecipePreferences(
    null,
    (current) => ({
      explicit: {
        preferredCuisines: [...current.explicit.preferredCuisines, "Korean"],
      },
    }),
    "2026-08-14T05:00:00.000Z"
  );
  const reset = resetRecipePreferences("2026-08-14T06:00:00.000Z");

  assert.deepEqual(patched.explicit.preferredCuisines, ["Korean"]);
  assert.deepEqual(reset.explicit.preferredCuisines, []);
  assert.equal(reset.explicit.maxCaloriesPerServing, null);
  assert.equal(reset.personalization.learnFromActivity, false);
  assert.equal(reset.updatedAt, "2026-08-14T06:00:00.000Z");
});
