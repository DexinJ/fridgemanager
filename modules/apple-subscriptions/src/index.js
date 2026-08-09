import { requireNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

export const APPLE_SUBSCRIPTION_CHANGED_EVENT =
  "onSubscriptionStatusChanged";
export const APPLE_TRANSACTION_EVENT = "onAppleTransaction";

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
let activeProductIds = null;

function getNativeModule() {
  if (Platform.OS !== "ios") return null;
  nativeModule ??= requireNativeModule("AppleSubscriptions");
  return nativeModule;
}

function normalizeProductIds(productIds) {
  if (!Array.isArray(productIds)) return [];
  return [
    ...new Set(
      productIds
        .map((productId) => String(productId || "").trim())
        .filter(Boolean)
    ),
  ];
}

export function getConfiguredAppleSubscriptionProductIds() {
  return normalizeProductIds(
    String(process.env.EXPO_PUBLIC_APPLE_SUBSCRIPTION_PRODUCT_IDS || "")
      .split(",")
  );
}

function resolveProductIds(productIds) {
  if (Array.isArray(productIds)) {
    activeProductIds = normalizeProductIds(productIds);
  } else if (activeProductIds === null) {
    activeProductIds = getConfiguredAppleSubscriptionProductIds();
  }
  return activeProductIds;
}

function normalizeStringList(values) {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    ),
  ];
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

export function normalizeAppleSubscriptionProduct(product) {
  if (!product?.productId) return null;

  const period = product?.period;
  return {
    productId: String(product.productId),
    displayName: product?.displayName || String(product.productId),
    description: product?.description || "",
    displayPrice: product?.displayPrice || "",
    price: product?.price == null ? null : String(product.price),
    currencyCode: product?.currencyCode || null,
    type: product?.type || "auto_renewable",
    subscriptionGroupId: product?.subscriptionGroupId || null,
    subscriptionGroupDisplayName:
      product?.subscriptionGroupDisplayName || null,
    groupLevel: Number.isFinite(Number(product?.groupLevel))
      ? Number(product.groupLevel)
      : null,
    period:
      period && Number.isFinite(Number(period.value))
        ? {
            value: Number(period.value),
            unit: period.unit || "unknown",
          }
        : null,
    isFamilyShareable: product?.isFamilyShareable === true,
  };
}

export function normalizeAppleTransactionEvidence(evidence) {
  if (!evidence?.signedTransactionInfo || !evidence?.transactionId) {
    return null;
  }

  return {
    signedTransactionInfo: String(evidence.signedTransactionInfo),
    signedRenewalInfo: evidence?.signedRenewalInfo
      ? String(evidence.signedRenewalInfo)
      : null,
    transactionId: String(evidence.transactionId),
    originalTransactionId: evidence?.originalTransactionId
      ? String(evidence.originalTransactionId)
      : null,
    productId: evidence?.productId ? String(evidence.productId) : null,
    subscriptionGroupId: evidence?.subscriptionGroupId || null,
    appAccountToken: evidence?.appAccountToken || null,
    purchaseDate: evidence?.purchaseDate || null,
    expirationDate: evidence?.expirationDate || null,
    revocationDate: evidence?.revocationDate || null,
    localVerification:
      evidence?.localVerification === "verified"
        ? "verified"
        : "unverified",
    localVerificationError: evidence?.localVerificationError || null,
    renewalLocalVerification:
      evidence?.renewalLocalVerification || null,
    source: evidence?.source || null,
  };
}

export function normalizeAppleTransactionOutcome(result, fallbackOutcome) {
  const evidence = Array.isArray(result?.evidence)
    ? result.evidence
        .map(normalizeAppleTransactionEvidence)
        .filter(Boolean)
    : [];

  return {
    ...(result || {}),
    outcome: result?.outcome || fallbackOutcome || "unknown",
    evidence,
    unfinishedTransactionIds: normalizeStringList(
      result?.unfinishedTransactionIds
    ),
    finishedTransactionIds: normalizeStringList(
      result?.finishedTransactionIds
    ),
    notFoundTransactionIds: normalizeStringList(
      result?.notFoundTransactionIds
    ),
    snapshot: result?.snapshot
      ? normalizeAppleSubscriptionSnapshot(result.snapshot)
      : null,
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
      "Apple subscriptions require an iOS development or App Store build.",
    checkedAt: new Date().toISOString(),
  });
}

function unsupportedOperationError() {
  const error = new Error("Apple subscriptions are available only on iOS.");
  error.code = "APPLE_SUBSCRIPTIONS_UNSUPPORTED";
  return error;
}

function configureNativeModule(module, productIds) {
  module.configure(productIds);
  return productIds;
}

export async function getAppleSubscriptionProducts(productIds) {
  if (Platform.OS !== "ios") return [];

  const module = getNativeModule();
  const configuredIds = configureNativeModule(
    module,
    resolveProductIds(productIds)
  );
  const products = await module.getProducts(configuredIds);
  const orderByProductId = new Map(
    configuredIds.map((productId, index) => [productId, index])
  );

  return (Array.isArray(products) ? products : [])
    .map(normalizeAppleSubscriptionProduct)
    .filter(Boolean)
    .sort(
      (left, right) =>
        (orderByProductId.get(left.productId) ?? Number.MAX_SAFE_INTEGER) -
        (orderByProductId.get(right.productId) ?? Number.MAX_SAFE_INTEGER)
    );
}

export async function getAppleSubscriptionStatus(productIds) {
  if (Platform.OS !== "ios") {
    return unsupportedPlatformSnapshot();
  }

  try {
    const module = getNativeModule();
    const configuredIds = configureNativeModule(
      module,
      resolveProductIds(productIds)
    );
    const snapshot = await module.getCurrentStatus(configuredIds);
    return normalizeAppleSubscriptionSnapshot(snapshot);
  } catch (error) {
    if (/native module|cannot find|not found/i.test(error?.message || "")) {
      return missingDevelopmentBuildSnapshot();
    }
    throw error;
  }
}

export async function purchaseAppleSubscription(
  productId,
  appAccountToken
) {
  if (Platform.OS !== "ios") throw unsupportedOperationError();

  const module = getNativeModule();
  configureNativeModule(module, resolveProductIds());
  const result = await module.purchase(productId, appAccountToken);
  return normalizeAppleTransactionOutcome(result, "unknown");
}

export async function restoreAppleSubscriptions(productIds) {
  if (Platform.OS !== "ios") throw unsupportedOperationError();

  const module = getNativeModule();
  const configuredIds = configureNativeModule(
    module,
    resolveProductIds(productIds)
  );
  const result = await module.restorePurchases(configuredIds);
  return normalizeAppleTransactionOutcome(result, "restored");
}

export async function getUnfinishedAppleTransactions() {
  if (Platform.OS !== "ios") throw unsupportedOperationError();

  const module = getNativeModule();
  configureNativeModule(module, resolveProductIds());
  const result = await module.getUnfinishedTransactions();
  return normalizeAppleTransactionOutcome(result, "unfinished");
}

export async function finishAppleTransactions(transactionIds) {
  if (Platform.OS !== "ios") throw unsupportedOperationError();

  const module = getNativeModule();
  configureNativeModule(module, resolveProductIds());
  const result = await module.finishTransactions(
    normalizeStringList(transactionIds)
  );
  return normalizeAppleTransactionOutcome(result, "finished");
}

export function addAppleSubscriptionStatusListener(listener, productIds) {
  if (Platform.OS !== "ios") {
    return { remove() {} };
  }

  try {
    const module = getNativeModule();
    configureNativeModule(module, resolveProductIds(productIds));

    return module.addListener(
      APPLE_SUBSCRIPTION_CHANGED_EVENT,
      (snapshot) => listener(normalizeAppleSubscriptionSnapshot(snapshot))
    );
  } catch {
    listener(missingDevelopmentBuildSnapshot());
    return { remove() {} };
  }
}

export function addAppleTransactionListener(listener) {
  if (Platform.OS !== "ios") {
    return { remove() {} };
  }

  try {
    const module = getNativeModule();
    configureNativeModule(module, resolveProductIds());
    return module.addListener(APPLE_TRANSACTION_EVENT, (result) => {
      listener(normalizeAppleTransactionOutcome(result, "transaction_updated"));
    });
  } catch {
    return { remove() {} };
  }
}

export const addAppleTransactionEvidenceListener =
  addAppleTransactionListener;
