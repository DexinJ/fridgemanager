const MS_PER_DAY = 86400000;

export function startOfDayLocal(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;

  const local = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return Number.isNaN(local.getTime()) ? null : local;
}

export function endOfDayLocal(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return null;

  const local = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    23,
    59,
    59,
    999
  );
  return Number.isNaN(local.getTime()) ? null : local;
}

// Calendar expiration dates remain usable through the end of the selected day.
export function isoFromLocalDateOnly(d) {
  const local = endOfDayLocal(d);
  return local ? local.toISOString() : null;
}

// Accept: YYYY-MM-DD or MM/DD/YYYY
export function parseDateInputToIso(dateText) {
  const s = String(dateText || "").trim();
  if (!s) return null;

  // YYYY-MM-DD
  const m1 = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m1) {
    const y = Number(m1[1]);
    const mo = Number(m1[2]) - 1;
    const da = Number(m1[3]);
    const d = new Date(y, mo, da);
    if (Number.isNaN(d.getTime())) return null;
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== da) return null;
    return isoFromLocalDateOnly(d);
  }

  // MM/DD/YYYY
  const m2 = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m2) {
    const mo = Number(m2[1]) - 1;
    const da = Number(m2[2]);
    const y = Number(m2[3]);
    const d = new Date(y, mo, da);
    if (Number.isNaN(d.getTime())) return null;
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== da) return null;
    return isoFromLocalDateOnly(d);
  }

  return null;
}

export function formatYYYYMMDDLocal(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";

  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

// optional helper if you ever need it
export function addLocalDaysIso(days) {
  const d = startOfDayLocal(new Date());
  const normalizedDays = Number(days);
  if (!d || !Number.isFinite(normalizedDays)) return null;

  d.setDate(d.getDate() + Math.round(normalizedDays));
  return Number.isNaN(d.getTime()) ? null : isoFromLocalDateOnly(d);
}

export { MS_PER_DAY };

