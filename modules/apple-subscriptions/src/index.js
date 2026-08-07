import { requireNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

export const APPLE_SUBSCRIPTION_CHANGED_EVENT =
  "onSubscriptionStatusChanged";

export const EMPTY_APPLE_SUBSCRIPTION = Object.freeze({
  status: "not_subscribed",
  isEntitled: false,
  productId: null,
  displayName: null,
  subscriptionGroupId: null,
  expirationDate: null,
  willAutoRenew: false,
  isPartial: false,
  subscriptions: [],
  checkedAt: null,
});

let nativeModule;

function getNativeModule() {
  if (Platform.OS !== "ios") return null;
  nativeModule ??= requireNativeModule("AppleSubscriptions");
  return nativeModule;
}

export function getConfiguredAppleSubscriptionProductIds() {
  return String(
    process.env.EXPO_PUBLIC_APPLE_SUBSCRIPTION_PRODUCT_IDS || ""
  )
    .split(",")
    .map((productId) => productId.trim())
    .filter(Boolean);
}

export function normalizeAppleSubscriptionSnapshot(snapshot) {
  const subscriptions = Array.isArray(snapshot?.subscriptions)
    ? snapshot.subscriptions
    : [];

  return {
    ...EMPTY_APPLE_SUBSCRIPTION,
    ...(snapshot || {}),
    status: snapshot?.status || "unknown",
    isEntitled: snapshot?.isEntitled === true,
    productId: snapshot?.productId || null,
    displayName: snapshot?.displayName || null,
    subscriptionGroupId: snapshot?.subscriptionGroupId || null,
    expirationDate: snapshot?.expirationDate || null,
    willAutoRenew: snapshot?.willAutoRenew === true,
    isPartial: snapshot?.isPartial === true,
    subscriptions,
    checkedAt: snapshot?.checkedAt || new Date().toISOString(),
  };
}

function unsupportedPlatformSnapshot() {
  return normalizeAppleSubscriptionSnapshot({
    status: "unsupported_platform",
    checkedAt: new Date().toISOString(),
  });
}

function missingDevelopmentBuildSnapshot() {
  return normalizeAppleSubscriptionSnapshot({
    status: "development_build_required",
    error:
      "Apple subscription detection requires an iOS development or App Store build.",
    checkedAt: new Date().toISOString(),
  });
}

export async function getAppleSubscriptionStatus() {
  if (Platform.OS !== "ios") {
    return unsupportedPlatformSnapshot();
  }

  try {
    const module = getNativeModule();
    const productIds = getConfiguredAppleSubscriptionProductIds();
    await module.configure(productIds);
    const snapshot = await module.getCurrentStatus(productIds);
    return normalizeAppleSubscriptionSnapshot(snapshot);
  } catch (error) {
    if (/native module|cannot find|not found/i.test(error?.message || "")) {
      return missingDevelopmentBuildSnapshot();
    }
    throw error;
  }
}

export function addAppleSubscriptionStatusListener(listener) {
  if (Platform.OS !== "ios") {
    return { remove() {} };
  }

  try {
    const module = getNativeModule();
    const productIds = getConfiguredAppleSubscriptionProductIds();
    void module.configure(productIds);

    return module.addListener(
      APPLE_SUBSCRIPTION_CHANGED_EVENT,
      (snapshot) => listener(normalizeAppleSubscriptionSnapshot(snapshot))
    );
  } catch {
    listener(missingDevelopmentBuildSnapshot());
    return { remove() {} };
  }
}
