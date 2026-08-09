export function parseBackendResponseText(responseText) {
  const text = String(responseText || "").trim();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

export function createBackendResponseError(
  payload,
  { status, fallbackMessage = "The request failed." } = {}
) {
  const nestedError =
    payload?.error && typeof payload.error === "object"
      ? payload.error
      : null;
  const message =
    (typeof payload?.error === "string" ? payload.error : null) ||
    nestedError?.message ||
    payload?.message ||
    fallbackMessage;
  const error = new Error(message);

  error.name = "BackendResponseError";
  error.status = status;
  error.code = payload?.code || nestedError?.code || null;
  error.quota = payload?.quota || nestedError?.quota || null;
  error.retryAfterMs =
    payload?.retryAfterMs || nestedError?.retryAfterMs || null;

  return error;
}
