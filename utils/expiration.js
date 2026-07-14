// utils/expiration.js
// Purpose: compute expiry "meta" from an expiresAt ISO timestamp.
// Used by GlobalContext to derive item.expired = "expired" | "almost" | "ok"

export const DEFAULT_ALMOST_EXPIRE_DAYS = 2;

const MS_PER_DAY = 86400000;


function toDateOrNull(input) {
  if (!input) return null;

  if (typeof input === "string") {
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
  const diffMs = expiresAtDate.getTime() - nowDate.getTime();
  return Math.ceil(diffMs / MS_PER_DAY);
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
  }
) {
  const now = new Date();
  const exp = toDateOrNull(expiresAtIso);

  if (!exp) {
    return {
      hasExpiry: false,
      expiresAtIso: null,
      expired: false,
      almostExpired: false,
      daysUntil: null,
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
    urgencyKey, // ✅ "expired" | "eat_first" | "use_soon" | "lasts_a_while" | "long_keeper"
  };
}

