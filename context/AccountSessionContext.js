import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Platform } from "react-native";
import { API_BASE_URL } from "../api/backendConfig";
import {
  createBackendResponseError,
  parseBackendResponseText,
} from "../api/backendErrors";
import { useAppleSubscription } from "./SubscriptionContext";

const EMPTY_ENTITLEMENT = Object.freeze({
  plan: "free",
  active: false,
  source: null,
  verified: false,
  productId: null,
  status: "unknown",
  expiresAt: null,
  checkedAt: null,
});

const SESSION_REQUEST_TIMEOUT_MS = 10_000;
const APPLE_REQUEST_TIMEOUT_MS = 20_000;
const APPLE_EVIDENCE_MAX_ITEMS = 20;
const APPLE_EVIDENCE_SOURCES = new Set([
  "purchase",
  "restore",
  "refresh",
  "transaction_update",
]);

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeQuota(value, previous = null) {
  const source =
    value?.quota && typeof value.quota === "object" ? value.quota : value;
  if (!source || typeof source !== "object") return previous;

  const applies =
    typeof source.applies === "boolean"
      ? source.applies
      : typeof source.quotaApplies === "boolean"
        ? source.quotaApplies
        : previous?.applies ?? true;

  if (!applies) {
    return {
      applies: false,
      limit: null,
      used: 0,
      reserved: 0,
      remaining: null,
      resetsAt: source.resetsAt ?? source.resetAt ?? previous?.resetsAt ?? null,
      timezone: source.timezone ?? previous?.timezone ?? null,
    };
  }

  const limit =
    finiteNumber(source.limit ?? source.dailyLimit) ?? previous?.limit ?? null;
  const remaining =
    finiteNumber(source.remaining ?? source.remainingTokens) ??
    previous?.remaining ??
    null;
  const used =
    finiteNumber(source.used ?? source.usedTokens) ??
    (limit !== null && remaining !== null
      ? Math.max(0, limit - remaining)
      : null) ??
    previous?.used ??
    null;

  return {
    ...(previous || {}),
    applies,
    limit,
    used,
    reserved:
      finiteNumber(source.reserved ?? source.reservedTokens) ??
      previous?.reserved ??
      0,
    remaining,
    resetsAt: source.resetsAt ?? source.resetAt ?? previous?.resetsAt ?? null,
    timezone: source.timezone ?? previous?.timezone ?? null,
  };
}

function responseMessage(payload, fallback) {
  return payload?.error?.message || payload?.error || payload?.message || fallback;
}

function isSupersededAppleRequest(error) {
  return error?.code === "APPLE_REQUEST_SUPERSEDED";
}

function supersededAppleRequestError() {
  const error = new Error(
    "The signed-in account changed before the Apple action completed."
  );
  error.code = "APPLE_REQUEST_SUPERSEDED";
  return error;
}

function catalogProductIds(sessionPayload) {
  const products = sessionPayload?.apple?.products;
  if (!Array.isArray(products)) return [];

  return products
    .map((product) => String(product?.productId || "").trim())
    .filter(Boolean);
}

function catalogFingerprint(sessionPayload) {
  return [...catalogProductIds(sessionPayload)].sort().join("\n");
}

function normalizeAppleEvidence(envelope, expectedAppAccountToken) {
  const evidence = Array.isArray(envelope?.evidence) ? envelope.evidence : [];
  const normalized = [];
  const seenTransactions = new Set();

  for (const item of evidence) {
    const signedTransactionInfo =
      typeof item?.signedTransactionInfo === "string"
        ? item.signedTransactionInfo.trim()
        : "";
    if (!signedTransactionInfo || seenTransactions.has(signedTransactionInfo)) {
      continue;
    }
    if (
      item.appAccountToken &&
      expectedAppAccountToken &&
      String(item.appAccountToken).trim().toLowerCase() !==
        String(expectedAppAccountToken).trim().toLowerCase()
    ) {
      const error = new Error(
        "This Apple transaction belongs to a different Pantrio account."
      );
      error.code = "APPLE_ACCOUNT_TOKEN_MISMATCH";
      throw error;
    }

    seenTransactions.add(signedTransactionInfo);
    normalized.push({ signedTransactionInfo });
    if (normalized.length === APPLE_EVIDENCE_MAX_ITEMS) break;
  }

  if (!normalized.length) {
    const error = new Error(
      "StoreKit did not provide signed transaction evidence. Please try again."
    );
    error.code = "APPLE_EVIDENCE_MISSING";
    throw error;
  }

  return normalized;
}

function evidenceFingerprint(envelope) {
  const entries = Array.isArray(envelope?.evidence) ? envelope.evidence : [];
  return entries
    .map(
      (item) =>
        item?.transactionId ||
        `${String(item?.signedTransactionInfo || "").slice(-48)}:${String(
          item?.signedTransactionInfo || ""
        ).length}`
    )
    .filter(Boolean)
    .sort()
    .join("|");
}

function evidenceForAppAccount(envelope, appAccountToken) {
  const expectedToken = String(appAccountToken || "").trim().toLowerCase();
  const evidence = (Array.isArray(envelope?.evidence) ? envelope.evidence : [])
    .filter(
      (item) =>
        expectedToken &&
        String(item?.appAccountToken || "").trim().toLowerCase() ===
          expectedToken
    );
  return { ...(envelope || {}), evidence };
}

function mergeApplePlans(sessionPayload, storeKitProducts) {
  const catalog = Array.isArray(sessionPayload?.apple?.products)
    ? sessionPayload.apple.products
    : [];
  const storeKitById = new Map(
    (Array.isArray(storeKitProducts) ? storeKitProducts : []).map((product) => [
      product?.productId,
      product,
    ])
  );

  return catalog.map((catalogProduct) => {
    const storeKit = storeKitById.get(catalogProduct?.productId) || null;
    const planId = String(catalogProduct?.planId || "").trim();
    const fallbackName = planId
      ? planId.charAt(0).toUpperCase() + planId.slice(1)
      : "Pantrio subscription";

    return {
      ...catalogProduct,
      ...(storeKit || {}),
      productId: catalogProduct.productId,
      planId: catalogProduct.planId,
      displayName:
        storeKit?.displayName || catalogProduct?.displayName || fallbackName,
      description:
        storeKit?.description || catalogProduct?.description || null,
      displayPrice: storeKit?.displayPrice || null,
      period: storeKit?.period || catalogProduct?.period || null,
      storeKitAvailable: Boolean(storeKit),
    };
  });
}

const AccountSessionContext = createContext({
  session: null,
  entitlement: EMPTY_ENTITLEMENT,
  quota: null,
  model: null,
  initializing: false,
  loading: false,
  error: null,
  apple: null,
  applePlans: [],
  appleProductsLoading: false,
  appleProductsError: null,
  appleOperation: null,
  appleError: null,
  refreshSession: async () => null,
  purchaseApplePlan: async () => null,
  restoreApplePurchases: async () => null,
  refreshAppleSubscription: async () => null,
  updateQuota: () => {},
  applyRealtimeState: () => {},
});

export function AccountSessionProvider({ authUser = null, children }) {
  const {
    products: storeKitProducts,
    productsLoading: appleProductsLoading,
    productsError: appleProductsError,
    latestTransactionEvent,
    configureProductCatalog,
    refreshSubscription: refreshLocalAppleSubscription,
    purchaseProduct,
    restorePurchases,
    getUnfinishedTransactions,
    finishTransactions,
  } = useAppleSubscription();
  const [session, setSession] = useState(null);
  const [entitlement, setEntitlement] = useState(EMPTY_ENTITLEMENT);
  const [quota, setQuota] = useState(null);
  const [model, setModel] = useState(null);
  const [initialized, setInitialized] = useState(!authUser);
  const [loading, setLoading] = useState(Boolean(authUser));
  const [error, setError] = useState(null);
  const [appleOperation, setAppleOperation] = useState(null);
  const [appleError, setAppleError] = useState(null);
  const authUserUid = authUser?.uid || null;
  const mountedRef = useRef(false);
  const sessionRef = useRef(null);
  const sessionRequestControllerRef = useRef(null);
  const sessionRequestGenerationRef = useRef(0);
  const appleRequestControllersRef = useRef(new Set());
  const authUserUidRef = useRef(authUserUid);
  const authGenerationRef = useRef(0);
  const appleEvidenceRequestsRef = useRef(new Map());
  const appleUserActionRef = useRef(false);
  const appleBootstrapKeyRef = useRef(null);

  const applySessionPayload = useCallback((payload) => {
    if (!payload || typeof payload !== "object") return;

    sessionRef.current = payload;
    setSession(payload);
    if (payload.entitlement && typeof payload.entitlement === "object") {
      setEntitlement({ ...EMPTY_ENTITLEMENT, ...payload.entitlement });
    }
    if (payload.quota && typeof payload.quota === "object") {
      setQuota((current) => normalizeQuota(payload.quota, current));
    }
    if (payload.model && typeof payload.model === "object") {
      setModel(payload.model);
    }
  }, []);

  const authenticatedAppleRequest = useCallback(
    async (path, options = {}) => {
      if (!authUser) {
        const authError = new Error(
          "Sign in to verify your Apple subscription."
        );
        authError.code = "AUTH_REQUIRED";
        throw authError;
      }

      const requestUid = authUser.uid;
      const requestGeneration = authGenerationRef.current;

      const controller = new AbortController();
      appleRequestControllersRef.current.add(controller);
      let timedOut = false;
      let timeoutId;
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
          const timeoutError = new Error(
            "Apple subscription verification timed out. Please try again."
          );
          timeoutError.code = "APPLE_VERIFICATION_TIMEOUT";
          reject(timeoutError);
        }, APPLE_REQUEST_TIMEOUT_MS);
      });

      try {
        return await Promise.race([
          (async () => {
            const token = await authUser.getIdToken();
            const response = await fetch(`${API_BASE_URL}${path}`, {
              ...options,
              headers: {
                Authorization: `Bearer ${token}`,
                ...(options.body ? { "Content-Type": "application/json" } : {}),
                ...(options.headers || {}),
              },
              signal: controller.signal,
            });
            const responseText = await response.text();
            const payload = parseBackendResponseText(responseText) || {};
            if (!response.ok) {
              throw createBackendResponseError(payload, {
                status: response.status,
                fallbackMessage: `Apple subscription request failed (${response.status}).`,
              });
            }
            if (
              authGenerationRef.current !== requestGeneration ||
              authUserUidRef.current !== requestUid
            ) {
              const supersededError = new Error(
                "The signed-in account changed before verification completed."
              );
              supersededError.code = "APPLE_REQUEST_SUPERSEDED";
              throw supersededError;
            }
            return payload;
          })(),
          timeoutPromise,
        ]);
      } catch (nextError) {
        if (timedOut) {
          const timeoutError = new Error(
            "Apple subscription verification timed out. Please try again."
          );
          timeoutError.code = "APPLE_VERIFICATION_TIMEOUT";
          throw timeoutError;
        }
        throw nextError;
      } finally {
        clearTimeout(timeoutId);
        appleRequestControllersRef.current.delete(controller);
      }
    },
    [authUser]
  );

  const refreshSession = useCallback(async () => {
    const requestGeneration = sessionRequestGenerationRef.current + 1;
    sessionRequestGenerationRef.current = requestGeneration;
    sessionRequestControllerRef.current?.abort();

    if (!authUser) {
      sessionRequestControllerRef.current = null;
      sessionRef.current = null;
      setSession(null);
      setEntitlement(EMPTY_ENTITLEMENT);
      setQuota(null);
      setModel(null);
      setInitialized(true);
      setLoading(false);
      setError(null);
      return null;
    }

    const controller = new AbortController();
    sessionRequestControllerRef.current = controller;
    setLoading(true);
    let timedOut = false;
    let timeoutId;

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
        const timeoutError = new Error(
          "Checking account access timed out. Please try again."
        );
        timeoutError.code = "SESSION_TIMEOUT";
        reject(timeoutError);
      }, SESSION_REQUEST_TIMEOUT_MS);
    });

    try {
      const payload = await Promise.race([
        (async () => {
          const token = await authUser.getIdToken();
          const response = await fetch(`${API_BASE_URL}/api/session`, {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          });
          const responsePayload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(
              responseMessage(
                responsePayload,
                `Could not load account access (${response.status}).`
              )
            );
          }

          return responsePayload;
        })(),
        timeoutPromise,
      ]);

      if (sessionRequestGenerationRef.current !== requestGeneration) {
        return null;
      }

      applySessionPayload(payload);
      setError(null);
      return payload;
    } catch (nextError) {
      if (sessionRequestGenerationRef.current !== requestGeneration) {
        return null;
      }

      const errorToReport = timedOut
        ? Object.assign(
            new Error("Checking account access timed out. Please try again."),
            { code: "SESSION_TIMEOUT" }
          )
        : nextError;
      setError(errorToReport?.message || "Could not load account access.");
      throw errorToReport;
    } finally {
      clearTimeout(timeoutId);
      if (sessionRequestGenerationRef.current === requestGeneration) {
        if (sessionRequestControllerRef.current === controller) {
          sessionRequestControllerRef.current = null;
        }
        setInitialized(true);
        setLoading(false);
      }
    }
  }, [applySessionPayload, authUser]);

  const verifyAppleEvidence = useCallback(
    async (envelope, source = "refresh", sessionPayload = sessionRef.current) => {
      const normalizedSource = APPLE_EVIDENCE_SOURCES.has(source)
        ? source
        : "refresh";
      const appAccountToken = sessionPayload?.apple?.appAccountToken;
      if (!appAccountToken) {
        const tokenError = new Error(
          "Pantrio has not prepared this account for Apple purchases yet. Retry the account check."
        );
        tokenError.code = "APPLE_ACCOUNT_TOKEN_MISSING";
        throw tokenError;
      }

      const evidence = normalizeAppleEvidence(envelope, appAccountToken);
      if (!evidence.length) return null;

      const fingerprint = `${authUserUid || ""}:${String(
        appAccountToken
      ).toLowerCase()}:${evidenceFingerprint(envelope)}`;
      const existingRequest = appleEvidenceRequestsRef.current.get(fingerprint);
      if (existingRequest) return existingRequest;

      const request = (async () => {
        try {
          const result = await authenticatedAppleRequest(
            "/api/subscriptions/apple/verify",
            {
              method: "POST",
              body: JSON.stringify({ source: normalizedSource, evidence }),
            }
          );

          if (result?.session) applySessionPayload(result.session);

          const submittedTransactionIds = new Set(
            (Array.isArray(envelope?.evidence) ? envelope.evidence : [])
              .map((item) => String(item?.transactionId || "").trim())
              .filter(Boolean)
          );
          const acceptedTransactionIds = [
            ...new Set(
              (Array.isArray(result?.acceptedTransactionIds)
                ? result.acceptedTransactionIds
                : []
                )
                .map((transactionId) => String(transactionId || "").trim())
                .filter(
                  (transactionId) =>
                    transactionId && submittedTransactionIds.has(transactionId)
                )
            ),
          ];
          if (acceptedTransactionIds.length) {
            await finishTransactions(acceptedTransactionIds);
          }
          await refreshLocalAppleSubscription().catch(() => null);
          if (!result?.session) await refreshSession();
          if (mountedRef.current) setAppleError(null);
          return result;
        } catch (nextError) {
          if (mountedRef.current && !isSupersededAppleRequest(nextError)) {
            setAppleError(
              nextError?.message || "Could not verify the Apple subscription."
            );
          }
          throw nextError;
        }
      })();

      appleEvidenceRequestsRef.current.set(fingerprint, request);
      try {
        return await request;
      } finally {
        if (appleEvidenceRequestsRef.current.get(fingerprint) === request) {
          appleEvidenceRequestsRef.current.delete(fingerprint);
        }
      }
    },
    [
      applySessionPayload,
      authUserUid,
      authenticatedAppleRequest,
      finishTransactions,
      refreshLocalAppleSubscription,
      refreshSession,
    ]
  );

  const refreshServerAppleEntitlement = useCallback(async () => {
    const result = await authenticatedAppleRequest(
      "/api/subscriptions/apple/refresh",
      { method: "POST" }
    );
    if (result?.session) {
      applySessionPayload(result.session);
      return result.session;
    }
    return refreshSession();
  }, [applySessionPayload, authenticatedAppleRequest, refreshSession]);

  const reconcileAppleSubscription = useCallback(
    async (sessionPayload = sessionRef.current) => {
      const apple = sessionPayload?.apple;
      if (
        Platform.OS !== "ios" ||
        apple?.enabled !== true ||
        !apple?.appAccountToken
      ) {
        return null;
      }

      await configureProductCatalog(apple.products || []);
      const unfinishedEnvelope = await getUnfinishedTransactions();
      const accountEnvelope = evidenceForAppAccount(
        unfinishedEnvelope,
        apple.appAccountToken
      );
      let refreshedSession;
      if (accountEnvelope.evidence.length) {
        const verification = await verifyAppleEvidence(
          accountEnvelope,
          "refresh",
          sessionPayload
        );
        refreshedSession = verification?.session || sessionRef.current;
      } else {
        refreshedSession = await refreshServerAppleEntitlement();
        await refreshLocalAppleSubscription().catch(() => null);
      }
      if (mountedRef.current) setAppleError(null);
      return refreshedSession;
    },
    [
      configureProductCatalog,
      getUnfinishedTransactions,
      refreshLocalAppleSubscription,
      refreshServerAppleEntitlement,
      verifyAppleEvidence,
    ]
  );

  const purchaseApplePlan = useCallback(
    async (productId) => {
      if (appleUserActionRef.current) {
        const busyError = new Error(
          "Another Apple subscription action is already in progress."
        );
        busyError.code = "APPLE_OPERATION_IN_PROGRESS";
        throw busyError;
      }

      const sessionPayload = sessionRef.current;
      const actionUid = authUserUid;
      const actionGeneration = authGenerationRef.current;
      const apple = sessionPayload?.apple;
      const catalog = Array.isArray(apple?.products) ? apple.products : [];
      if (
        Platform.OS !== "ios" ||
        apple?.enabled !== true ||
        !apple?.appAccountToken
      ) {
        throw new Error("Apple purchases are not available for this account.");
      }
      if (!catalog.some((product) => product?.productId === productId)) {
        const productError = new Error(
          "This subscription plan is not available for this Pantrio account."
        );
        productError.code = "APPLE_PRODUCT_NOT_ALLOWED";
        throw productError;
      }

      appleUserActionRef.current = true;
      setAppleOperation("purchase");
      setAppleError(null);
      try {
        await configureProductCatalog(catalog);
        if (
          !mountedRef.current ||
          authGenerationRef.current !== actionGeneration ||
          authUserUidRef.current !== actionUid
        ) {
          throw supersededAppleRequestError();
        }
        const envelope = await purchaseProduct(
          productId,
          apple.appAccountToken
        );
        if (!mountedRef.current || authUserUidRef.current !== actionUid) {
          return envelope;
        }
        if (envelope?.outcome === "purchased") {
          if (!envelope?.evidence?.length) {
            throw new Error(
              "Apple completed the purchase but did not return verification evidence. Retry account verification."
            );
          }
          const verification = await verifyAppleEvidence(
            envelope,
            "purchase",
            sessionPayload
          );
          return { ...envelope, verification };
        }
        return envelope;
      } catch (nextError) {
        if (mountedRef.current && !isSupersededAppleRequest(nextError)) {
          setAppleError(nextError?.message || "Could not complete the purchase.");
        }
        throw nextError;
      } finally {
        if (authGenerationRef.current === actionGeneration) {
          appleUserActionRef.current = false;
          if (mountedRef.current) setAppleOperation(null);
        }
      }
    },
    [authUserUid, configureProductCatalog, purchaseProduct, verifyAppleEvidence]
  );

  const restoreApplePurchases = useCallback(async () => {
    if (appleUserActionRef.current) {
      const busyError = new Error(
        "Another Apple subscription action is already in progress."
      );
      busyError.code = "APPLE_OPERATION_IN_PROGRESS";
      throw busyError;
    }

    const sessionPayload = sessionRef.current;
    const actionUid = authUserUid;
    const actionGeneration = authGenerationRef.current;
    const apple = sessionPayload?.apple;
    if (
      Platform.OS !== "ios" ||
      apple?.enabled !== true ||
      !apple?.appAccountToken
    ) {
      throw new Error("Apple purchases are not available for this account.");
    }

    appleUserActionRef.current = true;
    setAppleOperation("restore");
    setAppleError(null);
    try {
      await configureProductCatalog(apple.products || []);
      if (
        !mountedRef.current ||
        authGenerationRef.current !== actionGeneration ||
        authUserUidRef.current !== actionUid
      ) {
        throw supersededAppleRequestError();
      }
      const envelope = await restorePurchases();
      if (!mountedRef.current || authUserUidRef.current !== actionUid) {
        return envelope;
      }
      const accountEnvelope = evidenceForAppAccount(
        envelope,
        apple.appAccountToken
      );
      const verification = accountEnvelope.evidence.length
        ? await verifyAppleEvidence(accountEnvelope, "restore", sessionPayload)
        : null;
      if (!verification) await refreshServerAppleEntitlement();
      await refreshLocalAppleSubscription().catch(() => null);
      return {
        ...envelope,
        evidence: accountEnvelope.evidence,
        verification,
      };
    } catch (nextError) {
      if (mountedRef.current && !isSupersededAppleRequest(nextError)) {
        setAppleError(nextError?.message || "Could not restore purchases.");
      }
      throw nextError;
    } finally {
      if (authGenerationRef.current === actionGeneration) {
        appleUserActionRef.current = false;
        if (mountedRef.current) setAppleOperation(null);
      }
    }
  }, [
    authUserUid,
    configureProductCatalog,
    refreshLocalAppleSubscription,
    refreshServerAppleEntitlement,
    restorePurchases,
    verifyAppleEvidence,
  ]);

  const refreshAppleSubscription = useCallback(async () => {
    if (appleUserActionRef.current) return null;
    appleUserActionRef.current = true;
    const actionGeneration = authGenerationRef.current;
    setAppleOperation("refresh");
    setAppleError(null);
    try {
      const refreshedSession = await refreshSession();
      return await reconcileAppleSubscription(
        refreshedSession || sessionRef.current
      );
    } catch (nextError) {
      if (mountedRef.current && !isSupersededAppleRequest(nextError)) {
        setAppleError(
          nextError?.message || "Could not refresh the Apple subscription."
        );
      }
      throw nextError;
    } finally {
      if (authGenerationRef.current === actionGeneration) {
        appleUserActionRef.current = false;
        if (mountedRef.current) setAppleOperation(null);
      }
    }
  }, [reconcileAppleSubscription, refreshSession]);

  useEffect(() => {
    mountedRef.current = true;
    const appleRequestControllers = appleRequestControllersRef.current;
    const appleEvidenceRequests = appleEvidenceRequestsRef.current;
    return () => {
      mountedRef.current = false;
      sessionRequestGenerationRef.current += 1;
      sessionRequestControllerRef.current?.abort();
      sessionRequestControllerRef.current = null;
      for (const controller of appleRequestControllers) {
        controller.abort();
      }
      appleRequestControllers.clear();
      appleEvidenceRequests.clear();
    };
  }, []);

  const updateQuota = useCallback((nextQuota) => {
    setQuota((current) => normalizeQuota(nextQuota, current));
  }, []);

  const applyRealtimeState = useCallback((payload) => {
    if (!payload || typeof payload !== "object") return;

    if (
      payload.quota ||
      payload.dailyLimit !== undefined ||
      payload.limit !== undefined ||
      payload.remainingTokens !== undefined ||
      payload.remaining !== undefined ||
      payload.quotaApplies !== undefined
    ) {
      setQuota((current) => normalizeQuota(payload, current));
    }

    if (
      payload.model ||
      payload.requestedModel ||
      payload.effectiveModel ||
      payload.modelRestricted !== undefined
    ) {
      setModel((current) => ({
        ...(current || {}),
        requested: payload.requestedModel ?? current?.requested ?? null,
        effective:
          payload.effectiveModel ??
          (typeof payload.model === "string"
            ? payload.model
            : payload.model?.effective) ??
          current?.effective ??
          null,
        restricted:
          typeof payload.modelRestricted === "boolean"
            ? payload.modelRestricted
            : payload.model?.restricted ?? current?.restricted ?? false,
      }));
    }

    if (typeof payload.isSubscribed === "boolean") {
      setEntitlement((current) => ({
        ...current,
        active: payload.isSubscribed,
        plan: payload.isSubscribed
          ? current?.plan && current.plan !== "free"
            ? current.plan
            : "subscriber"
          : "free",
      }));
    }
  }, []);

  useLayoutEffect(() => {
    authUserUidRef.current = authUserUid;
    authGenerationRef.current += 1;
    sessionRequestGenerationRef.current += 1;
    sessionRequestControllerRef.current?.abort();
    sessionRequestControllerRef.current = null;
    for (const controller of appleRequestControllersRef.current) {
      controller.abort();
    }
    appleRequestControllersRef.current.clear();
    appleEvidenceRequestsRef.current.clear();
    appleUserActionRef.current = false;
    sessionRef.current = null;
    appleBootstrapKeyRef.current = null;
  }, [authUserUid]);

  useEffect(() => {
    const resetTimer = setTimeout(() => {
      setSession(null);
      setEntitlement(EMPTY_ENTITLEMENT);
      setQuota(null);
      setModel(null);
      setInitialized(!authUserUid);
      setLoading(Boolean(authUserUid));
      setError(null);
      setAppleOperation(null);
      setAppleError(null);
    }, 0);
    return () => clearTimeout(resetTimer);
  }, [authUserUid]);

  useEffect(() => {
    const initialSessionTimer = setTimeout(() => {
      refreshSession().catch(() => {});
    }, 0);

    return () => clearTimeout(initialSessionTimer);
  }, [refreshSession]);

  useEffect(() => {
    const apple = session?.apple;
    if (
      Platform.OS !== "ios" ||
      apple?.enabled !== true ||
      !apple?.appAccountToken
    ) {
      return undefined;
    }

    const bootstrapKey = `${authUserUid || ""}:${apple.appAccountToken}:${catalogFingerprint(
      session
    )}`;
    if (appleBootstrapKeyRef.current === bootstrapKey) return undefined;
    appleBootstrapKeyRef.current = bootstrapKey;

    const bootstrapTimer = setTimeout(() => {
      reconcileAppleSubscription(session).catch((nextError) => {
        if (mountedRef.current && !isSupersededAppleRequest(nextError)) {
          setAppleError(
            nextError?.message || "Could not verify the Apple subscription."
          );
        }
      });
    }, 0);
    return () => clearTimeout(bootstrapTimer);
  }, [authUserUid, reconcileAppleSubscription, session]);

  useEffect(() => {
    if (
      !latestTransactionEvent?.sequence ||
      latestTransactionEvent.accountId !== authUserUid ||
      !session?.apple?.appAccountToken
    ) {
      return undefined;
    }

    let cancelled = false;
    const transactionTimer = setTimeout(() => {
      const accountEnvelope = evidenceForAppAccount(
        latestTransactionEvent.envelope,
        session.apple.appAccountToken
      );
      if (!accountEnvelope.evidence.length) return;
      verifyAppleEvidence(
        accountEnvelope,
        "transaction_update",
        session
      ).catch((nextError) => {
        if (
          !cancelled &&
          mountedRef.current &&
          !isSupersededAppleRequest(nextError)
        ) {
          setAppleError(
            nextError?.message || "Could not verify an Apple transaction update."
          );
        }
      });
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(transactionTimer);
    };
  }, [authUserUid, latestTransactionEvent, session, verifyAppleEvidence]);

  useEffect(() => {
    if (!authUser) return undefined;
    let previousState = AppState.currentState;

    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextState) => {
        const becameActive =
          nextState === "active" && previousState !== "active";
        previousState = nextState;
        if (!becameActive) return;

        refreshSession()
          .then((refreshedSession) =>
            reconcileAppleSubscription(refreshedSession || sessionRef.current)
          )
          .catch(() => {});
      }
    );

    return () => appStateSubscription.remove();
  }, [authUser, reconcileAppleSubscription, refreshSession]);

  const applePlans = useMemo(
    () => mergeApplePlans(session, storeKitProducts),
    [session, storeKitProducts]
  );

  const value = useMemo(
    () => ({
      session,
      entitlement,
      quota,
      model,
      initializing: !initialized,
      loading,
      error,
      apple: session?.apple || null,
      applePlans,
      appleProductsLoading,
      appleProductsError,
      appleOperation,
      appleError,
      // Backward-compatible aliases for existing consumers.
      syncingSubscription: Boolean(appleOperation),
      subscriptionSyncError: appleError,
      refreshSession,
      purchaseApplePlan,
      restoreApplePurchases,
      refreshAppleSubscription,
      updateQuota,
      applyRealtimeState,
    }),
    [
      appleError,
      appleOperation,
      applePlans,
      appleProductsError,
      appleProductsLoading,
      applyRealtimeState,
      entitlement,
      error,
      initialized,
      loading,
      model,
      purchaseApplePlan,
      quota,
      refreshAppleSubscription,
      refreshSession,
      restoreApplePurchases,
      session,
      updateQuota,
    ]
  );

  return (
    <AccountSessionContext.Provider value={value}>
      {children}
    </AccountSessionContext.Provider>
  );
}

export function useAccountSession() {
  return useContext(AccountSessionContext);
}
