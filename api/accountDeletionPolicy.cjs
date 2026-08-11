const DELETED_FIREBASE_ERROR_CODES = new Set([
  "auth/user-not-found",
]);

const ACCEPTED_DELETION_STATUSES = new Set(["processing", "complete"]);

function classifyDeletionStatus(httpStatus, payload) {
  const deletionStatus = String(payload?.deletionStatus || "").trim();
  const code = String(payload?.code || "").trim();

  // Normal protected routes report a durable deletion tombstone as 410,
  // while the dedicated status route uses 200/202. Both are authoritative
  // accepted-deletion responses when their public state agrees.
  if (
    (httpStatus >= 200 && httpStatus < 300) ||
    (httpStatus === 410 &&
      (code === "ACCOUNT_DELETION_IN_PROGRESS" || code === "ACCOUNT_DELETED"))
  ) {
    if (deletionStatus === "complete") {
      return { kind: "complete", deletionStatus };
    }
    if (deletionStatus === "processing") {
      return { kind: "processing", deletionStatus };
    }
  }

  if (httpStatus === 404 && code === "ACCOUNT_NOT_FOUND") {
    return { kind: "complete", deletionStatus: "complete" };
  }

  if (httpStatus >= 200 && httpStatus < 300) {
    if (deletionStatus === "not_requested") {
      return { kind: "not_requested", deletionStatus };
    }
  }

  if (httpStatus === 403 && code === "RECENT_AUTH_REQUIRED") {
    return { kind: "recent_auth_required", deletionStatus: null };
  }

  if (httpStatus === 401) {
    return { kind: "authentication_unknown", deletionStatus: null };
  }

  if (httpStatus >= 400 && httpStatus < 500) {
    return { kind: "rejected", deletionStatus: deletionStatus || null };
  }

  return { kind: "unknown", deletionStatus: deletionStatus || null };
}

function isDeletionAccepted(payload) {
  return ACCEPTED_DELETION_STATUSES.has(
    String(payload?.deletionStatus || "").trim()
  );
}

function isAcceptedDeletionResponse(httpStatus, payload) {
  return shouldFinalizeDeletionLocally(
    classifyDeletionStatus(httpStatus, payload)
  );
}

function hasExactDeletionUid(payload, expectedUid) {
  const actual =
    typeof payload?.uid === "string" ? payload.uid.trim() : "";
  const expected = String(expectedUid || "").trim();
  return Boolean(expected && actual === expected);
}

function deletionSessionDisposition(httpStatus, payload, expectedUid) {
  const code = String(payload?.code || "").trim();
  const isDeletionTombstone =
    httpStatus === 410 &&
    (code === "ACCOUNT_DELETION_IN_PROGRESS" || code === "ACCOUNT_DELETED");
  if (!isDeletionTombstone) {
    return { invalidateSession: false, shouldPurge: false };
  }
  const bound =
    isAcceptedDeletionResponse(httpStatus, payload) &&
    hasExactDeletionUid(payload, expectedUid);
  return { invalidateSession: true, shouldPurge: bound };
}

function isDeletedFirebaseError(error) {
  return DELETED_FIREBASE_ERROR_CODES.has(String(error?.code || ""));
}

function shouldFinalizeDeletionLocally(classification) {
  return (
    classification?.kind === "processing" ||
    classification?.kind === "complete"
  );
}

function selectPendingAccountDeletionIntent(intents) {
  return (
    (Array.isArray(intents) ? intents : [])
      .filter(
        (intent) =>
          intent?.reason === "account-delete" &&
          typeof intent?.uid === "string" &&
          intent.uid.trim()
      )
      .sort((left, right) =>
        String(left.requestedAt || "").localeCompare(
          String(right.requestedAt || "")
        )
      )[0] || null
  );
}

module.exports = {
  classifyDeletionStatus,
  deletionSessionDisposition,
  hasExactDeletionUid,
  isAcceptedDeletionResponse,
  isDeletedFirebaseError,
  isDeletionAccepted,
  selectPendingAccountDeletionIntent,
  shouldFinalizeDeletionLocally,
};
