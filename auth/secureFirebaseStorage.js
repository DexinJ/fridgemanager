import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SECURE_FIREBASE_KEY_PREFIX = "pantrio.firebase.auth.v1.";
const SECURE_CHUNK_MARKER = "pantrio-secure-chunks-v1";
const SECURE_CHUNK_SIZE = 1500;
const SECURE_STORE_OPTIONS = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
let warnedAboutFallback = false;
let secureStoreAvailabilityPromise = null;
const volatileFallback = new Map();

async function secureKeyForFirebaseKey(firebaseKey) {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    String(firebaseKey)
  );
  return `${SECURE_FIREBASE_KEY_PREFIX}${digest}`;
}

function parseChunkManifest(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (
      parsed?.marker !== SECURE_CHUNK_MARKER ||
      !/^[a-f0-9]{16}$/.test(String(parsed.generation || "")) ||
      !Number.isInteger(parsed.count) ||
      parsed.count < 1 ||
      parsed.count > 100
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function chunkKey(baseKey, generation, index) {
  return `${baseKey}.${generation}.${index}`;
}

async function readEncryptedValue(baseKey) {
  const stored = await SecureStore.getItemAsync(baseKey, SECURE_STORE_OPTIONS);
  if (stored === null) return null;
  const manifest = parseChunkManifest(stored);
  // Supports values written before chunking was introduced.
  if (!manifest) return stored;

  const chunks = await Promise.all(
    Array.from({ length: manifest.count }, (_, index) =>
      SecureStore.getItemAsync(
        chunkKey(baseKey, manifest.generation, index),
        SECURE_STORE_OPTIONS
      )
    )
  );
  if (chunks.some((chunk) => chunk === null)) {
    throw new Error("Encrypted Firebase session storage is incomplete.");
  }
  return chunks.join("");
}

async function writeEncryptedValue(baseKey, value) {
  const normalizedValue = String(value);
  const generation = (
    await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      normalizedValue
    )
  ).slice(0, 16);
  const chunks = normalizedValue.match(
    new RegExp(`.{1,${SECURE_CHUNK_SIZE}}`, "gs")
  ) || [""];
  const previous = parseChunkManifest(
    await SecureStore.getItemAsync(baseKey, SECURE_STORE_OPTIONS)
  );

  await Promise.all(
    chunks.map((chunk, index) =>
      SecureStore.setItemAsync(
        chunkKey(baseKey, generation, index),
        chunk,
        SECURE_STORE_OPTIONS
      )
    )
  );
  await SecureStore.setItemAsync(
    baseKey,
    JSON.stringify({ marker: SECURE_CHUNK_MARKER, generation, count: chunks.length }),
    SECURE_STORE_OPTIONS
  );

  if (previous && previous.generation !== generation) {
    await Promise.allSettled(
      Array.from({ length: previous.count }, (_, index) =>
        SecureStore.deleteItemAsync(
          chunkKey(baseKey, previous.generation, index),
          SECURE_STORE_OPTIONS
        )
      )
    );
  }
}

async function deleteEncryptedValue(baseKey) {
  const manifest = parseChunkManifest(
    await SecureStore.getItemAsync(baseKey, SECURE_STORE_OPTIONS)
  );
  const removals = [
    SecureStore.deleteItemAsync(baseKey, SECURE_STORE_OPTIONS),
  ];
  if (manifest) {
    removals.push(
      ...Array.from({ length: manifest.count }, (_, index) =>
        SecureStore.deleteItemAsync(
          chunkKey(baseKey, manifest.generation, index),
          SECURE_STORE_OPTIONS
        )
      )
    );
  }
  await Promise.all(removals);
}

function warnAboutFallback(error) {
  if (warnedAboutFallback) return;
  warnedAboutFallback = true;
  console.warn("[firebase auth] secure persistence unavailable; using memory", {
    name: String(error?.name || "Error"),
    code: error?.code ? String(error.code) : null,
  });
}

async function secureStoreSupported() {
  if (!secureStoreAvailabilityPromise) {
    secureStoreAvailabilityPromise = (async () => {
      if (Platform.OS === "web") return false;
      try {
        const available = await SecureStore.isAvailableAsync();
        if (!available) {
          warnAboutFallback({
            name: "SecureStoreUnavailable",
            code: "SECURE_STORE_UNAVAILABLE",
          });
        }
        return available;
      } catch {
        warnAboutFallback({
          name: "SecureStoreUnavailable",
          code: "SECURE_STORE_CHECK_FAILED",
        });
        return false;
      }
    })();
  }
  return secureStoreAvailabilityPromise;
}

/**
 * Firebase's React Native persistence adapter accepts any async get/set/remove
 * implementation. Reads fall back to Firebase's former AsyncStorage key once,
 * then migrate it only after the encrypted write succeeds. If encrypted
 * storage is unavailable, refreshed credentials remain memory-only.
 */
export const secureFirebaseStorage = {
  async getItem(firebaseKey) {
    if (!(await secureStoreSupported())) {
      await AsyncStorage.removeItem(firebaseKey).catch(() => {});
      return volatileFallback.get(firebaseKey) ?? null;
    }

    try {
      const secureKey = await secureKeyForFirebaseKey(firebaseKey);
      const stored = await readEncryptedValue(secureKey);
      if (stored !== null) return stored;

      const legacyValue = await AsyncStorage.getItem(firebaseKey);
      if (legacyValue !== null) {
        // Do not expose the legacy token to Firebase unless its encrypted copy
        // has committed. This is a one-time, fail-closed migration.
        await writeEncryptedValue(secureKey, legacyValue);
        await AsyncStorage.removeItem(firebaseKey);
        return legacyValue;
      }
      return volatileFallback.get(firebaseKey) ?? null;
    } catch (error) {
      warnAboutFallback(error);
      await AsyncStorage.removeItem(firebaseKey).catch(() => {});
      return volatileFallback.get(firebaseKey) ?? null;
    }
  },

  async setItem(firebaseKey, value) {
    const normalizedValue = String(value);
    if (await secureStoreSupported()) {
      try {
        const secureKey = await secureKeyForFirebaseKey(firebaseKey);
        await writeEncryptedValue(secureKey, normalizedValue);
        volatileFallback.delete(firebaseKey);
        await AsyncStorage.removeItem(firebaseKey);
        return;
      } catch (error) {
        warnAboutFallback(error);
        await AsyncStorage.removeItem(firebaseKey).catch(() => {});
      }
    } else {
      await AsyncStorage.removeItem(firebaseKey).catch(() => {});
    }
    // Never write refreshed credentials back to plaintext storage.
    volatileFallback.set(firebaseKey, normalizedValue);
  },

  async removeItem(firebaseKey) {
    volatileFallback.delete(firebaseKey);
    const removals = [AsyncStorage.removeItem(firebaseKey)];
    if (await secureStoreSupported()) {
      removals.push(
        secureKeyForFirebaseKey(firebaseKey).then((secureKey) =>
          deleteEncryptedValue(secureKey)
        )
      );
    }
    await Promise.all(removals);
  },
};
