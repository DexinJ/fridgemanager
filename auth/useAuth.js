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
import { fetchWithTimeout } from "../api/fetchWithTimeout";
import {
  clearAuthProvisioningIntent,
  getAuthProvisioningIntent,
} from "../api/authProvisioningStorage";
import {
  clearUserDataPurgePending,
  confirmUserDataPurge,
  getUserDataPurgeIntent,
} from "../api/storageKeys";
import { auth } from "./firebaseClient";
import {
  revokeGoogleAccessNative,
  signOutFromGoogleNative,
} from "./googleAuth";

const AuthContext = createContext(null);

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

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [provisioning, setProvisioning] = useState(false);
  const [postAuthNotice, setPostAuthNotice] = useState(null);
  const [authRecoveryError, setAuthRecoveryError] = useState(null);
  const rawUserRef = useRef(null);
  const pendingUserRef = useRef(null);
  const provisioningRef = useRef(false);
  const provisioningGenerationRef = useRef(0);
  const authStateGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const lastProviderIdsRef = useRef([]);

  const reconcileAuthenticatedUser = useCallback(
    async (nextUser, generation) => {
      const isCurrent = () =>
        mountedRef.current &&
        authStateGenerationRef.current === generation &&
        rawUserRef.current?.uid === nextUser.uid;

      try {
        const deletionIntent = await getUserDataPurgeIntent(nextUser.uid);
        if (!isCurrent()) return;

        if (
          deletionIntent?.reason === "account-delete" &&
          (deletionIntent.phase === "confirmed" ||
            deletionIntent.phase === "purging")
        ) {
          await firebaseSignOut(auth);
          return;
        }

        // A requested or unreadable marker is ambiguous: the app may have
        // stopped after sending a deletion request but before recording the
        // response. Verify the server before either exposing or purging data.
        if (deletionIntent?.phase === "requested") {
          const accountExists = await backendAccountExists(nextUser);
          if (!isCurrent()) return;

          if (accountExists) {
            await clearUserDataPurgePending(nextUser.uid);
            if (!isCurrent()) return;
          } else {
            await confirmUserDataPurge(nextUser.uid);
            if (!isCurrent()) return;
            await firebaseSignOut(auth);
            return;
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
        setUser(null);
        setLoading(false);
        setAuthRecoveryError(
          error instanceof Error
            ? error
            : new Error("The account status could not be verified.")
        );
      }
    },
    []
  );

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      const generation = authStateGenerationRef.current + 1;
      authStateGenerationRef.current = generation;
      const normalizedUser = nextUser || null;
      rawUserRef.current = normalizedUser;
      if (normalizedUser) {
        lastProviderIdsRef.current = (normalizedUser.providerData || [])
          .map((provider) => provider?.providerId)
          .filter(Boolean);
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
        setLoading(false);
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
  }, [reconcileAuthenticatedUser]);

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
    setPostAuthNotice({ title, message });
  }, []);

  const consumePostAuthNotice = useCallback(() => {
    setPostAuthNotice(null);
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

  const signOutFromRecovery = useCallback(async () => {
    setAuthRecoveryError(null);
    setUser(null);
    setLoading(true);

    try {
      await signOut();
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
      loggedIn: Boolean(user),
      beginProvisioning,
      completeProvisioning,
      abortProvisioning,
      queuePostAuthNotice,
      consumePostAuthNotice,
      retryAuthRecovery,
      signOut,
      signOutFromRecovery,
    }),
    [
      abortProvisioning,
      authRecoveryError,
      beginProvisioning,
      completeProvisioning,
      consumePostAuthNotice,
      loading,
      postAuthNotice,
      provisioning,
      queuePostAuthNotice,
      retryAuthRecovery,
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
