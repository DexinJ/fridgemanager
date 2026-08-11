import AsyncStorage from "@react-native-async-storage/async-storage";

const { shouldClearLegacyOwnedData } = require("./legacyPurgePolicy.cjs");

const USER_STORAGE_PREFIX = "@pantrio:user";
const LEGACY_STORAGE_OWNER_KEY = "@pantrio:legacyStorageOwner:v1";
const LEGACY_STORAGE_QUARANTINE_PREFIX = "@pantrio:legacyQuarantine:v1";
const USER_DATA_PURGE_INTENT_VERSION = 1;
const USER_DATA_PURGE_INTENT_SUFFIX = ":purgeIntent";
const USER_DATA_PURGE_PHASES = new Set(["requested", "confirmed", "purging"]);

export const LEGACY_ASYNC_STORAGE_KEYS = Object.freeze({
  fridgeItems: "@fridgeItems",
  shoppingListItems: "@shoppingListItems",
  appSettings: "@appSettings",
  chatMessages: "@chatMessages",
  chatSummary: "@chatSummary",
});

let legacyMigrationOperation = Promise.resolve();

function normalizeUid(uid) {
  const normalizedUid = String(uid || "").trim();
  if (!normalizedUid) {
    throw new Error("An authenticated user is required for local storage.");
  }
  return normalizedUid;
}

function encodeUid(uid) {
  return Array.from(normalizeUid(uid), (character) =>
    character.codePointAt(0).toString(16).padStart(6, "0")
  ).join("");
}

function decodeUid(encodedUid) {
  if (!encodedUid || encodedUid.length % 6 !== 0 || /[^0-9a-f]/i.test(encodedUid)) {
    return null;
  }

  try {
    const codePoints = [];
    for (let index = 0; index < encodedUid.length; index += 6) {
      codePoints.push(Number.parseInt(encodedUid.slice(index, index + 6), 16));
    }
    return String.fromCodePoint(...codePoints);
  } catch {
    return null;
  }
}

function uidFromPurgeIntentKey(key) {
  const prefix = `${USER_STORAGE_PREFIX}:`;
  if (!key.startsWith(prefix) || !key.endsWith(USER_DATA_PURGE_INTENT_SUFFIX)) {
    return null;
  }

  return decodeUid(
    key.slice(prefix.length, -USER_DATA_PURGE_INTENT_SUFFIX.length)
  );
}

function withLegacyMigrationLock(operation) {
  const result = legacyMigrationOperation.then(operation, operation);
  legacyMigrationOperation = result.catch(() => {});
  return result;
}

export function getUserStorageKeys(uid) {
  const namespace = `${USER_STORAGE_PREFIX}:${encodeUid(uid)}`;

  return {
    fridgeItems: `${namespace}:fridgeItems`,
    shoppingListItems: `${namespace}:shoppingListItems`,
    appSettings: `${namespace}:appSettings`,
    chatMessages: `${namespace}:chatMessages`,
    chatSummary: `${namespace}:chatSummary`,
    purgeIntent: `${namespace}:purgeIntent`,
  };
}

export function getUserSecureStorageKey(uid, name) {
  const normalizedName = String(name || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]/g, "_");

  if (!normalizedName) {
    throw new Error("A secure storage key name is required.");
  }

  return `pantrio.user.${encodeUid(uid)}.${normalizedName}`;
}

export async function getLegacyStorageOwner() {
  const ownerUid = await AsyncStorage.getItem(LEGACY_STORAGE_OWNER_KEY);
  return ownerUid ? String(ownerUid).trim() || null : null;
}

export async function isLegacyStorageOwner(uid) {
  return (await getLegacyStorageOwner()) === normalizeUid(uid);
}

function normalizePurgeReason(reason) {
  return String(reason || "clear-all").trim().slice(0, 80) || "clear-all";
}

function normalizePurgeIntent(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  return {
    version: USER_DATA_PURGE_INTENT_VERSION,
    uid:
      typeof value.uid === "string" && value.uid.trim()
        ? value.uid.trim()
        : null,
    reason: normalizePurgeReason(value.reason),
    phase: USER_DATA_PURGE_PHASES.has(value.phase)
      ? value.phase
      : normalizePurgeReason(value.reason) === "account-delete"
        ? "requested"
        : "confirmed",
    requestedAt:
      typeof value.requestedAt === "string" ? value.requestedAt : null,
    attempts:
      Number.isSafeInteger(value.attempts) && value.attempts >= 0
        ? value.attempts
        : 0,
    lastAttemptAt:
      typeof value.lastAttemptAt === "string" ? value.lastAttemptAt : null,
    lastError:
      typeof value.lastError === "string"
        ? value.lastError.slice(0, 500)
        : null,
  };
}

function parsePurgeIntent(storedValue, fallbackUid) {
  try {
    const parsedValue = JSON.parse(storedValue);
    const normalizedIntent = normalizePurgeIntent(parsedValue);
    if (normalizedIntent) {
      return {
        ...normalizedIntent,
        // The UID encoded in the key is authoritative. A corrupt marker must
        // never be able to redirect a purge to a different account namespace.
        uid: fallbackUid || normalizedIntent.uid,
      };
    }
  } catch {
    // Fall through to an intentionally pending invalid marker.
  }

  return {
    version: USER_DATA_PURGE_INTENT_VERSION,
    uid: fallbackUid,
    reason: "unknown",
    phase: "requested",
    requestedAt: null,
    attempts: 0,
    lastAttemptAt: null,
    lastError: "The stored purge intent could not be parsed.",
  };
}

export async function getUserDataPurgeIntent(uid) {
  const normalizedUid = normalizeUid(uid);
  const { purgeIntent } = getUserStorageKeys(uid);
  const storedValue = await AsyncStorage.getItem(purgeIntent);
  if (storedValue === null) return null;

  // An unreadable marker must still be treated as pending. Treating it as
  // absent could expose data that a previous deletion attempt meant to purge.
  return parsePurgeIntent(storedValue, normalizedUid);
}

export async function listUserDataPurgeIntents() {
  const allKeys = await AsyncStorage.getAllKeys();
  const purgeIntentKeys = allKeys.filter(
    (key) => uidFromPurgeIntentKey(key) !== null
  );
  if (purgeIntentKeys.length === 0) return [];

  const entries = await AsyncStorage.multiGet(purgeIntentKeys);
  return entries
    .filter(([, value]) => value !== null)
    .map(([key, value]) => parsePurgeIntent(value, uidFromPurgeIntentKey(key)))
    .filter((intent) => intent.uid);
}

export async function markUserDataPurgePending(
  uid,
  { reason = "clear-all", phase } = {}
) {
  const normalizedUid = normalizeUid(uid);
  const { purgeIntent } = getUserStorageKeys(uid);
  const existingIntent = await getUserDataPurgeIntent(uid);
  const normalizedReason = normalizePurgeReason(existingIntent?.reason || reason);
  const requestedPhase = USER_DATA_PURGE_PHASES.has(phase)
    ? phase
    : normalizedReason === "account-delete"
      ? "requested"
      : "confirmed";
  const nextIntent = {
    version: USER_DATA_PURGE_INTENT_VERSION,
    uid: normalizedUid,
    reason: normalizedReason,
    phase:
      existingIntent?.phase === "confirmed" ||
      existingIntent?.phase === "purging"
        ? existingIntent.phase
        : requestedPhase,
    requestedAt: existingIntent?.requestedAt || new Date().toISOString(),
    attempts: existingIntent?.attempts || 0,
    lastAttemptAt: existingIntent?.lastAttemptAt || null,
    lastError: existingIntent?.lastError || null,
  };

  await AsyncStorage.setItem(purgeIntent, JSON.stringify(nextIntent));
  return nextIntent;
}

export async function confirmUserDataPurge(uid) {
  const existingIntent = await getUserDataPurgeIntent(uid);
  return markUserDataPurgePending(uid, {
    reason: existingIntent?.reason || "account-delete",
    phase: "confirmed",
  });
}

export async function recordUserDataPurgeFailure(uid, error) {
  const { purgeIntent } = getUserStorageKeys(uid);
  const existingIntent =
    (await getUserDataPurgeIntent(uid)) ||
    (await markUserDataPurgePending(uid));
  const nextIntent = {
    ...existingIntent,
    attempts: existingIntent.attempts + 1,
    lastAttemptAt: new Date().toISOString(),
    lastError: String(error?.message || error || "Unknown purge failure").slice(
      0,
      500
    ),
  };

  await AsyncStorage.setItem(purgeIntent, JSON.stringify(nextIntent));
  return nextIntent;
}

export async function clearUserDataPurgePending(uid) {
  const { purgeIntent } = getUserStorageKeys(uid);
  await AsyncStorage.removeItem(purgeIntent);
}

export async function clearLegacyStorageQuarantine() {
  const allKeys = await AsyncStorage.getAllKeys();
  const quarantineKeys = allKeys.filter((key) =>
    key.startsWith(`${LEGACY_STORAGE_QUARANTINE_PREFIX}:`)
  );
  if (quarantineKeys.length > 0) {
    await AsyncStorage.multiRemove(quarantineKeys);
  }
  return quarantineKeys.length;
}

export async function clearLegacyStorageForUser(uid) {
  const normalizedUid = normalizeUid(uid);

  return withLegacyMigrationLock(async () => {
    const [ownerUid, allKeys] = await Promise.all([
      getLegacyStorageOwner(),
      AsyncStorage.getAllKeys(),
    ]);
    const keysToRemove = allKeys.filter((key) =>
      key.startsWith(`${LEGACY_STORAGE_QUARANTINE_PREFIX}:`)
    );

    if (shouldClearLegacyOwnedData(ownerUid, normalizedUid)) {
      keysToRemove.push(
        ...Object.values(LEGACY_ASYNC_STORAGE_KEYS),
        LEGACY_STORAGE_OWNER_KEY
      );
    }

    const uniqueKeys = [...new Set(keysToRemove)];
    if (uniqueKeys.length > 0) {
      await AsyncStorage.multiRemove(uniqueKeys);
    }
    return uniqueKeys.length;
  });
}

export async function migrateLegacyAsyncStorageForUser(uid) {
  const normalizedUid = normalizeUid(uid);

  return withLegacyMigrationLock(async () => {
    await clearLegacyStorageQuarantine();
    const ownerUid = await getLegacyStorageOwner();

    if (!ownerUid) {
      const legacyEntries = await AsyncStorage.multiGet(
        Object.values(LEGACY_ASYNC_STORAGE_KEYS)
      );
      const ambiguousEntries = legacyEntries.filter(
        ([, value]) => value !== null
      );

      if (ambiguousEntries.length > 0) {
        // Unscoped values have no trustworthy owner. Assigning them to the
        // first user who signs in can disclose a previous user's data. With no
        // recovery UI or trustworthy owner, deletion is the privacy-safe path.
        await AsyncStorage.multiRemove(
          ambiguousEntries.map(([key]) => key)
        );
      }

      return {
        claimed: false,
        migratedKeys: [],
        discardedAmbiguousKeys: ambiguousEntries.map(([key]) => key),
      };
    }

    if (ownerUid !== normalizedUid) {
      return { claimed: false, migratedKeys: [] };
    }

    const scopedKeys = getUserStorageKeys(normalizedUid);
    const names = Object.keys(LEGACY_ASYNC_STORAGE_KEYS);
    const [legacyEntries, scopedEntries] = await Promise.all([
      AsyncStorage.multiGet(names.map((name) => LEGACY_ASYNC_STORAGE_KEYS[name])),
      AsyncStorage.multiGet(names.map((name) => scopedKeys[name])),
    ]);
    const existingScopedValues = new Map(scopedEntries);
    const migratedKeys = [];
    const writes = [];

    legacyEntries.forEach(([, value], index) => {
      const name = names[index];
      if (value !== null && existingScopedValues.get(scopedKeys[name]) === null) {
        writes.push([scopedKeys[name], value]);
        migratedKeys.push(name);
      }
    });

    if (writes.length > 0) {
      await AsyncStorage.multiSet(writes);
    }

    await AsyncStorage.multiRemove(Object.values(LEGACY_ASYNC_STORAGE_KEYS));

    return { claimed: true, migratedKeys };
  });
}
