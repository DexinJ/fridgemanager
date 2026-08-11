const MAX_EXPIRATION_REMINDERS = 40;

export function canSynchronizeReminders({
  storageHydrated,
  storageOwnerUid,
  fridgeWriteEnabled,
  settingsWriteEnabled,
}) {
  return Boolean(
    storageHydrated &&
      storageOwnerUid &&
      fridgeWriteEnabled &&
      settingsWriteEnabled
  );
}

export function buildReminderSyncSignature(settings, fridgeItems) {
  const notificationsEnabled = settings?.notifications?.turnOn !== false;
  const dailyEnabled = Boolean(settings?.notifications?.dailyReminders);
  const expirationEnabled = Boolean(settings?.expiration?.expirationAlerts);
  const remindDays = clampInteger(settings?.expiration?.remindDays, 1, 31, 5);
  const settingsSignature = [
    notificationsEnabled ? 1 : 0,
    dailyEnabled ? 1 : 0,
    expirationEnabled ? 1 : 0,
    remindDays,
  ].join(":");

  if (!notificationsEnabled || (!dailyEnabled && !expirationEnabled)) {
    return settingsSignature;
  }

  const itemSignature = (Array.isArray(fridgeItems) ? fridgeItems : [])
    .map((item) => `${String(item?.id || "")}:${String(item?.expiresAt || "")}`)
    .sort()
    .join("|");
  return `${settingsSignature}:${itemSignature}`;
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number)
    ? Math.min(maximum, Math.max(minimum, number))
    : fallback;
}

export function buildExpirationReminderSchedule(
  fridgeItems,
  remindDays,
  now = new Date()
) {
  const currentTime = now instanceof Date ? now.getTime() : Number(now);
  const daysBefore = clampInteger(remindDays, 1, 31, 5);
  const scheduled = [];

  for (const item of Array.isArray(fridgeItems) ? fridgeItems : []) {
    const expiration = new Date(item?.expiresAt);
    if (Number.isNaN(expiration.getTime())) continue;

    const trigger = new Date(
      expiration.getFullYear(),
      expiration.getMonth(),
      expiration.getDate() - daysBefore,
      9,
      0,
      0,
      0
    );
    if (trigger.getTime() <= currentTime) continue;

    scheduled.push({
      itemId: String(item?.id || ""),
      trigger,
      expiresAt: expiration,
    });
  }

  return scheduled
    .sort((left, right) => left.trigger.getTime() - right.trigger.getTime())
    .slice(0, MAX_EXPIRATION_REMINDERS);
}

export function countItemsExpiringWithin(
  fridgeItems,
  days,
  now = new Date()
) {
  const currentTime = now instanceof Date ? now.getTime() : Number(now);
  const horizon = currentTime + clampInteger(days, 1, 31, 5) * 86_400_000;

  return (Array.isArray(fridgeItems) ? fridgeItems : []).filter((item) => {
    const expiresAt = new Date(item?.expiresAt).getTime();
    return Number.isFinite(expiresAt) && expiresAt >= currentTime && expiresAt <= horizon;
  }).length;
}
