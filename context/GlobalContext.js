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
import { API_BASE_URL } from "../api/backendConfig";
import { fetchWithTimeout } from "../api/fetchWithTimeout";
import { clearChatData, loadChatData } from "../api/memoryManager";
import {
  clearCustomAiProviderSettings,
  migrateLegacyCustomAiProviderSettings,
} from "../api/aiProviderSettings";
import {
  clearUserDataPurgePending,
  getUserDataPurgeIntent,
  getUserStorageKeys,
  listUserDataPurgeIntents,
  markUserDataPurgePending,
  migrateLegacyAsyncStorageForUser,
  recordUserDataPurgeFailure,
} from "../api/storageKeys";

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
const STORAGE_SLICE_NAMES = ["fridge", "shopping", "settings", "chat"];

function createStorageHydrationState({ resolved = false } = {}) {
  return Object.fromEntries(
    STORAGE_SLICE_NAMES.map((slice) => [
      slice,
      { resolved, writeEnabled: false, error: null },
    ])
  );
}

function isPlainRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseStoredArray(value, label) {
  if (value === null) return [];
  const parsedValue = JSON.parse(value);
  if (!Array.isArray(parsedValue)) {
    throw new Error(`Stored ${label} data must be an array.`);
  }
  return parsedValue;
}

function parseStoredSettings(value) {
  if (value === null) return null;
  const parsedValue = JSON.parse(value);
  if (!isPlainRecord(parsedValue)) {
    throw new Error("Stored settings must be an object.");
  }
  return parsedValue;
}

function mergeStoredSettings(previousSettings, parsedSettings) {
  if (!parsedSettings) return previousSettings;

  const storedUx = isPlainRecord(parsedSettings.ux) ? parsedSettings.ux : {};
  const storedNotifications = isPlainRecord(parsedSettings.notifications)
    ? parsedSettings.notifications
    : {};
  const storedPrivacy = isPlainRecord(parsedSettings.privacy)
    ? parsedSettings.privacy
    : {};
  const storedAdvanced = isPlainRecord(parsedSettings.advanced)
    ? parsedSettings.advanced
    : {};
  const storedExpiration = isPlainRecord(parsedSettings.expiration)
    ? parsedSettings.expiration
    : {};
  const storedUser = isPlainRecord(parsedSettings.user)
    ? parsedSettings.user
    : {};
  const restoredAiProvider = AI_PROVIDER_VALUES.has(storedAdvanced.aiProvider)
    ? storedAdvanced.aiProvider
    : storedAdvanced.useCustomAi
      ? "custom"
      : "pantrio";

  return {
    ...previousSettings,
    ...parsedSettings,
    ux: { ...previousSettings.ux, ...storedUx },
    notifications: {
      ...previousSettings.notifications,
      ...storedNotifications,
    },
    privacy: { ...previousSettings.privacy, ...storedPrivacy },
    advanced: {
      ...previousSettings.advanced,
      ...storedAdvanced,
      aiProvider: restoredAiProvider,
      useCustomAi: restoredAiProvider === "custom",
    },
    expiration: { ...previousSettings.expiration, ...storedExpiration },
    user: { ...previousSettings.user, ...storedUser },
  };
}

function errorMessage(error) {
  return String(error?.message || error || "Unknown storage error");
}

async function purgeStoredUserData(uid) {
  const storageKeys = getUserStorageKeys(uid);
  const operations = [
    ["fridge", () => AsyncStorage.removeItem(storageKeys.fridgeItems)],
    [
      "shopping",
      () => AsyncStorage.removeItem(storageKeys.shoppingListItems),
    ],
    ["settings", () => AsyncStorage.removeItem(storageKeys.appSettings)],
    ["customAi", () => clearCustomAiProviderSettings(uid)],
    [
      "chat",
      async () => {
        const result = await clearChatData(uid);
        if (!result.ok) throw result.error || new Error("Chat purge failed.");
      },
    ],
  ];
  const settledOperations = await Promise.allSettled(
    operations.map(([, operation]) => operation())
  );
  const outcomes = {};
  const cleared = [];
  const errors = [];

  settledOperations.forEach((result, index) => {
    const scope = operations[index][0];
    if (result.status === "fulfilled") {
      outcomes[scope] = true;
      cleared.push(scope);
      return;
    }

    outcomes[scope] = false;
    errors.push({
      scope,
      message: errorMessage(result.reason),
      cause: result.reason,
    });
  });

  return { ok: errors.length === 0, outcomes, cleared, errors };
}

function publicPurgeResult(result) {
  return {
    ok: result.ok,
    pendingRetry: !result.ok,
    cleared: result.cleared,
    errors: result.errors.map(({ scope, message }) => ({ scope, message })),
  };
}

async function completePendingUserDataPurge(uid) {
  const intent = await getUserDataPurgeIntent(uid);
  if (
    intent &&
    intent.phase !== "confirmed" &&
    intent.phase !== "purging"
  ) {
    return {
      ok: false,
      outcomes: {},
      cleared: [],
      errors: [
        {
          scope: "purgeIntent",
          message:
            "The pending data cleanup has not been confirmed yet.",
        },
      ],
      awaitingConfirmation: true,
    };
  }

  const purgeResult = await purgeStoredUserData(uid);

  if (purgeResult.ok) {
    try {
      await clearUserDataPurgePending(uid);
      return purgeResult;
    } catch (error) {
      purgeResult.ok = false;
      purgeResult.errors.push({
        scope: "purgeIntent",
        message: errorMessage(error),
        cause: error,
      });
    }
  }

  try {
    await recordUserDataPurgeFailure(
      uid,
      purgeResult.errors[0]?.cause || new Error("User data purge failed.")
    );
  } catch (error) {
    purgeResult.errors.push({
      scope: "purgeJournal",
      message: errorMessage(error),
      cause: error,
    });
  }

  return purgeResult;
}

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

  // A failed read may finish startup, but that slice stays read-only so its
  // recoverable stored value is never overwritten with an in-memory default.
  const [storageHydration, setStorageHydration] = useState(() =>
    createStorageHydrationState()
  );
  const [storageHydrationAttempt, setStorageHydrationAttempt] = useState(0);
  const [storagePurgeResult, setStoragePurgeResult] = useState(null);
  const storageHydrated = STORAGE_SLICE_NAMES.every(
    (slice) => storageHydration[slice].resolved
  );
  const storageHydrationErrors = useMemo(
    () =>
      Object.fromEntries(
        STORAGE_SLICE_NAMES.flatMap((slice) =>
          storageHydration[slice].error
            ? [[slice, errorMessage(storageHydration[slice].error)]]
            : []
        )
      ),
    [storageHydration]
  );

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
  const storageOwnerUid = user?.uid || null;

  // ---------------------------
  // Smart chat persistence refs
  // ---------------------------
  const storageWriteEnabledRef = useRef(
    Object.fromEntries(STORAGE_SLICE_NAMES.map((slice) => [slice, false]))
  );
  const retryStorageHydration = useCallback(() => {
    storageWriteEnabledRef.current = Object.fromEntries(
      STORAGE_SLICE_NAMES.map((slice) => [slice, false])
    );
    setStorageHydration(createStorageHydrationState());
    setStoragePurgeResult(null);
    setStorageHydrationAttempt((attempt) => attempt + 1);
  }, []);
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

  // Per-slice hydration prevents a corrupt/read-failed slice from being saved.
  useEffect(() => {
    let cancelled = false;

    const resetHydration = () => {
      storageWriteEnabledRef.current = Object.fromEntries(
        STORAGE_SLICE_NAMES.map((slice) => [slice, false])
      );
      if (!cancelled) setStorageHydration(createStorageHydrationState());
    };

    const resolveSlice = (slice, { writeEnabled, error = null }) => {
      if (cancelled) return;
      storageWriteEnabledRef.current = {
        ...storageWriteEnabledRef.current,
        [slice]: writeEnabled,
      };
      setStorageHydration((previous) => ({
        ...previous,
        [slice]: { resolved: true, writeEnabled, error },
      }));
    };

    const resolveAllReadOnly = (error = null) => {
      if (cancelled) return;
      storageWriteEnabledRef.current = Object.fromEntries(
        STORAGE_SLICE_NAMES.map((slice) => [slice, false])
      );
      setStorageHydration(
        Object.fromEntries(
          STORAGE_SLICE_NAMES.map((slice) => [
            slice,
            { resolved: true, writeEnabled: false, error },
          ])
        )
      );
    };

    const loadData = async () => {
      resetHydration();

      let pendingPurgeIntents;
      try {
        pendingPurgeIntents = await listUserDataPurgeIntents();
      } catch (error) {
        if (!cancelled) {
          setStoragePurgeResult({
            ok: false,
            pendingRetry: true,
            cleared: [],
            errors: [{ scope: "purgeJournal", message: errorMessage(error) }],
          });
          resolveAllReadOnly(error);
        }
        return;
      }

      const sweepCleared = [];
      for (const intent of pendingPurgeIntents) {
        if (intent.phase !== "confirmed" && intent.phase !== "purging") {
          continue;
        }
        const result = await completePendingUserDataPurge(intent.uid);
        if (cancelled) return;
        sweepCleared.push(...result.cleared);
        if (!result.ok) {
          const visibleResult = publicPurgeResult(result);
          setStoragePurgeResult(visibleResult);
          resolveAllReadOnly(
            new Error(
              visibleResult.errors[0]?.message || "Pending data purge failed."
            )
          );
          return;
        }
      }

      if (cancelled) return;
      if (pendingPurgeIntents.length > 0) {
        setStoragePurgeResult({
          ok: true,
          pendingRetry: false,
          cleared: sweepCleared,
          errors: [],
        });
      }

      if (!storageOwnerUid) {
        chatLastSavedAtRef.current = Date.now();
        resolveAllReadOnly();
        return;
      }

      let legacyMigrationError = null;
      try {
        await migrateLegacyAsyncStorageForUser(storageOwnerUid);
      } catch (error) {
        legacyMigrationError = error;
        console.error("Legacy local data migration failed:", error);
      }

      const storageKeys = getUserStorageKeys(storageOwnerUid);
      const [fridgeResult, shoppingResult, settingsResult, chatResult] =
        await Promise.allSettled([
          AsyncStorage.getItem(storageKeys.fridgeItems),
          AsyncStorage.getItem(storageKeys.shoppingListItems),
          AsyncStorage.getItem(storageKeys.appSettings),
          loadChatData(storageOwnerUid),
        ]);
      if (cancelled) return;

      let fridgeData = [];
      let fridgeError = null;
      try {
        if (fridgeResult.status === "rejected") throw fridgeResult.reason;
        fridgeData = migrateFridgeItems(
          parseStoredArray(fridgeResult.value, "fridge")
        );
        if (!Array.isArray(fridgeData)) {
          throw new Error("Migrated fridge data must be an array.");
        }
      } catch (error) {
        fridgeError = error;
      }

      let shoppingData = [];
      let shoppingError = null;
      try {
        if (shoppingResult.status === "rejected") throw shoppingResult.reason;
        shoppingData = migrateShoppingItems(
          parseStoredArray(shoppingResult.value, "shopping list")
        );
        if (!Array.isArray(shoppingData)) {
          throw new Error("Migrated shopping list data must be an array.");
        }
      } catch (error) {
        shoppingError = error;
      }

      let parsedSettings = null;
      let settingsLoadError = null;
      try {
        if (settingsResult.status === "rejected") throw settingsResult.reason;
        parsedSettings = parseStoredSettings(settingsResult.value);
      } catch (error) {
        settingsLoadError = error;
      }

      const storedAdvanced = isPlainRecord(parsedSettings?.advanced)
        ? parsedSettings.advanced
        : {};
      let settingsMigrationError = null;
      try {
        await migrateLegacyCustomAiProviderSettings(storageOwnerUid, {
          baseUrl:
            storedAdvanced.aiBaseUrl || defaultSettings.advanced.aiBaseUrl,
          fallbackModel:
            storedAdvanced.aiModel || defaultSettings.advanced.aiModel,
        });
      } catch (error) {
        settingsMigrationError = error;
        console.error("Legacy AI provider migration failed:", error);
      }
      const settingsError = settingsLoadError || settingsMigrationError;

      let chatData = null;
      let chatError = null;
      if (chatResult.status === "fulfilled") {
        chatData = chatResult.value;
      } else {
        chatError = chatResult.reason;
      }

      if (cancelled) return;

      if (!fridgeError) setFridgeItemsRaw(fridgeData);
      if (!shoppingError) setShoppingListItems(shoppingData);
      if (!settingsLoadError) {
        setSettings((previous) =>
          mergeStoredSettings(previous, parsedSettings)
        );
      }
      if (!chatError) {
        setMessages(chatData.messages);
        setSummary(chatData.summary);
      }
      chatLastSavedAtRef.current = Date.now();

      resolveSlice("fridge", {
        writeEnabled: !fridgeError && !legacyMigrationError,
        error: fridgeError || legacyMigrationError,
      });
      resolveSlice("shopping", {
        writeEnabled: !shoppingError && !legacyMigrationError,
        error: shoppingError || legacyMigrationError,
      });
      resolveSlice("settings", {
        writeEnabled: !settingsError && !legacyMigrationError,
        error: settingsError || legacyMigrationError,
      });
      resolveSlice("chat", {
        writeEnabled: !chatError && !legacyMigrationError,
        error: chatError || legacyMigrationError,
      });
    };

    loadData();

    return () => {
      cancelled = true;
    };
  }, [defaultSettings, storageHydrationAttempt, storageOwnerUid]);

  // ---------------------------------------
  // Smart chat saving
  // ---------------------------------------
  useEffect(() => {
    if (
      !storageHydration.chat.writeEnabled ||
      !storageWriteEnabledRef.current.chat ||
      !storageOwnerUid
    ) {
      return;
    }

    const { chatMessages } = getUserStorageKeys(storageOwnerUid);

    const doSave = async () => {
      if (!storageWriteEnabledRef.current.chat) return;
      try {
        chatLastSavedAtRef.current = Date.now();

        await AsyncStorage.setItem(
          chatMessages,
          JSON.stringify(messages)
        );
      } catch (error) {
        storageWriteEnabledRef.current = {
          ...storageWriteEnabledRef.current,
          chat: false,
        };
        setStorageHydration((previous) => ({
          ...previous,
          chat: { resolved: true, writeEnabled: false, error },
        }));
        console.warn(
          "save scoped chat messages failed:",
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
  }, [
    messages,
    receiving,
    storageHydration.chat.writeEnabled,
    storageOwnerUid,
  ]);

  // ---------------------------------------
  // Fetch username after login
  // ---------------------------------------
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadUserIntoSettings() {
      // Let the UID-scoped local settings finish hydrating first so a late
      // local read cannot overwrite the authoritative backend username.
      if (!storageHydrated) return;

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

        const response = await fetchWithTimeout(
          `${API_BASE_URL}/api/users/${uid}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            signal: controller.signal,
          },
          {
            timeoutMessage:
              "Loading the account profile timed out. Please try again.",
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
        if (__DEV__ && !cancelled && error?.name !== "AbortError") {
          console.log(
            "loadUserIntoSettings error:",
            error
          );
        }

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
      controller.abort();
    };
  }, [storageHydrated, user]);

  // ---------------------------------------
  // Save fridge, shopping list, and settings
  // ---------------------------------------

  const markStorageWriteFailure = useCallback((slice, error) => {
    storageWriteEnabledRef.current = {
      ...storageWriteEnabledRef.current,
      [slice]: false,
    };
    setStorageHydration((previous) => ({
      ...previous,
      [slice]: { resolved: true, writeEnabled: false, error },
    }));
  }, []);

  // Each persisted slice is gated by its own successful hydration.
  useEffect(() => {
    if (
      !storageHydration.fridge.writeEnabled ||
      !storageWriteEnabledRef.current.fridge ||
      !storageOwnerUid
    ) {
      return;
    }

    const { fridgeItems } = getUserStorageKeys(storageOwnerUid);
    AsyncStorage.setItem(fridgeItems, JSON.stringify(fridgeItemsRaw)).catch(
      (error) => {
        markStorageWriteFailure("fridge", error);
        console.error("Error saving fridge data:", error);
      }
    );
  }, [
    fridgeItemsRaw,
    markStorageWriteFailure,
    storageHydration.fridge.writeEnabled,
    storageOwnerUid,
  ]);

  useEffect(() => {
    if (
      !storageHydration.shopping.writeEnabled ||
      !storageWriteEnabledRef.current.shopping ||
      !storageOwnerUid
    ) {
      return;
    }

    const { shoppingListItems: shoppingKey } =
      getUserStorageKeys(storageOwnerUid);
    AsyncStorage.setItem(
      shoppingKey,
      JSON.stringify(shoppingListItems)
    ).catch((error) => {
      markStorageWriteFailure("shopping", error);
      console.error("Error saving shopping list data:", error);
    });
  }, [
    markStorageWriteFailure,
    shoppingListItems,
    storageHydration.shopping.writeEnabled,
    storageOwnerUid,
  ]);

  useEffect(() => {
    if (
      !storageHydration.settings.writeEnabled ||
      !storageWriteEnabledRef.current.settings ||
      !storageOwnerUid
    ) {
      return;
    }

    const { appSettings } = getUserStorageKeys(storageOwnerUid);
    AsyncStorage.setItem(appSettings, JSON.stringify(settings)).catch(
      (error) => {
        markStorageWriteFailure("settings", error);
        console.error("Error saving settings:", error);
      }
    );
  }, [
    markStorageWriteFailure,
    settings,
    storageHydration.settings.writeEnabled,
    storageOwnerUid,
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
    if (!storageOwnerUid) {
      setFridgeItemsRaw([]);
      setShoppingListItems([]);
      setSettings(defaultSettings);
      setMessages([]);
      setSummary("");
      const result = {
        ok: true,
        pendingRetry: false,
        cleared: ["fridge", "shopping", "settings", "chat"],
        errors: [],
      };
      setStoragePurgeResult(result);
      return result;
    }

    storageWriteEnabledRef.current = Object.fromEntries(
      STORAGE_SLICE_NAMES.map((slice) => [slice, false])
    );
    setStorageHydration((previous) =>
      Object.fromEntries(
        STORAGE_SLICE_NAMES.map((slice) => [
          slice,
          {
            resolved: true,
            writeEnabled: false,
            error: previous[slice]?.error || null,
          },
        ])
      )
    );
    if (chatSaveTimerRef.current) {
      clearTimeout(chatSaveTimerRef.current);
      chatSaveTimerRef.current = null;
    }

    let journalError = null;
    let keepWritesDisabled = false;
    try {
      const existingIntent = await getUserDataPurgeIntent(storageOwnerUid);
      keepWritesDisabled = existingIntent?.reason === "account-delete";
    } catch (error) {
      journalError = error;
      console.error("Could not read the data purge intent:", error);
    }
    try {
      await markUserDataPurgePending(storageOwnerUid, {
        reason: "clear-all",
      });
    } catch (error) {
      journalError ||= error;
      console.error("Could not persist the data purge intent:", error);
    }

    let purgeResult;
    try {
      purgeResult = await completePendingUserDataPurge(storageOwnerUid);
    } catch (error) {
      purgeResult = {
        ok: false,
        outcomes: {},
        cleared: [],
        errors: [
          {
            scope: "purge",
            message: errorMessage(error),
            cause: error,
          },
        ],
      };
    }

    if (journalError && !purgeResult.ok) {
      purgeResult.errors.push({
        scope: "purgeJournal",
        message: errorMessage(journalError),
        cause: journalError,
      });
    }

    if (purgeResult.outcomes.fridge) setFridgeItemsRaw([]);
    if (purgeResult.outcomes.shopping) setShoppingListItems([]);
    if (purgeResult.outcomes.settings) setSettings(defaultSettings);
    if (purgeResult.outcomes.chat) {
      setMessages([]);
      setSummary("");
    }

    const sharedPurgeError = purgeResult.ok
      ? null
      : new Error(
          purgeResult.errors[0]?.message || "Local data purge is incomplete."
        );
    const writesEnabled = purgeResult.ok && !keepWritesDisabled;
    storageWriteEnabledRef.current = Object.fromEntries(
      STORAGE_SLICE_NAMES.map((slice) => [slice, writesEnabled])
    );
    setStorageHydration(
      Object.fromEntries(
        STORAGE_SLICE_NAMES.map((slice) => [
          slice,
          {
            resolved: true,
            writeEnabled: writesEnabled,
            error: sharedPurgeError,
          },
        ])
      )
    );

    const visibleResult = publicPurgeResult(purgeResult);
    setStoragePurgeResult(visibleResult);

    if (__DEV__ && visibleResult.ok) {
      console.log("All scoped local data cleared.");
    }
    if (!visibleResult.ok) {
      console.error("Local data purge is incomplete:", visibleResult.errors);
    }

    return visibleResult;
  };

  return (
    <GlobalContext.Provider
      value={{
        fridgeItems,
        shoppingListItems,
        settings,
        retryStorageHydration,
        storageHydrated,
        storageHydration,
        storageHydrationAttempt,
        storageHydrationErrors,
        storageOwnerUid,
        storagePurgeResult,
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
