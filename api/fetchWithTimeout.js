const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Fetch with a deterministic timeout while preserving an optional caller
 * abort signal. Successful requests behave exactly like the native fetch API.
 */
export async function fetchWithTimeout(
  input,
  init = {},
  { timeoutMs = DEFAULT_TIMEOUT_MS, timeoutMessage = "The request timed out." } = {}
) {
  const controller = new AbortController();
  const callerSignal = init.signal;
  let timedOut = false;

  const abortFromCaller = () => controller.abort();
  if (callerSignal?.aborted) {
    controller.abort();
  } else {
    callerSignal?.addEventListener?.("abort", abortFromCaller, { once: true });
  }

  const normalizedTimeout = Number(timeoutMs);
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Number.isFinite(normalizedTimeout) && normalizedTimeout > 0
    ? normalizedTimeout
    : DEFAULT_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error(timeoutMessage);
      timeoutError.code = "REQUEST_TIMEOUT";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener?.("abort", abortFromCaller);
  }
}

export { DEFAULT_TIMEOUT_MS };
