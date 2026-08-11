import {
  createBackendResponseError,
  parseBackendResponseText,
} from "./backendErrors";
import { API_BASE_URL } from "./backendConfig";
import { fetchWithTimeout } from "./fetchWithTimeout";

const DELETE_TIMEOUT_MS = 30_000;
const STATUS_TIMEOUT_MS = 10_000;

async function readResponse(response) {
  const responseText = await response.text().catch(() => "");
  return parseBackendResponseText(responseText) || {};
}

async function authenticatedDeletionRequest(
  path,
  { bearerToken, method = "GET", timeoutMs = STATUS_TIMEOUT_MS } = {}
) {
  const token = String(bearerToken || "").trim();
  if (!token) {
    const error = new Error("A Firebase bearer token is required.");
    error.code = "AUTH_REQUIRED";
    throw error;
  }

  const response = await fetchWithTimeout(
    `${API_BASE_URL}${path}`,
    {
      method,
      headers: { Authorization: `Bearer ${token}` },
    },
    {
      timeoutMs,
      timeoutMessage:
        method === "DELETE"
          ? "Account deletion timed out. Pantrio is checking whether it completed."
          : "Checking account deletion status timed out.",
    }
  );
  const payload = await readResponse(response);
  return { httpStatus: response.status, payload };
}

export function requestBackendAccountDeletion(uid, bearerToken) {
  return authenticatedDeletionRequest(
    `/api/users/${encodeURIComponent(uid)}`,
    {
      bearerToken,
      method: "DELETE",
      timeoutMs: DELETE_TIMEOUT_MS,
    }
  );
}

export function getBackendAccountDeletionStatus(uid, bearerToken) {
  return authenticatedDeletionRequest(
    `/api/users/${encodeURIComponent(uid)}/deletion-status`,
    { bearerToken }
  );
}

export function accountDeletionResponseError(
  { httpStatus, payload },
  fallbackMessage = "Could not delete your account."
) {
  return createBackendResponseError(payload, {
    status: httpStatus,
    fallbackMessage,
  });
}
