import AsyncStorage from "@react-native-async-storage/async-storage";

const AUTH_PROVISIONING_INTENT_KEY = "@pantrio:authProvisioning:v1";
const AUTH_PROVISIONING_INTENT_VERSION = 1;

function normalizeProvider(provider) {
  const value = String(provider || "unknown").trim().toLowerCase();
  return value.slice(0, 40) || "unknown";
}

function normalizeIntent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return {
    version: AUTH_PROVISIONING_INTENT_VERSION,
    provider: normalizeProvider(value.provider),
    uid:
      typeof value.uid === "string" && value.uid.trim()
        ? value.uid.trim()
        : null,
    startedAt:
      typeof value.startedAt === "string"
        ? value.startedAt
        : new Date().toISOString(),
  };
}

export async function getAuthProvisioningIntent() {
  const storedValue = await AsyncStorage.getItem(AUTH_PROVISIONING_INTENT_KEY);
  if (storedValue === null) return null;

  try {
    return normalizeIntent(JSON.parse(storedValue));
  } catch {
    // An unreadable marker must remain pending. Treating it as absent could
    // publish a Firebase user whose backend profile was never committed.
    return {
      version: AUTH_PROVISIONING_INTENT_VERSION,
      provider: "unknown",
      uid: null,
      startedAt: null,
      invalid: true,
    };
  }
}

export async function markAuthProvisioningStarted(provider) {
  const intent = {
    version: AUTH_PROVISIONING_INTENT_VERSION,
    provider: normalizeProvider(provider),
    uid: null,
    startedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(
    AUTH_PROVISIONING_INTENT_KEY,
    JSON.stringify(intent)
  );
  return intent;
}

export async function bindAuthProvisioningUser(uid) {
  const normalizedUid = String(uid || "").trim();
  if (!normalizedUid) {
    throw new Error("A Firebase user is required to finish account setup.");
  }

  const existingIntent = await getAuthProvisioningIntent();
  if (!existingIntent) {
    throw new Error("The account-setup operation is no longer active.");
  }

  const nextIntent = {
    version: AUTH_PROVISIONING_INTENT_VERSION,
    provider: normalizeProvider(existingIntent.provider),
    uid: normalizedUid,
    startedAt: existingIntent.startedAt || new Date().toISOString(),
  };
  await AsyncStorage.setItem(
    AUTH_PROVISIONING_INTENT_KEY,
    JSON.stringify(nextIntent)
  );
  return nextIntent;
}

export async function clearAuthProvisioningIntent() {
  await AsyncStorage.removeItem(AUTH_PROVISIONING_INTENT_KEY);
}

