import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import {
  addAppleSubscriptionStatusListener,
  addAppleTransactionListener,
  EMPTY_APPLE_SUBSCRIPTION,
  finishAppleTransactions,
  getAppleSubscriptionProducts,
  getAppleSubscriptionStatus,
  getUnfinishedAppleTransactions,
  purchaseAppleSubscription,
  restoreAppleSubscriptions,
} from "../modules/apple-subscriptions/src";
import {
  orderedStringListKey,
  productCatalogCoversIds,
} from "./refreshPolicy";

const LOADING_SUBSCRIPTION = Object.freeze({
  ...EMPTY_APPLE_SUBSCRIPTION,
  status: "loading",
});

function productIdsFromCatalog(catalog) {
  if (!Array.isArray(catalog)) return [];

  return [
    ...new Set(
      catalog
        .map((entry) =>
          typeof entry === "string" ? entry : entry?.productId
        )
        .map((productId) => String(productId || "").trim())
        .filter(Boolean)
    ),
  ];
}

export const SubscriptionContext = createContext({
  subscription: LOADING_SUBSCRIPTION,
  loading: true,
  error: null,
  products: [],
  productsLoading: false,
  productsError: null,
  latestTransactionEvent: null,
  configureProductCatalog: async () => [],
  refreshSubscription: async () => LOADING_SUBSCRIPTION,
  purchaseProduct: async () => null,
  restorePurchases: async () => null,
  getUnfinishedTransactions: async () => null,
  finishTransactions: async () => null,
});

export function AppleSubscriptionProvider({
  accountId = null,
  children,
  enabled = true,
}) {
  const [subscription, setSubscription] = useState(() =>
    enabled ? LOADING_SUBSCRIPTION : EMPTY_APPLE_SUBSCRIPTION
  );
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(null);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productsError, setProductsError] = useState(null);
  const [latestTransactionEvent, setLatestTransactionEvent] = useState(null);
  const mountedRef = useRef(false);
  const configuredProductIdsRef = useRef([]);
  const productsRef = useRef([]);
  const successfulProductCatalogKeyRef = useRef(null);
  const productCatalogRequestRef = useRef(null);
  const productRequestGenerationRef = useRef(0);
  const subscriptionRefreshPromiseRef = useRef(null);
  const subscriptionRequestGenerationRef = useRef(0);
  const transactionSequenceRef = useRef(0);

  const applySubscriptionSnapshot = useCallback((nextSubscription) => {
    if (!mountedRef.current || !nextSubscription) return;
    setSubscription(nextSubscription);
    setError(nextSubscription.error || null);
    setLoading(false);
  }, []);

  const refreshSubscription = useCallback(() => {
    if (!enabled) {
      setSubscription(EMPTY_APPLE_SUBSCRIPTION);
      setLoading(false);
      setError(null);
      return Promise.resolve(EMPTY_APPLE_SUBSCRIPTION);
    }

    const inFlight = subscriptionRefreshPromiseRef.current;
    if (inFlight) return inFlight;

    const requestGeneration = subscriptionRequestGenerationRef.current + 1;
    subscriptionRequestGenerationRef.current = requestGeneration;
    setLoading(true);
    const request = (async () => {
      try {
        const nextSubscription = await getAppleSubscriptionStatus(
          configuredProductIdsRef.current
        );
        if (subscriptionRequestGenerationRef.current === requestGeneration) {
          applySubscriptionSnapshot(nextSubscription);
        }
        return nextSubscription;
      } catch (nextError) {
        if (
          mountedRef.current &&
          subscriptionRequestGenerationRef.current === requestGeneration
        ) {
          setError(
            nextError?.message || "Could not check the Apple subscription."
          );
          setSubscription((current) => ({
            ...current,
            status: "unknown",
            checkedAt: new Date().toISOString(),
          }));
        }
        throw nextError;
      } finally {
        if (subscriptionRefreshPromiseRef.current === request) {
          subscriptionRefreshPromiseRef.current = null;
        }
        if (
          mountedRef.current &&
          subscriptionRequestGenerationRef.current === requestGeneration
        ) {
          setLoading(false);
        }
      }
    })();

    subscriptionRefreshPromiseRef.current = request;
    return request;
  }, [applySubscriptionSnapshot, enabled]);

  const configureProductCatalog = useCallback(
    (catalog) => {
      const productIds = productIdsFromCatalog(catalog);
      const catalogKey = orderedStringListKey([
        String(accountId || ""),
        ...productIds,
      ]);

      configuredProductIdsRef.current = productIds;
      if (!enabled || productIds.length === 0) {
        productRequestGenerationRef.current += 1;
        productCatalogRequestRef.current = null;
        successfulProductCatalogKeyRef.current = null;
        productsRef.current = [];
        if (mountedRef.current) {
          setProducts([]);
          setProductsLoading(false);
          setProductsError(null);
        }
        return Promise.resolve([]);
      }

      const inFlight = productCatalogRequestRef.current;
      if (inFlight?.catalogKey === catalogKey) return inFlight.request;
      if (!inFlight && successfulProductCatalogKeyRef.current === catalogKey) {
        return Promise.resolve(productsRef.current);
      }

      const requestGeneration = productRequestGenerationRef.current + 1;
      productRequestGenerationRef.current = requestGeneration;
      if (mountedRef.current) {
        setProductsLoading(true);
        setProductsError(null);
      }

      const request = (async () => {
        try {
          const nextProducts = await getAppleSubscriptionProducts(productIds);
          const normalizedProducts = Array.isArray(nextProducts)
            ? nextProducts
            : [];
          if (productRequestGenerationRef.current === requestGeneration) {
            productsRef.current = normalizedProducts;
            successfulProductCatalogKeyRef.current = productCatalogCoversIds(
              normalizedProducts,
              productIds
            )
              ? catalogKey
              : null;
            if (mountedRef.current) setProducts(normalizedProducts);
          }
          return normalizedProducts;
        } catch (nextError) {
          if (productRequestGenerationRef.current === requestGeneration) {
            productsRef.current = [];
            successfulProductCatalogKeyRef.current = null;
            if (mountedRef.current) {
              setProducts([]);
              setProductsError(
                nextError?.message || "Could not load Apple subscription plans."
              );
            }
          }
          throw nextError;
        } finally {
          if (productCatalogRequestRef.current?.request === request) {
            productCatalogRequestRef.current = null;
          }
          if (
            mountedRef.current &&
            productRequestGenerationRef.current === requestGeneration
          ) {
            setProductsLoading(false);
          }
        }
      })();

      productCatalogRequestRef.current = { catalogKey, request };
      return request;
    },
    [accountId, enabled]
  );

  const purchaseProduct = useCallback(
    async (productId, appAccountToken) => {
      if (!enabled) {
        throw new Error("Apple subscriptions are available only on iOS.");
      }
      const result = await purchaseAppleSubscription(productId, appAccountToken);
      applySubscriptionSnapshot(result?.snapshot);
      return result;
    },
    [applySubscriptionSnapshot, enabled]
  );

  const restorePurchases = useCallback(async () => {
    if (!enabled) {
      throw new Error("Apple subscriptions are available only on iOS.");
    }
    const result = await restoreAppleSubscriptions(
      configuredProductIdsRef.current
    );
    applySubscriptionSnapshot(result?.snapshot);
    return result;
  }, [applySubscriptionSnapshot, enabled]);

  const getUnfinishedTransactions = useCallback(async () => {
    if (!enabled) return null;
    return getUnfinishedAppleTransactions();
  }, [enabled]);

  const finishTransactions = useCallback(
    async (transactionIds) => {
      if (!enabled || !Array.isArray(transactionIds) || !transactionIds.length) {
        return null;
      }
      const result = await finishAppleTransactions(transactionIds);
      applySubscriptionSnapshot(result?.snapshot);
      return result;
    },
    [applySubscriptionSnapshot, enabled]
  );

  useEffect(() => {
    mountedRef.current = true;

    if (!enabled) {
      return () => {
        mountedRef.current = false;
      };
    }

    // Subscribe before the initial read so an update cannot slip between them.
    const statusListener = addAppleSubscriptionStatusListener((next) => {
      applySubscriptionSnapshot(next);
    });
    const transactionListener = addAppleTransactionListener((envelope) => {
      if (!mountedRef.current) return;
      transactionSequenceRef.current += 1;
      setLatestTransactionEvent({
        accountId,
        sequence: transactionSequenceRef.current,
        envelope,
      });
      if (envelope?.snapshot) {
        applySubscriptionSnapshot(envelope.snapshot);
      }
    });

    // The iOS module publishes a listener_started snapshot. Other platforms do
    // not have a native listener, so they still need one unsupported-state read.
    const initialRefreshTimer =
      Platform.OS === "ios"
        ? null
        : setTimeout(() => {
            refreshSubscription().catch(() => {});
          }, 0);

    return () => {
      mountedRef.current = false;
      if (initialRefreshTimer !== null) clearTimeout(initialRefreshTimer);
      statusListener.remove();
      transactionListener.remove();
    };
  }, [accountId, applySubscriptionSnapshot, enabled, refreshSubscription]);

  useEffect(() => {
    transactionSequenceRef.current = 0;
    configuredProductIdsRef.current = [];
    productsRef.current = [];
    successfulProductCatalogKeyRef.current = null;
    productCatalogRequestRef.current = null;
    productRequestGenerationRef.current += 1;
    subscriptionRefreshPromiseRef.current = null;
    subscriptionRequestGenerationRef.current += 1;
    const resetTimer = setTimeout(() => {
      setLatestTransactionEvent(null);
      setProducts([]);
      setProductsLoading(false);
      setProductsError(null);
      setError(null);
      setSubscription(
        enabled ? LOADING_SUBSCRIPTION : EMPTY_APPLE_SUBSCRIPTION
      );
      setLoading(enabled);
    }, 0);
    return () => clearTimeout(resetTimer);
  }, [accountId, enabled]);

  const value = useMemo(
    () => ({
      subscription,
      loading,
      error,
      products,
      productsLoading,
      productsError,
      latestTransactionEvent,
      configureProductCatalog,
      refreshSubscription,
      purchaseProduct,
      restorePurchases,
      getUnfinishedTransactions,
      finishTransactions,
    }),
    [
      configureProductCatalog,
      error,
      finishTransactions,
      getUnfinishedTransactions,
      latestTransactionEvent,
      loading,
      products,
      productsError,
      productsLoading,
      purchaseProduct,
      refreshSubscription,
      restorePurchases,
      subscription,
    ]
  );

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useAppleSubscription() {
  return useContext(SubscriptionContext);
}
