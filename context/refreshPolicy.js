export function orderedStringListKey(values) {
  return JSON.stringify(Array.isArray(values) ? values : []);
}

export function productCatalogCoversIds(products, requestedProductIds) {
  if (!Array.isArray(products) || !Array.isArray(requestedProductIds)) {
    return false;
  }

  const loadedProductIds = new Set(
    products
      .map((product) => String(product?.productId || "").trim())
      .filter(Boolean)
  );
  return (
    requestedProductIds.length > 0 &&
    requestedProductIds.every((productId) => loadedProductIds.has(productId))
  );
}

export function isRefreshFresh(lastCompletedAt, maxAgeMs, now = Date.now()) {
  const completedAt = Number(lastCompletedAt);
  const ageLimit = Number(maxAgeMs);
  const currentTime = Number(now);

  return (
    Number.isFinite(completedAt) &&
    completedAt > 0 &&
    Number.isFinite(ageLimit) &&
    ageLimit > 0 &&
    Number.isFinite(currentTime) &&
    currentTime >= completedAt &&
    currentTime - completedAt < ageLimit
  );
}

export function canExposeAccountData(session, accountDeletionPending = false) {
  return Boolean(session && !accountDeletionPending);
}
