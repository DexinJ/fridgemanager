import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearCustomAiProviderSettings,
  clearLegacyCustomAiProviderSettingsForUser,
} from "./aiProviderSettings";
import { clearChatData } from "./memoryManager";
import { cancelPantrioReminders } from "./reminderScheduler";
import {
  clearUserDataPurgePending,
  clearLegacyStorageForUser,
  getUserDataPurgeIntent,
  getUserStorageKeys,
  recordUserDataPurgeFailure,
} from "./storageKeys";

export function userDataPurgeErrorMessage(error) {
  return String(error?.message || error || "Unknown storage error");
}

export async function purgeStoredUserData(uid) {
  const storageKeys = getUserStorageKeys(uid);
  const operations = [
    ["fridge", () => AsyncStorage.removeItem(storageKeys.fridgeItems)],
    [
      "shopping",
      () => AsyncStorage.removeItem(storageKeys.shoppingListItems),
    ],
    ["settings", () => AsyncStorage.removeItem(storageKeys.appSettings)],
    ["customAi", () => clearCustomAiProviderSettings(uid)],
    ["legacyStorage", () => clearLegacyStorageForUser(uid)],
    ["legacyCustomAi", () => clearLegacyCustomAiProviderSettingsForUser(uid)],
    ["reminders", () => cancelPantrioReminders()],
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
      message: userDataPurgeErrorMessage(result.reason),
      cause: result.reason,
    });
  });

  return { ok: errors.length === 0, outcomes, cleared, errors };
}

export function publicUserDataPurgeResult(result) {
  return {
    ok: result.ok,
    pendingRetry: !result.ok,
    cleared: result.cleared,
    errors: result.errors.map(({ scope, message }) => ({ scope, message })),
  };
}

export async function completePendingUserDataPurge(uid) {
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
        message: userDataPurgeErrorMessage(error),
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
      message: userDataPurgeErrorMessage(error),
      cause: error,
    });
  }

  return purgeResult;
}
