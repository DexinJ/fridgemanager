import * as SecureStore from "expo-secure-store";

const LEGACY_AI_API_KEY_STORAGE_KEY = "pantrio.customAiApiKey";
// Keep the key used by the first per-provider release so its string-valued
// entries can be upgraded in place to { apiKey, model } provider profiles.
const AI_PROVIDER_SETTINGS_STORAGE_KEY = "pantrio.customAiApiKeys";
let secureStoreOperation = Promise.resolve();

export function normalizeAiBaseUrl(baseUrl) {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

function withSecureStoreLock(operation) {
  const result = secureStoreOperation.then(operation);
  secureStoreOperation = result.catch(() => {});
  return result;
}

async function getStoredProviderSettings() {
  const storedValue = await SecureStore.getItemAsync(
    AI_PROVIDER_SETTINGS_STORAGE_KEY
  );
  if (!storedValue) return {};

  try {
    const parsedValue = JSON.parse(storedValue);
    return parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)
      ? parsedValue
      : {};
  } catch {
    return {};
  }
}

async function storeProviderSettings(providerSettings) {
  if (Object.keys(providerSettings).length > 0) {
    await SecureStore.setItemAsync(
      AI_PROVIDER_SETTINGS_STORAGE_KEY,
      JSON.stringify(providerSettings)
    );
  } else {
    await SecureStore.deleteItemAsync(AI_PROVIDER_SETTINGS_STORAGE_KEY);
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

export async function getCustomAiProviderSettings(
  baseUrl,
  { migrateLegacy = false, fallbackModel = "" } = {}
) {
  const providerId = normalizeAiBaseUrl(baseUrl);
  if (!providerId) return { apiKey: "", model: "" };

  return withSecureStoreLock(async () => {
    const providerSettings = await getStoredProviderSettings();
    const storedSettings = providerSettings[providerId];
    const legacyModel = migrateLegacy ? fallbackModel : "";
    const savedSettings = normalizeProviderSettings(
      storedSettings,
      legacyModel
    );
    if (savedSettings) {
      if (typeof storedSettings === "string" && savedSettings.model) {
        providerSettings[providerId] = savedSettings;
        // Reading the existing key should still succeed if this opportunistic
        // in-place format upgrade cannot be written yet.
        await storeProviderSettings(providerSettings).catch(() => {});
      }
      return savedSettings;
    }

    // Only the hydrated, currently configured provider may claim the key from
    // the former single-provider storage format.
    if (migrateLegacy) {
      const legacyApiKey =
        (await SecureStore.getItemAsync(LEGACY_AI_API_KEY_STORAGE_KEY)) || "";
      if (legacyApiKey) {
        const migratedSettings = {
          apiKey: legacyApiKey.trim(),
          model: String(legacyModel || "").trim(),
        };
        providerSettings[providerId] = migratedSettings;
        await storeProviderSettings(providerSettings);
        await SecureStore.deleteItemAsync(LEGACY_AI_API_KEY_STORAGE_KEY);
        return migratedSettings;
      }
    }

    return { apiKey: "", model: "" };
  });
}

export async function setCustomAiProviderSettings(
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
    const providerSettings = await getStoredProviderSettings();
    if (nextSettings.apiKey || nextSettings.model) {
      providerSettings[providerId] = nextSettings;
    } else {
      delete providerSettings[providerId];
    }

    await storeProviderSettings(providerSettings);
  });
}

export async function clearCustomAiProviderSettings() {
  return withSecureStoreLock(() =>
    Promise.all([
      SecureStore.deleteItemAsync(AI_PROVIDER_SETTINGS_STORAGE_KEY),
      SecureStore.deleteItemAsync(LEGACY_AI_API_KEY_STORAGE_KEY),
    ])
  );
}
