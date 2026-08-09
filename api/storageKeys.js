import AsyncStorage from "@react-native-async-storage/async-storage";

const USER_STORAGE_PREFIX = "@pantrio:user";
const LEGACY_STORAGE_OWNER_KEY = "@pantrio:legacyStorageOwner:v1";

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

export async function isLegacyStorageOwner(uid) {
  return (
    (await AsyncStorage.getItem(LEGACY_STORAGE_OWNER_KEY)) === normalizeUid(uid)
  );
}

export async function migrateLegacyAsyncStorageForUser(uid) {
  const normalizedUid = normalizeUid(uid);

  return withLegacyMigrationLock(async () => {
    let ownerUid = await AsyncStorage.getItem(LEGACY_STORAGE_OWNER_KEY);

    if (!ownerUid) {
      await AsyncStorage.setItem(LEGACY_STORAGE_OWNER_KEY, normalizedUid);
      ownerUid = normalizedUid;
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
