import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  classifyDeletionStatus,
  deletionSessionDisposition,
  hasExactDeletionUid,
  isAcceptedDeletionResponse,
  isDeletedFirebaseError,
  isDeletionAccepted,
  selectPendingAccountDeletionIntent,
  shouldFinalizeDeletionLocally,
} = require("../api/accountDeletionPolicy.cjs");

test("classifies complete and processing deletion responses by body status", () => {
  assert.equal(
    classifyDeletionStatus(200, { deletionStatus: "complete" }).kind,
    "complete"
  );
  assert.equal(
    classifyDeletionStatus(202, {
      ok: false,
      deletionStatus: "processing",
    }).kind,
    "processing"
  );
  assert.equal(isDeletionAccepted({ deletionStatus: "processing" }), true);
  assert.equal(
    isAcceptedDeletionResponse(410, {
      code: "ACCOUNT_DELETION_IN_PROGRESS",
      deletionStatus: "processing",
    }),
    true
  );
  assert.equal(
    isAcceptedDeletionResponse(410, {
      code: "UNRELATED_GONE_RESPONSE",
      deletionStatus: "processing",
    }),
    false
  );
  assert.equal(hasExactDeletionUid({ uid: "user-1" }, "user-1"), true);
  assert.equal(hasExactDeletionUid({}, "user-1"), false);
  assert.equal(hasExactDeletionUid({ uid: "user-2" }, "user-1"), false);

  const deletionPayload = {
    code: "ACCOUNT_DELETION_IN_PROGRESS",
    deletionStatus: "processing",
  };
  assert.deepEqual(
    deletionSessionDisposition(410, deletionPayload, "user-1"),
    { invalidateSession: true, shouldPurge: false }
  );
  assert.deepEqual(
    deletionSessionDisposition(
      410,
      { code: "ACCOUNT_DELETION_IN_PROGRESS", uid: "user-1" },
      "user-1"
    ),
    { invalidateSession: true, shouldPurge: false }
  );
  assert.deepEqual(
    deletionSessionDisposition(
      410,
      { ...deletionPayload, uid: "user-2" },
      "user-1"
    ),
    { invalidateSession: true, shouldPurge: false }
  );
  assert.deepEqual(
    deletionSessionDisposition(
      410,
      { ...deletionPayload, uid: "user-1" },
      "user-1"
    ),
    { invalidateSession: true, shouldPurge: true }
  );
});

test("distinguishes safe retry and definitive deletion-status outcomes", () => {
  assert.equal(
    classifyDeletionStatus(200, { deletionStatus: "not_requested" }).kind,
    "not_requested"
  );
  assert.equal(
    classifyDeletionStatus(404, { code: "ACCOUNT_NOT_FOUND" }).kind,
    "complete"
  );
  assert.equal(classifyDeletionStatus(401, {}).kind, "authentication_unknown");
  assert.equal(
    classifyDeletionStatus(403, { code: "RECENT_AUTH_REQUIRED" }).kind,
    "recent_auth_required"
  );
});

test("recognizes Firebase errors that prove the remote auth user is gone", () => {
  assert.equal(isDeletedFirebaseError({ code: "auth/user-not-found" }), true);
  assert.equal(isDeletedFirebaseError({ code: "auth/invalid-user-token" }), false);
  assert.equal(isDeletedFirebaseError({ code: "auth/user-disabled" }), false);
  assert.equal(isDeletedFirebaseError({ code: "auth/user-token-expired" }), false);
  assert.equal(isDeletedFirebaseError({ code: "auth/network-request-failed" }), false);
});

test("purges local data only after the backend accepts or completes deletion", () => {
  assert.equal(
    shouldFinalizeDeletionLocally({ kind: "processing" }),
    true
  );
  assert.equal(shouldFinalizeDeletionLocally({ kind: "complete" }), true);
  assert.equal(shouldFinalizeDeletionLocally({ kind: "unknown" }), false);
  assert.equal(shouldFinalizeDeletionLocally({ kind: "not_requested" }), false);
});

test("signed-out recovery discovers the oldest pending account deletion", () => {
  const selected = selectPendingAccountDeletionIntent([
    {
      uid: "newer-user",
      reason: "account-delete",
      requestedAt: "2026-08-10T12:00:00.000Z",
    },
    { uid: "ignored-user", reason: "clear-all" },
    {
      uid: "older-user",
      reason: "account-delete",
      requestedAt: "2026-08-09T12:00:00.000Z",
    },
  ]);

  assert.equal(selected?.uid, "older-user");
  assert.equal(selectPendingAccountDeletionIntent([]), null);
});
