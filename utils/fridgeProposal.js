const DEFAULT_CATEGORIES = Object.freeze({
  storage: "Fridge",
  urgency: "Use soon",
  food_type: "Prepared",
});

function clean(value, maxLength = 120) {
  return String(value ?? "").trim().slice(0, maxLength);
}

export function normalizeFridgeProposalCategories(categories) {
  const source = Array.isArray(categories)
    ? {
        // Compatibility with proposal cards created by older app versions.
        storage: categories[0],
        urgency: categories[1],
        food_type: categories[2],
        state: categories[3],
      }
    : categories && typeof categories === "object"
      ? categories
      : {};

  const storage = clean(source.storage) || DEFAULT_CATEGORIES.storage;
  const urgency = clean(source.urgency) || DEFAULT_CATEGORIES.urgency;
  const food_type = clean(source.food_type) || DEFAULT_CATEGORIES.food_type;
  const state = clean(source.state);

  return state
    ? { storage, urgency, food_type, state }
    : { storage, urgency, food_type };
}

export function normalizeFridgeProposalQuantity(value) {
  return clean(value, 80) || "1";
}

export function fridgeProposalCategoryLabels(categories) {
  const normalized = normalizeFridgeProposalCategories(categories);
  return [
    normalized.storage,
    normalized.urgency,
    normalized.food_type,
    normalized.state,
  ].filter(Boolean);
}

export function createFridgeProposalActionId() {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) return `fridge-proposal-${randomUuid}`;

  return `fridge-proposal-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

function legacyActionFingerprint(action) {
  const items = (Array.isArray(action?.items) ? action.items : []).map((item) => ({
    name: clean(item?.name),
    quantity: normalizeFridgeProposalQuantity(item?.quantity),
    categories: normalizeFridgeProposalCategories(item?.categories),
    expiresAt: clean(
      item?.expiresAt ??
        item?.expires_at ??
        item?.expirationDate ??
        item?.expiration_date
    ),
  }));

  return JSON.stringify({
    kind: "add_all_to_fridge",
    title: clean(action?.title, 160),
    items,
  });
}

export function fridgeProposalActionKey(action) {
  const actionId = clean(action?.actionId, 200);
  if (actionId) return `id:${actionId}`;

  const carriedKey = String(action?.actionKey ?? "").trim();
  if (carriedKey) return carriedKey;

  return `legacy:${legacyActionFingerprint(action)}`;
}

export function isFridgeProposalActionConsumed(action) {
  return (
    action?.status === "completed" ||
    action?.status === "applied" ||
    action?.consumed === true
  );
}

export function claimFridgeProposalAction(claimedKeys, action) {
  if (!(claimedKeys instanceof Set) || isFridgeProposalActionConsumed(action)) {
    return false;
  }

  const key = fridgeProposalActionKey(action);
  if (claimedKeys.has(key)) return false;
  claimedKeys.add(key);
  return true;
}

export function releaseFridgeProposalAction(claimedKeys, action) {
  if (claimedKeys instanceof Set) {
    claimedKeys.delete(fridgeProposalActionKey(action));
  }
}

export function markFridgeProposalActionConsumed(
  messages,
  targetAction,
  completedAt = new Date().toISOString()
) {
  const targetKey = fridgeProposalActionKey(targetAction);
  const confirmedItems = Array.isArray(targetAction?.items)
    ? targetAction.items.map((candidate) => {
        const item =
          candidate && typeof candidate === "object" && !Array.isArray(candidate)
            ? candidate
            : {};
        const { selected: _selected, ...confirmedItem } = item;
        return confirmedItem;
      })
    : null;

  return (Array.isArray(messages) ? messages : []).map((message) => {
    const action = message?.type === "ui_action" ? message.action : null;
    if (
      action?.kind !== "add_all_to_fridge" ||
      fridgeProposalActionKey(action) !== targetKey ||
      isFridgeProposalActionConsumed(action)
    ) {
      return message;
    }

    return {
      ...message,
      action: {
        ...action,
        ...(confirmedItems ? { items: confirmedItems } : {}),
        status: "completed",
        consumed: true,
        completedAt,
      },
    };
  });
}
