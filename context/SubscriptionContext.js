import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  const productRequestGenerationRef = useRef(0);
  const transactionSequenceRef = useRef(0);

  const refreshSubscription = useCallback(async () => {
    if (!enabled) {
      setSubscription(EMPTY_APPLE_SUBSCRIPTION);
      setLoading(false);
      setError(null);
      return EMPTY_APPLE_SUBSCRIPTION;
    }

    setLoading(true);
    try {
      const nextSubscription = await getAppleSubscriptionStatus(
        configuredProductIdsRef.current
      );
      if (mountedRef.current) {
        setSubscription(nextSubscription);
        setError(nextSubscription.error || null);
      }
      return nextSubscription;
    } catch (nextError) {
      if (mountedRef.current) {
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
      if (mountedRef.current) setLoading(false);
    }
  }, [enabled]);

  const configureProductCatalog = useCallback(
    async (catalog) => {
      const productIds = productIdsFromCatalog(catalog);

      configuredProductIdsRef.current = productIds;
      if (!enabled || productIds.length === 0) {
        productRequestGenerationRef.current += 1;
        if (mountedRef.current) {
          setProducts([]);
          setProductsLoading(false);
          setProductsError(null);
        }
        return [];
      }

      const requestGeneration = productRequestGenerationRef.current + 1;
      productRequestGenerationRef.current = requestGeneration;
      if (mountedRef.current) {
        setProductsLoading(true);
        setProductsError(null);
      }

      try {
        const nextProducts = await getAppleSubscriptionProducts(productIds);
        if (
          mountedRef.current &&
          productRequestGenerationRef.current === requestGeneration
        ) {
          const normalizedProducts = Array.isArray(nextProducts)
            ? nextProducts
            : [];
          setProducts(normalizedProducts);
        }
        await refreshSubscription();
        return Array.isArray(nextProducts) ? nextProducts : [];
      } catch (nextError) {
        if (
          mountedRef.current &&
          productRequestGenerationRef.current === requestGeneration
        ) {
          setProducts([]);
          setProductsError(
            nextError?.message || "Could not load Apple subscription plans."
          );
        }
        throw nextError;
      } finally {
        if (
          mountedRef.current &&
          productRequestGenerationRef.current === requestGeneration
        ) {
          setProductsLoading(false);
        }
      }
    },
    [enabled, refreshSubscription]
  );

  const purchaseProduct = useCallback(
    async (productId, appAccountToken) => {
      if (!enabled) {
        throw new Error("Apple subscriptions are available only on iOS.");
      }
      return purchaseAppleSubscription(productId, appAccountToken);
    },
    [enabled]
  );

  const restorePurchases = useCallback(async () => {
    if (!enabled) {
      throw new Error("Apple subscriptions are available only on iOS.");
    }
    return restoreAppleSubscriptions(configuredProductIdsRef.current);
  }, [enabled]);

  const getUnfinishedTransactions = useCallback(async () => {
    if (!enabled) return null;
    return getUnfinishedAppleTransactions();
  }, [enabled]);

  const finishTransactions = useCallback(
    async (transactionIds) => {
      if (!enabled || !Array.isArray(transactionIds) || !transactionIds.length) {
        return null;
      }
      return finishAppleTransactions(transactionIds);
    },
    [enabled]
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
      if (!mountedRef.current) return;
      setSubscription(next);
      setError(next.error || null);
      setLoading(false);
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
        setSubscription(envelope.snapshot);
        setError(envelope.snapshot.error || null);
        setLoading(false);
      }
    });

    const initialRefreshTimer = setTimeout(() => {
      refreshSubscription().catch(() => {});
    }, 0);

    return () => {
      mountedRef.current = false;
      clearTimeout(initialRefreshTimer);
      statusListener.remove();
      transactionListener.remove();
    };
  }, [accountId, enabled, refreshSubscription]);

  useEffect(() => {
    transactionSequenceRef.current = 0;
    configuredProductIdsRef.current = [];
    productRequestGenerationRef.current += 1;
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
