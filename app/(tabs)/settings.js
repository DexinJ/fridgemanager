// SettingsScreen.js (FULL paste-in replacement)
// - Adds urgencyDays controls (from GlobalContext) under Expiration Reminder
// - Urgency sliders update LIVE while sliding
// - Updates username locally (settings.user.name) AND on backend
// - Adds Logout and permanent Delete Account buttons
// Assumes:
//   1) you have useAuth() that exposes { user, signOut } + user.getIdToken()
//   2) your backend has PATCH /api/users/me { name }
//   3) your backend has DELETE /api/users/:uid
//   4) you have API_BASE_URL set (env or constants)

import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { useNavigation, useRouter } from "expo-router";
import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  InteractionManager,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import DropDownPicker from "react-native-dropdown-picker";
import {
  getCustomAiProviderSettings,
  normalizeAiBaseUrl,
  setCustomAiProviderSettings,
} from "../../api/aiProviderSettings";
import { API_BASE_URL } from "../../api/backendConfig";
import { fetchWithTimeout } from "../../api/fetchWithTimeout";
import { clearChatData } from "../../api/memoryManager";
import { requestReminderPermissions } from "../../api/reminderScheduler";
import {
  getAccountDeletionReauthenticationMethod,
  reauthenticateForAccountDeletion,
} from "../../auth/accountReauthentication";
import { useAuth } from "../../auth/useAuth";
import { HeaderWithHiddenButton } from "../../components/Header";
import { useAccountSession } from "../../context/AccountSessionContext";
import { ChatActionsContext, GlobalContext } from "../../context/GlobalContext";
import { useAppleSubscription } from "../../context/SubscriptionContext";
import {
  getAppleIntelligenceAvailability,
  openAppleIntelligenceSettings,
} from "../../modules/apple-intelligence/src";

const { width } = Dimensions.get("window");

const APPLE_SUBSCRIPTIONS_URL =
  "https://apps.apple.com/account/subscriptions";
const TERMS_OF_USE_URL =
  String(process.env.EXPO_PUBLIC_TERMS_OF_USE_URL || "").trim() ||
  "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";
const PRIVACY_POLICY_URL = String(
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL || ""
).trim();
const LOCAL_AI_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

const AI_PROVIDER_URLS = [
  { label: "OpenAI", value: "https://api.openai.com/v1" },
  { label: "OpenRouter", value: "https://openrouter.ai/api/v1" },
  { label: "Groq", value: "https://api.groq.com/openai/v1" },
  { label: "Together AI", value: "https://api.together.xyz/v1" },
];

const APPLE_AI_UNSUPPORTED_STATUSES = new Set([
  "device_not_eligible",
  "unsupported_os",
  "unsupported_platform",
  "development_build_required",
]);

const APPLE_SUBSCRIPTION_STATUS_LABELS = {
  subscribed: "Active",
  active: "Active",
  in_grace_period: "Active — billing grace period",
  grace_period: "Active — billing grace period",
  in_billing_retry_period: "Billing issue",
  billing_retry: "Billing issue",
  expired: "Expired",
  revoked: "Revoked",
  not_subscribed: "No active subscription",
  loading: "Checking subscription...",
  unknown: "Status unavailable",
  development_build_required: "Requires an iOS app build",
  unsupported_platform: "Available on iOS",
};

const APPLE_SUBSCRIPTION_ATTENTION_STATUSES = new Set([
  "in_billing_retry_period",
  "billing_retry",
  "expired",
  "revoked",
]);

function getSubscriptionStatusLabel(status) {
  return APPLE_SUBSCRIPTION_STATUS_LABELS[status] || "Status unavailable";
}

function getSubscriptionName(subscription) {
  if (subscription?.displayName) return subscription.displayName;
  if (!subscription?.productId) return null;

  const productName = subscription.productId.split(".").pop() || "";
  return productName
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatSubscriptionDate(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
}

function formatQuotaCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return Math.max(0, Math.trunc(number)).toLocaleString();
}

function formatQuotaReset(value, timezone) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const options = {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    ...(timezone ? { timeZone: timezone } : {}),
  };

  try {
    return date.toLocaleString(undefined, options);
  } catch {
    return date.toLocaleString();
  }
}

function planName(value) {
  const normalized = String(value || "free").trim();
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatSubscriptionPeriod(period) {
  const value = Number(period?.value);
  const unit = String(period?.unit || "").toLowerCase();
  if (!Number.isFinite(value) || value <= 0 || !unit) return null;
  const normalizedUnit = value === 1 ? unit.replace(/s$/, "") : unit;
  return `${Math.trunc(value)} ${normalizedUnit}${value === 1 ? "" : "s"}`;
}

function validateCustomAiBaseUrl(value) {
  const normalized = normalizeAiBaseUrl(value);
  let parsed;

  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("Enter a valid absolute API base URL.");
  }

  if (parsed.username || parsed.password) {
    throw new Error("The API base URL must not contain credentials.");
  }

  const localDevelopmentUrl =
    typeof __DEV__ !== "undefined" &&
    __DEV__ &&
    parsed.protocol === "http:" &&
    LOCAL_AI_HOSTS.has(parsed.hostname.toLowerCase());

  if (parsed.protocol !== "https:" && !localDevelopmentUrl) {
    throw new Error(
      "Custom AI providers must use HTTPS. Plain HTTP is allowed only for localhost during development."
    );
  }

  return normalized;
}

export default function SettingsScreen() {
  const {
    settings,
    storageHydrated,
    storageOwnerUid,
    updateSetting,
    theme,
    clearAllData,

    // Urgency thresholds from GlobalContext
    urgencyDays,
    setUrgencyDays,
  } = useContext(GlobalContext);
  const { setMessages, setSummary } = useContext(ChatActionsContext);

  const { user, signOut, loggedIn, deleteAccount } = useAuth();
  const {
    subscription,
    loading: subscriptionLoading,
    error: subscriptionError,
  } = useAppleSubscription();
  const {
    session: accountSession,
    entitlement,
    quota,
    model: accountModel,
    loading: accountSessionLoading,
    error: accountSessionError,
    apple,
    applePlans,
    appleProductsLoading,
    appleProductsError,
    accountOperation,
    appleOperation,
    appleError,
    refreshSession,
    purchaseApplePlan,
    restoreApplePurchases,
    refreshAppleSubscription,
    beginAccountTeardown,
  } = useAccountSession();

  const [currentSubMenu, setCurrentSubMenu] = useState(null);
  const [anim] = useState(() => new Animated.Value(0));
  const mountedRef = useRef(false);
  const navigation = useNavigation();
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const [remindDays, setRemindDays] = useState(
    settings?.expiration?.remindDays ?? 5
  );
  const [fontSizeDraft, setFontSizeDraft] = useState(null);
  const displayedFontSize = fontSizeDraft ?? settings?.ux?.fontSize ?? 16;

  const [modalVisible, setModalVisible] = useState(false);
  const [tempName, setTempName] = useState(
    settings?.user?.name ?? "freeUser"
  );
  const [savingName, setSavingName] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deletePasswordModalVisible, setDeletePasswordModalVisible] =
    useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiProviderSettingsBaseUrl, setAiProviderSettingsBaseUrl] = useState(null);
  const configuredAiBaseUrl =
    settings?.advanced?.aiBaseUrl || "https://api.openai.com/v1";
  const configuredAiModel = settings?.advanced?.aiModel || "gpt-4o-mini";
  const [aiBaseUrlDraft, setAiBaseUrlDraft] = useState(null);
  const [aiModelDraft, setAiModelDraft] = useState(null);
  const [aiProviderSettingsRevision, setAiProviderSettingsRevision] = useState(0);
  const aiBaseUrl = aiBaseUrlDraft ?? configuredAiBaseUrl;
  const aiModel = aiModelDraft ?? configuredAiModel;
  const [aiProviderOpen, setAiProviderOpen] = useState(false);
  const aiProvider = settings?.advanced?.aiProvider ||
    (settings?.advanced?.useCustomAi ? "custom" : "pantrio");
  const [appleAvailability, setAppleAvailability] = useState(null);
  const [checkingAppleAi, setCheckingAppleAi] = useState(false);
  const [savingAi, setSavingAi] = useState(false);

  const router = useRouter();
  const fontSize = settings?.ux?.fontSize ?? 16;
  const username = settings?.user?.name ?? "freeUser";
  const subscriptionStatus = subscriptionLoading && !subscription?.checkedAt
    ? "loading"
    : subscription?.status;
  const subscriptionStatusLabel = getSubscriptionStatusLabel(
    subscriptionStatus
  );
  const subscriptionStatusColor = subscriptionStatus === "loading"
    ? theme.textSecondary
    : subscription?.isEntitled
      ? theme.accent
      : APPLE_SUBSCRIPTION_ATTENTION_STATUSES.has(subscriptionStatus)
        ? theme.danger
        : theme.textSecondary;
  const subscriptionName = getSubscriptionName(subscription);
  const subscriptionDate = formatSubscriptionDate(
    subscription?.expirationDate
  );
  const subscriptionPlanLabel = subscriptionName ||
    (subscriptionStatus === "loading"
      ? "Looking up your plan..."
      : "No plan selected");
  const accountAccessStatusLabel = accountSessionLoading
    ? "Checking account..."
    : accountSessionError && !accountSession
      ? "Access unavailable"
    : entitlement?.active
      ? entitlement?.verified
        ? "Verified subscription access"
        : "Reported subscription access"
      : "Free access";
  const accountAccessStatusColor = accountSessionLoading
    ? theme.textSecondary
    : accountSessionError && !accountSession
      ? theme.danger
    : entitlement?.active
      ? theme.accent
      : theme.textSecondary;
  const accountPlanLabel = accountSessionLoading
    ? "Loading Pantrio access..."
    : accountSessionError && !accountSession
      ? "Could not load Pantrio access"
      : `${planName(entitlement?.plan)} plan`;
  const quotaReset = formatQuotaReset(quota?.resetsAt, quota?.timezone);
  const effectiveModel = accountModel?.effective || null;
  const applePurchasesAvailable =
    Platform.OS === "ios" &&
    apple?.enabled === true &&
    Boolean(apple?.appAccountToken);
  const appleBusy = Boolean(appleOperation);
  const accountBusy = Boolean(accountOperation);

  const stylesWithFont = useMemo(
    () => dynamicStyles(theme, fontSize),
    [theme, fontSize]
  );

  const setAiBaseUrl = useCallback((nextValue) => {
    setAiBaseUrlDraft((currentDraft) => {
      const currentValue = currentDraft ?? configuredAiBaseUrl;
      return typeof nextValue === "function"
        ? nextValue(currentValue)
        : nextValue;
    });
  }, [configuredAiBaseUrl]);

  const normalizedAiBaseUrl = normalizeAiBaseUrl(aiBaseUrl);
  const normalizedConfiguredAiBaseUrl = normalizeAiBaseUrl(configuredAiBaseUrl);
  const loadingAiProviderSettings =
    !storageHydrated || aiProviderSettingsBaseUrl !== normalizedAiBaseUrl;

  const aiProviderItems = useMemo(() => {
    const normalizedUrl = normalizeAiBaseUrl(aiBaseUrl);
    if (!normalizedUrl || AI_PROVIDER_URLS.some((item) => item.value === normalizedUrl)) {
      return AI_PROVIDER_URLS;
    }
    return [
      { label: `Custom (${normalizedUrl})`, value: normalizedUrl },
      ...AI_PROVIDER_URLS,
    ];
  }, [aiBaseUrl]);

  useEffect(() => {
    if (!storageHydrated) return undefined;

    let active = true;

    getCustomAiProviderSettings(storageOwnerUid, normalizedAiBaseUrl, {
      migrateLegacy: normalizedAiBaseUrl === normalizedConfiguredAiBaseUrl,
      fallbackModel:
        normalizedAiBaseUrl === normalizedConfiguredAiBaseUrl
          ? configuredAiModel
          : "",
    })
      .then((savedSettings) => {
        if (!active) return;
        setAiApiKey(savedSettings.apiKey);
        setAiModelDraft(savedSettings.model);
        setAiProviderSettingsBaseUrl(normalizedAiBaseUrl);
      })
      .catch(() => {
        if (!active) return;
        setAiApiKey("");
        setAiModelDraft("");
        setAiProviderSettingsBaseUrl(normalizedAiBaseUrl);
      });

    return () => {
      active = false;
    };
  }, [
    normalizedAiBaseUrl,
    normalizedConfiguredAiBaseUrl,
    configuredAiModel,
    aiProviderSettingsRevision,
    storageHydrated,
    storageOwnerUid,
  ]);

  const checkAppleAi = useCallback(async () => {
    if (mountedRef.current) setCheckingAppleAi(true);
    try {
      const availability = await getAppleIntelligenceAvailability();
      if (mountedRef.current) setAppleAvailability(availability);
      return availability;
    } finally {
      if (mountedRef.current) setCheckingAppleAi(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    getAppleIntelligenceAvailability().then((availability) => {
      if (!active) return;
      setAppleAvailability(availability);
      if (
        aiProvider === "apple" &&
        APPLE_AI_UNSUPPORTED_STATUSES.has(availability.status)
      ) {
        updateSetting("advanced", "aiProvider", "pantrio");
        updateSetting("advanced", "useCustomAi", false);
      }
    });
    return () => {
      active = false;
    };
  }, [aiProvider, updateSetting]);

  const selectAiProvider = async (nextProvider) => {
    if (nextProvider === "apple") {
      const availability = await checkAppleAi();
      if (!mountedRef.current) return;
      if (!availability.available) {
        if (availability.status === "not_enabled") {
          Alert.alert(
            "Turn on Apple Intelligence?",
            `${availability.reason}\n\nOpen Settings, then go to Apple Intelligence & Siri to turn it on.`,
            [
              { text: "Not now", style: "cancel" },
              { text: "Open Settings", onPress: openAppleIntelligenceSettings },
            ]
          );
        } else {
          Alert.alert("Apple Intelligence unavailable", availability.reason);
        }
        return;
      }
    }

    updateSetting("advanced", "aiProvider", nextProvider);
    updateSetting("advanced", "useCustomAi", nextProvider === "custom");
  };

  const saveAiProvider = async () => {
    let baseUrl;
    try {
      baseUrl = validateCustomAiBaseUrl(aiBaseUrl);
    } catch (error) {
      Alert.alert("Invalid URL", error?.message || "Enter a valid HTTPS URL.");
      return;
    }
    const model = aiModel.trim();
    if (!model || !aiApiKey.trim()) {
      Alert.alert("Missing details", "Enter both a model name and API key.");
      return;
    }

    setSavingAi(true);
    try {
      await setCustomAiProviderSettings(storageOwnerUid, baseUrl, {
        apiKey: aiApiKey,
        model,
      });
      if (!mountedRef.current) return;
      updateSetting("advanced", "aiBaseUrl", baseUrl);
      updateSetting("advanced", "aiModel", model);
      Alert.alert(
        "Saved",
        "This provider's API key and model name were saved securely."
      );
    } catch (error) {
      if (mountedRef.current) {
        Alert.alert(
          "Save failed",
          error?.message || "Could not save AI settings."
        );
      }
    } finally {
      if (mountedRef.current) setSavingAi(false);
    }
  };

  const handleClearAllData = async () => {
    try {
      const result = await Promise.resolve(clearAllData?.());
      if (!mountedRef.current) return;
      setAiApiKey("");
      setAiBaseUrlDraft(null);
      setAiModelDraft(null);
      setAiProviderSettingsBaseUrl(null);
      setAiProviderSettingsRevision((revision) => revision + 1);
      if (!result || result.ok !== true) {
        Alert.alert(
          "Cleanup incomplete",
          "Some local data could not be cleared. Pantrio will retry automatically."
        );
      }
    } catch (error) {
      if (mountedRef.current) {
        Alert.alert(
          "Cleanup incomplete",
          error?.message ||
            "Some local data could not be cleared. Pantrio will retry automatically."
        );
      }
    }
  };

  const updateReminderToggle = async (section, key, enabled) => {
    if (!enabled) {
      updateSetting(section, key, false);
      return;
    }

    try {
      const granted = await requestReminderPermissions();
      if (!mountedRef.current) return;
      if (!granted) {
        updateSetting(section, key, false);
        Alert.alert(
          "Notifications are off",
          "Allow notifications in your device settings before enabling Pantrio reminders.",
          [
            { text: "Not now", style: "cancel" },
            {
              text: "Open Settings",
              onPress: () => Linking.openSettings().catch(() => {}),
            },
          ]
        );
        return;
      }

      updateSetting("notifications", "reminderPermissionRequested", true);
      updateSetting(section, key, true);
    } catch (error) {
      if (!mountedRef.current) return;
      updateSetting(section, key, false);
      Alert.alert(
        "Could not enable reminders",
        error?.message || "Notification permission could not be requested."
      );
    }
  };

  const categories = [
    { key: "user", title: "Account", icon: "person-outline" },
    { key: "ux", title: "Appearance", icon: "color-palette-outline" },
    {
      key: "notifications",
      title: "Notifications",
      icon: "notifications-outline",
    },
    {
      key: "fridge",
      title: "Expiration Reminder",
      icon: "time-outline",
    },
    {
      key: "privacy",
      title: "Privacy",
      icon: "shield-checkmark-outline",
    },
    {
      key: "advanced",
      title: "Advanced",
      icon: "construct-outline",
    },
  ];

  async function updateUsernameOnBackend(name) {
    if (!user) {
      throw new Error("Not logged in");
    }

    const token = await user.getIdToken();

    const resp = await fetchWithTimeout(
      `${API_BASE_URL}/api/users/me`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name }),
      },
      { timeoutMessage: "Updating the username timed out. Please try again." }
    );

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(text || `Failed to update name (${resp.status})`);
    }

    return resp.json().catch(() => ({}));
  }

  const openUsernameEditor = () => {
    setTempName(username);
    setModalVisible(true);
  };

  const saveName = async () => {
    const next = String(tempName || "").trim();

    if (!next) {
      Alert.alert("Name required", "Please enter a username.");
      return;
    }

    setSavingName(true);

    // Update locally immediately.
    const prev = settings?.user?.name ?? "freeUser";
    updateSetting("user", "name", next);

    try {
      // Update backend.
      const updatedProfile = await updateUsernameOnBackend(next);
      const confirmedName = updatedProfile?.username || next;
      const firstRefresh = await refreshSession({ maxAgeMs: 0 }).catch(() => null);
      if (firstRefresh?.user?.username !== confirmedName) {
        await refreshSession({ maxAgeMs: 0 }).catch(() => null);
      }
      if (mountedRef.current) {
        updateSetting("user", "name", confirmedName);
        setModalVisible(false);
      }
    } catch (e) {
      if (!mountedRef.current) return;
      // Roll back local username if backend update fails.
      updateSetting("user", "name", prev);

      Alert.alert(
        "Update failed",
        e?.message || "Could not update username on server."
      );
    } finally {
      if (mountedRef.current) setSavingName(false);
    }
  };

  const handleLogout = () => {
    Alert.alert("Log out", "Are you sure you want to log out?", [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Log out",
        style: "destructive",
        onPress: () => {
          // Let iOS dismiss its native alert window before auth removes the
          // active tabs/native-stack hierarchy underneath it.
          InteractionManager.runAfterInteractions(() => {
            requestAnimationFrame(() => {
              if (!mountedRef.current || !user) return;

              void (async () => {
                let releaseAccountOperation = null;
                try {
                  releaseAccountOperation = beginAccountTeardown("logout");
                  const result = await signOut?.();
                  if (result?.providerCleanupError) {
                    console.warn(
                      "[logout] native provider cleanup warning",
                      result.providerCleanupError
                    );
                  }
                } catch (e) {
                  if (mountedRef.current) {
                    Alert.alert(
                      e?.code === "ACCOUNT_OPERATION_IN_PROGRESS"
                        ? "Action in progress"
                        : "Logout failed",
                      e?.message || "Could not log out."
                    );
                  }
                } finally {
                  releaseAccountOperation?.();
                }
              })();
            });
          });
        },
      },
    ]);
  };

  const openAppleSubscriptions = async () => {
    try {
      await Linking.openURL(APPLE_SUBSCRIPTIONS_URL);
    } catch (error) {
      Alert.alert(
        "Could not open subscriptions",
        error?.message ||
          "Open your Apple Account subscriptions in the App Store."
      );
    }
  };

  const handleCancelAppleSubscription = () => {
    Alert.alert(
      "Cancel Apple subscription?",
      "Apple manages subscription cancellations. Pantrio will open Apple Subscriptions, where you can select Pantrio and confirm the cancellation.",
      [
        {
          text: "Keep Subscription",
          style: "cancel",
        },
        {
          text: "Open Apple Subscriptions",
          style: "destructive",
          onPress: openAppleSubscriptions,
        },
      ]
    );
  };

  const openLegalDocument = async (url, title) => {
    try {
      await Linking.openURL(url);
    } catch (nextError) {
      Alert.alert(
        `Could not open ${title}`,
        nextError?.message || `Open the ${title} in your web browser.`
      );
    }
  };

  const handlePurchaseApplePlan = async (plan) => {
    if (!plan?.productId || appleBusy) return;

    try {
      const result = await purchaseApplePlan(plan.productId);
      if (!mountedRef.current) return;
      if (result?.outcome === "cancelled") return;
      if (result?.outcome === "pending") {
        Alert.alert(
          "Purchase pending",
          "Apple is waiting for approval or payment confirmation. Pantrio will update automatically when the transaction completes."
        );
        return;
      }
      if (result?.outcome === "purchased") {
        Alert.alert(
          "Subscription active",
          "Apple verified the purchase and Pantrio refreshed your account access."
        );
      }
    } catch (nextError) {
      if (!mountedRef.current || nextError?.code === "APPLE_REQUEST_SUPERSEDED") {
        return;
      }
      Alert.alert(
        "Purchase not completed",
        nextError?.message || "Could not complete the Apple purchase."
      );
    }
  };

  const handleRestoreApplePurchases = async () => {
    if (appleBusy) return;

    try {
      const result = await restoreApplePurchases();
      if (!mountedRef.current) return;
      if (result?.verification || result?.evidence?.length) {
        Alert.alert(
          "Purchases restored",
          "Pantrio verified the Apple purchase for this account."
        );
      } else {
        Alert.alert(
          "No purchases found",
          "Apple did not return an active Pantrio subscription for this account."
        );
      }
    } catch (nextError) {
      if (!mountedRef.current || nextError?.code === "APPLE_REQUEST_SUPERSEDED") {
        return;
      }
      Alert.alert(
        "Restore failed",
        nextError?.message || "Could not restore Apple purchases."
      );
    }
  };

  const handleRefreshAppleSubscription = async () => {
    if (appleBusy) return;

    try {
      await refreshAppleSubscription();
    } catch (nextError) {
      if (!mountedRef.current || nextError?.code === "APPLE_REQUEST_SUPERSEDED") {
        return;
      }
      Alert.alert(
        "Refresh failed",
        nextError?.message || "Could not refresh the Apple subscription."
      );
    }
  };

  const performAccountDeletion = async ({ password } = {}) => {
    if (!user || deletingAccount) return;

    let releaseAccountOperation = null;
    let deletionCoordinatorStarted = false;
    try {
      setDeletingAccount(true);
      releaseAccountOperation = beginAccountTeardown("delete-account");

      if (
        !storageHydrated ||
        !user.uid ||
        storageOwnerUid !== user.uid
      ) {
        throw new Error(
          "Local account data is still loading. Wait a moment and try again."
        );
      }

      // Firebase and the backend both require recent authentication for this
      // destructive operation. Apple confirmation also gives the backend one
      // final fresh authorization code if the original link was interrupted.
      await reauthenticateForAccountDeletion(user, { password });
      deletionCoordinatorStarted = true;
      await deleteAccount();
    } catch (error) {
      // Once deleteAccount starts, AuthProvider owns errors because this screen
      // is intentionally unmounted by the root teardown guard.
      if (mountedRef.current && !deletionCoordinatorStarted) {
        Alert.alert(
          error?.code === "auth/wrong-password" ||
            error?.code === "auth/invalid-credential"
            ? "Password not accepted"
            : "Could not confirm deletion",
          error?.message || "Sign in again and retry account deletion."
        );
      }
    } finally {
      releaseAccountOperation?.();
      if (mountedRef.current) {
        setDeletingAccount(false);
        setDeletePassword("");
        setDeletePasswordModalVisible(false);
      }
    }
  };

  const handleDeleteAccount = () => {
    if (!user || deletingAccount) return;

    Alert.alert(
      "Delete account?",
      "This permanently deletes your Pantrio account and clears your fridge items, shopping list, chat history, and settings from this device. This cannot be undone.\n\nDeleting your Pantrio account does not cancel an Apple subscription. Manage or cancel it separately in Apple Subscriptions.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () => {
            void getAccountDeletionReauthenticationMethod(user)
              .then((method) => {
                if (!mountedRef.current) return;
                if (method === "password") {
                  setDeletePassword("");
                  setDeletePasswordModalVisible(true);
                  return;
                }
                void performAccountDeletion();
              })
              .catch((error) => {
                if (mountedRef.current) {
                  Alert.alert(
                    "Could not confirm sign-in",
                    error?.message || "Try signing in again."
                  );
                }
              });
          },
        },
      ]
    );
  };

  const openSubMenu = (key) => {
    setCurrentSubMenu(key);
    setOpened(true);

    Animated.timing(anim, {
      toValue: -width,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const goBack = useCallback(() => {
    setOpened(false);

    Animated.timing(anim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => setCurrentSubMenu(null));
  }, [anim]);

  useLayoutEffect(() => {
    navigation.setOptions({
      header: () => (
        <HeaderWithHiddenButton
          title="Settings"
          hideButton={!opened}
          onPress={goBack}
        />
      ),
    });
  }, [goBack, navigation, opened, theme]);

  const CustomButton = ({
    title,
    onPress,
    fontSize: buttonFontSize,
    color,
  }) => (
    <TouchableOpacity
      onPress={onPress}
      style={{
        borderRadius: 12,
        marginTop: 12,
        paddingVertical: 12,
        paddingHorizontal: 16,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: color ? `${color}18` : theme.actionButton,
        borderWidth: color ? StyleSheet.hairlineWidth : 0,
        borderColor: color || "transparent",
      }}
      disabled={!onPress}
    >
      <Text
        style={{
          fontSize: buttonFontSize,
          color: color || theme.actionButtonText || "#ffffff",
          fontWeight: "700",
          opacity: onPress ? 1 : 0.6,
        }}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );

  const renderMainMenu = () => (
    <ScrollView
      style={stylesWithFont.menuPanel}
      contentContainerStyle={stylesWithFont.mainMenu}
      showsVerticalScrollIndicator={false}
    >
      {categories.map((cat) => (
        <TouchableOpacity
          key={cat.key}
          style={stylesWithFont.sectionHeader}
          onPress={() => openSubMenu(cat.key)}
        >
          <View style={stylesWithFont.sectionIcon}>
            <Ionicons name={cat.icon} size={fontSize * 1.25} color={theme.accent} />
          </View>

          <Text style={stylesWithFont.sectionTitle}>
            {cat.title}
          </Text>

          <Ionicons
            name="chevron-forward"
            size={fontSize * 1.25}
            color={theme.textSecondary}
          />
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  // Urgency sliders: live update during sliding and monotonic clamp on release.
  const renderUrgencySliders = () => {
    const fallback = {
      expired: 0,
      eat_first: 2,
      use_soon: 7,
      lasts_a_while: 30,
      long_keeper: 180,
    };

    const U = urgencyDays || fallback;

    // Live updates during drag.
    const setLive = (key, val) => {
      const v = Number(val);

      setUrgencyDays((prev) => ({
        ...(prev || U || fallback),
        expired: 0,
        [key]: v,
      }));
    };

    // Clamp and enforce monotonic ordering after release.
    const setMonotonic = (patchFn) => {
      setUrgencyDays((prev) => {
        const cur = prev || U || fallback;
        const next = patchFn(cur);

        const eat_first = Math.max(
          1,
          Number(next.eat_first ?? cur.eat_first ?? 2)
        );

        const use_soon = Math.max(
          eat_first,
          Number(next.use_soon ?? cur.use_soon ?? 7)
        );

        const lasts_a_while = Math.max(
          use_soon,
          Number(
            next.lasts_a_while ?? cur.lasts_a_while ?? 30
          )
        );

        const long_keeper = Math.max(
          lasts_a_while,
          Number(next.long_keeper ?? cur.long_keeper ?? 180)
        );

        return {
          expired: 0,
          eat_first,
          use_soon,
          lasts_a_while,
          long_keeper,
        };
      });
    };

    return (
      <View style={stylesWithFont.settingColumn}>
        <Text
          style={[
            stylesWithFont.label,
            {
              fontWeight: "700",
              marginBottom: 10,
            },
          ]}
        >
          Urgency thresholds (days remaining)
        </Text>

        <View style={{ marginBottom: 12 }}>
          <Text style={stylesWithFont.label}>
            Expired: 0 days
          </Text>

          <Text
            style={[
              stylesWithFont.value,
              {
                marginTop: 4,
              },
            ]}
          >
            (Automatically when expiration date is in the past)
          </Text>
        </View>

        <View style={{ marginBottom: 12 }}>
          <Text style={stylesWithFont.label}>
            Eat first: {U.eat_first} days
          </Text>

          <Slider
            style={{ width: "100%" }}
            value={U.eat_first}
            onValueChange={(val) => setLive("eat_first", val)}
            onSlidingComplete={(val) =>
              setMonotonic((cur) => ({
                ...cur,
                eat_first: val,
              }))
            }
            minimumValue={1}
            maximumValue={14}
            step={1}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
          />
        </View>

        <View style={{ marginBottom: 12 }}>
          <Text style={stylesWithFont.label}>
            Use soon: {U.use_soon} days
          </Text>

          <Slider
            style={{ width: "100%" }}
            value={U.use_soon}
            onValueChange={(val) => setLive("use_soon", val)}
            onSlidingComplete={(val) =>
              setMonotonic((cur) => ({
                ...cur,
                use_soon: val,
              }))
            }
            minimumValue={2}
            maximumValue={30}
            step={1}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
          />
        </View>

        <View style={{ marginBottom: 12 }}>
          <Text style={stylesWithFont.label}>
            Lasts a while: {U.lasts_a_while} days
          </Text>

          <Slider
            style={{ width: "100%" }}
            value={U.lasts_a_while}
            onValueChange={(val) =>
              setLive("lasts_a_while", val)
            }
            onSlidingComplete={(val) =>
              setMonotonic((cur) => ({
                ...cur,
                lasts_a_while: val,
              }))
            }
            minimumValue={7}
            maximumValue={90}
            step={1}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
          />
        </View>

        <View style={{ marginBottom: 4 }}>
          <Text style={stylesWithFont.label}>
            Long keeper: {U.long_keeper} days
          </Text>

          <Slider
            style={{ width: "100%" }}
            value={U.long_keeper}
            onValueChange={(val) => setLive("long_keeper", val)}
            onSlidingComplete={(val) =>
              setMonotonic((cur) => ({
                ...cur,
                long_keeper: val,
              }))
            }
            minimumValue={30}
            maximumValue={365}
            step={5}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
          />
        </View>
      </View>
    );
  };

  const renderSubMenu = (key) => {
    switch (key) {
      case "user":
        return (
          <View style={stylesWithFont.subMenu}>
            <TouchableOpacity
              style={stylesWithFont.settingRow}
              activeOpacity={0.75}
              onPress={openUsernameEditor}
              accessibilityRole="button"
              accessibilityLabel={`Edit username, currently ${username}`}
            >
              <View style={stylesWithFont.sectionIcon}>
                <Ionicons
                  name="person-outline"
                  size={fontSize * 1.25}
                  color={theme.accent}
                />
              </View>
              <View style={stylesWithFont.accountCardCopy}>
                <Text style={stylesWithFont.accountFieldLabel}>Username</Text>
                <Text
                  style={stylesWithFont.accountValue}
                  numberOfLines={1}
                >
                  {username}
                </Text>
              </View>
              <View style={stylesWithFont.accountEditAction}>
                <Ionicons
                  name="create-outline"
                  size={Math.max(16, fontSize)}
                  color={theme.accent}
                />
                <Text style={stylesWithFont.accountEditText}>Edit</Text>
              </View>
            </TouchableOpacity>

            <View style={stylesWithFont.settingColumn}>
              <View style={stylesWithFont.accountCardHeader}>
                <View style={stylesWithFont.sectionIcon}>
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={fontSize * 1.25}
                    color={theme.accent}
                  />
                </View>
                <View style={stylesWithFont.accountCardCopy}>
                  <Text style={stylesWithFont.accountCardTitle}>
                    Pantrio account access
                  </Text>
                  <Text style={stylesWithFont.accountCardSubtitle}>
                    Backend access, quota, and model
                  </Text>
                </View>
                {accountSessionLoading ? (
                  <ActivityIndicator size="small" color={theme.accent} />
                ) : null}
              </View>

              <View style={stylesWithFont.subscriptionCard}>
                <View
                  style={[
                    stylesWithFont.subscriptionStatusBadge,
                    { borderColor: accountAccessStatusColor },
                  ]}
                >
                  <View
                    style={[
                      stylesWithFont.subscriptionStatusDot,
                      { backgroundColor: accountAccessStatusColor },
                    ]}
                  />
                  <Text
                    style={[
                      stylesWithFont.subscriptionStatusText,
                      { color: accountAccessStatusColor },
                    ]}
                  >
                    {accountAccessStatusLabel}
                  </Text>
                </View>

                <Text style={stylesWithFont.subscriptionPlan}>
                  {accountPlanLabel}
                </Text>

                {!accountSessionLoading && quota ? (
                  <View style={stylesWithFont.subscriptionDetails}>
                    <View style={stylesWithFont.subscriptionDetailRow}>
                      <Text style={stylesWithFont.subscriptionDetailLabel}>
                        Daily AI allowance
                      </Text>
                      <Text style={stylesWithFont.subscriptionDetailValue}>
                        {quota.applies
                          ? `${formatQuotaCount(quota.remaining)} of ${formatQuotaCount(quota.limit)} tokens left`
                          : "No daily quota"}
                      </Text>
                    </View>
                    {quota.applies && quotaReset ? (
                      <View style={stylesWithFont.subscriptionDetailRow}>
                        <Text style={stylesWithFont.subscriptionDetailLabel}>
                          Resets
                        </Text>
                        <Text style={stylesWithFont.subscriptionDetailValue}>
                          {quotaReset}
                          {quota.timezone ? ` (${quota.timezone})` : ""}
                        </Text>
                      </View>
                    ) : null}
                    {effectiveModel ? (
                      <View style={stylesWithFont.subscriptionDetailRow}>
                        <Text style={stylesWithFont.subscriptionDetailLabel}>
                          AI model
                        </Text>
                        <Text style={stylesWithFont.subscriptionDetailValue}>
                          {effectiveModel}
                        </Text>
                      </View>
                    ) : null}
                    {entitlement?.active ? (
                      <View style={stylesWithFont.subscriptionDetailRow}>
                        <Text style={stylesWithFont.subscriptionDetailLabel}>
                          Verification
                        </Text>
                        <Text style={stylesWithFont.subscriptionDetailValue}>
                          {entitlement?.verified
                            ? "Server verified"
                            : "StoreKit report (unverified)"}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {accountSessionError ? (
                  <>
                    <View style={stylesWithFont.subscriptionErrorRow}>
                      <Ionicons
                        name="alert-circle-outline"
                        size={Math.max(16, fontSize)}
                        color={theme.danger}
                      />
                      <Text style={stylesWithFont.subscriptionError}>
                        {accountSessionError}
                      </Text>
                    </View>
                    <CustomButton
                      title={accountSessionLoading ? "Retrying..." : "Retry Account Check"}
                      onPress={
                        accountSessionLoading
                          ? null
                          : () => refreshSession().catch(() => {})
                      }
                      fontSize={fontSize}
                      color={theme.accent}
                    />
                  </>
                ) : null}
              </View>
              <Text style={stylesWithFont.subscriptionFootnote}>
                Pantrio grants paid access only after its backend verifies the
                signed Apple transaction for this account.
              </Text>
            </View>

            <View style={stylesWithFont.settingColumn}>
              <View style={stylesWithFont.accountCardHeader}>
                <View style={stylesWithFont.sectionIcon}>
                  <Ionicons
                    name="card-outline"
                    size={fontSize * 1.25}
                    color={theme.accent}
                  />
                </View>
                <View style={stylesWithFont.accountCardCopy}>
                  <Text style={stylesWithFont.accountCardTitle}>
                    Apple on this device
                  </Text>
                  <Text style={stylesWithFont.accountCardSubtitle}>
                    Local StoreKit status and renewal
                  </Text>
                </View>
                {subscriptionLoading || appleBusy || appleProductsLoading ? (
                  <ActivityIndicator size="small" color={theme.accent} />
                ) : null}
              </View>

              <View style={stylesWithFont.subscriptionCard}>
                <View
                  style={[
                    stylesWithFont.subscriptionStatusBadge,
                    { borderColor: subscriptionStatusColor },
                  ]}
                >
                  <View
                    style={[
                      stylesWithFont.subscriptionStatusDot,
                      { backgroundColor: subscriptionStatusColor },
                    ]}
                  />
                  <Text
                    style={[
                      stylesWithFont.subscriptionStatusText,
                      { color: subscriptionStatusColor },
                    ]}
                  >
                    {subscriptionStatusLabel}
                  </Text>
                </View>

                <Text style={stylesWithFont.subscriptionPlan}>
                  {subscriptionPlanLabel}
                </Text>

                {subscription?.productId ? (
                  <View style={stylesWithFont.subscriptionDetails}>
                    <View style={stylesWithFont.subscriptionDetailRow}>
                      <Text style={stylesWithFont.subscriptionDetailLabel}>
                        Product
                      </Text>
                      <Text
                        style={stylesWithFont.subscriptionDetailValue}
                        numberOfLines={2}
                      >
                        {subscription.productId}
                      </Text>
                    </View>
                    <View style={stylesWithFont.subscriptionDetailRow}>
                      <Text style={stylesWithFont.subscriptionDetailLabel}>
                        Renewal
                      </Text>
                      <Text style={stylesWithFont.subscriptionDetailValue}>
                        {subscription?.willAutoRenew
                          ? "Renews automatically"
                          : "Will not renew"}
                      </Text>
                    </View>
                    {subscriptionDate ? (
                      <View style={stylesWithFont.subscriptionDetailRow}>
                        <Text style={stylesWithFont.subscriptionDetailLabel}>
                          {subscription?.willAutoRenew
                            ? "Next renewal"
                            : "Access until"}
                        </Text>
                        <Text style={stylesWithFont.subscriptionDetailValue}>
                          {subscriptionDate}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {subscriptionError ? (
                  <View style={stylesWithFont.subscriptionErrorRow}>
                    <Ionicons
                      name="alert-circle-outline"
                      size={Math.max(16, fontSize)}
                      color={theme.danger}
                    />
                    <Text style={stylesWithFont.subscriptionError}>
                      {subscriptionError}
                    </Text>
                  </View>
                ) : null}

                {appleError ? (
                  <View style={stylesWithFont.subscriptionErrorRow}>
                    <Ionicons
                      name="cloud-offline-outline"
                      size={Math.max(16, fontSize)}
                      color={theme.danger}
                    />
                    <Text style={stylesWithFont.subscriptionError}>
                      {appleError}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Text style={stylesWithFont.accountInputLabel}>
                Available plans
              </Text>
              {appleProductsLoading && !applePlans.length ? (
                <View style={stylesWithFont.accountActivity}>
                  <ActivityIndicator color={theme.accent} />
                </View>
              ) : null}
              {!appleProductsLoading && !applePlans.length ? (
                <Text style={stylesWithFont.helpText}>
                  {apple?.enabled === false
                    ? "Apple subscriptions are not configured for this app yet."
                    : "No Apple subscription plans are currently available."}
                </Text>
              ) : null}
              {applePlans.map((plan) => {
                const currentPlan =
                  entitlement?.active &&
                  entitlement?.verified &&
                  entitlement?.productId === plan.productId;
                const periodLabel = formatSubscriptionPeriod(plan.period);
                const priceLabel = plan.displayPrice
                  ? periodLabel
                    ? `${plan.displayPrice} every ${periodLabel}`
                    : plan.displayPrice
                  : periodLabel;
                const canPurchase =
                  applePurchasesAvailable &&
                  plan.storeKitAvailable &&
                  !appleBusy &&
                  !currentPlan;

                return (
                  <View
                    key={plan.productId}
                    style={stylesWithFont.applePlanCard}
                  >
                    <View style={stylesWithFont.applePlanHeader}>
                      <View style={stylesWithFont.applePlanCopy}>
                        <Text style={stylesWithFont.applePlanName}>
                          {plan.displayName}
                        </Text>
                        {priceLabel ? (
                          <Text style={stylesWithFont.applePlanPrice}>
                            {priceLabel}
                          </Text>
                        ) : null}
                      </View>
                      {currentPlan ? (
                        <View style={stylesWithFont.currentPlanBadge}>
                          <Text style={stylesWithFont.currentPlanText}>
                            Current
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    {plan.description ? (
                      <Text style={stylesWithFont.applePlanDescription}>
                        {plan.description}
                      </Text>
                    ) : null}
                    {plan.displayPrice && periodLabel ? (
                      <Text style={stylesWithFont.appleRenewalDisclosure}>
                        Automatically renews at {plan.displayPrice} every {periodLabel}
                        {" "}unless canceled at least 24 hours before the current
                        period ends. Payment is charged to your Apple Account at
                        confirmation.
                      </Text>
                    ) : null}
                    <CustomButton
                      title={
                        currentPlan
                          ? "Current Plan"
                          : appleOperation === "purchase"
                            ? "Processing Purchase..."
                            : entitlement?.active
                              ? `Change to ${plan.displayName}`
                              : `Subscribe to ${plan.displayName}`
                      }
                      onPress={
                        canPurchase
                          ? () => handlePurchaseApplePlan(plan)
                          : null
                      }
                      fontSize={fontSize}
                      color={theme.accent}
                    />
                    {!plan.storeKitAvailable && Platform.OS === "ios" ? (
                      <Text style={stylesWithFont.applePlanUnavailable}>
                        This product is not currently available from Apple.
                      </Text>
                    ) : null}
                  </View>
                );
              })}

              {appleProductsError ? (
                <View style={stylesWithFont.subscriptionErrorRow}>
                  <Ionicons
                    name="alert-circle-outline"
                    size={Math.max(16, fontSize)}
                    color={theme.danger}
                  />
                  <Text style={stylesWithFont.subscriptionError}>
                    {appleProductsError}
                  </Text>
                </View>
              ) : null}

              <View style={stylesWithFont.appleLegalLinks}>
                <TouchableOpacity
                  onPress={() =>
                    openLegalDocument(TERMS_OF_USE_URL, "Terms of Use")
                  }
                  accessibilityRole="link"
                >
                  <Text style={stylesWithFont.appleLegalLinkText}>
                    Terms of Use
                  </Text>
                </TouchableOpacity>
                {PRIVACY_POLICY_URL ? (
                  <TouchableOpacity
                    onPress={() =>
                      openLegalDocument(
                        PRIVACY_POLICY_URL,
                        "Privacy Policy"
                      )
                    }
                    accessibilityRole="link"
                  >
                    <Text style={stylesWithFont.appleLegalLinkText}>
                      Privacy Policy
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <CustomButton
                title={
                  appleOperation === "restore"
                    ? "Restoring Purchases..."
                    : "Restore Purchases"
                }
                onPress={
                  applePurchasesAvailable && !appleBusy
                    ? handleRestoreApplePurchases
                    : null
                }
                fontSize={fontSize}
                color={theme.accent}
              />
              <CustomButton
                title={
                  appleOperation === "refresh"
                    ? "Refreshing Subscription..."
                    : "Refresh Subscription Status"
                }
                onPress={
                  applePurchasesAvailable && !appleBusy
                    ? handleRefreshAppleSubscription
                    : null
                }
                fontSize={fontSize}
                color={theme.accent}
              />
              <CustomButton
                title="Manage Apple Subscription"
                onPress={openAppleSubscriptions}
                fontSize={fontSize}
                color={theme.accent}
              />
              {subscription?.willAutoRenew ? (
                <CustomButton
                  title="Cancel Subscription"
                  onPress={handleCancelAppleSubscription}
                  fontSize={fontSize}
                  color={theme.danger}
                />
              ) : null}
              <Text style={stylesWithFont.subscriptionFootnote}>
                Purchases are linked with an anonymous account token. Pantrio
                never receives your Apple Account email or password.
              </Text>
            </View>

            {loggedIn ? (
              <>
                <View style={stylesWithFont.settingColumn}>
                  <View style={stylesWithFont.accountCardHeader}>
                    <View style={stylesWithFont.sectionIcon}>
                      <Ionicons
                        name="log-out-outline"
                        size={fontSize * 1.25}
                        color={theme.accent}
                      />
                    </View>
                    <View style={stylesWithFont.accountCardCopy}>
                      <Text style={stylesWithFont.accountCardTitle}>
                        Session
                      </Text>
                      <Text style={stylesWithFont.accountCardSubtitle}>
                        Sign out of Pantrio on this device
                      </Text>
                    </View>
                  </View>
                  <CustomButton
                    title="Log out"
                    onPress={
                      deletingAccount || accountBusy ? null : handleLogout
                    }
                    fontSize={fontSize}
                    color={theme.accent}
                  />
                </View>

                <View style={stylesWithFont.settingColumn}>
                  <View style={stylesWithFont.accountCardHeader}>
                    <View
                      style={[
                        stylesWithFont.sectionIcon,
                        { backgroundColor: `${theme.danger}18` },
                      ]}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={fontSize * 1.25}
                        color={theme.danger}
                      />
                    </View>
                    <View style={stylesWithFont.accountCardCopy}>
                      <Text style={stylesWithFont.accountDangerTitle}>
                        Delete account
                      </Text>
                      <Text style={stylesWithFont.accountCardSubtitle}>
                      Permanently delete account and app data
                      </Text>
                    </View>
                  </View>
                  <CustomButton
                    title={
                      deletingAccount
                        ? "Deleting Account..."
                        : "Delete Account"
                    }
                    onPress={
                      deletingAccount || accountBusy
                        ? null
                        : handleDeleteAccount
                    }
                    fontSize={fontSize}
                    color={theme.danger}
                  />
                  {deletingAccount ? (
                    <View style={stylesWithFont.accountActivity}>
                      <ActivityIndicator color={theme.danger} />
                    </View>
                  ) : null}
                </View>
              </>
            ) : (
              <View style={stylesWithFont.settingColumn}>
                <View style={stylesWithFont.accountCardHeader}>
                  <View style={stylesWithFont.sectionIcon}>
                    <Ionicons
                      name="log-in-outline"
                      size={fontSize * 1.25}
                      color={theme.accent}
                    />
                  </View>
                  <View style={stylesWithFont.accountCardCopy}>
                    <Text style={stylesWithFont.accountCardTitle}>
                      Pantrio account
                    </Text>
                    <Text style={stylesWithFont.accountCardSubtitle}>
                      Sign in to sync and manage your account
                    </Text>
                  </View>
                </View>
                <CustomButton
                  title="Log In/Sign Up"
                  onPress={() => router.push("/(auth)/sign-in")}
                  fontSize={fontSize}
                  color={theme.accent}
                />
              </View>
            )}

            <Modal
              visible={modalVisible}
              animationType="fade"
              transparent={true}
              onRequestClose={() => {
                if (!savingName) {
                  setModalVisible(false);
                }
              }}
            >
              <View style={stylesWithFont.modalBackground}>
                <View style={stylesWithFont.modalContainer}>
                  <View style={stylesWithFont.accountCardHeader}>
                    <View style={stylesWithFont.sectionIcon}>
                      <Ionicons
                        name="person-outline"
                        size={fontSize * 1.25}
                        color={theme.accent}
                      />
                    </View>
                    <View style={stylesWithFont.accountCardCopy}>
                      <Text style={stylesWithFont.accountCardTitle}>
                        Edit username
                      </Text>
                      <Text style={stylesWithFont.accountCardSubtitle}>
                        Choose how your name appears in Pantrio
                      </Text>
                    </View>
                  </View>

                  <Text style={stylesWithFont.accountInputLabel}>Username</Text>
                  <TextInput
                    style={stylesWithFont.accountInput}
                    value={tempName}
                    onChangeText={setTempName}
                    placeholder="Your name"
                    placeholderTextColor={theme.textPlaceholder}
                    returnKeyType="done"
                    onSubmitEditing={saveName}
                    editable={!savingName}
                    autoFocus
                  />

                  {savingName ? (
                    <View style={stylesWithFont.accountActivity}>
                      <ActivityIndicator color={theme.accent} />
                    </View>
                  ) : null}

                  <CustomButton
                    title={savingName ? "Saving..." : "Save Username"}
                    onPress={savingName ? null : saveName}
                    fontSize={fontSize}
                  />
                  <CustomButton
                    title="Cancel"
                    onPress={
                      savingName ? null : () => setModalVisible(false)
                    }
                    fontSize={fontSize}
                    color={theme.textSecondary}
                  />
                </View>
              </View>
            </Modal>

            <Modal
              visible={deletePasswordModalVisible}
              animationType="fade"
              transparent
              onRequestClose={() => {
                if (!deletingAccount) {
                  setDeletePasswordModalVisible(false);
                  setDeletePassword("");
                }
              }}
            >
              <View style={stylesWithFont.modalBackground}>
                <View style={stylesWithFont.modalContainer}>
                  <Text style={stylesWithFont.accountCardTitle}>
                    Confirm your password
                  </Text>
                  <Text style={stylesWithFont.accountCardSubtitle}>
                    Re-enter your password before permanently deleting this
                    account.
                  </Text>
                  <Text style={stylesWithFont.accountInputLabel}>Password</Text>
                  <TextInput
                    style={stylesWithFont.accountInput}
                    value={deletePassword}
                    onChangeText={setDeletePassword}
                    placeholder="Password"
                    placeholderTextColor={theme.textPlaceholder}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    editable={!deletingAccount}
                    onSubmitEditing={() => {
                      if (deletePassword && !deletingAccount) {
                        void performAccountDeletion({
                          password: deletePassword,
                        });
                      }
                    }}
                    autoFocus
                  />
                  <CustomButton
                    title={deletingAccount ? "Confirming..." : "Delete Account"}
                    onPress={
                      deletePassword && !deletingAccount
                        ? () =>
                            void performAccountDeletion({
                              password: deletePassword,
                            })
                        : null
                    }
                    fontSize={fontSize}
                    color={theme.danger}
                  />
                  <CustomButton
                    title="Cancel"
                    onPress={
                      deletingAccount
                        ? null
                        : () => {
                            setDeletePasswordModalVisible(false);
                            setDeletePassword("");
                          }
                    }
                    fontSize={fontSize}
                    color={theme.textSecondary}
                  />
                </View>
              </View>
            </Modal>
          </View>
        );

      case "ux":
        return (
          <View style={stylesWithFont.subMenu}>
            <View style={stylesWithFont.settingRow}>
              <Text style={stylesWithFont.label}>
                Use System Theme
              </Text>

              <Switch
                value={!!settings?.ux?.systemTheme}
                onValueChange={(val) =>
                  updateSetting("ux", "systemTheme", val)
                }
                trackColor={{
                  true: theme.actionButton,
                  false: theme.border,
                }}
              />
            </View>

            <View style={stylesWithFont.settingRow}>
              <Text style={stylesWithFont.label}>
                Dark Mode
              </Text>

              <Switch
                value={!!settings?.ux?.darkMode}
                disabled={!!settings?.ux?.systemTheme}
                onValueChange={(val) =>
                  updateSetting("ux", "darkMode", val)
                }
                trackColor={{
                  true: theme.actionButton,
                  false: theme.border,
                }}
              />
            </View>

            <View style={stylesWithFont.settingRow}>
              <Text style={stylesWithFont.label}>
                Font Size: {displayedFontSize}
              </Text>

              <Slider
                style={{ flex: 1 }}
                value={displayedFontSize}
                onValueChange={setFontSizeDraft}
                onSlidingComplete={(val) => {
                  updateSetting("ux", "fontSize", val);
                  setFontSizeDraft(null);
                }}
                minimumValue={12}
                maximumValue={24}
                step={1}
                minimumTrackTintColor={theme.accent}
                maximumTrackTintColor={theme.border}
              />
            </View>
          </View>
        );

      case "notifications":
        return (
          <View style={stylesWithFont.subMenu}>
            <View style={stylesWithFont.settingRow}>
              <Text style={stylesWithFont.label}>
                Daily Reminders
              </Text>

              <Switch
                value={
                  !!settings?.notifications?.dailyReminders
                }
                onValueChange={(val) =>
                  void updateReminderToggle(
                    "notifications",
                    "dailyReminders",
                    val
                  )
                }
                trackColor={{
                  true: theme.actionButton,
                  false: theme.border,
                }}
              />
            </View>
          </View>
        );

      case "fridge":
        return (
          <View style={stylesWithFont.subMenu}>
            <View style={stylesWithFont.settingRow}>
              <Text style={stylesWithFont.label}>
                Expiration Alerts
              </Text>

              <Switch
                value={
                  !!settings?.expiration?.expirationAlerts
                }
                onValueChange={(val) =>
                  void updateReminderToggle(
                    "expiration",
                    "expirationAlerts",
                    val
                  )
                }
                trackColor={{
                  true: theme.accent,
                  false: theme.border,
                }}
              />
            </View>

            <View style={stylesWithFont.settingRow}>
              <Text style={stylesWithFont.label}>
                Alert Time: {remindDays} days
              </Text>

              <Slider
                style={{ flex: 1 }}
                value={
                  settings?.expiration?.remindDays ?? 5
                }
                onSlidingComplete={(val) =>
                  updateSetting(
                    "expiration",
                    "remindDays",
                    val
                  )
                }
                onValueChange={(val) =>
                  setRemindDays(val)
                }
                minimumValue={1}
                maximumValue={31}
                step={1}
                minimumTrackTintColor={theme.accent}
                maximumTrackTintColor={theme.border}
              />
            </View>

            {renderUrgencySliders()}
          </View>
        );

      case "privacy":
        return (
          <View style={stylesWithFont.subMenu}>
            <View style={stylesWithFont.settingRow}>
              <Text style={stylesWithFont.label}>
                Incognito Mode
              </Text>

              <Switch
                value={!!settings?.privacy?.incognito}
                onValueChange={(val) =>
                  updateSetting(
                    "privacy",
                    "incognito",
                    val
                  )
                }
                trackColor={{
                  true: theme.actionButton,
                  false: theme.border,
                }}
              />
            </View>

            <View style={stylesWithFont.settingColumn}>
              <CustomButton
                title="Clear All Data"
                onPress={() => {
                  Alert.alert(
                    "Confirm Reset",
                    "Are you sure you want to clear all data? This cannot be undone.",
                    [
                      {
                        text: "Cancel",
                        style: "cancel",
                      },
                      {
                        text: "Clear",
                        style: "destructive",
                        onPress: handleClearAllData,
                      },
                    ]
                  );
                }}
                fontSize={fontSize}
                color={theme.danger}
              />

              <CustomButton
                title="Clear Chat Messages"
                onPress={() => {
                  Alert.alert(
                    "Confirm Reset",
                    "Are you sure you want to clear all chat messages? This cannot be undone.",
                    [
                      {
                        text: "Cancel",
                        style: "cancel",
                      },
                      {
                        text: "Clear",
                        style: "destructive",
                        onPress: () =>
                          clearChatData(
                            storageOwnerUid,
                            setMessages,
                            setSummary
                          ),
                      },
                    ]
                  );
                }}
                fontSize={fontSize}
                color={theme.danger}
              />
            </View>
          </View>
        );

      case "advanced":
        return (
          <View style={stylesWithFont.subMenu}>
            <View style={stylesWithFont.settingColumn}>
              <Text style={stylesWithFont.label}>Select AI</Text>
              <Text style={stylesWithFont.helpText}>
                Choose the AI Pantrio uses for chat and food planning.
              </Text>

              {[
                { value: "pantrio", label: "Pantrio AI", detail: "Uses Pantrio's hosted AI service." },
                { value: "apple", label: "Apple Intelligence", detail: appleAvailability?.reason || "Checking this device…" },
                { value: "custom", label: "My own AI API", detail: "Uses an OpenAI-compatible provider and your API key." },
              ].map((option) => {
                const appleUnsupported =
                  option.value === "apple" &&
                  APPLE_AI_UNSUPPORTED_STATUSES.has(appleAvailability?.status);
                const disabled =
                  option.value === "apple" &&
                  (checkingAppleAi || !appleAvailability || appleUnsupported);

                return (
                <TouchableOpacity
                  key={option.value}
                  style={[
                    stylesWithFont.aiProviderChoice,
                    disabled && stylesWithFont.aiProviderChoiceDisabled,
                  ]}
                  onPress={() => selectAiProvider(option.value)}
                  disabled={disabled}
                  accessibilityState={{
                    disabled,
                    selected: aiProvider === option.value,
                  }}
                >
                  <Ionicons
                    name={
                      appleUnsupported
                        ? "lock-closed-outline"
                        : aiProvider === option.value
                          ? "radio-button-on"
                          : "radio-button-off"
                    }
                    size={fontSize + 4}
                    color={disabled ? theme.textSecondary : theme.accent}
                  />
                  <View style={stylesWithFont.aiProviderCopy}>
                    <Text style={stylesWithFont.aiProviderLabel}>{option.label}</Text>
                    <Text style={stylesWithFont.helpText}>{option.detail}</Text>
                  </View>
                  {checkingAppleAi && option.value === "apple" ? (
                    <ActivityIndicator size="small" color={theme.accent} />
                  ) : null}
                </TouchableOpacity>
                );
              })}
            </View>

            {aiProvider === "custom" ? (
            <View style={stylesWithFont.settingColumn}>
              <Text style={stylesWithFont.inputLabel}>API provider</Text>
              <DropDownPicker
                open={aiProviderOpen}
                value={aiBaseUrl}
                items={aiProviderItems}
                setOpen={setAiProviderOpen}
                setValue={setAiBaseUrl}
                disabled={savingAi}
                placeholder="Choose an API provider"
                listMode="SCROLLVIEW"
                style={stylesWithFont.dropdown}
                dropDownContainerStyle={stylesWithFont.dropdownMenu}
                textStyle={stylesWithFont.dropdownText}
                placeholderStyle={stylesWithFont.dropdownPlaceholder}
                arrowIconStyle={{ tintColor: theme.textSecondary }}
                tickIconStyle={{ tintColor: theme.accent }}
                zIndex={3000}
              />
              <Text style={stylesWithFont.selectedUrl}>{aiBaseUrl}</Text>

              <Text style={stylesWithFont.inputLabel}>Model</Text>
              <TextInput
                style={stylesWithFont.aiInput}
                value={loadingAiProviderSettings ? "" : aiModel}
                onChangeText={setAiModelDraft}
                editable={!savingAi && !loadingAiProviderSettings}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder="gpt-4o-mini"
                placeholderTextColor={theme.textPlaceholder}
              />

              <Text style={stylesWithFont.inputLabel}>API key</Text>
              <TextInput
                style={stylesWithFont.aiInput}
                value={loadingAiProviderSettings ? "" : aiApiKey}
                onChangeText={setAiApiKey}
                editable={!savingAi && !loadingAiProviderSettings}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                placeholder="Your provider API key"
                placeholderTextColor={theme.textPlaceholder}
              />

              <CustomButton
                title={savingAi ? "Saving..." : "Save AI Provider"}
                onPress={savingAi || loadingAiProviderSettings ? null : saveAiProvider}
                fontSize={fontSize}
              />
              <Text style={stylesWithFont.securityText}>
                Each provider keeps its own model name and key in the secure device keychain. A key is sent only to the API base URL it was saved for.
              </Text>
            </View>
            ) : null}
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <View
      style={{
        flex: 1,
        overflow: "hidden",
        backgroundColor: theme.background,
      }}
    >
      <Animated.View
        style={{
          flexDirection: "row",
          width: width * 2,
          transform: [{ translateX: anim }],
        }}
      >
        {renderMainMenu()}

        {currentSubMenu && (
          <ScrollView
            style={stylesWithFont.menuPanel}
            contentContainerStyle={stylesWithFont.subMenuScroll}
            showsVerticalScrollIndicator={false}
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
          >
            {renderSubMenu(currentSubMenu)}
          </ScrollView>
        )}
      </Animated.View>
    </View>
  );
}

const dynamicStyles = (theme, fontSize) =>
  StyleSheet.create({
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 13,
      paddingHorizontal: 14,
      backgroundColor: theme.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      borderRadius: 16,
      marginBottom: 10,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 8,
      elevation: 2,
    },

    mainMenu: {
      paddingHorizontal: 16,
      paddingTop: 18,
      paddingBottom: 36,
    },
    menuPanel: {
      width,
      flexGrow: 0,
      flexShrink: 0,
    },
    sectionIcon: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: `${theme.accent}18`,
    },

    sectionTitle: {
      flex: 1,
      fontSize,
      fontWeight: "600",
      marginLeft: 12,
      color: theme.textPrimary,
    },

    settingRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 15,
      backgroundColor: theme.card,
      borderRadius: 16,
      marginBottom: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },

    settingColumn: {
      paddingHorizontal: 16,
      paddingVertical: 16,
      backgroundColor: theme.card,
      borderRadius: 16,
      marginBottom: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
    },

    accountCardHeader: {
      flexDirection: "row",
      alignItems: "center",
    },
    accountCardCopy: {
      flex: 1,
      minWidth: 0,
      marginLeft: 12,
    },
    accountFieldLabel: {
      fontSize: Math.max(11, fontSize - 3),
      fontWeight: "700",
      letterSpacing: 0.7,
      textTransform: "uppercase",
      color: theme.textSecondary,
    },
    accountValue: {
      marginTop: 3,
      fontSize: fontSize + 2,
      fontWeight: "700",
      color: theme.textPrimary,
    },
    accountEditAction: {
      flexDirection: "row",
      alignItems: "center",
      marginLeft: 12,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 10,
      backgroundColor: `${theme.accent}18`,
    },
    accountEditText: {
      marginLeft: 5,
      fontSize: Math.max(12, fontSize - 2),
      fontWeight: "700",
      color: theme.accent,
    },
    accountCardTitle: {
      fontSize,
      fontWeight: "700",
      color: theme.textPrimary,
    },
    accountCardSubtitle: {
      marginTop: 3,
      fontSize: Math.max(11, fontSize - 3),
      lineHeight: Math.max(16, fontSize + 1),
      color: theme.textSecondary,
    },
    accountDangerTitle: {
      fontSize,
      fontWeight: "700",
      color: theme.danger,
    },
    accountActivity: {
      alignItems: "center",
      paddingTop: 12,
    },
    accountInputLabel: {
      marginTop: 18,
      marginBottom: 7,
      fontSize: Math.max(12, fontSize - 2),
      fontWeight: "700",
      color: theme.textPrimary,
    },
    accountInput: {
      minHeight: 48,
      paddingHorizontal: 12,
      paddingVertical: 11,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      borderRadius: 12,
      fontSize,
      color: theme.textPrimary,
      backgroundColor: theme.background,
    },

    subscriptionCard: {
      marginTop: 14,
      padding: 14,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.background,
    },
    subscriptionStatusBadge: {
      alignSelf: "flex-start",
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 9,
      paddingVertical: 6,
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: 999,
    },
    subscriptionStatusDot: {
      width: 7,
      height: 7,
      marginRight: 7,
      borderRadius: 4,
    },
    subscriptionStatusText: {
      fontSize: Math.max(12, fontSize - 2),
      fontWeight: "700",
    },
    subscriptionPlan: {
      marginTop: 12,
      fontSize: fontSize + 1,
      fontWeight: "700",
      color: theme.textPrimary,
    },
    subscriptionDetails: {
      marginTop: 12,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: theme.border,
    },
    subscriptionDetailRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      paddingVertical: 10,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    subscriptionDetailLabel: {
      flex: 1,
      marginRight: 12,
      fontSize: Math.max(11, fontSize - 3),
      fontWeight: "600",
      color: theme.textSecondary,
    },
    subscriptionDetailValue: {
      flex: 1.7,
      fontSize: Math.max(11, fontSize - 3),
      fontWeight: "600",
      textAlign: "right",
      color: theme.textPrimary,
    },
    subscriptionErrorRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginTop: 12,
      padding: 10,
      borderRadius: 10,
      backgroundColor: `${theme.danger}12`,
    },
    subscriptionError: {
      flex: 1,
      marginLeft: 8,
      fontSize: Math.max(11, fontSize - 3),
      lineHeight: Math.max(16, fontSize + 1),
      color: theme.danger,
    },
    subscriptionFootnote: {
      marginTop: 8,
      paddingHorizontal: 2,
      fontSize: Math.max(11, fontSize - 3),
      lineHeight: Math.max(16, fontSize + 1),
      textAlign: "center",
      color: theme.textSecondary,
    },
    applePlanCard: {
      marginTop: 10,
      padding: 14,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      backgroundColor: theme.background,
    },
    applePlanHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
    },
    applePlanCopy: {
      flex: 1,
      minWidth: 0,
      marginRight: 10,
    },
    applePlanName: {
      fontSize: fontSize + 1,
      fontWeight: "700",
      color: theme.textPrimary,
    },
    applePlanPrice: {
      marginTop: 4,
      fontSize: Math.max(12, fontSize - 2),
      fontWeight: "600",
      color: theme.accent,
    },
    applePlanDescription: {
      marginTop: 10,
      fontSize: Math.max(11, fontSize - 3),
      lineHeight: Math.max(16, fontSize + 1),
      color: theme.textSecondary,
    },
    appleRenewalDisclosure: {
      marginTop: 10,
      fontSize: Math.max(10, fontSize - 4),
      lineHeight: Math.max(15, fontSize),
      color: theme.textSecondary,
    },
    currentPlanBadge: {
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 999,
      backgroundColor: `${theme.accent}18`,
    },
    currentPlanText: {
      fontSize: Math.max(11, fontSize - 3),
      fontWeight: "700",
      color: theme.accent,
    },
    applePlanUnavailable: {
      marginTop: 8,
      fontSize: Math.max(11, fontSize - 3),
      textAlign: "center",
      color: theme.textSecondary,
    },
    appleLegalLinks: {
      flexDirection: "row",
      justifyContent: "center",
      gap: 22,
      marginTop: 14,
      marginBottom: 2,
    },
    appleLegalLinkText: {
      fontSize: Math.max(11, fontSize - 3),
      fontWeight: "700",
      textDecorationLine: "underline",
      color: theme.accent,
    },

    label: {
      fontSize,
      color: theme.textPrimary,
    },

    value: {
      fontSize,
      color: theme.textSecondary,
    },

    subMenu: {
      flex: 1,
    },
    subMenuScroll: {
      paddingHorizontal: 16,
      paddingTop: 18,
      paddingBottom: 40,
    },

    modalBackground: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: theme.modalBackground,
    },

    modalContainer: {
      width: "88%",
      maxWidth: 420,
      padding: 20,
      backgroundColor: theme.card,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      flexDirection: "column",
      justifyContent: "space-around",
    },

    input: {
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      marginBottom: 10,
      fontSize,
      color: theme.textPrimary,
    },
    inputLabel: {
      marginTop: 14,
      marginBottom: 5,
      fontSize: Math.max(12, fontSize - 2),
      fontWeight: "600",
      color: theme.textPrimary,
    },
    aiInput: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize,
      color: theme.textPrimary,
      backgroundColor: theme.background,
    },
    dropdown: {
      minHeight: 48,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      borderRadius: 12,
      paddingHorizontal: 12,
      backgroundColor: theme.background,
    },
    dropdownMenu: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      borderRadius: 12,
      backgroundColor: theme.card,
    },
    dropdownText: {
      fontSize,
      color: theme.textPrimary,
    },
    dropdownPlaceholder: {
      color: theme.textPlaceholder,
    },
    selectedUrl: {
      marginTop: 7,
      paddingHorizontal: 2,
      fontSize: Math.max(11, fontSize - 3),
      color: theme.textSecondary,
    },
    helpText: {
      fontSize: Math.max(12, fontSize - 2),
      lineHeight: Math.max(17, fontSize + 3),
      color: theme.textSecondary,
    },
    securityText: {
      marginTop: 8,
      fontSize: Math.max(11, fontSize - 3),
      lineHeight: Math.max(16, fontSize + 1),
      color: theme.textSecondary,
    },
    aiProviderChoice: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 13,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    aiProviderChoiceDisabled: {
      opacity: 0.5,
    },
    aiProviderCopy: {
      flex: 1,
      marginLeft: 12,
    },
    aiProviderLabel: {
      marginBottom: 3,
      fontSize,
      fontWeight: "700",
      color: theme.textPrimary,
    },
  });
