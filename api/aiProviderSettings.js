import * as SecureStore from "expo-secure-store";
import {
  getUserSecureStorageKey,
  isLegacyStorageOwner,
} from "./storageKeys";

const LEGACY_AI_API_KEY_STORAGE_KEY = "pantrio.customAiApiKey";
// This was the first per-provider key, but it was shared by every account on
// the device. It is now used only as a one-time migration source.
const LEGACY_AI_PROVIDER_SETTINGS_STORAGE_KEY = "pantrio.customAiApiKeys";
const USER_AI_PROVIDER_SETTINGS_KEY_NAME = "customAiProviderSettings";
let secureStoreOperation = Promise.resolve();

export function normalizeAiBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function withSecureStoreLock(operation) {
  const result = secureStoreOperation.then(operation, operation);
  secureStoreOperation = result.catch(() => {});
  return result;
}

function getSettingsStorageKey(uid) {
  return getUserSecureStorageKey(uid, USER_AI_PROVIDER_SETTINGS_KEY_NAME);
}

function parseProviderSettings(storedValue) {
  if (!storedValue) return {};

  try {
    const parsedValue = JSON.parse(storedValue);
    return parsedValue &&
      typeof parsedValue === "object" &&
      !Array.isArray(parsedValue)
      ? parsedValue
      : {};
  } catch {
    return {};
  }
}

async function getStoredProviderSettings(uid) {
  const storedValue = await SecureStore.getItemAsync(getSettingsStorageKey(uid));
  return parseProviderSettings(storedValue);
}

async function storeProviderSettings(uid, providerSettings) {
  const storageKey = getSettingsStorageKey(uid);

  if (Object.keys(providerSettings).length > 0) {
    await SecureStore.setItemAsync(storageKey, JSON.stringify(providerSettings));
  } else {
    await SecureStore.deleteItemAsync(storageKey);
  }
}

function normalizeProviderSettings(value, fallbackModel = "") {
  if (typeof value === "string") {
    return {
      apiKey: value.trim(),
      model: String(fallbackModel || "").trim(),
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return {
    apiKey: String(value.apiKey || "").trim(),
    model: String(value.model || fallbackModel || "").trim(),
  };
}

async function migrateLegacyProviderSettingsUnlocked(
  uid,
  { baseUrl = "", fallbackModel = "" } = {}
) {
  if (!(await isLegacyStorageOwner(uid))) return false;

  const providerId = normalizeAiBaseUrl(baseUrl);
  const [legacyProviderValue, legacyApiKey] = await Promise.all([
    SecureStore.getItemAsync(LEGACY_AI_PROVIDER_SETTINGS_STORAGE_KEY),
    SecureStore.getItemAsync(LEGACY_AI_API_KEY_STORAGE_KEY),
  ]);

  if (legacyProviderValue === null && legacyApiKey === null) return false;

  const providerSettings = await getStoredProviderSettings(uid);
  const legacyProviderSettings = parseProviderSettings(legacyProviderValue);
  let changed = false;

  Object.entries(legacyProviderSettings).forEach(([legacyBaseUrl, value]) => {
    const legacyProviderId = normalizeAiBaseUrl(legacyBaseUrl);
    if (!legacyProviderId || Object.hasOwn(providerSettings, legacyProviderId)) {
      return;
    }

    const normalizedSettings = normalizeProviderSettings(
      value,
      legacyProviderId === providerId ? fallbackModel : ""
    );
    if (normalizedSettings) {
      providerSettings[legacyProviderId] = normalizedSettings;
      changed = true;
    }
  });

  if (
    legacyApiKey &&
    providerId &&
    !Object.hasOwn(providerSettings, providerId)
  ) {
    providerSettings[providerId] = {
      apiKey: legacyApiKey.trim(),
      model: String(fallbackModel || "").trim(),
    };
    changed = true;
  }

  if (changed) {
    await storeProviderSettings(uid, providerSettings);
  }

  await Promise.all([
    SecureStore.deleteItemAsync(LEGACY_AI_PROVIDER_SETTINGS_STORAGE_KEY),
    SecureStore.deleteItemAsync(LEGACY_AI_API_KEY_STORAGE_KEY),
  ]);

  return true;
}

export async function migrateLegacyCustomAiProviderSettings(
  uid,
  options = {}
) {
  return withSecureStoreLock(() =>
    migrateLegacyProviderSettingsUnlocked(uid, options)
  );
}

export async function getCustomAiProviderSettings(
  uid,
  baseUrl,
  { migrateLegacy = false, fallbackModel = "" } = {}
) {
  const providerId = normalizeAiBaseUrl(baseUrl);
  if (!providerId) return { apiKey: "", model: "" };

  return withSecureStoreLock(async () => {
    if (migrateLegacy) {
      await migrateLegacyProviderSettingsUnlocked(uid, {
        baseUrl: providerId,
        fallbackModel,
      });
    }

    const providerSettings = await getStoredProviderSettings(uid);
    const storedSettings = providerSettings[providerId];
    const savedSettings = normalizeProviderSettings(storedSettings, fallbackModel);

    if (savedSettings) {
      if (typeof storedSettings === "string" && savedSettings.model) {
        providerSettings[providerId] = savedSettings;
        // Reading should still succeed if this opportunistic format upgrade
        // cannot be written yet.
        await storeProviderSettings(uid, providerSettings).catch(() => {});
      }
      return savedSettings;
    }

    return { apiKey: "", model: "" };
  });
}

export async function setCustomAiProviderSettings(
  uid,
  baseUrl,
  { apiKey, model } = {}
) {
  const providerId = normalizeAiBaseUrl(baseUrl);
  if (!providerId) {
    throw new Error("An API base URL is required before saving its settings.");
  }

  const nextSettings = {
    apiKey: String(apiKey || "").trim(),
    model: String(model || "").trim(),
  };

  return withSecureStoreLock(async () => {
    const providerSettings = await getStoredProviderSettings(uid);
    if (nextSettings.apiKey || nextSettings.model) {
      providerSettings[providerId] = nextSettings;
    } else {
      delete providerSettings[providerId];
    }

    await storeProviderSettings(uid, providerSettings);
  });
}

export async function clearCustomAiProviderSettings(uid) {
  return withSecureStoreLock(() =>
    SecureStore.deleteItemAsync(getSettingsStorageKey(uid))
  );
}
