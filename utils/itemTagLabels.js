const norm = (s) => String(s || "").trim().toLowerCase();

/**
 * Build tag lookup maps from preset tags.
 */
export function buildTagMaps(tags) {
  const tagById = new Map();
  const tagIdByKey = new Map();

  for (const t of tags || []) {
    if (!t) continue;
    if (t.id) tagById.set(t.id, t);

    // key
    if (t.key) tagIdByKey.set(String(t.key), t.id);

    // label normalized -> id
    if (t.label) {
      const k = norm(t.label).replace(/\s+/g, "_");
      tagIdByKey.set(k, t.id);
    }
  }

  return { tagById, tagIdByKey };
}

/**
 * Convert a label ("Use soon") => tagId using tagIdByKey map.
 */
export function makeLabelToTagId(tagIdByKey) {
  return (label) => {
    if (!label) return null;
    const k = norm(label).replace(/\s+/g, "_");
    return tagIdByKey.get(k) ?? null;
  };
}

/**
 * Get first tag label from item.tagIds that matches type.
 */
export function makeGetTagLabelByType(tagById) {
  return (item, type) => {
    for (const id of item?.tagIds || []) {
      const t = tagById.get(id);
      if (t?.type === type) return t?.label || "";
    }
    return "";
  };
}

/**
 * Convert tagIds => labels per type:
 * { storage, urgency, food_type, state }
 */
export function makeLabelsFromTagIds(tagById) {
  return (tagIds) => {
    const out = { storage: "", urgency: "", food_type: "", state: "" };
    for (const id of tagIds || []) {
      const t = tagById.get(id);
      if (!t?.type) continue;
      out[t.type] = t.label || "";
    }
    return out;
  };
}

/**
 * Replace (switch) exactly one tag of a given type in a tagId list.
 * Removes all existing tags of that type, then adds nextTagId.
 */
export function makeReplaceTagByType(tagById) {
  return (tagIds, type, nextTagId) => {
    const cur = Array.isArray(tagIds) ? tagIds : [];
    const withoutType = cur.filter((id) => tagById.get(id)?.type !== type);
    if (!nextTagId) return withoutType;
    return Array.from(new Set([...withoutType, nextTagId]));
  };
}

/**
 * Ensure at most one tag per type. First tag wins.
 */
export function makeDedupeTagsByType(tagById) {
  return (tagIds) => {
    const seen = new Set();
    const out = [];
    for (const id of tagIds || []) {
      const type = tagById.get(id)?.type;
      if (!type) continue;
      if (seen.has(type)) continue;
      seen.add(type);
      out.push(id);
    }
    return out;
  };
}
