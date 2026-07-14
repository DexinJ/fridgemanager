// utils/tags.js
// Purpose: normalize "categories" input into preset tagIds.
// Pure functions; pass tags/tagById in to keep this stateless.

const keyify = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, "_");

export function buildTagById(tags) {
  const m = new Map();
  for (const t of Array.isArray(tags) ? tags : []) {
    if (t?.id) m.set(t.id, t);
  }
  return m;
}

/**
 * findPresetTagId({ input, tags, tagById })
 * - input can be: tagId, label, or key-ish string
 */
export function findPresetTagId({ input, tags, tagById }) {
  const s = String(input || "").trim();
  if (!s) return null;

  // If they passed an actual id, accept it
  const byId = tagById?.get?.(s);
  if (byId?.id) return byId.id;

  const k = keyify(s);

  // Match by key
  const byKey = (Array.isArray(tags) ? tags : []).find((t) => t?.key === k);
  if (byKey?.id) return byKey.id;

  // Match by label (case-insensitive)
  const byLabel = (Array.isArray(tags) ? tags : []).find(
    (t) => String(t?.label || "").trim().toLowerCase() === s.toLowerCase()
  );
  if (byLabel?.id) return byLabel.id;

  return null;
}

/**
 * normalizeToPresetTagIds({ categories, tags, tagById })
 * - categories can be: array, "a,b,c", single string, null
 * - returns a deduped array of tagIds
 */
export function normalizeToPresetTagIds({ categories, tags, tagById }) {
  if (!categories) return [];

  const list = Array.isArray(categories)
    ? categories
    : String(categories)
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);

  const ids = list
    .map((x) => findPresetTagId({ input: x, tags, tagById }))
    .filter(Boolean);

  return Array.from(new Set(ids));
}
