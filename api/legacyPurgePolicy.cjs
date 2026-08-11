function normalizedOwner(value) {
  const owner = String(value || "").trim();
  return owner || null;
}

function shouldClearLegacyOwnedData(legacyOwnerUid, deletingUid) {
  const owner = normalizedOwner(legacyOwnerUid);
  const target = normalizedOwner(deletingUid);
  if (!target) throw new TypeError("A deleting Firebase UID is required.");

  // Ownerless global values cannot be assigned safely to any future account,
  // while an explicit different owner must be preserved.
  return owner === null || owner === target;
}

module.exports = { shouldClearLegacyOwnedData };
