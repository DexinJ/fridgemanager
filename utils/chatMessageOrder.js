// utils/chatMessageOrder.js

/**
 * Insert a new assistant message directly above the pending action card for
 * the same request, so the card renders below the assistant's text. Falls back
 * to appending when no action card is tracked for the request.
 */
export function insertAssistantAboveActionCard(
  previous,
  message,
  actionMessageId
) {
  const prev = Array.isArray(previous) ? previous : [];
  if (!actionMessageId) return [...prev, message];

  const cardIndex = prev.findIndex((entry) => entry?.id === actionMessageId);
  if (cardIndex < 0) return [...prev, message];

  const updated = [...prev];
  updated.splice(cardIndex, 0, message);
  return updated;
}
