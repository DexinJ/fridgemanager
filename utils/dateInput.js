const MS_PER_DAY = 86400000;

export function startOfDayLocal(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// store as ISO at local midnight
export function isoFromLocalDateOnly(d) {
  return startOfDayLocal(d).toISOString();
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
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

// optional helper if you ever need it
export function addLocalDaysIso(days) {
  const d = startOfDayLocal(new Date());
  d.setDate(d.getDate() + Math.round(days));
  return d.toISOString();
}

export { MS_PER_DAY };

