// utils/migrations.js
// Purpose: sanitize persisted items into the newest expected shape.

import { toIsoOrNull } from "./expiryPredictor.js";

export function canMigrateLegacyProviderCredentials({
  settingsReadStatus,
  settingsLoadError,
}) {
  // Moving a legacy API key is destructive because the source is erased after
  // the scoped copy commits. Only provider metadata from a successfully read
  // and parsed settings value is authoritative; a null value is still a
  // successful read and intentionally uses defaults.
  return settingsReadStatus === "fulfilled" && !settingsLoadError;
}

function migrateLegacyExpiration(input) {
  const iso = toIsoOrNull(input);
  if (!iso) return null;
  const date = new Date(iso);
  if (
    date.getHours() === 0 &&
    date.getMinutes() === 0 &&
    date.getSeconds() === 0 &&
    date.getMilliseconds() === 0
  ) {
    date.setHours(23, 59, 59, 999);
    return date.toISOString();
  }
  return iso;
}

export function migrateFridgeItems(items) {
  if (!Array.isArray(items)) return [];
  const nowIso = new Date().toISOString();

  return items.map((it) => ({
    ...it,
    tagIds: Array.isArray(it?.tagIds) ? it.tagIds : [],
    createdAt: it?.createdAt || nowIso,
    updatedAt: it?.updatedAt || it?.createdAt || nowIso,
    expiresAt: migrateLegacyExpiration(it?.expiresAt),
  }));
}

export function migrateShoppingItems(items) {
  if (!Array.isArray(items)) return [];
  const nowIso = new Date().toISOString();

  return items.map((it) => ({
    ...it,
    tagIds: Array.isArray(it?.tagIds) ? it.tagIds : [],
    createdAt: it?.createdAt || nowIso,
    updatedAt: it?.updatedAt || it?.createdAt || nowIso,
  }));
}
