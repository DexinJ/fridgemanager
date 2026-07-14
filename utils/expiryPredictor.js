// utils/expiryPredictor.js
// Purpose: infer expiresAt when user doesn't provide one, based on tags.
// Pure utilities; GlobalContext can call predictExpiresAtIso(...)

const MS_PER_DAY = 86400000;

const norm = (s) => String(s || "").trim().toLowerCase();

export function addDaysIso(baseIso, days) {
  const base = new Date(baseIso);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + Number(days || 0) * MS_PER_DAY).toISOString();
}

export function toIsoOrNull(input) {
  if (input === null || input === undefined || input === "") return null;

  if (typeof input === "string") {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input.toISOString();
  }

  if (typeof input === "number") {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  return null;
}

/**
 * pickTagLabel(tagIds, tagById, type)
 * - tagById is Map(tagId -> tagObject)
 * - returns the *label* (e.g. "Fridge") for the first tag matching `type`
 */
export function pickTagLabel(tagIds, tagById, type) {
  const ids = Array.isArray(tagIds) ? tagIds : [];
  for (const id of ids) {
    const t = tagById?.get?.(id);
    if (t?.type === type) return t.label || "";
  }
  return "";
}

// Heuristic defaults (tune anytime)
export function estimateShelfLifeDays({ storage, urgency, foodType, state }) {
  const s = norm(storage);
  const f = norm(foodType);
  const st = norm(state);

  let baseDays = 10;

  if (s === "freezer") {
    if (f === "meat" || f === "seafood") baseDays = 180;
    else if (f === "prepared") baseDays = 90;
    else baseDays = 120;
  } else if (s === "pantry") {
    if (f === "produce") baseDays = st === "cut" ? 3 : 7;
    else if (f === "bakery") baseDays = 5;
    else if (f === "dairy" || f === "meat" || f === "seafood" || f === "prepared") baseDays = 3;
    else if (f === "condiments") baseDays = st === "opened" ? 60 : 180;
    else if (f === "snacks" || f === "beverages") baseDays = 120;
    else baseDays = 60;
  } else {
    // Default: Fridge
    if (f === "prepared" || st === "cooked") baseDays = 4;
    else if ((f === "meat" || f === "seafood") && st === "raw") baseDays = 2;
    else if (f === "meat" || f === "seafood") baseDays = 3;
    else if (f === "dairy") baseDays = st === "opened" ? 7 : 10;
    else if (f === "produce") baseDays = st === "cut" ? 3 : 7;
    else if (f === "bakery") baseDays = 5;
    else if (f === "condiments") baseDays = st === "opened" ? 60 : 120;
    else if (f === "snacks" || f === "beverages") baseDays = 30;
    else baseDays = 10;
  }

  // Safety caps
  if (s !== "freezer" && (f === "prepared" || st === "cooked")) {
    baseDays = Math.min(baseDays, 4);
  }
  if (s !== "freezer" && (f === "meat" || f === "seafood") && st === "raw") {
    baseDays = Math.min(baseDays, 2);
  }

  // urgency currently unused, but left here so you can incorporate it later
  void urgency;

  return baseDays;
}

/**
 * predictExpiresAtIso({ createdAtIso, tagIds, tagById })
 * Uses tags (storage/urgency/food_type/state) to estimate shelf life and returns expiresAt ISO.
 */
export function predictExpiresAtIso({ createdAtIso, tagIds, tagById }) {
  const storage = pickTagLabel(tagIds, tagById, "storage");
  const urgency = pickTagLabel(tagIds, tagById, "urgency");
  const foodType = pickTagLabel(tagIds, tagById, "food_type");
  const state = pickTagLabel(tagIds, tagById, "state");

  const days = estimateShelfLifeDays({ storage, urgency, foodType, state });
  return addDaysIso(createdAtIso, days);
}
