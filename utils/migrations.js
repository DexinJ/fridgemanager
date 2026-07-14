// utils/migrations.js
// Purpose: sanitize persisted items into the newest expected shape.

import { toIsoOrNull } from "./expiryPredictor";

export function migrateFridgeItems(items) {
  if (!Array.isArray(items)) return [];
  const nowIso = new Date().toISOString();

  return items.map((it) => ({
    ...it,
    tagIds: Array.isArray(it?.tagIds) ? it.tagIds : [],
    createdAt: it?.createdAt || nowIso,
    updatedAt: it?.updatedAt || it?.createdAt || nowIso,
    expiresAt: toIsoOrNull(it?.expiresAt),
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
