// GlobalContext.js (edited)
// ✅ GlobalContext no longer calls useAuth().
// ✅ Instead, _layout passes the Firebase user into <GlobalProvider authUser={user} />
// ✅ Username fetch + settings.user hydration now depend on authUser, not on useAuth.

import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useColorScheme } from "react-native";
import { v4 as uuidv4 } from "uuid";
import { clearChatData, loadChatData } from "../api/memoryManager";

// ❌ REMOVED: import { useAuth } from "../auth/useAuth";

// ✅ utils you pasted
import { DEFAULT_ALMOST_EXPIRE_DAYS, getExpiryMeta } from "../utils/expiration";
import { predictExpiresAtIso, toIsoOrNull } from "../utils/expiryPredictor";
import { FOOD_TYPE_RULES, inferFoodTypeLabelFromName } from "../utils/foodTypeInference";
import {
  buildTagMaps,
  makeDedupeTagsByType,
  makeLabelToTagId,
  makeReplaceTagByType,
} from "../utils/itemTagLabels";
import { migrateFridgeItems, migrateShoppingItems } from "../utils/migrations";
import { buildTagById, findPresetTagId, normalizeToPresetTagIds } from "../utils/tags";

// ✅ Make sure you have this env set in Expo:
// EXPO_PUBLIC_API_BASE_URL=http://192.168.0.163:3000
const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:3000";

export const GlobalContext = createContext();

// ✅ central threshold (used everywhere)
const ALMOST_EXPIRE_DAYS = DEFAULT_ALMOST_EXPIRE_DAYS;

// ✅ CHANGED: GlobalProvider now accepts authUser from _layout
export const GlobalProvider = ({ children, authUser = null }) => {
  // --- Default settings ---
  const defaultSettings = useMemo(
    () => ({
      ux: { systemTheme: true, darkMode: false, fontSize: 16 },
      notifications: { turnOn: true, dailyReminders: true },
      privacy: { incognito: false },
      advanced: { modelChoice: "default" },
      expiration: { expirationAlerts: true, remindDays: 5 },
      user: { uid: null, name: "freeUser" },
    }),
    []
  );
  // ✅ store RAW data in state (we will compute `expired` at read-time)
  const [fridgeItemsRaw, setFridgeItemsRaw] = useState([]);
  const [shoppingListItems, setShoppingListItems] = useState([]);
  const [settings, setSettings] = useState(defaultSettings);
  const [urgencyDays, setUrgencyDays] = useState({
    expired: 0,
    eat_first: 2,
    use_soon: 7,
    lasts_a_while: 30,
    long_keeper: 180,
  });

  // 🏷️ Preset tags ONLY (no user-created tags)
  const PRESET_TAGS = useMemo(
    () => [
      // storage
      { id: "t_storage_fridge", type: "storage", key: "fridge", label: "Fridge" },
      { id: "t_storage_freezer", type: "storage", key: "freezer", label: "Freezer" },
      { id: "t_storage_pantry", type: "storage", key: "pantry", label: "Pantry" },

      // urgency buckets
      { id: "t_urgency_expired", type: "urgency", key: "expired", label: "Expired" },
      { id: "t_urgency_eat_first", type: "urgency", key: "eat_first", label: "Eat first" },
      { id: "t_urgency_use_soon", type: "urgency", key: "use_soon", label: "Use soon" },
      {
        id: "t_urgency_lasts_a_while",
        type: "urgency",
        key: "lasts_a_while",
        label: "Lasts a while",
      },
      { id: "t_urgency_long_keeper", type: "urgency", key: "long_keeper", label: "Long keeper" },

      // food types
      { id: "t_food_produce", type: "food_type", key: "produce", label: "Produce" },
      { id: "t_food_dairy", type: "food_type", key: "dairy", label: "Dairy" },
      { id: "t_food_meat", type: "food_type", key: "meat", label: "Meat" },
      { id: "t_food_seafood", type: "food_type", key: "seafood", label: "Seafood" },
      { id: "t_food_prepared", type: "food_type", key: "prepared", label: "Prepared" },
      { id: "t_food_condiment", type: "food_type", key: "condiment", label: "Condiments" },
      { id: "t_food_beverage", type: "food_type", key: "beverage", label: "Beverages" },
      { id: "t_food_snack", type: "food_type", key: "snack", label: "Snacks" },
      { id: "t_food_bakery", type: "food_type", key: "bakery", label: "Bakery" },
      { id: "t_food_frozen", type: "food_type", key: "frozen", label: "Frozen" },

      // state
      { id: "t_state_opened", type: "state", key: "opened", label: "Opened" },
      { id: "t_state_unopened", type: "state", key: "unopened", label: "Unopened" },
      { id: "t_state_raw", type: "state", key: "raw", label: "Raw" },
      { id: "t_state_cooked", type: "state", key: "cooked", label: "Cooked" },
      { id: "t_state_cut", type: "state", key: "cut", label: "Cut" },
      { id: "t_state_whole", type: "state", key: "whole", label: "Whole" },
    ],
    []
  );

  // Keep tags in state for easy access in UI, but always treat them as preset.
  const [tags] = useState(PRESET_TAGS);

  // -----------------------------
  // 🏷️ Tag indices + wrappers around utils/tags.js
  // -----------------------------
  const tagById = useMemo(() => buildTagById(tags), [tags]);

  const normalizeCategoriesToTagIds = useCallback(
    (categories) => normalizeToPresetTagIds({ categories, tags, tagById }),
    [tags, tagById]
  );

  const resolvePresetTagId = useCallback(
    (input) => findPresetTagId({ input, tags, tagById }),
    [tags, tagById]
  );

  // -----------------------------
  // 🍎 Food-type inference
  // -----------------------------
  const allowedFoodTypeLabels = useMemo(() => {
    return (tags || [])
      .filter((t) => t?.type === "food_type")
      .map((t) => t.label)
      .filter(Boolean);
  }, [tags]);

  const inferFoodTypeLabelFromNameSafe = useCallback(
    (name) => inferFoodTypeLabelFromName(name, allowedFoodTypeLabels, FOOD_TYPE_RULES),
    [allowedFoodTypeLabels]
  );

  // 🆕 Conversation state
  const [messages, setMessages] = useState([]);
  const [summary, setSummary] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [waiting, setWaiting] = useState(false);

  // system theme from device
  const systemScheme = useColorScheme();

  // ✅ CHANGED: no useAuth() here; use authUser passed from _layout
  const user = authUser;

  // ---------------------------
  // Smart chat persistence refs
  // ---------------------------
  const chatHydratedRef = useRef(false);
  const chatSaveTimerRef = useRef(null);
  const chatLastSavedAtRef = useRef(0);

  const lightTheme = {
    background: "#FFFFFF",
    card: "#f5f5f5",
    border: "#ddd",
    textPrimary: "#333",
    textSecondary: "#666",
    textPlaceholder: "#888",
    accent: "#2196F3",
    warning: "#FF9800",
    warningBackground: "#FFF1DD",
    actionButton: "#4CAF50",
    modalBackground: "rgba(0,0,0,0.9)",
    inputText: "#000",
    inputBackground: "#fff",
    userBubble: "#DCF8C6",
    aiBubble: "#EAEAEA",
    danger: "#E53935",
    dangerBackground: "#FFE5E5",
    cancelButton: "#ccc",
    shoppingItemBackground: "#eaf7ea",
    shoppingCheckedText: "#777",
  };

  const darkTheme = {
    background: "#111",
    card: "#1C1C1E",
    border: "#333",
    textPrimary: "#f5f5f5",
    textSecondary: "#aaa",
    textPlaceholder: "#888",
    accent: "#64B5F6",
    warning: "#FFB74D",
    warningBackground: "#3A2A14",
    actionButton: "#056162",
    modalBackground: "rgba(0,0,0,0.9)",
    inputText: "#fff",
    inputBackground: "#222",
    userBubble: "#056162",
    aiBubble: "#262d31",
    danger: "#EF5350",
    dangerBackground: "#3A1616",
    cancelButton: "#555",
    shoppingItemBackground: "#056162",
    shoppingCheckedText: "#aaa",
  };

  const theme = settings.ux.darkMode ? darkTheme : lightTheme;

  // --- Apply system theme if enabled ---
  useEffect(() => {
    if (settings.ux.systemTheme) {
      setSettings((prev) => ({
        ...prev,
        ux: { ...prev.ux, darkMode: systemScheme === "dark" },
      }));
    }
  }, [systemScheme, settings.ux.systemTheme]);

  // --- Load local data on startup ---
  useEffect(() => {
    const loadData = async () => {
      try {
        await AsyncStorage.removeItem("hasOnboarded");

        const [fridgeData, shoppingData, settingsData] = await Promise.all([
          AsyncStorage.getItem("@fridgeItems"),
          AsyncStorage.getItem("@shoppingListItems"),
          AsyncStorage.getItem("@appSettings"),
        ]);

        if (fridgeData) setFridgeItemsRaw(migrateFridgeItems(JSON.parse(fridgeData)));
        if (shoppingData) setShoppingListItems(migrateShoppingItems(JSON.parse(shoppingData)));

        if (settingsData) {
          const parsed = JSON.parse(settingsData);

          setSettings((prev) => ({
            ...prev,
            ...parsed,
            ux: { ...prev.ux, ...(parsed.ux || {}) },
            notifications: { ...prev.notifications, ...(parsed.notifications || {}) },
            privacy: { ...prev.privacy, ...(parsed.privacy || {}) },
            advanced: { ...prev.advanced, ...(parsed.advanced || {}) },
            expiration: { ...prev.expiration, ...(parsed.expiration || {}) },
            user: { ...prev.user, ...(parsed.user || {}) },
          }));
        }

        await loadChatData(setMessages, setSummary);
      } catch (e) {
        console.error("Error loading data", e);
      } finally {
        chatHydratedRef.current = true;
        chatLastSavedAtRef.current = Date.now();
      }
    };

    loadData();
  }, [defaultSettings]);

  // ---------------------------------------
  // ✅ Smart chat saving (throttle + flush)
  // ---------------------------------------
  useEffect(() => {
    if (!chatHydratedRef.current) return;

    const KEY = "@chatMessages";

    const doSave = async () => {
      try {
        chatLastSavedAtRef.current = Date.now();
        await AsyncStorage.setItem(KEY, JSON.stringify(messages));
      } catch (e) {
        console.warn("save @chatMessages failed:", e);
      }
    };

    if (chatSaveTimerRef.current) {
      clearTimeout(chatSaveTimerRef.current);
      chatSaveTimerRef.current = null;
    }

    if (receiving) {
      const THROTTLE_MS = 800;
      const elapsed = Date.now() - chatLastSavedAtRef.current;
      const wait = Math.max(THROTTLE_MS - elapsed, 0);

      chatSaveTimerRef.current = setTimeout(() => {
        doSave();
        chatSaveTimerRef.current = null;
      }, wait);

      return () => {
        if (chatSaveTimerRef.current) {
          clearTimeout(chatSaveTimerRef.current);
          chatSaveTimerRef.current = null;
        }
      };
    }

    doSave();

    return () => {
      if (chatSaveTimerRef.current) {
        clearTimeout(chatSaveTimerRef.current);
        chatSaveTimerRef.current = null;
      }
    };
  }, [messages, receiving]);

  // --- Fetch username from backend after login and store into settings.user ---
  // ✅ CHANGED: depends on authUser (user from props), not on useAuth()
  useEffect(() => {
    let cancelled = false;

    async function loadUserIntoSettings() {
      if (!user) {
        setSettings((prev) => ({ ...prev, user: { uid: null, name: "freeUser" } }));
        return;
      }

      try {
        const token = await user.getIdToken();
        const uid = user.uid;

        const resp = await fetch(`${API_BASE_URL}/api/users/${uid}`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!resp.ok) {
          if (!cancelled) {
            // keep uid but don't pretend we have a username
            setSettings((prev) => ({
              ...prev,
              user: { ...prev.user, uid: user.uid, name: prev.user?.name || "freeUser" },
            }));
          }
          return;
        }

        const data = await resp.json();

        if (!cancelled) {
          setSettings((prev) => ({
            ...prev,
            user: {
              ...prev.user,
              uid: data?.uid ?? user.uid,
              name: data?.username ?? prev.user?.name ?? "freeUser",
            },
          }));
        }
      } catch (e) {
        console.log("loadUserIntoSettings error:", e);
        if (!cancelled) {
          setSettings((prev) => ({
            ...prev,
            user: { ...prev.user, uid: user.uid, name: prev.user?.name || "freeUser" },
          }));
        }
      }
    }

    loadUserIntoSettings();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // --- Save all states whenever they change ---
  // ✅ persist RAW fridge items only (no computed `expired`)
  useEffect(() => {
    AsyncStorage.setItem("@fridgeItems", JSON.stringify(fridgeItemsRaw));
    AsyncStorage.setItem("@shoppingListItems", JSON.stringify(shoppingListItems));
    AsyncStorage.setItem("@appSettings", JSON.stringify(settings));
  }, [fridgeItemsRaw, shoppingListItems, settings]);

  // --- Settings updater ---
  const updateSetting = (section, key, value) => {
    setSettings((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: value },
    }));
  };

  const setUsername = (name) => {
    setSettings((prev) => ({
      ...prev,
      user: { ...prev.user, name: String(name || "freeUser") },
    }));
  };

  // -----------------------------
  // ✅ Expiration status ON EACH ITEM (no derived lists)
  // -----------------------------
  const fridgeItems = useMemo(() => {
    const { tagById, tagIdByKey } = buildTagMaps(tags || []);
    const labelToTagId = makeLabelToTagId(tagIdByKey);

    const replaceTagByType = makeReplaceTagByType(tagById);
    const dedupeTagsByType = makeDedupeTagsByType(tagById);

    return (fridgeItemsRaw || []).map((it) => {
      const meta = getExpiryMeta(it?.expiresAt, ALMOST_EXPIRE_DAYS, urgencyDays);
      const status = meta?.expired ? "expired" : meta?.almostExpired ? "almost" : "ok";

      const desiredUrgencyId = meta?.urgencyKey ? labelToTagId(meta.urgencyKey) : null;

      const curTagIds = Array.isArray(it.tagIds) ? it.tagIds : [];
      const nextTagIds = desiredUrgencyId
        ? dedupeTagsByType(replaceTagByType(curTagIds, "urgency", desiredUrgencyId))
        : dedupeTagsByType(curTagIds);

      return {
        ...it,
        tagIds: nextTagIds, // visual-only urgency switch
        expired: status,
        urgencyKey: meta?.urgencyKey || null,
      };
    });
  }, [fridgeItemsRaw, tags, getExpiryMeta, urgencyDays, ALMOST_EXPIRE_DAYS]);

  // -----------------------------
  // --- Fridge / Shopping helpers
  // -----------------------------
  const addToShoppingList = (name, quantity, categories) => {
    const tagIds = normalizeCategoriesToTagIds(categories);
    const now = new Date().toISOString();

    setShoppingListItems((prev) => [
      ...prev,
      { id: uuidv4(), name, quantity, tagIds, createdAt: now, updatedAt: now },
    ]);
  };

  const addToFridge = (name, quantity, categories, expiresAt) => {
    const tagIds = normalizeCategoriesToTagIds(categories);
    const nowIso = new Date().toISOString();

    let finalExpiresAt = toIsoOrNull(expiresAt);

    if (!finalExpiresAt) {
      finalExpiresAt = predictExpiresAtIso({
        createdAtIso: nowIso,
        tagIds,
        tagById,
      });
    }

    setFridgeItemsRaw((prev) => [
      ...prev,
      {
        id: uuidv4(),
        name,
        quantity,
        tagIds,
        createdAt: nowIso,
        updatedAt: nowIso,
        expiresAt: finalExpiresAt,
      },
    ]);
  };

  const removeFromFridge = (id) => {
    setFridgeItemsRaw((prev) => prev.filter((item) => item.id !== id));
  };

  const removeFromShoppingList = (id) => {
    setShoppingListItems((prev) => prev.filter((item) => item.id !== id));
  };

  const editFridgeItem = (id, updates = {}) => {
    if (!id) return;

    setFridgeItemsRaw((prev) => {
      const now = new Date().toISOString();

      return prev.map((it) => {
        if (it.id !== id) return it;

        const nextName = updates.name !== undefined ? String(updates.name) : it.name;
        const nextQty = updates.quantity !== undefined ? String(updates.quantity) : it.quantity;

        let nextTagIds = Array.isArray(it.tagIds) ? it.tagIds : [];
        if (updates.tagIds !== undefined) nextTagIds = normalizeCategoriesToTagIds(updates.tagIds);
        else if (updates.categories !== undefined) nextTagIds = normalizeCategoriesToTagIds(updates.categories);

        let nextExpiresAt =
          updates.expiresAt !== undefined ? toIsoOrNull(updates.expiresAt) : toIsoOrNull(it.expiresAt);

        if (updates.expiresAt !== undefined && nextExpiresAt === null) {
          nextExpiresAt = predictExpiresAtIso({
            createdAtIso: it.createdAt || now,
            tagIds: nextTagIds,
            tagById,
          });
        }

        return {
          ...it,
          name: nextName,
          quantity: nextQty,
          tagIds: nextTagIds,
          expiresAt: nextExpiresAt,
          updatedAt: now,
        };
      });
    });
  };

  const editShoppingListItem = (id, updates = {}) => {
    if (!id) return;

    setShoppingListItems((prev) => {
      const now = new Date().toISOString();

      return prev.map((it) => {
        if (it.id !== id) return it;

        const nextName = updates.name !== undefined ? String(updates.name) : it.name;
        const nextQty = updates.quantity !== undefined ? String(updates.quantity) : it.quantity;

        let nextTagIds = Array.isArray(it.tagIds) ? it.tagIds : [];
        if (updates.tagIds !== undefined) nextTagIds = normalizeCategoriesToTagIds(updates.tagIds);
        else if (updates.categories !== undefined) nextTagIds = normalizeCategoriesToTagIds(updates.categories);

        return { ...it, name: nextName, quantity: nextQty, tagIds: nextTagIds, updatedAt: now };
      });
    });
  };

  // -----------------------------
  // ✅ Simple tag helpers for UI actions
  // -----------------------------
  const addPresetTagToItem = ({ list = "fridge", itemId, tagInput }) => {
    const tagId = resolvePresetTagId(tagInput);
    if (!itemId || !tagId) return;

    const apply = (it) => {
      const cur = Array.isArray(it.tagIds) ? it.tagIds : [];
      if (cur.includes(tagId)) return it;
      return { ...it, tagIds: [...cur, tagId], updatedAt: new Date().toISOString() };
    };

    if (list === "shopping") {
      setShoppingListItems((prev) => prev.map((it) => (it.id === itemId ? apply(it) : it)));
    } else {
      setFridgeItemsRaw((prev) => prev.map((it) => (it.id === itemId ? apply(it) : it)));
    }
  };

  const removePresetTagFromItem = ({ list = "fridge", itemId, tagInput }) => {
    const tagId = resolvePresetTagId(tagInput);
    if (!itemId || !tagId) return;

    const apply = (it) => {
      const cur = Array.isArray(it.tagIds) ? it.tagIds : [];
      if (!cur.includes(tagId)) return it;
      return { ...it, tagIds: cur.filter((id) => id !== tagId), updatedAt: new Date().toISOString() };
    };

    if (list === "shopping") {
      setShoppingListItems((prev) => prev.map((it) => (it.id === itemId ? apply(it) : it)));
    } else {
      setFridgeItemsRaw((prev) => prev.map((it) => (it.id === itemId ? apply(it) : it)));
    }
  };

  // -----------------------------
  // ✅ Streamliner: normalize name/qty + optionally retag food_type
  // -----------------------------
  const streamlineLists = ({ scope = "both", retag = true, dryRun = false } = {}) => {
    const wantShopping = scope === "shopping" || scope === "both";
    const wantFridge = scope === "fridge" || scope === "both";

    const normalizeName = (name) => String(name ?? "").trim().replace(/\s+/g, " ");
    const normalizeQuantity = (qty) => String(qty ?? "").trim().replace(/\s+/g, " ");

    const isSameSet = (a, b) => {
      const aa = Array.isArray(a) ? a : [];
      const bb = Array.isArray(b) ? b : [];
      if (aa.length !== bb.length) return false;
      for (const id of aa) if (!bb.includes(id)) return false;
      return true;
    };

    const replaceFoodTypeOnly = (tagIds, inferredLabel) => {
      const inferredId = resolvePresetTagId(inferredLabel);
      if (!inferredId) return null;

      const current = Array.isArray(tagIds) ? tagIds : [];
      const filtered = current.filter((id) => tagById.get(id)?.type !== "food_type");
      return Array.from(new Set([...filtered, inferredId]));
    };

    const changes = { shopping: [], fridge: [] };

    const processOne = (listName, items) => {
      for (const it of items) {
        if (!it?.id) continue;

        const currentTags = Array.isArray(it.tagIds) ? it.tagIds : [];
        const hasTags = currentTags.length > 0;

        const nextName = normalizeName(it.name);
        const nextQty = normalizeQuantity(it.quantity);

        let nextTags = currentTags;

        const inferred = inferFoodTypeLabelFromNameSafe(nextName);
        const shouldApply = !!inferred && (retag || !hasTags);

        if (shouldApply) {
          const proposed = replaceFoodTypeOnly(currentTags, inferred);
          if (proposed) nextTags = proposed;
        }

        const nameChanged = nextName !== String(it.name ?? "");
        const qtyChanged = nextQty !== String(it.quantity ?? "");
        const tagsChanged = !isSameSet(currentTags, nextTags);

        if (nameChanged || qtyChanged || tagsChanged) {
          changes[listName].push({
            id: it.id,
            inferredFoodType: inferred || null,
            before: { name: it.name, quantity: it.quantity, tagIds: currentTags },
            after: { name: nextName, quantity: nextQty, tagIds: nextTags },
          });

          if (!dryRun) {
            const patch = {
              ...(nameChanged ? { name: nextName } : {}),
              ...(qtyChanged ? { quantity: nextQty } : {}),
              ...(tagsChanged ? { tagIds: nextTags } : {}),
            };

            if (listName === "shopping") editShoppingListItem(it.id, patch);
            else editFridgeItem(it.id, patch);
          }
        }
      }
    };

    if (wantShopping) processOne("shopping", shoppingListItems);
    if (wantFridge) processOne("fridge", fridgeItemsRaw);

    return {
      scope,
      dryRun,
      changed: {
        shopping: changes.shopping.length,
        fridge: changes.fridge.length,
        details: changes,
      },
    };
  };

  const clearAllData = async () => {
    try {
      setFridgeItemsRaw([]);
      setShoppingListItems([]);
      setSettings(defaultSettings);

      await AsyncStorage.multiRemove([
        "@fridgeItems",
        "@shoppingListItems",
        "@appSettings",
        "@chatMessages",
        "@chatSummary",
      ]);

      await clearChatData(setMessages, setSummary);
      console.log("All data cleared!");
    } catch (e) {
      console.error("Error clearing data", e);
    }
  };

  return (
    <GlobalContext.Provider
      value={{
        fridgeItems,
        shoppingListItems,
        settings,
        tags,

        FOOD_TYPE_RULES,
        inferFoodTypeLabelFromName: inferFoodTypeLabelFromNameSafe,
        streamlineLists,

        ALMOST_EXPIRE_DAYS,
        getExpiryMeta,
        urgencyDays,
        setUrgencyDays,

        messages,
        summary,
        setMessages,
        setSummary,
        receiving,
        setReceiving,
        waiting,
        setWaiting,

        addToFridge,
        addToShoppingList,
        removeFromFridge,
        removeFromShoppingList,
        editFridgeItem,
        editShoppingListItem,

        normalizeToPresetTagIds: normalizeCategoriesToTagIds,
        addPresetTagToItem,
        removePresetTagFromItem,

        updateSetting,
        setUsername,
        theme,
        clearAllData,
      }}
    >
      {children}
    </GlobalContext.Provider>
  );
};