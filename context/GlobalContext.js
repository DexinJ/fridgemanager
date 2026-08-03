// GlobalContext.js (edited)
// ✅ GlobalContext no longer calls useAuth().
// ✅ Instead, _layout passes the Firebase user into <GlobalProvider authUser={user} />
// ✅ Username fetch + settings.user hydration now depend on authUser, not on useAuth.

import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useColorScheme } from "react-native";
import { v4 as uuidv4 } from "uuid";
import { clearChatData, loadChatData } from "../api/memoryManager";
import { clearCustomAiApiKey } from "../api/aiProviderSettings";

// ❌ REMOVED: import { useAuth } from "../auth/useAuth";

// ✅ utils you pasted
import {
  DEFAULT_ALMOST_EXPIRE_DAYS,
  getExpiryMeta,
} from "../utils/expiration";
import {
  predictExpiresAtIso,
  toIsoOrNull,
} from "../utils/expiryPredictor";
import {
  FOOD_TYPE_RULES,
  inferFoodTypeLabelFromName,
} from "../utils/foodTypeInference";
import {
  buildTagMaps,
  makeDedupeTagsByType,
  makeLabelToTagId,
  makeReplaceTagByType,
} from "../utils/itemTagLabels";
import {
  migrateFridgeItems,
  migrateShoppingItems,
} from "../utils/migrations";
import {
  buildTagById,
  findPresetTagId,
  normalizeToPresetTagIds,
} from "../utils/tags";

const AI_PROVIDER_VALUES = new Set(["pantrio", "apple", "custom"]);

// ✅ Make sure you have this env set in Expo:
// EXPO_PUBLIC_API_BASE_URL=http://192.168.0.163:3000
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || "http://localhost:3000";

export const GlobalContext = createContext();

// ✅ central threshold (used everywhere)
const ALMOST_EXPIRE_DAYS = DEFAULT_ALMOST_EXPIRE_DAYS;

// ✅ CHANGED: GlobalProvider now accepts authUser from _layout
export const GlobalProvider = ({ children, authUser = null }) => {
  // --- Default settings ---
  const defaultSettings = useMemo(
    () => ({
      ux: {
        systemTheme: true,
        darkMode: false,
        fontSize: 16,
      },
      notifications: {
        turnOn: true,
        dailyReminders: true,
      },
      privacy: {
        incognito: false,
      },
      advanced: {
        aiProvider: "pantrio",
        useCustomAi: false,
        aiBaseUrl: "https://api.openai.com/v1",
        aiModel: "gpt-4o-mini",
      },
      expiration: {
        expirationAlerts: true,
        remindDays: 5,
      },
      user: {
        uid: null,
        name: "freeUser",
      },
    }),
    []
  );

  // ✅ store RAW data in state
  // We compute `expired` at read-time.
  const [fridgeItemsRaw, setFridgeItemsRaw] = useState([]);
  const [shoppingListItems, setShoppingListItems] = useState([]);
  const [settings, setSettings] = useState(defaultSettings);

  // ✅ FIX 1:
  // Prevent empty/default state from being saved before
  // AsyncStorage finishes loading.
  const [storageHydrated, setStorageHydrated] = useState(false);

  const [urgencyDays, setUrgencyDays] = useState({
    expired: 0,
    eat_first: 2,
    use_soon: 7,
    lasts_a_while: 30,
    long_keeper: 180,
  });

  // 🏷️ Preset tags ONLY
  const PRESET_TAGS = useMemo(
    () => [
      // storage
      {
        id: "t_storage_fridge",
        type: "storage",
        key: "fridge",
        label: "Fridge",
      },
      {
        id: "t_storage_freezer",
        type: "storage",
        key: "freezer",
        label: "Freezer",
      },
      {
        id: "t_storage_pantry",
        type: "storage",
        key: "pantry",
        label: "Pantry",
      },

      // urgency buckets
      {
        id: "t_urgency_expired",
        type: "urgency",
        key: "expired",
        label: "Expired",
      },
      {
        id: "t_urgency_eat_first",
        type: "urgency",
        key: "eat_first",
        label: "Eat first",
      },
      {
        id: "t_urgency_use_soon",
        type: "urgency",
        key: "use_soon",
        label: "Use soon",
      },
      {
        id: "t_urgency_lasts_a_while",
        type: "urgency",
        key: "lasts_a_while",
        label: "Lasts a while",
      },
      {
        id: "t_urgency_long_keeper",
        type: "urgency",
        key: "long_keeper",
        label: "Long keeper",
      },

      // food types
      {
        id: "t_food_produce",
        type: "food_type",
        key: "produce",
        label: "Produce",
      },
      {
        id: "t_food_dairy",
        type: "food_type",
        key: "dairy",
        label: "Dairy",
      },
      {
        id: "t_food_meat",
        type: "food_type",
        key: "meat",
        label: "Meat",
      },
      {
        id: "t_food_seafood",
        type: "food_type",
        key: "seafood",
        label: "Seafood",
      },
      {
        id: "t_food_prepared",
        type: "food_type",
        key: "prepared",
        label: "Prepared",
      },
      {
        id: "t_food_condiment",
        type: "food_type",
        key: "condiment",
        label: "Condiments",
      },
      {
        id: "t_food_beverage",
        type: "food_type",
        key: "beverage",
        label: "Beverages",
      },
      {
        id: "t_food_snack",
        type: "food_type",
        key: "snack",
        label: "Snacks",
      },
      {
        id: "t_food_bakery",
        type: "food_type",
        key: "bakery",
        label: "Bakery",
      },
      {
        id: "t_food_frozen",
        type: "food_type",
        key: "frozen",
        label: "Frozen",
      },

      // state
      {
        id: "t_state_opened",
        type: "state",
        key: "opened",
        label: "Opened",
      },
      {
        id: "t_state_unopened",
        type: "state",
        key: "unopened",
        label: "Unopened",
      },
      {
        id: "t_state_raw",
        type: "state",
        key: "raw",
        label: "Raw",
      },
      {
        id: "t_state_cooked",
        type: "state",
        key: "cooked",
        label: "Cooked",
      },
      {
        id: "t_state_cut",
        type: "state",
        key: "cut",
        label: "Cut",
      },
      {
        id: "t_state_whole",
        type: "state",
        key: "whole",
        label: "Whole",
      },
    ],
    []
  );

  // Keep tags in state for easy access in UI,
  // but always treat them as preset.
  const [tags] = useState(PRESET_TAGS);

  // -----------------------------
  // 🏷️ Tag indices
  // -----------------------------
  const tagById = useMemo(() => buildTagById(tags), [tags]);

  const normalizeCategoriesToTagIds = useCallback(
    (categories) =>
      normalizeToPresetTagIds({
        categories,
        tags,
        tagById,
      }),
    [tags, tagById]
  );

  const resolvePresetTagId = useCallback(
    (input) =>
      findPresetTagId({
        input,
        tags,
        tagById,
      }),
    [tags, tagById]
  );

  // -----------------------------
  // 🍎 Food-type inference
  // -----------------------------
  const allowedFoodTypeLabels = useMemo(() => {
    return (tags || [])
      .filter((tag) => tag?.type === "food_type")
      .map((tag) => tag.label)
      .filter(Boolean);
  }, [tags]);

  const inferFoodTypeLabelFromNameSafe = useCallback(
    (name) =>
      inferFoodTypeLabelFromName(
        name,
        allowedFoodTypeLabels,
        FOOD_TYPE_RULES
      ),
    [allowedFoodTypeLabels]
  );

  // Conversation state
  const [messages, setMessages] = useState([]);
  const [summary, setSummary] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [waiting, setWaiting] = useState(false);

  // System theme from device
  const systemScheme = useColorScheme();

  // ✅ CHANGED:
  // Use authUser passed from _layout.
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
        ux: {
          ...prev.ux,
          darkMode: systemScheme === "dark",
        },
      }));
    }
  }, [systemScheme, settings.ux.systemTheme]);

  // ---------------------------------------
  // Load local data on startup
  // ---------------------------------------

  // ✅ FIX 2:
  // Finish loading fridge items, shopping items,
  // and settings before enabling saves.
  useEffect(() => {
    let cancelled = false;

    const loadData = async () => {
      try {
        const [fridgeData, shoppingData, settingsData] =
          await Promise.all([
            AsyncStorage.getItem("@fridgeItems"),
            AsyncStorage.getItem("@shoppingListItems"),
            AsyncStorage.getItem("@appSettings"),
          ]);

        if (cancelled) return;

        if (fridgeData) {
          const parsedFridgeData = JSON.parse(fridgeData);

          setFridgeItemsRaw(
            migrateFridgeItems(parsedFridgeData)
          );
        }

        if (shoppingData) {
          const parsedShoppingData = JSON.parse(shoppingData);

          setShoppingListItems(
            migrateShoppingItems(parsedShoppingData)
          );
        }

        if (settingsData) {
          const parsedSettings = JSON.parse(settingsData);
          const storedAdvanced = parsedSettings.advanced || {};
          const restoredAiProvider = AI_PROVIDER_VALUES.has(
            storedAdvanced.aiProvider
          )
            ? storedAdvanced.aiProvider
            : storedAdvanced.useCustomAi
              ? "custom"
              : "pantrio";

          setSettings((prev) => ({
            ...prev,
            ...parsedSettings,
            ux: {
              ...prev.ux,
              ...(parsedSettings.ux || {}),
            },
            notifications: {
              ...prev.notifications,
              ...(parsedSettings.notifications || {}),
            },
            privacy: {
              ...prev.privacy,
              ...(parsedSettings.privacy || {}),
            },
            advanced: {
              ...prev.advanced,
              ...storedAdvanced,
              aiProvider: restoredAiProvider,
              useCustomAi: restoredAiProvider === "custom",
            },
            expiration: {
              ...prev.expiration,
              ...(parsedSettings.expiration || {}),
            },
            user: {
              ...prev.user,
              ...(parsedSettings.user || {}),
            },
          }));
        }

        await loadChatData(setMessages, setSummary);
      } catch (error) {
        console.error("Error loading local data:", error);
      } finally {
        if (!cancelled) {
          chatHydratedRef.current = true;
          chatLastSavedAtRef.current = Date.now();

          // ✅ FIX 2:
          // Saving is now allowed because startup loading
          // has completed.
          setStorageHydrated(true);
        }
      }
    };

    loadData();

    return () => {
      cancelled = true;
    };
  }, [defaultSettings]);

  // ---------------------------------------
  // Smart chat saving
  // ---------------------------------------
  useEffect(() => {
    if (!chatHydratedRef.current) return;

    const KEY = "@chatMessages";

    const doSave = async () => {
      try {
        chatLastSavedAtRef.current = Date.now();

        await AsyncStorage.setItem(
          KEY,
          JSON.stringify(messages)
        );
      } catch (error) {
        console.warn(
          "save @chatMessages failed:",
          error
        );
      }
    };

    if (chatSaveTimerRef.current) {
      clearTimeout(chatSaveTimerRef.current);
      chatSaveTimerRef.current = null;
    }

    if (receiving) {
      const THROTTLE_MS = 800;
      const elapsed =
        Date.now() - chatLastSavedAtRef.current;
      const wait = Math.max(
        THROTTLE_MS - elapsed,
        0
      );

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

  // ---------------------------------------
  // Fetch username after login
  // ---------------------------------------
  useEffect(() => {
    let cancelled = false;

    async function loadUserIntoSettings() {
      if (!user) {
        setSettings((prev) => ({
          ...prev,
          user: {
            uid: null,
            name: "freeUser",
          },
        }));

        return;
      }

      try {
        const token = await user.getIdToken();
        const uid = user.uid;

        const response = await fetch(
          `${API_BASE_URL}/api/users/${uid}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        if (!response.ok) {
          if (!cancelled) {
            setSettings((prev) => ({
              ...prev,
              user: {
                ...prev.user,
                uid: user.uid,
                name:
                  prev.user?.name ||
                  "freeUser",
              },
            }));
          }

          return;
        }

        const data = await response.json();

        if (!cancelled) {
          setSettings((prev) => ({
            ...prev,
            user: {
              ...prev.user,
              uid: data?.uid ?? user.uid,
              name:
                data?.username ??
                prev.user?.name ??
                "freeUser",
            },
          }));
        }
      } catch (error) {
        console.log(
          "loadUserIntoSettings error:",
          error
        );

        if (!cancelled) {
          setSettings((prev) => ({
            ...prev,
            user: {
              ...prev.user,
              uid: user.uid,
              name:
                prev.user?.name ||
                "freeUser",
            },
          }));
        }
      }
    }

    loadUserIntoSettings();

    return () => {
      cancelled = true;
    };
  }, [user]);

  // ---------------------------------------
  // Save fridge, shopping list, and settings
  // ---------------------------------------

  // ✅ FIX 3:
  // Do not overwrite stored data with initial empty/default
  // values during app startup.
  useEffect(() => {
    if (!storageHydrated) return;

    const saveData = async () => {
      try {
        await Promise.all([
          AsyncStorage.setItem(
            "@fridgeItems",
            JSON.stringify(fridgeItemsRaw)
          ),
          AsyncStorage.setItem(
            "@shoppingListItems",
            JSON.stringify(shoppingListItems)
          ),
          AsyncStorage.setItem(
            "@appSettings",
            JSON.stringify(settings)
          ),
        ]);
      } catch (error) {
        console.error(
          "Error saving local data:",
          error
        );
      }
    };

    saveData();
  }, [
    storageHydrated,
    fridgeItemsRaw,
    shoppingListItems,
    settings,
  ]);

  // --- Settings updater ---
  const updateSetting = (
    section,
    key,
    value
  ) => {
    setSettings((prev) => ({
      ...prev,
      [section]: {
        ...prev[section],
        [key]: value,
      },
    }));
  };

  const setUsername = (name) => {
    setSettings((prev) => ({
      ...prev,
      user: {
        ...prev.user,
        name: String(name || "freeUser"),
      },
    }));
  };

  // -----------------------------
  // Expiration status on each item
  // -----------------------------
  const fridgeItems = useMemo(() => {
    const {
      tagById: mappedTagById,
      tagIdByKey,
    } = buildTagMaps(tags || []);

    const labelToTagId =
      makeLabelToTagId(tagIdByKey);

    const replaceTagByType =
      makeReplaceTagByType(mappedTagById);

    const dedupeTagsByType =
      makeDedupeTagsByType(mappedTagById);

    return (fridgeItemsRaw || []).map(
      (item) => {
        const meta = getExpiryMeta(
          item?.expiresAt,
          ALMOST_EXPIRE_DAYS,
          urgencyDays
        );

        const status = meta?.expired
          ? "expired"
          : meta?.almostExpired
            ? "almost"
            : "ok";

        const desiredUrgencyId =
          meta?.urgencyKey
            ? labelToTagId(meta.urgencyKey)
            : null;

        const currentTagIds =
          Array.isArray(item.tagIds)
            ? item.tagIds
            : [];

        const nextTagIds =
          desiredUrgencyId
            ? dedupeTagsByType(
                replaceTagByType(
                  currentTagIds,
                  "urgency",
                  desiredUrgencyId
                )
              )
            : dedupeTagsByType(
                currentTagIds
              );

        return {
          ...item,
          tagIds: nextTagIds,
          expired: status,
          urgencyKey:
            meta?.urgencyKey || null,
        };
      }
    );
  }, [
    fridgeItemsRaw,
    tags,
    urgencyDays,
  ]);

  // -----------------------------
  // Fridge and shopping helpers
  // -----------------------------
  const addToShoppingList = (
    name,
    quantity,
    categories
  ) => {
    const tagIds =
      normalizeCategoriesToTagIds(
        categories
      );

    const now = new Date().toISOString();

    setShoppingListItems((prev) => [
      ...prev,
      {
        id: uuidv4(),
        name,
        quantity,
        tagIds,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  };

  const addToFridge = (
    name,
    quantity,
    categories,
    expiresAt
  ) => {
    const tagIds =
      normalizeCategoriesToTagIds(
        categories
      );

    const nowIso =
      new Date().toISOString();

    let finalExpiresAt =
      toIsoOrNull(expiresAt);

    if (!finalExpiresAt) {
      finalExpiresAt =
        predictExpiresAtIso({
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
    setFridgeItemsRaw((prev) =>
      prev.filter(
        (item) => item.id !== id
      )
    );
  };

  const removeFromShoppingList = (
    id
  ) => {
    setShoppingListItems((prev) =>
      prev.filter(
        (item) => item.id !== id
      )
    );
  };

  const editFridgeItem = (
    id,
    updates = {}
  ) => {
    if (!id) return;

    setFridgeItemsRaw((prev) => {
      const now =
        new Date().toISOString();

      return prev.map((item) => {
        if (item.id !== id) {
          return item;
        }

        const nextName =
          updates.name !== undefined
            ? String(updates.name)
            : item.name;

        const nextQuantity =
          updates.quantity !== undefined
            ? String(updates.quantity)
            : item.quantity;

        let nextTagIds =
          Array.isArray(item.tagIds)
            ? item.tagIds
            : [];

        if (
          updates.tagIds !== undefined
        ) {
          nextTagIds =
            normalizeCategoriesToTagIds(
              updates.tagIds
            );
        } else if (
          updates.categories !== undefined
        ) {
          nextTagIds =
            normalizeCategoriesToTagIds(
              updates.categories
            );
        }

        let nextExpiresAt =
          updates.expiresAt !== undefined
            ? toIsoOrNull(
                updates.expiresAt
              )
            : toIsoOrNull(
                item.expiresAt
              );

        if (
          updates.expiresAt !== undefined &&
          nextExpiresAt === null
        ) {
          nextExpiresAt =
            predictExpiresAtIso({
              createdAtIso:
                item.createdAt || now,
              tagIds: nextTagIds,
              tagById,
            });
        }

        return {
          ...item,
          name: nextName,
          quantity: nextQuantity,
          tagIds: nextTagIds,
          expiresAt: nextExpiresAt,
          updatedAt: now,
        };
      });
    });
  };

  const editShoppingListItem = (
    id,
    updates = {}
  ) => {
    if (!id) return;

    setShoppingListItems((prev) => {
      const now =
        new Date().toISOString();

      return prev.map((item) => {
        if (item.id !== id) {
          return item;
        }

        const nextName =
          updates.name !== undefined
            ? String(updates.name)
            : item.name;

        const nextQuantity =
          updates.quantity !== undefined
            ? String(updates.quantity)
            : item.quantity;

        let nextTagIds =
          Array.isArray(item.tagIds)
            ? item.tagIds
            : [];

        if (
          updates.tagIds !== undefined
        ) {
          nextTagIds =
            normalizeCategoriesToTagIds(
              updates.tagIds
            );
        } else if (
          updates.categories !== undefined
        ) {
          nextTagIds =
            normalizeCategoriesToTagIds(
              updates.categories
            );
        }

        return {
          ...item,
          name: nextName,
          quantity: nextQuantity,
          tagIds: nextTagIds,
          updatedAt: now,
        };
      });
    });
  };

  // -----------------------------
  // Preset-tag helpers
  // -----------------------------
  const addPresetTagToItem = ({
    list = "fridge",
    itemId,
    tagInput,
  }) => {
    const tagId =
      resolvePresetTagId(tagInput);

    if (!itemId || !tagId) return;

    const apply = (item) => {
      const currentTagIds =
        Array.isArray(item.tagIds)
          ? item.tagIds
          : [];

      if (
        currentTagIds.includes(tagId)
      ) {
        return item;
      }

      return {
        ...item,
        tagIds: [
          ...currentTagIds,
          tagId,
        ],
        updatedAt:
          new Date().toISOString(),
      };
    };

    if (list === "shopping") {
      setShoppingListItems((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? apply(item)
            : item
        )
      );
    } else {
      setFridgeItemsRaw((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? apply(item)
            : item
        )
      );
    }
  };

  const removePresetTagFromItem = ({
    list = "fridge",
    itemId,
    tagInput,
  }) => {
    const tagId =
      resolvePresetTagId(tagInput);

    if (!itemId || !tagId) return;

    const apply = (item) => {
      const currentTagIds =
        Array.isArray(item.tagIds)
          ? item.tagIds
          : [];

      if (
        !currentTagIds.includes(tagId)
      ) {
        return item;
      }

      return {
        ...item,
        tagIds:
          currentTagIds.filter(
            (id) => id !== tagId
          ),
        updatedAt:
          new Date().toISOString(),
      };
    };

    if (list === "shopping") {
      setShoppingListItems((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? apply(item)
            : item
        )
      );
    } else {
      setFridgeItemsRaw((prev) =>
        prev.map((item) =>
          item.id === itemId
            ? apply(item)
            : item
        )
      );
    }
  };

  // -----------------------------
  // Streamline lists
  // -----------------------------
  const streamlineLists = ({
    scope = "both",
    retag = true,
    dryRun = false,
  } = {}) => {
    const wantShopping =
      scope === "shopping" ||
      scope === "both";

    const wantFridge =
      scope === "fridge" ||
      scope === "both";

    const normalizeName = (name) =>
      String(name ?? "")
        .trim()
        .replace(/\s+/g, " ");

    const normalizeQuantity = (
      quantity
    ) =>
      String(quantity ?? "")
        .trim()
        .replace(/\s+/g, " ");

    const isSameSet = (a, b) => {
      const first =
        Array.isArray(a) ? a : [];

      const second =
        Array.isArray(b) ? b : [];

      if (
        first.length !== second.length
      ) {
        return false;
      }

      for (const id of first) {
        if (!second.includes(id)) {
          return false;
        }
      }

      return true;
    };

    const replaceFoodTypeOnly = (
      tagIds,
      inferredLabel
    ) => {
      const inferredId =
        resolvePresetTagId(
          inferredLabel
        );

      if (!inferredId) return null;

      const currentTagIds =
        Array.isArray(tagIds)
          ? tagIds
          : [];

      const filteredTagIds =
        currentTagIds.filter(
          (id) =>
            tagById.get(id)?.type !==
            "food_type"
        );

      return Array.from(
        new Set([
          ...filteredTagIds,
          inferredId,
        ])
      );
    };

    const changes = {
      shopping: [],
      fridge: [],
    };

    const processOne = (
      listName,
      items
    ) => {
      for (const item of items) {
        if (!item?.id) continue;

        const currentTagIds =
          Array.isArray(item.tagIds)
            ? item.tagIds
            : [];

        const hasTags =
          currentTagIds.length > 0;

        const nextName =
          normalizeName(item.name);

        const nextQuantity =
          normalizeQuantity(
            item.quantity
          );

        let nextTagIds =
          currentTagIds;

        const inferred =
          inferFoodTypeLabelFromNameSafe(
            nextName
          );

        const shouldApply =
          Boolean(inferred) &&
          (retag || !hasTags);

        if (shouldApply) {
          const proposed =
            replaceFoodTypeOnly(
              currentTagIds,
              inferred
            );

          if (proposed) {
            nextTagIds = proposed;
          }
        }

        const nameChanged =
          nextName !==
          String(item.name ?? "");

        const quantityChanged =
          nextQuantity !==
          String(item.quantity ?? "");

        const tagsChanged =
          !isSameSet(
            currentTagIds,
            nextTagIds
          );

        if (
          nameChanged ||
          quantityChanged ||
          tagsChanged
        ) {
          changes[listName].push({
            id: item.id,
            inferredFoodType:
              inferred || null,
            before: {
              name: item.name,
              quantity:
                item.quantity,
              tagIds:
                currentTagIds,
            },
            after: {
              name: nextName,
              quantity:
                nextQuantity,
              tagIds: nextTagIds,
            },
          });

          if (!dryRun) {
            const patch = {
              ...(nameChanged
                ? { name: nextName }
                : {}),
              ...(quantityChanged
                ? {
                    quantity:
                      nextQuantity,
                  }
                : {}),
              ...(tagsChanged
                ? {
                    tagIds:
                      nextTagIds,
                  }
                : {}),
            };

            if (
              listName === "shopping"
            ) {
              editShoppingListItem(
                item.id,
                patch
              );
            } else {
              editFridgeItem(
                item.id,
                patch
              );
            }
          }
        }
      }
    };

    if (wantShopping) {
      processOne(
        "shopping",
        shoppingListItems
      );
    }

    if (wantFridge) {
      processOne(
        "fridge",
        fridgeItemsRaw
      );
    }

    return {
      scope,
      dryRun,
      changed: {
        shopping:
          changes.shopping.length,
        fridge:
          changes.fridge.length,
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
      await clearCustomAiApiKey();

      await clearChatData(
        setMessages,
        setSummary
      );

      console.log(
        "All data cleared!"
      );
    } catch (error) {
      console.error(
        "Error clearing data:",
        error
      );
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
        inferFoodTypeLabelFromName:
          inferFoodTypeLabelFromNameSafe,
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

        normalizeToPresetTagIds:
          normalizeCategoriesToTagIds,
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
