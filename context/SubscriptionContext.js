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
  EMPTY_APPLE_SUBSCRIPTION,
  getAppleSubscriptionStatus,
} from "../modules/apple-subscriptions/src";

const LOADING_SUBSCRIPTION = Object.freeze({
  ...EMPTY_APPLE_SUBSCRIPTION,
  status: "loading",
});

export const SubscriptionContext = createContext({
  subscription: LOADING_SUBSCRIPTION,
  loading: true,
  error: null,
  refreshSubscription: async () => LOADING_SUBSCRIPTION,
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
  const mountedRef = useRef(false);

  const refreshSubscription = useCallback(async () => {
    if (!enabled) {
      setSubscription(EMPTY_APPLE_SUBSCRIPTION);
      setLoading(false);
      setError(null);
      return EMPTY_APPLE_SUBSCRIPTION;
    }

    setLoading(true);
    try {
      const nextSubscription = await getAppleSubscriptionStatus();
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

    const initialRefreshTimer = setTimeout(() => {
      refreshSubscription().catch(() => {});
    }, 0);

    return () => {
      mountedRef.current = false;
      clearTimeout(initialRefreshTimer);
      statusListener.remove();
    };
  }, [accountId, enabled, refreshSubscription]);

  const value = useMemo(
    () => ({
      subscription,
      loading,
      error,
      refreshSubscription,
    }),
    [error, loading, refreshSubscription, subscription]
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
