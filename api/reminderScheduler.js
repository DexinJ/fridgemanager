import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  buildExpirationReminderSchedule,
  countItemsExpiringWithin,
} from "../utils/reminderPolicy";
import { createLatestTaskQueue } from "../utils/latestTaskQueue";

const REMINDER_MARKER = "pantrio-local-reminder-v1";
const ANDROID_CHANNEL_ID = "pantrio-reminders";
const reminderTaskQueue = createLatestTaskQueue();

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

async function cancelPantrioRemindersRaw() {
  if (Platform.OS === "web") return;
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const cancellationResults = await Promise.allSettled(
    scheduled
      .filter(
        (request) => request?.content?.data?.pantrioReminder === REMINDER_MARKER
      )
      .map((request) =>
        Notifications.cancelScheduledNotificationAsync(request.identifier)
      )
  );
  const failedCount = cancellationResults.filter(
    (result) => result.status === "rejected"
  ).length;
  if (failedCount > 0) {
    const error = new Error(
      `Could not cancel ${failedCount} scheduled Pantrio reminder${failedCount === 1 ? "" : "s"}.`
    );
    error.code = "REMINDER_CANCELLATION_FAILED";
    throw error;
  }
}

export function cancelPantrioReminders() {
  return reminderTaskQueue.invalidateAndRun(cancelPantrioRemindersRaw);
}

async function ensurePermission() {
  return Notifications.getPermissionsAsync();
}

export async function requestReminderPermissions() {
  if (Platform.OS === "web") return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

async function performReminderSync({ settings, fridgeItems }) {
  if (Platform.OS === "web") return { scheduled: 0, permission: "unsupported" };

  await cancelPantrioRemindersRaw();

  const dailyEnabled = Boolean(settings?.notifications?.dailyReminders);
  const expirationEnabled = Boolean(settings?.expiration?.expirationAlerts);
  const notificationsEnabled = settings?.notifications?.turnOn !== false;
  if (!notificationsEnabled || (!dailyEnabled && !expirationEnabled)) {
    return { scheduled: 0, permission: "not-requested" };
  }

  const currentPermission = await ensurePermission();
  if (!currentPermission.granted) {
    return {
      scheduled: 0,
      permission: currentPermission.canAskAgain ? "undetermined" : "denied",
    };
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Pantrio reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const requests = [];
  const triggerChannel =
    Platform.OS === "android" ? { channelId: ANDROID_CHANNEL_ID } : {};
  const remindDays = settings?.expiration?.remindDays ?? 5;

  if (dailyEnabled) {
    const expiringCount = countItemsExpiringWithin(fridgeItems, remindDays);
    requests.push({
      content: {
        title: "Pantrio fridge check",
        body: expiringCount
          ? `${expiringCount} item${expiringCount === 1 ? " is" : "s are"} nearing expiration.`
          : "Take a moment to review your fridge and shopping list.",
        data: { pantrioReminder: REMINDER_MARKER, kind: "daily" },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour: 9,
        minute: 0,
        ...triggerChannel,
      },
    });
  }

  if (expirationEnabled) {
    const schedule = buildExpirationReminderSchedule(fridgeItems, remindDays);
    for (const reminder of schedule) {
      requests.push({
        content: {
          title: "An item is nearing expiration",
          body: `Open Pantrio to review items expiring within ${Math.round(Number(remindDays) || 5)} days.`,
          data: {
            pantrioReminder: REMINDER_MARKER,
            kind: "expiration",
            itemId: reminder.itemId,
          },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: reminder.trigger,
          ...triggerChannel,
        },
      });
    }
  }

  const scheduleResults = await Promise.allSettled(
    requests.map((request) => Notifications.scheduleNotificationAsync(request))
  );
  const identifiers = scheduleResults
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  const failed = scheduleResults.find((result) => result.status === "rejected");
  if (failed) {
    await Promise.allSettled(
      identifiers.map((identifier) =>
        Notifications.cancelScheduledNotificationAsync(identifier)
      )
    );
    throw failed.reason instanceof Error
      ? failed.reason
      : new Error("Could not schedule all reminders.");
  }
  return { scheduled: identifiers.length, permission: "granted" };
}

export function syncLocalReminders(request) {
  return reminderTaskQueue.runLatest(
    () => performReminderSync(request),
    { supersededValue: { scheduled: 0, permission: "superseded" } }
  );
}
