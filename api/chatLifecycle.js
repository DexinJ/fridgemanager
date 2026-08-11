const cancellationHandlers = new Set();

export function registerChatCancellation(handler) {
  if (typeof handler !== "function") return () => {};
  cancellationHandlers.add(handler);
  return () => cancellationHandlers.delete(handler);
}

export async function cancelActiveChatWork(reason = "Chat history was cleared.") {
  const results = await Promise.allSettled(
    [...cancellationHandlers].map((handler) => Promise.resolve(handler(reason)))
  );

  return {
    cancelled: results.filter((result) => result.status === "fulfilled").length,
    errors: results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason),
  };
}
