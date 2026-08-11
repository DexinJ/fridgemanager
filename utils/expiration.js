// utils/expiration.js
// Purpose: compute expiry "meta" from an expiresAt ISO timestamp.
// Used by GlobalContext to derive item.expired = "expired" | "almost" | "ok"

export const DEFAULT_ALMOST_EXPIRE_DAYS = 2;

const MS_PER_DAY = 86400000;


function toDateOrNull(input) {
  if (!input) return null;

  if (typeof input === "string") {
    const dateOnly = input.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
      const year = Number(dateOnly[1]);
      const month = Number(dateOnly[2]) - 1;
      const day = Number(dateOnly[3]);
      const localEndOfDay = new Date(year, month, day, 23, 59, 59, 999);
      if (
        localEndOfDay.getFullYear() !== year ||
        localEndOfDay.getMonth() !== month ||
        localEndOfDay.getDate() !== day
      ) {
        return null;
      }
      return localEndOfDay;
    }
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  if (input instanceof Date) {
    return Number.isNaN(input.getTime()) ? null : input;
  }

  if (typeof input === "number") {
    const d = new Date(input);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

// We treat "daysUntil" as whole days remaining, rounded up.
// Example: expires in 0.2 days => 1 dayUntil (still "almost" if threshold allows).
function computeDaysUntil(expiresAtDate, nowDate) {
  const expirationDay = Date.UTC(
    expiresAtDate.getFullYear(),
    expiresAtDate.getMonth(),
    expiresAtDate.getDate()
  );
  const currentDay = Date.UTC(
    nowDate.getFullYear(),
    nowDate.getMonth(),
    nowDate.getDate()
  );
  return Math.round((expirationDay - currentDay) / MS_PER_DAY);
}

/**
 * getExpiryMeta(expiresAtIso, almostDays?)
 * Returns a stable shape used everywhere:
 *  {
 *    hasExpiry: boolean,
 *    expiresAtIso: string|null,
 *    expired: boolean,
 *    almostExpired: boolean,
 *    daysUntil: number|null
 *  }
 */
export function getExpiryMeta(
  expiresAtIso,
  almostDays = DEFAULT_ALMOST_EXPIRE_DAYS,
  urgencyDays = {
    expired: 0,
    eat_first: 2,
    use_soon: 7,
    lasts_a_while: 30,
    long_keeper: 180,
  },
  nowInput = new Date()
) {
  const now = toDateOrNull(nowInput) || new Date();
  const exp = toDateOrNull(expiresAtIso);

  if (!exp) {
    return {
      hasExpiry: false,
      expiresAtIso: null,
      expired: false,
      almostExpired: false,
      daysUntil: null,
      daysUntilExpire: null,
      expiresAtMs: null,
      urgencyKey: null,
    };
  }

  const daysUntil = computeDaysUntil(exp, now);

  // expired if expiration moment is strictly in the past
  const expired = exp.getTime() < now.getTime();

  // almostExpired only if not expired and within threshold
  const almostExpired = !expired && daysUntil <= Number(almostDays || 0);

  // 🔥 NEW: derive urgency key
  let urgencyKey = "long_keeper";

  if (expired || daysUntil <= urgencyDays.expired) {
    urgencyKey = "expired";
  } else if (daysUntil <= urgencyDays.eat_first) {
    urgencyKey = "eat_first";
  } else if (daysUntil <= urgencyDays.use_soon) {
    urgencyKey = "use_soon";
  } else if (daysUntil <= urgencyDays.lasts_a_while) {
    urgencyKey = "lasts_a_while";
  } else {
    urgencyKey = "long_keeper";
  }

  return {
    hasExpiry: true,
    expiresAtIso: exp.toISOString(),
    expired,
    almostExpired,
    daysUntil,
    daysUntilExpire: daysUntil,
    expiresAtMs: exp.getTime(),
    urgencyKey, // ✅ "expired" | "eat_first" | "use_soon" | "lasts_a_while" | "long_keeper"
  };
}

