// gptTools.js (FULL PASTE - updated)
// - Uses GlobalContext.inferFoodTypeLabelFromName + GlobalContext.streamlineLists (single source of truth)
// - Removes local inferFoodType rules completely
// - Keeps add/remove/find/get/propose tools
// - Adds defensive fallback if streamlineLists isn't wired yet

import { useContext } from "react";
import { GlobalContext } from "../context/GlobalContext";

export function useGPTTools() {
  const {
    fridgeItems,
    shoppingListItems,
    addToFridge, // addToFridge(name, quantity, tagIds, expiresAt?)
    addToShoppingList, // addToShoppingList(name, quantity, tagIds)
    removeFromFridge,
    removeFromShoppingList,
    editFridgeItem,
    editShoppingListItem,
    setMessages,
    tags, // preset tags only

    // ✅ NEW from GlobalContext
    inferFoodTypeLabelFromName,
    streamlineLists: streamlineListsFromContext,
  } = useContext(GlobalContext);

  const norm = (s) => String(s || "").trim().toLowerCase();

  // -----------------------------
  // Categories normalization
  // -----------------------------
  // Preferred format:
  // categories = { storage: "Fridge", urgency: "Use soon", food_type: "Dairy", state?: "Opened" }
  //
  // Back-compat accepted (optional):
  // - array: ["Fridge","Use soon","Dairy"]
  // - string: "Fridge, Use soon, Dairy"
  const normalizeCategoriesToLabels = (categories) => {
    if (!categories) return [];

    // ✅ object form (preferred)
    if (typeof categories === "object" && !Array.isArray(categories)) {
      const { storage, urgency, food_type, state } = categories || {};
      return [storage, urgency, food_type, state]
        .map((x) => String(x || "").trim())
        .filter(Boolean);
    }

    // legacy array
    if (Array.isArray(categories)) {
      return categories.map((c) => String(c || "").trim()).filter(Boolean);
    }

    // legacy comma-separated string
    return String(categories)
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
  };

  // Validate the required typed keys when object is provided
  const validateTypedCategories = (categories) => {
    if (!categories || typeof categories !== "object" || Array.isArray(categories)) {
      return {
        ok: false,
        message: "categories must be an object: { storage, urgency, food_type, state? }",
      };
    }

    const storage = String(categories.storage || "").trim();
    const urgency = String(categories.urgency || "").trim();
    const foodType = String(categories.food_type || "").trim();

    if (!storage || !urgency || !foodType) {
      return {
        ok: false,
        message:
          "Missing required categories. Required: storage, urgency, food_type. Example: { storage:'Fridge', urgency:'Use soon', food_type:'Dairy' }",
      };
    }

    return { ok: true };
  };

  // -----------------------------
  // Preset-only tag mapping
  // -----------------------------
  const categoryLabelToPresetTagId = (label) => {
    const c = String(label || "").trim();
    if (!c) return null;

    const cKey = norm(c).replace(/\s+/g, "_");

    const list = Array.isArray(tags) ? tags : [];

    const existing =
      list.find((t) => t?.key === cKey) || list.find((t) => norm(t?.label) === norm(c));

    return existing?.id || null;
  };

  const tagIdToLabel = (id) => {
    const list = Array.isArray(tags) ? tags : [];
    const t = list.find((x) => x?.id === id);
    return t?.label || null;
  };

  const categoriesToPresetTagIds = (categories) => {
    const labels = normalizeCategoriesToLabels(categories);
    const ids = labels.map(categoryLabelToPresetTagId).filter(Boolean);
    return Array.from(new Set(ids));
  };

  const formatAcceptedCategories = (categories, tagIds) => {
    const labels = normalizeCategoriesToLabels(categories);
    if (labels.length === 0) return "";
    if (tagIds.length === 0) return " (categories ignored: not in preset tags)";
    return ` (categories: ${labels.join(", ")})`;
  };

  // -----------------------------
  // Expiration helpers (tool-level validation)
  // -----------------------------
  const normalizeExpiresAt = (expiresAt) => {
    if (expiresAt === undefined || expiresAt === null || expiresAt === "") return null;
    return expiresAt;
  };

  const validateExpiresAtRequired = (expiresAt) => {
    const v = normalizeExpiresAt(expiresAt);
    if (!v) {
      return {
        ok: false,
        message:
          "Missing expiresAt. Please ask the user for an expiration date (e.g., '2026-02-01' or 'in 5 days').",
      };
    }
    return { ok: true, value: v };
  };

  const getItemTagLabels = (item) => {
    const ids = Array.isArray(item?.tagIds) ? item.tagIds : [];
    return ids.map(tagIdToLabel).filter(Boolean);
  };

  // -----------------------------
  // Tools
  // -----------------------------
  return {
    // ✅ requires expiresAt
    addFridgeItem: async ({ name, quantity = "1", categories, expiresAt }) => {
      const n = String(name || "").trim();
      if (!n) return { success: false, message: "Missing item name." };

      const v = validateTypedCategories(categories);
      if (!v.ok) return { success: false, message: v.message };

      const ex = validateExpiresAtRequired(expiresAt);
      if (!ex.ok) return { success: false, message: ex.message };

      const tagIds = categoriesToPresetTagIds(categories);
      addToFridge(n, String(quantity || "1"), tagIds, ex.value);

      return {
        success: true,
        message: `${quantity} ${n} added to fridge (expires: ${String(
          ex.value
        )}).${formatAcceptedCategories(categories, tagIds)}`,
      };
    },

    addShoppingItem: async ({ name, quantity = "1", categories }) => {
      const n = String(name || "").trim();
      if (!n) return { success: false, message: "Missing item name." };

      const v = validateTypedCategories(categories);
      if (!v.ok) return { success: false, message: v.message };

      const tagIds = categoriesToPresetTagIds(categories);
      addToShoppingList(n, String(quantity || "1"), tagIds);

      return {
        success: true,
        message: `${quantity} ${n} added to shopping list.${formatAcceptedCategories(
          categories,
          tagIds
        )}`,
      };
    },

    removeFridgeItem: async ({ name }) => {
      const n = norm(name);
      if (!n) return { success: false, message: "Missing item name." };

      const item = (Array.isArray(fridgeItems) ? fridgeItems : []).find(
        (i) => norm(i.name) === n
      );
      if (item) {
        removeFromFridge(item.id);
        return { success: true, message: `${name} removed from fridge.` };
      }
      return { success: false, message: `${name} not found in fridge.` };
    },

    removeShoppingItem: async ({ name }) => {
      const n = norm(name);
      if (!n) return { success: false, message: "Missing item name." };

      const item = (Array.isArray(shoppingListItems) ? shoppingListItems : []).find(
        (i) => norm(i.name) === n
      );
      if (item) {
        removeFromShoppingList(item.id);
        return { success: true, message: `${name} removed from shopping list.` };
      }
      return { success: false, message: `${name} not found in shopping list.` };
    },

    // -----------------------------
    // ✅ streamlineLists tool
    // Delegates to GlobalContext.streamlineLists (single source of truth)
    //
    // Args:
    // - scope: "shopping" | "fridge" | "both"
    // - retag: boolean
    // - dryRun: boolean
    // -----------------------------
    streamlineLists: async ({ scope = "both", retag = true, dryRun = false } = {}) => {
      // Defensive fallback if context not updated yet
      if (typeof streamlineListsFromContext !== "function") {
        const wantShopping = scope === "shopping" || scope === "both";
        const wantFridge = scope === "fridge" || scope === "both";

        return {
          __context: true,
          scope,
          retag,
          dryRun,
          changed: { shopping: 0, fridge: 0, details: { shopping: [], fridge: [] } },
          items: {
            shopping: wantShopping
              ? (Array.isArray(shoppingListItems) ? shoppingListItems : []).map((it) => ({
                  id: it?.id,
                  name: String(it?.name ?? ""),
                  quantity: String(it?.quantity ?? ""),
                  tagIds: Array.isArray(it?.tagIds) ? it.tagIds : [],
                  tagLabels: getItemTagLabels(it),
                }))
              : [],
            fridge: wantFridge
              ? (Array.isArray(fridgeItems) ? fridgeItems : []).map((it) => ({
                  id: it?.id,
                  name: String(it?.name ?? ""),
                  quantity: String(it?.quantity ?? ""),
                  expiresAt: it?.expiresAt ?? null,
                  tagIds: Array.isArray(it?.tagIds) ? it.tagIds : [],
                  tagLabels: getItemTagLabels(it),
                }))
              : [],
          },
          warning: "GlobalContext.streamlineLists not found; no changes applied.",
        };
      }

      const res = streamlineListsFromContext({ scope, retag, dryRun });

      // Optional: tiny debug note in chat when called via GPT and actually mutates
      if (!dryRun && (res?.changed?.shopping || res?.changed?.fridge)) {
        setMessages?.((prev) => [
          ...(Array.isArray(prev) ? prev : []),
          {
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: `🧹 Streamlined ${(res.changed.shopping || 0) + (res.changed.fridge || 0)} item(s) (normalized names/qty + ensured food_type tags).`,
              },
            ],
          },
        ]);
      }

      // Helpful snapshot of current lists
      const wantShopping = scope === "shopping" || scope === "both";
      const wantFridge = scope === "fridge" || scope === "both";

      const items = {
        shopping: wantShopping
          ? (Array.isArray(shoppingListItems) ? shoppingListItems : []).map((it) => ({
              id: it?.id,
              name: String(it?.name ?? ""),
              quantity: String(it?.quantity ?? ""),
              tagIds: Array.isArray(it?.tagIds) ? it.tagIds : [],
              tagLabels: getItemTagLabels(it),
            }))
          : [],
        fridge: wantFridge
          ? (Array.isArray(fridgeItems) ? fridgeItems : []).map((it) => ({
              id: it?.id,
              name: String(it?.name ?? ""),
              quantity: String(it?.quantity ?? ""),
              expiresAt: it?.expiresAt ?? null,
              tagIds: Array.isArray(it?.tagIds) ? it.tagIds : [],
              tagLabels: getItemTagLabels(it),
            }))
          : [],
      };

      return { __context: true, ...res, items };
    },

    // 🟡 Context-only tools
    findInFridge: async ({ name }) => {
      const n = norm(name);
      const item = (Array.isArray(fridgeItems) ? fridgeItems : []).find(
        (i) => norm(i.name) === n
      );
      return { __context: true, exists: !!item, ...(item || {}) };
    },

    findInShoppingList: async ({ name }) => {
      const n = norm(name);
      const item = (Array.isArray(shoppingListItems) ? shoppingListItems : []).find(
        (i) => norm(i.name) === n
      );
      return { __context: true, exists: !!item, ...(item || {}) };
    },

    getFridgeContents: async () => ({ __context: true, items: fridgeItems }),
    getShoppingListContents: async () => ({ __context: true, items: shoppingListItems }),

    proposeAddAllToFridge: async ({ items, title }) => {
      const clean = (v) => String(v ?? "").trim();
    
      const categoriesObjToArray = (cats) => {
        if (!cats || typeof cats !== "object" || Array.isArray(cats)) return undefined;
    
        // Order is intentional but not required
        const out = [
          clean(cats.storage),
          clean(cats.urgency),
          clean(cats.food_type),
          clean(cats.state),
        ].filter(Boolean);
    
        return out.length ? out : undefined;
      };
    
      const safeItems = (Array.isArray(items) ? items : [])
        .map((it) => {
          const name = clean(it?.name);
          if (!name) return null;
    
          return {
            name,
            quantity: clean(it?.quantity) || "1",
    
            // ✅ EXACTLY what addToFridge expects
            categories: categoriesObjToArray(it?.categories),
    
            // ✅ pass through; addToFridge decides precedence & prediction
            expiresAt:
              it?.expiresAt ??
              it?.expires_at ??
              it?.expirationDate ??
              it?.expiration_date ??
              undefined,
          };
        })
        .filter(Boolean);
    
      setMessages?.((prev) => [
        ...(Array.isArray(prev) ? prev : []),
        {
          role: "assistant",
          type: "ui_action",
          action: {
            kind: "add_all_to_fridge",
            title: title || "Add all to fridge",
            items: safeItems,
    
            // expiresAt is OPTIONAL – predictor will fill if missing
            requires: [],
          },
        },
      ]);
    },
    
  };
}
