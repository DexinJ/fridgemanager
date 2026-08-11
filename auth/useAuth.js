// src/auth/useAuth.js
import { signOut as firebaseSignOut, onAuthStateChanged } from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { API_BASE_URL } from "../api/backendConfig";
import {
  accountDeletionResponseError,
  getBackendAccountDeletionStatus,
  requestBackendAccountDeletion,
} from "../api/accountDeletionApi";
import {
  clearAccountDeletionLifecycle,
  clearAppleLinkState,
  clearDurablePostAuthNotice,
  getAccountDeletionLifecycle,
  getAppleLinkState,
  getDurablePostAuthNotice,
  setDurablePostAuthNotice,
  updateAccountDeletionLifecycle,
} from "../api/accountLifecycleStorage";
import { fetchWithTimeout } from "../api/fetchWithTimeout";
import {
  clearAuthProvisioningIntent,
  getAuthProvisioningIntent,
} from "../api/authProvisioningStorage";
import {
  clearUserDataPurgePending,
  confirmUserDataPurge,
  getUserDataPurgeIntent,
  listUserDataPurgeIntents,
  markUserDataPurgePending,
} from "../api/storageKeys";
import {
  completePendingUserDataPurge,
  purgeStoredUserData,
  publicUserDataPurgeResult,
} from "../api/userDataPurge";
import { auth } from "./firebaseClient";
import {
  revokeGoogleAccessNative,
  signOutFromGoogleNative,
} from "./googleAuth";

const AuthContext = createContext(null);

const {
  classifyDeletionStatus,
  hasExactDeletionUid,
  isDeletedFirebaseError,
  selectPendingAccountDeletionIntent,
  shouldFinalizeDeletionLocally,
} = require("../api/accountDeletionPolicy.cjs");

const APPLE_MANUAL_SIGN_IN_REVOCATION_MESSAGE =
  "Your Pantrio account was deleted, but Apple access could not be revoked automatically. In iOS Settings, open your Apple Account, then Sign-In & Security > Sign in with Apple > Pantrio, and choose Stop Using Sign in with Apple.";
const APPLE_PENDING_SIGN_IN_REVOCATION_MESSAGE =
  "Your Pantrio account deletion was accepted, and the server is retrying the Apple disconnection automatically. Because that retry may not finish, you can guarantee disconnection in iOS Settings under Apple Account > Sign-In & Security > Sign in with Apple > Pantrio by choosing Stop Using Sign in with Apple. This does not cancel an App Store subscription.";

const DELETED_FIREBASE_ERROR_CODES = new Set([
  "auth/invalid-user-token",
  "auth/user-disabled",
  "auth/user-not-found",
  "auth/user-token-expired",
]);

async function backendAccountExists(user) {
  let token;
  try {
    token = await user.getIdToken(true);
  } catch (error) {
    if (DELETED_FIREBASE_ERROR_CODES.has(error?.code)) return false;
    throw error;
  }

  const response = await fetchWithTimeout(
    `${API_BASE_URL}/api/users/${encodeURIComponent(user.uid)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
    {
      timeoutMessage: "Checking this account's server status timed out.",
    }
  );

  if (response.status === 404 || response.status === 410) return false;
  if (!response.ok) {
    throw new Error(
      `Could not verify this account with the server (${response.status}).`
    );
  }
  return true;
}

function definitiveDeletionError(result, fallbackMessage) {
  const error = accountDeletionResponseError(result, fallbackMessage);
  error.accountDeletionRejected = true;
  return error;
}

function waitForDeletionStatus(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function firebaseAccountGoneResolution(user, bearerToken) {
  return {
    classification: { kind: "complete", deletionStatus: "complete" },
    result: {
      httpStatus: 404,
      payload: {
        ok: true,
        uid: user.uid,
        deletionStatus: "complete",
        firebaseStatus: "deleted",
      },
    },
    bearerToken,
  };
}

function pendingDeletionRecoveryError({ uid, cause = null, signedOut = false } = {}) {
  const error = new Error(
    signedOut
      ? "Pantrio found an unfinished account-deletion cleanup on this device. Sign in again to verify the server result, or clear this device's account data explicitly."
      : "Pantrio could not safely verify the pending account deletion. Your account data remains locked on this device. Retry, sign out without erasing it, or clear this device's data explicitly."
  );
  error.code = "ACCOUNT_DELETION_STATUS_UNKNOWN";
  error.cause = cause;
  error.accountDeletionRecoveryRequired = true;
  error.pendingDeletionUid = String(uid || "").trim() || null;
  error.signedOutRecovery = Boolean(signedOut);
  return error;
}

async function inspectDeletionStatus(user, bearerToken) {
  let token = bearerToken;
  let result = await getBackendAccountDeletionStatus(user.uid, token);
  let classification = classifyDeletionStatus(result.httpStatus, result.payload);

  if (classification.kind !== "authentication_unknown") {
    return { classification, result, bearerToken: token };
  }

  try {
    token = await user.getIdToken(true);
  } catch (error) {
    if (isDeletedFirebaseError(error)) {
      return firebaseAccountGoneResolution(user, bearerToken);
    }
    throw error;
  }

  result = await getBackendAccountDeletionStatus(user.uid, token);
  classification = classifyDeletionStatus(result.httpStatus, result.payload);
  return { classification, result, bearerToken: token };
}

async function requestDeletionAndResolveStatus(user, bearerToken) {
  let deleteResult = null;
  let deleteError = null;

  try {
    deleteResult = await requestBackendAccountDeletion(user.uid, bearerToken);
    const classification = classifyDeletionStatus(
      deleteResult.httpStatus,
      deleteResult.payload
    );

    if (classification.kind === "complete" || classification.kind === "processing") {
      return { classification, result: deleteResult, bearerToken };
    }
    if (classification.kind === "recent_auth_required") {
      const error = definitiveDeletionError(
        deleteResult,
        "Sign in again with your account provider, then retry account deletion."
      );
      error.code = "RECENT_AUTH_REQUIRED";
      throw error;
    }
    if (
      classification.kind === "rejected" ||
      classification.kind === "not_requested"
    ) {
      throw definitiveDeletionError(deleteResult);
    }
  } catch (error) {
    if (error?.accountDeletionRejected) throw error;
    deleteError = error;
  }

  try {
    let status = await inspectDeletionStatus(user, bearerToken);
    if (status.classification.kind === "not_requested" && deleteError) {
      // A client timeout can abort fetch while the DELETE is still queued or
      // committing server-side. Give the tombstone route a bounded window to
      // observe it before declaring the request rejected.
      for (const delayMs of [250, 750, 1500]) {
        await waitForDeletionStatus(delayMs);
        status = await inspectDeletionStatus(user, status.bearerToken);
        if (status.classification.kind !== "not_requested") break;
      }
    }
    if (
      status.classification.kind === "complete" ||
      status.classification.kind === "processing"
    ) {
      return status;
    }
    if (status.classification.kind === "not_requested") {
      throw definitiveDeletionError(
        status.result,
        deleteError?.message || "The server did not accept account deletion."
      );
    }
    if (
      status.classification.kind === "recent_auth_required" ||
      status.classification.kind === "rejected"
    ) {
      throw definitiveDeletionError(status.result);
    }

    return {
      classification: { kind: "unknown", deletionStatus: null },
      result: status.result,
      bearerToken: status.bearerToken,
      cause: deleteError,
    };
  } catch (statusError) {
    if (statusError?.accountDeletionRejected) throw statusError;
    return {
      classification: { kind: "unknown", deletionStatus: null },
      result: deleteResult,
      bearerToken,
      cause: statusError || deleteError,
    };
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [postAuthNotice, setPostAuthNotice] = useState(null);
  const [authRecoveryError, setAuthRecoveryError] = useState(null);
  const [accountDeletion, setAccountDeletion] = useState({
    pending: false,
    phase: null,
  });
  const [accountDeletionError, setAccountDeletionError] = useState(null);
  const rawUserRef = useRef(null);
  const pendingUserRef = useRef(null);
  const provisioningRef = useRef(false);
  const provisioningGenerationRef = useRef(0);
  const authStateGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const lastProviderIdsRef = useRef([]);
  const accountDeletionRef = useRef({ pending: false, phase: null });
  const accountDeletionOperationRef = useRef(null);
  const pendingDeletionRecoveryUidRef = useRef(null);
  const signedOutDeletionRecoveryDismissedRef = useRef(false);

  const updateAccountDeletionState = useCallback((next) => {
    const state = {
      pending: Boolean(next?.pending),
      phase: next?.phase || null,
    };
    accountDeletionRef.current = state;
    if (mountedRef.current) setAccountDeletion(state);
  }, []);

  const storePostAuthNotice = useCallback(async (notice) => {
    const title = String(notice?.title || "Account update").trim();
    const message = String(notice?.message || "").trim();
    if (!message) return null;

    const normalized = {
      title,
      message,
      audienceUid: notice?.audienceUid
        ? String(notice.audienceUid).trim() || null
        : null,
    };
    setPostAuthNotice(normalized);
    await setDurablePostAuthNotice(normalized).catch(() => {});
    return normalized;
  }, []);

  const finishAcceptedAccountDeletion = useCallback(
    async (nextUser, resolution, options = {}) => {
      const uid = nextUser.uid;
      const remotePayload = resolution?.result?.payload || {};
      const remoteKind = resolution?.classification?.kind || "unknown";

      updateAccountDeletionState({ pending: true, phase: "purging-local-data" });
      await updateAccountDeletionLifecycle(uid, {
        phase: "purging-local-data",
        remoteStatus: remoteKind,
        deletionStatus: remotePayload.deletionStatus || null,
        firebaseStatus: remotePayload.firebaseStatus || null,
        localDataStatus: remotePayload.localDataStatus || null,
        appleSignInRevocation:
          remotePayload.appleSignInRevocation || options.appleSignInRevocation || null,
      }).catch(() => {});

      let purgeResult;
      try {
        await confirmUserDataPurge(uid);
        purgeResult = await completePendingUserDataPurge(uid);
      } catch (error) {
        // Once deletion is accepted, a journal write failure must not keep
        // account data mounted. Direct purge remains safe and idempotent.
        purgeResult = await purgeStoredUserData(uid).catch((purgeError) => ({
          ok: false,
          outcomes: {},
          cleared: [],
          errors: [
            {
              scope: "purge",
              message: String(purgeError?.message || error?.message || purgeError),
            },
          ],
        }));
      }
      const visiblePurgeResult = publicUserDataPurgeResult(purgeResult);
      const appleLinkState = await getAppleLinkState(uid).catch(() => null);
      const manualAppleRevocation =
        remotePayload.appleSignInRevocation === "manual_required" ||
        appleLinkState?.status === "relink_required";
      const pendingAppleRevocation =
        remotePayload.appleSignInRevocation === "pending";

      let notice = null;
      if (manualAppleRevocation) {
        notice = {
          title: "Finish disconnecting Apple",
          message: APPLE_MANUAL_SIGN_IN_REVOCATION_MESSAGE,
        };
      } else if (pendingAppleRevocation) {
        notice = {
          title: "Apple access is still disconnecting",
          message: APPLE_PENDING_SIGN_IN_REVOCATION_MESSAGE,
        };
      } else if (!visiblePurgeResult.ok) {
        notice = {
          title: "Local cleanup needs another attempt",
          message:
            "Your account deletion was accepted and you were signed out, but some data on this device could not be removed. Pantrio will retry cleanup before allowing another account to open.",
        };
      } else if (remoteKind === "unknown") {
        notice = {
          title: "Deletion is being reconciled",
          message:
            "Pantrio could not confirm the final server response, so it cleared local account data and signed you out. If you sign in again, Pantrio will check the deletion status before showing account data.",
        };
      } else if (remoteKind === "processing") {
        notice = {
          title: "Account deletion is finishing",
          message:
            "Your deletion request was accepted and local account data was cleared. The remaining server cleanup will continue automatically.",
        };
      }

      if (notice) await storePostAuthNotice(notice);

      await clearAppleLinkState(uid).catch(() => {});
      const canClearLifecycle = remoteKind === "complete" && visiblePurgeResult.ok;
      if (!canClearLifecycle) {
        await updateAccountDeletionLifecycle(uid, {
          phase: "signed-out-pending-reconciliation",
          remoteStatus: remoteKind,
          localPurgeComplete: visiblePurgeResult.ok,
        }).catch(() => {});
      }

      updateAccountDeletionState({ pending: true, phase: "signing-out" });
      let providerCleanupError = null;
      if (lastProviderIdsRef.current.includes("google.com")) {
        try {
          await revokeGoogleAccessNative();
        } catch (error) {
          providerCleanupError = error;
        }
      }

      let firebaseSignedOut = false;
      try {
        await firebaseSignOut(auth);
        firebaseSignedOut = true;
      } catch (error) {
        if (!isDeletedFirebaseError(error)) {
          await updateAccountDeletionLifecycle(uid, {
            phase: "local-signout-failed",
            remoteStatus: remoteKind,
            localPurgeComplete: visiblePurgeResult.ok,
          }).catch(() => {});
          const recoveryError = new Error(
            error?.message || "Local Firebase sign-out failed."
          );
          recoveryError.code = error?.code || "LOCAL_SIGN_OUT_FAILED";
          recoveryError.cause = error;
          recoveryError.accountDeletionRecoveryRequired = true;
          setAuthRecoveryError(
            new Error(
              "The account was deleted, but this device could not finish signing out. Retry local sign-out before using Pantrio again."
            )
          );
          throw recoveryError;
        }
        firebaseSignedOut = true;
      } finally {
        authStateGenerationRef.current += 1;
        rawUserRef.current = firebaseSignedOut
          ? null
          : auth.currentUser || nextUser;
        pendingUserRef.current = null;
        lastProviderIdsRef.current = [];
        setUser(null);
        setLoading(false);
        updateAccountDeletionState({ pending: false, phase: null });
      }

      if (firebaseSignedOut && canClearLifecycle) {
        await clearAccountDeletionLifecycle(uid).catch(() => {});
      }

      return {
        remoteStatus: remoteKind,
        purgeResult: visiblePurgeResult,
        providerCleanupError,
        manualAppleRevocation,
      };
    },
    [storePostAuthNotice, updateAccountDeletionState]
  );

  const acceptRemoteAccountDeletion = useCallback(
    (payload) => {
      if (accountDeletionOperationRef.current) {
        return accountDeletionOperationRef.current;
      }

      const nextUser = rawUserRef.current || auth.currentUser;
      if (!nextUser) {
        return Promise.reject(
          new Error("The deleted account is no longer signed in on this device.")
        );
      }
      if (!hasExactDeletionUid(payload, nextUser.uid)) {
        const mismatchError = new Error(
          "The server deletion state belongs to a different account."
        );
        mismatchError.code = "ACCOUNT_DELETION_UID_MISMATCH";
        return Promise.reject(mismatchError);
      }

      const classification = classifyDeletionStatus(410, payload);
      if (!shouldFinalizeDeletionLocally(classification)) {
        const invalidStateError = new Error(
          "The server did not return an accepted account-deletion state."
        );
        invalidStateError.code = "ACCOUNT_DELETION_STATE_INVALID";
        return Promise.reject(invalidStateError);
      }

      updateAccountDeletionState({
        pending: true,
        phase: "remote-deletion-detected",
      });
      const resolution = {
        classification,
        result: { httpStatus: 410, payload },
      };
      const operation = (async () => {
        // Persist both recovery breadcrumbs before destructive cleanup when
        // possible. finishAcceptedAccountDeletion remains fail-safe if device
        // storage is unavailable and will perform a direct idempotent purge.
        await Promise.allSettled([
          updateAccountDeletionLifecycle(nextUser.uid, {
            phase: "remote-accepted",
            remoteStatus: classification.kind,
            deletionStatus: payload?.deletionStatus || null,
            firebaseStatus: payload?.firebaseStatus || null,
            localDataStatus: payload?.localDataStatus || null,
            appleSignInRevocation: payload?.appleSignInRevocation || null,
          }),
          markUserDataPurgePending(nextUser.uid, {
            reason: "account-delete",
            phase: "confirmed",
          }),
        ]);
        return finishAcceptedAccountDeletion(nextUser, resolution);
      })();

      accountDeletionOperationRef.current = operation;
      void operation.catch((error) => {
        if (mountedRef.current && !error?.accountDeletionRecoveryRequired) {
          setAccountDeletionError(
            error instanceof Error
              ? error
              : new Error("Could not finish remote account deletion.")
          );
        }
      });
      void operation
        .finally(() => {
          if (accountDeletionOperationRef.current === operation) {
            accountDeletionOperationRef.current = null;
          }
        })
        .catch(() => {});
      return operation;
    },
    [finishAcceptedAccountDeletion, updateAccountDeletionState]
  );

  const reconcileAuthenticatedUser = useCallback(
    async (nextUser, generation) => {
      const isCurrent = () =>
        mountedRef.current &&
        authStateGenerationRef.current === generation &&
        rawUserRef.current?.uid === nextUser.uid;

      try {
        const [deletionIntent, deletionLifecycle] = await Promise.all([
          getUserDataPurgeIntent(nextUser.uid),
          getAccountDeletionLifecycle(nextUser.uid),
        ]);
        if (!isCurrent()) return;

        if (
          deletionIntent?.reason === "account-delete" &&
          (deletionIntent.phase === "confirmed" ||
            deletionIntent.phase === "purging")
        ) {
          await finishAcceptedAccountDeletion(
            nextUser,
            {
              classification: {
                kind: deletionLifecycle?.remoteStatus || "unknown",
              },
              result: {
                payload: {
                  deletionStatus: deletionLifecycle?.deletionStatus || null,
                  firebaseStatus: deletionLifecycle?.firebaseStatus || null,
                  localDataStatus: deletionLifecycle?.localDataStatus || null,
                  appleSignInRevocation:
                    deletionLifecycle?.appleSignInRevocation || null,
                },
              },
            }
          );
          return;
        }

        // A lifecycle/marker can outlive the Firebase account or a lost DELETE
        // response. The status route never provisions, so it is safe to query
        // before publishing the authenticated route.
        if (deletionLifecycle || deletionIntent?.phase === "requested") {
          updateAccountDeletionState({
            pending: true,
            phase: "checking-deletion-status",
          });
          let token;
          try {
            token = await nextUser.getIdToken();
          } catch (error) {
            if (isDeletedFirebaseError(error)) {
              if (!isCurrent()) return;
              await finishAcceptedAccountDeletion(
                nextUser,
                firebaseAccountGoneResolution(nextUser, null)
              );
              return;
            }
            pendingDeletionRecoveryUidRef.current = nextUser.uid;
            throw pendingDeletionRecoveryError({
              uid: nextUser.uid,
              cause: error,
            });
          }
          const status = await inspectDeletionStatus(nextUser, token);
          if (!isCurrent()) return;

          if (
            status.classification.kind === "complete" ||
            status.classification.kind === "processing"
          ) {
            await finishAcceptedAccountDeletion(nextUser, status);
            return;
          }

          if (status.classification.kind === "not_requested") {
            await Promise.all([
              clearUserDataPurgePending(nextUser.uid),
              clearAccountDeletionLifecycle(nextUser.uid),
            ]);
            if (!isCurrent()) return;
            pendingDeletionRecoveryUidRef.current = null;
            updateAccountDeletionState({ pending: false, phase: null });
            await storePostAuthNotice({
              title: "Account deletion was not submitted",
              message:
                "A previous deletion attempt did not reach the server. Your account is still active; retry deletion from Settings when you are ready.",
              audienceUid: nextUser.uid,
            });
          } else {
            const error = new Error(
              "The pending account deletion could not be reconciled safely. Check your connection and retry."
            );
            error.code = "ACCOUNT_DELETION_STATUS_UNKNOWN";
            error.accountDeletionRecoveryRequired = true;
            error.pendingDeletionUid = nextUser.uid;
            pendingDeletionRecoveryUidRef.current = nextUser.uid;
            throw error;
          }
        }

        const provisioningIntent = await getAuthProvisioningIntent();
        if (!isCurrent()) return;

        if (provisioningIntent) {
          if (
            provisioningIntent.uid &&
            provisioningIntent.uid !== nextUser.uid
          ) {
            await clearAuthProvisioningIntent();
            if (!isCurrent()) return;
          } else {
            const accountExists = await backendAccountExists(nextUser);
            if (!isCurrent()) return;

            if (accountExists) {
              await clearAuthProvisioningIntent();
              if (!isCurrent()) return;
            } else {
              // Signing out does not delete the Firebase account. Keep the
              // marker so a future login cannot publish a Firebase-only user;
              // returning through signup can retry the backend profile POST.
              await firebaseSignOut(auth);
              return;
            }
          }
        }

        if (!isCurrent()) return;
        pendingUserRef.current = null;
        setAuthRecoveryError(null);
        setUser(nextUser);
        setLoading(false);
      } catch (error) {
        if (!isCurrent()) return;
        updateAccountDeletionState({ pending: false, phase: null });
        setUser(null);
        setLoading(false);
        setAuthRecoveryError(
          error instanceof Error
            ? error
            : new Error("The account status could not be verified.")
        );
      }
    },
    [
      finishAcceptedAccountDeletion,
      storePostAuthNotice,
      updateAccountDeletionState,
    ]
  );

  const reconcileSignedOutDeletionCleanup = useCallback(async (generation) => {
    const isCurrent = () =>
      mountedRef.current &&
      authStateGenerationRef.current === generation &&
      rawUserRef.current === null;

    try {
      if (signedOutDeletionRecoveryDismissedRef.current) {
        if (isCurrent()) {
          setAuthRecoveryError(null);
          setLoading(false);
        }
        return;
      }
      const intents = await listUserDataPurgeIntents();
      if (!isCurrent()) return;
      const pendingDeletion = selectPendingAccountDeletionIntent(intents);

      if (pendingDeletion) {
        pendingDeletionRecoveryUidRef.current = pendingDeletion.uid;
        setAuthRecoveryError(
          pendingDeletionRecoveryError({
            uid: pendingDeletion.uid,
            signedOut: true,
          })
        );
      } else {
        pendingDeletionRecoveryUidRef.current = null;
        setAuthRecoveryError(null);
      }
    } catch (error) {
      if (!isCurrent()) return;
      setAuthRecoveryError(
        error instanceof Error
          ? error
          : new Error("Local account cleanup could not be checked.")
      );
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      const generation = authStateGenerationRef.current + 1;
      authStateGenerationRef.current = generation;
      const normalizedUser = nextUser || null;
      rawUserRef.current = normalizedUser;
      if (normalizedUser) {
        signedOutDeletionRecoveryDismissedRef.current = false;
        lastProviderIdsRef.current = (normalizedUser.providerData || [])
          .map((provider) => provider?.providerId)
          .filter(Boolean);
      }

      // Deletion can remove the Firebase user before its HTTP response reaches
      // the client. Keep the authenticated route mounted behind the teardown
      // guard until the root coordinator has finished the local purge.
      if (accountDeletionRef.current.pending) {
        pendingUserRef.current = normalizedUser;
        setLoading(false);
        return;
      }

      // Firebase signs a newly-created account in before its backend profile
      // is ready. Keep the authenticated route hidden until signup explicitly
      // commits or rolls back that provisioning operation.
      if (provisioningRef.current) {
        pendingUserRef.current = normalizedUser;
        setLoading(false);
        return;
      }

      pendingUserRef.current = null;
      setAuthRecoveryError(null);
      setUser(null);

      if (!normalizedUser) {
        lastProviderIdsRef.current = [];
        setLoading(true);
        void reconcileSignedOutDeletionCleanup(generation);
        // Keep an interrupted provisioning marker across local sign-out. A
        // provider can create a Firebase account before the backend profile
        // fails; the next sign-in must verify that split state before publish.
        return;
      }

      setLoading(true);
      void reconcileAuthenticatedUser(normalizedUser, generation);
    });

    return () => {
      mountedRef.current = false;
      authStateGenerationRef.current += 1;
      unsubscribe();
    };
  }, [reconcileAuthenticatedUser, reconcileSignedOutDeletionCleanup]);

  useEffect(() => {
    let cancelled = false;
    void getDurablePostAuthNotice()
      .then((notice) => {
        if (cancelled || !notice?.message) return;
        setPostAuthNotice({
          title: String(notice.title || "Account update"),
          message: String(notice.message),
          audienceUid: notice.audienceUid
            ? String(notice.audienceUid)
            : null,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const beginProvisioning = useCallback(() => {
    if (provisioningRef.current) {
      throw new Error("Another account setup is still finishing.");
    }

    const generation = provisioningGenerationRef.current + 1;
    provisioningGenerationRef.current = generation;
    authStateGenerationRef.current += 1;
    provisioningRef.current = true;
    pendingUserRef.current = null;
    setAuthRecoveryError(null);
    setProvisioning(true);
    return generation;
  }, []);

  const queuePostAuthNotice = useCallback((notice) => {
    const title = String(notice?.title || "Account update").trim();
    const message = String(notice?.message || "").trim();
    if (!message) return;
    setPostAuthNotice({
      title,
      message,
      audienceUid: notice?.audienceUid
        ? String(notice.audienceUid).trim() || null
        : null,
    });
  }, []);

  const consumePostAuthNotice = useCallback(() => {
    setPostAuthNotice(null);
    void clearDurablePostAuthNotice().catch(() => {});
  }, []);

  const completeProvisioning = useCallback((generation) => {
    if (
      !provisioningRef.current ||
      generation !== provisioningGenerationRef.current
    ) {
      return false;
    }

    authStateGenerationRef.current += 1;
    provisioningRef.current = false;
    setProvisioning(false);
    setAuthRecoveryError(null);
    setUser(pendingUserRef.current || rawUserRef.current || null);
    pendingUserRef.current = null;
    setLoading(false);
    return true;
  }, []);

  const abortProvisioning = useCallback(async (generation, options = {}) => {
    if (
      !provisioningRef.current ||
      generation !== provisioningGenerationRef.current
    ) {
      return false;
    }

    // Invalidate the generation before provider cleanup can yield. A late
    // completion from this attempt can no longer publish its Firebase user.
    const invalidatedGeneration = generation + 1;
    provisioningGenerationRef.current = invalidatedGeneration;
    authStateGenerationRef.current += 1;

    let providerCleanupError = null;
    if (options.provider === "google") {
      try {
        await signOutFromGoogleNative();
      } catch (error) {
        providerCleanupError = error;
      }
    }

    // A replacement operation must never be signed out by an older cleanup
    // that resumed after yielding to native provider work.
    if (
      invalidatedGeneration !== provisioningGenerationRef.current ||
      !provisioningRef.current
    ) {
      return false;
    }

    try {
      // Keep the route guard closed until Firebase has actually signed out.
      await firebaseSignOut(auth);
    } catch (error) {
      if (invalidatedGeneration === provisioningGenerationRef.current) {
        // Do not claim to be signed out when Firebase still owns a session.
        // The durable provisioning marker remains in place and Retry can
        // reconcile it without exposing the partially-created account.
        provisioningRef.current = false;
        rawUserRef.current = auth.currentUser || rawUserRef.current;
        pendingUserRef.current = null;
        setUser(null);
        setProvisioning(false);
        setLoading(false);
        setAuthRecoveryError(
          error instanceof Error
            ? error
            : new Error("The incomplete account could not be signed out.")
        );
      }
      throw error;
    }

    if (invalidatedGeneration === provisioningGenerationRef.current) {
      provisioningRef.current = false;
      rawUserRef.current = null;
      pendingUserRef.current = null;
      lastProviderIdsRef.current = [];
      setAuthRecoveryError(null);
      setUser(null);
      setProvisioning(false);
      setLoading(false);
    }

    return { completed: true, providerCleanupError };
  }, []);

  const signOut = useCallback(async (options = {}) => {
    if (accountDeletionRef.current.pending) {
      throw new Error("Account deletion is already finishing.");
    }
    authStateGenerationRef.current += 1;
    const usesGoogle = lastProviderIdsRef.current.includes("google.com");
    let providerCleanupError = null;

    if (usesGoogle) {
      try {
        if (options.revokeProviderAccess) {
          await revokeGoogleAccessNative();
        } else {
          await signOutFromGoogleNative();
        }
      } catch (error) {
        // Native provider cleanup must not strand the Firebase session. Return
        // the provider error to destructive callers after local logout.
        providerCleanupError = error;
      }
    }

    await firebaseSignOut(auth);
    lastProviderIdsRef.current = [];
    return { providerCleanupError };
  }, []);

  const deleteAccount = useCallback(() => {
    if (accountDeletionOperationRef.current) {
      return accountDeletionOperationRef.current;
    }

    const nextUser = rawUserRef.current || auth.currentUser || user;
    if (!nextUser) {
      return Promise.reject(new Error("Sign in before deleting your account."));
    }

    // Close route/session guards synchronously before the first storage or
    // network await. This prevents foreground refreshes and screen writes once
    // a destructive request may be in flight.
    setAccountDeletionError(null);
    updateAccountDeletionState({ pending: true, phase: "preparing" });

    const operation = (async () => {
      const uid = nextUser.uid;
      try {
        await updateAccountDeletionLifecycle(uid, {
          phase: "requesting-server-deletion",
          remoteStatus: null,
        });
        await markUserDataPurgePending(uid, {
          reason: "account-delete",
          phase: "requested",
        });
      } catch (error) {
        await clearAccountDeletionLifecycle(uid).catch(() => {});
        updateAccountDeletionState({ pending: false, phase: null });
        throw error;
      }

      let bearerToken;
      try {
        bearerToken = await nextUser.getIdToken(true);
      } catch (error) {
        await Promise.all([
          clearAccountDeletionLifecycle(uid).catch(() => {}),
          clearUserDataPurgePending(uid).catch(() => {}),
        ]);
        updateAccountDeletionState({ pending: false, phase: null });
        throw error;
      }

      updateAccountDeletionState({ pending: true, phase: "requesting-server" });
      let resolution;
      try {
        resolution = await requestDeletionAndResolveStatus(nextUser, bearerToken);
      } catch (error) {
        if (error?.accountDeletionRejected) {
          await Promise.all([
            clearAccountDeletionLifecycle(uid).catch(() => {}),
            clearUserDataPurgePending(uid).catch(() => {}),
          ]);
          updateAccountDeletionState({ pending: false, phase: null });
        }
        throw error;
      }

      const payload = resolution?.result?.payload || {};
      await updateAccountDeletionLifecycle(uid, {
        phase:
          resolution.classification.kind === "unknown"
            ? "remote-status-unknown"
            : "remote-accepted",
        remoteStatus: resolution.classification.kind,
        deletionStatus: payload.deletionStatus || null,
        firebaseStatus: payload.firebaseStatus || null,
        localDataStatus: payload.localDataStatus || null,
        appleSignInRevocation: payload.appleSignInRevocation || null,
      }).catch(() => {});

      if (!shouldFinalizeDeletionLocally(resolution.classification)) {
        // A transport failure does not prove that the server accepted the
        // destructive request. Keep the requested markers and leave all
        // account data unmounted, but do not erase device-only data until a
        // later status check observes processing/completion (or proves the
        // Firebase account is gone).
        pendingDeletionRecoveryUidRef.current = uid;
        const recoveryError = pendingDeletionRecoveryError({
          uid,
          cause: resolution.cause || null,
        });
        setUser(null);
        setLoading(false);
        setAuthRecoveryError(recoveryError);
        updateAccountDeletionState({ pending: false, phase: null });
        throw recoveryError;
      }

      return finishAcceptedAccountDeletion(nextUser, resolution);
    })();

    accountDeletionOperationRef.current = operation;
    void operation.catch((error) => {
      if (mountedRef.current && !error?.accountDeletionRecoveryRequired) {
        setAccountDeletionError(
          error instanceof Error
            ? error
            : new Error("Could not finish account deletion.")
        );
      }
    });
    void operation.finally(() => {
      if (accountDeletionOperationRef.current === operation) {
        accountDeletionOperationRef.current = null;
      }
    }).catch(() => {});
    return operation;
  }, [finishAcceptedAccountDeletion, updateAccountDeletionState, user]);

  const consumeAccountDeletionError = useCallback(() => {
    setAccountDeletionError(null);
  }, []);

  const retryAuthRecovery = useCallback(() => {
    const currentUser = rawUserRef.current;
    setAuthRecoveryError(null);

    if (!currentUser) {
      setUser(null);
      setLoading(false);
      return;
    }

    const generation = authStateGenerationRef.current + 1;
    authStateGenerationRef.current = generation;
    setUser(null);
    setLoading(true);
    void reconcileAuthenticatedUser(currentUser, generation);
  }, [reconcileAuthenticatedUser]);

  const clearPendingDeletionDataFromRecovery = useCallback(() => {
    if (accountDeletionOperationRef.current) {
      return accountDeletionOperationRef.current;
    }

    const currentUser = rawUserRef.current || auth.currentUser;
    const uid =
      pendingDeletionRecoveryUidRef.current ||
      String(currentUser?.uid || "").trim();
    if (!uid) {
      return Promise.reject(
        new Error("No pending account data was found on this device.")
      );
    }

    updateAccountDeletionState({
      pending: true,
      phase: "purging-local-data",
    });

    const operation = (async () => {
      await updateAccountDeletionLifecycle(uid, {
        phase: "explicit-device-purge",
        remoteStatus: "unknown",
      }).catch(() => {});

      let purgeResult;
      try {
        await confirmUserDataPurge(uid);
        purgeResult = await completePendingUserDataPurge(uid);
      } catch (error) {
        purgeResult = await purgeStoredUserData(uid).catch((purgeError) => ({
          ok: false,
          outcomes: {},
          cleared: [],
          errors: [
            {
              scope: "purge",
              message: String(
                purgeError?.message || error?.message || purgeError || error
              ),
            },
          ],
        }));
      }

      if (purgeResult.ok) {
        try {
          await clearUserDataPurgePending(uid);
        } catch (error) {
          purgeResult.ok = false;
          purgeResult.errors.push({
            scope: "purgeIntent",
            message: String(error?.message || error),
          });
        }
      }

      const visiblePurgeResult = publicUserDataPurgeResult(purgeResult);
      const appleLinkState = await getAppleLinkState(uid).catch(() => null);
      const appleMayStillBeLinked =
        lastProviderIdsRef.current.includes("apple.com") ||
        appleLinkState?.status === "linked" ||
        appleLinkState?.status === "relink_required";

      await updateAccountDeletionLifecycle(uid, {
        phase: visiblePurgeResult.ok
          ? "device-data-cleared-pending-reconciliation"
          : "device-data-purge-failed",
        remoteStatus: "unknown",
        localPurgeComplete: visiblePurgeResult.ok,
        appleSignInRevocation: appleMayStillBeLinked
          ? "manual_required"
          : null,
      }).catch(() => {});

      if (visiblePurgeResult.ok) {
        await storePostAuthNotice(
          appleMayStillBeLinked
            ? {
                title: "Finish disconnecting Apple",
                message: APPLE_MANUAL_SIGN_IN_REVOCATION_MESSAGE,
              }
            : {
                title: "Device data cleared",
                message:
                  "Pantrio cleared this account's data from the device and signed out, but could not confirm the server deletion. Sign in again later to verify or retry the account deletion.",
              }
        );
      }

      await clearAppleLinkState(uid).catch(() => {});
      if (lastProviderIdsRef.current.includes("google.com")) {
        await signOutFromGoogleNative().catch(() => {});
      }

      let signOutError = null;
      try {
        await firebaseSignOut(auth);
      } catch (error) {
        signOutError = error;
      } finally {
        authStateGenerationRef.current += 1;
        rawUserRef.current = signOutError
          ? auth.currentUser || currentUser
          : null;
        pendingUserRef.current = null;
        lastProviderIdsRef.current = [];
        setUser(null);
        setLoading(false);
        updateAccountDeletionState({ pending: false, phase: null });
      }

      if (signOutError) {
        const recoveryError = pendingDeletionRecoveryError({
          uid,
          cause: signOutError,
        });
        setAuthRecoveryError(recoveryError);
        throw recoveryError;
      }

      if (visiblePurgeResult.ok) {
        const nextPendingDeletion = await listUserDataPurgeIntents()
          .then(selectPendingAccountDeletionIntent)
          .catch(() => null);
        if (nextPendingDeletion) {
          pendingDeletionRecoveryUidRef.current = nextPendingDeletion.uid;
          setAuthRecoveryError(
            pendingDeletionRecoveryError({
              uid: nextPendingDeletion.uid,
              signedOut: true,
            })
          );
        } else {
          pendingDeletionRecoveryUidRef.current = null;
          setAuthRecoveryError(null);
        }
      } else {
        pendingDeletionRecoveryUidRef.current = uid;
        setAuthRecoveryError(
          pendingDeletionRecoveryError({ uid, signedOut: true })
        );
      }

      return { purgeResult: visiblePurgeResult };
    })();

    accountDeletionOperationRef.current = operation;
    void operation.finally(() => {
      if (accountDeletionOperationRef.current === operation) {
        accountDeletionOperationRef.current = null;
      }
    }).catch(() => {});
    return operation;
  }, [storePostAuthNotice, updateAccountDeletionState]);

  const signOutFromRecovery = useCallback(async () => {
    setAuthRecoveryError(null);
    setUser(null);

    if (!rawUserRef.current && !auth.currentUser) {
      signedOutDeletionRecoveryDismissedRef.current = true;
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      await signOut();
      if (mountedRef.current) setLoading(false);
    } catch (error) {
      if (!mountedRef.current) return;
      setLoading(false);
      setAuthRecoveryError(
        error instanceof Error
          ? error
          : new Error("The local session could not be signed out.")
      );
    }
  }, [signOut]);

  const value = useMemo(
    () => ({
      user,
      loading,
      provisioning,
      postAuthNotice,
      authRecoveryError,
      accountDeletionError,
      accountDeletionPending: accountDeletion.pending,
      accountDeletionPhase: accountDeletion.phase,
      loggedIn: Boolean(user),
      beginProvisioning,
      completeProvisioning,
      abortProvisioning,
      queuePostAuthNotice,
      consumePostAuthNotice,
      consumeAccountDeletionError,
      retryAuthRecovery,
      clearPendingDeletionDataFromRecovery,
      acceptRemoteAccountDeletion,
      deleteAccount,
      signOut,
      signOutFromRecovery,
    }),
    [
      abortProvisioning,
      acceptRemoteAccountDeletion,
      accountDeletion.pending,
      accountDeletion.phase,
      accountDeletionError,
      authRecoveryError,
      beginProvisioning,
      completeProvisioning,
      consumeAccountDeletionError,
      consumePostAuthNotice,
      deleteAccount,
      loading,
      postAuthNotice,
      provisioning,
      queuePostAuthNotice,
      retryAuthRecovery,
      clearPendingDeletionDataFromRecovery,
      signOut,
      signOutFromRecovery,
      user,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider.");
  }

  return context;
}
