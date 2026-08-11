import assert from "node:assert/strict";
import test from "node:test";
import {
  buildExpirationReminderSchedule,
  buildReminderSyncSignature,
  canSynchronizeReminders,
  countItemsExpiringWithin,
} from "../utils/reminderPolicy.js";

test("reminders stay untouched when relevant storage hydration failed", () => {
  assert.equal(
    canSynchronizeReminders({
      storageHydrated: true,
      storageOwnerUid: "user-1",
      fridgeWriteEnabled: false,
      settingsWriteEnabled: true,
    }),
    false
  );
  assert.equal(
    canSynchronizeReminders({
      storageHydrated: true,
      storageOwnerUid: "user-1",
      fridgeWriteEnabled: true,
      settingsWriteEnabled: true,
    }),
    true
  );
});

test("reminder sync signature ignores unrelated settings and item fields", () => {
  const baseSettings = {
    notifications: { turnOn: true, dailyReminders: true },
    expiration: { expirationAlerts: true, remindDays: 5 },
  };
  const first = buildReminderSyncSignature(baseSettings, [
    { id: "milk", name: "Milk", quantity: "1", expiresAt: "2026-08-20" },
  ]);
  const second = buildReminderSyncSignature(
    { ...baseSettings, ux: { darkMode: true, fontSize: 24 } },
    [{ id: "milk", name: "Whole milk", quantity: "2", expiresAt: "2026-08-20" }]
  );
  assert.equal(second, first);
  assert.notEqual(
    buildReminderSyncSignature(baseSettings, [
      { id: "milk", expiresAt: "2026-08-21" },
    ]),
    first
  );
});

test("expiration reminders are scheduled at 9 AM the configured days before", () => {
  const expiration = new Date(2026, 7, 20, 23, 59, 59, 999);
  const schedule = buildExpirationReminderSchedule(
    [{ id: "milk", expiresAt: expiration.toISOString() }],
    5,
    new Date(2026, 7, 10, 12)
  );
  assert.equal(schedule.length, 1);
  assert.equal(schedule[0].trigger.getDate(), 15);
  assert.equal(schedule[0].trigger.getHours(), 9);
});

test("daily reminder counts only future items inside the horizon", () => {
  const now = new Date(2026, 7, 10, 12);
  const items = [
    { expiresAt: new Date(2026, 7, 12, 23, 59).toISOString() },
    { expiresAt: new Date(2026, 7, 20, 23, 59).toISOString() },
    { expiresAt: new Date(2026, 7, 9, 23, 59).toISOString() },
  ];
  assert.equal(countItemsExpiringWithin(items, 5, now), 1);
});
