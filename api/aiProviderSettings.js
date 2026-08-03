import * as SecureStore from "expo-secure-store";

const AI_API_KEY_STORAGE_KEY = "pantrio.customAiApiKey";

export async function getCustomAiApiKey() {
  return (await SecureStore.getItemAsync(AI_API_KEY_STORAGE_KEY)) || "";
}

export async function setCustomAiApiKey(apiKey) {
  const value = String(apiKey || "").trim();
  if (value) {
    await SecureStore.setItemAsync(AI_API_KEY_STORAGE_KEY, value);
  } else {
    await SecureStore.deleteItemAsync(AI_API_KEY_STORAGE_KEY);
  }
}

export async function clearCustomAiApiKey() {
  await SecureStore.deleteItemAsync(AI_API_KEY_STORAGE_KEY);
}
