import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import "react-native-get-random-values";
import { useAuth } from "../../auth/useAuth";
import { GptProvider } from "../../api/gpt";
import { IconHeader } from "../../components/Header";
import {
  AccountSessionProvider,
  useAccountSession,
} from "../../context/AccountSessionContext";
import {
  ChatContext,
  GlobalContext,
  GlobalProvider,
} from "../../context/GlobalContext";
import { AppleSubscriptionProvider } from "../../context/SubscriptionContext";
import { canExposeAccountData } from "../../context/refreshPolicy";

function ChatTabHeader() {
  const {
    activeConversationTitle,
    createConversation,
    setConversationsVisible,
  } = useContext(ChatContext);

  return (
    <IconHeader
      title={activeConversationTitle}
      leftItems={[
        {
          icon: "menu-outline",
          label: "Open conversations",
          onPress: () => setConversationsVisible(true),
        },
      ]}
      rightItems={[
        {
          icon: "add",
          label: "New chat",
          onPress: () => createConversation(),
        },
      ]}
    />
  );
}

function SessionBackedGlobalProvider({ authUser, children }) {
  const {
    session,
    initializing,
    loading,
    error,
    refreshSession,
    beginAccountTeardown,
  } = useAccountSession();
  const { accountDeletionPending, signOut } = useAuth();
  const [actionError, setActionError] = useState("");
  const [working, setWorking] = useState(false);

  if (!canExposeAccountData(session, accountDeletionPending)) {
    const waiting = initializing || loading || accountDeletionPending;
    const retry = async () => {
      if (working) return;
      setActionError("");
      setWorking(true);
      try {
        await refreshSession({ maxAgeMs: 0 });
      } catch (nextError) {
        setActionError(
          String(nextError?.message || "Could not verify account access.")
        );
      } finally {
        setWorking(false);
      }
    };
    const logout = async () => {
      if (working) return;
      setActionError("");
      setWorking(true);
      let releaseAccountOperation = null;
      try {
        releaseAccountOperation = beginAccountTeardown("logout");
        await signOut();
      } catch (nextError) {
        setActionError(String(nextError?.message || "Could not log out."));
      } finally {
        releaseAccountOperation?.();
        setWorking(false);
      }
    };

    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 28,
          backgroundColor: "#F7F8FA",
        }}
        accessibilityLabel={
          waiting ? "Verifying account access" : "Account access unavailable"
        }
      >
        {waiting ? (
          <>
            <ActivityIndicator size="large" color="#2563EB" />
            <Text
              style={{ marginTop: 14, color: "#30343B", textAlign: "center" }}
            >
              {accountDeletionPending
                ? "Finishing account deletion…"
                : "Verifying account access…"}
            </Text>
          </>
        ) : (
          <>
            <Ionicons name="cloud-offline-outline" size={44} color="#B3261E" />
            <Text
              style={{
                marginTop: 16,
                color: "#1E2229",
                fontSize: 20,
                fontWeight: "700",
                textAlign: "center",
              }}
            >
              Account access could not be verified
            </Text>
            <Text
              style={{
                marginTop: 10,
                color: "#5F6672",
                fontSize: 15,
                lineHeight: 22,
                textAlign: "center",
              }}
            >
              {actionError || error || "Check your connection and try again."}
            </Text>
            <Pressable
              onPress={() => void retry()}
              disabled={working}
              accessibilityRole="button"
              accessibilityLabel="Retry account verification"
              style={({ pressed }) => ({
                marginTop: 22,
                minWidth: 128,
                alignItems: "center",
                paddingHorizontal: 22,
                paddingVertical: 12,
                borderRadius: 10,
                backgroundColor: "#2563EB",
                opacity: working ? 0.5 : pressed ? 0.75 : 1,
              })}
            >
              {working ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>
                  Retry
                </Text>
              )}
            </Pressable>
            <Pressable
              onPress={() => void logout()}
              disabled={working}
              accessibilityRole="button"
              accessibilityLabel="Log out of this account"
              style={({ pressed }) => ({
                marginTop: 12,
                minWidth: 128,
                alignItems: "center",
                paddingHorizontal: 22,
                paddingVertical: 12,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#AEB4BE",
                opacity: working ? 0.5 : pressed ? 0.75 : 1,
              })}
            >
              <Text style={{ color: "#30343B", fontWeight: "700" }}>
                Log out
              </Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  return (
    <GlobalProvider
      authUser={authUser}
      accountProfile={session.user}
      accountProfileLoading={false}
    >
      {children}
    </GlobalProvider>
  );
}

function ThemedTabs() {
  const { signOut } = useAuth();
  const {
    retryStorageHydration,
    storageHydrated,
    storageHydrationErrors,
    storagePurgeResult,
    theme,
  } = useContext(GlobalContext);
  const { beginAccountTeardown, initializing } = useAccountSession();
  const mountedRef = useRef(false);
  const recoveryLogoutLockedRef = useRef(false);
  const [recoveryLogoutError, setRecoveryLogoutError] = useState("");
  const [recoveryLoggingOut, setRecoveryLoggingOut] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const logoutFromRecovery = async () => {
    if (recoveryLogoutLockedRef.current) return;
    recoveryLogoutLockedRef.current = true;
    setRecoveryLogoutError("");
    setRecoveryLoggingOut(true);

    let releaseAccountOperation = null;
    try {
      releaseAccountOperation = beginAccountTeardown("logout");
      const result = await signOut();
      if (result?.providerCleanupError) {
        console.warn(
          "[recovery logout] native provider cleanup warning",
          result.providerCleanupError
        );
      }
    } catch (error) {
      if (mountedRef.current) {
        setRecoveryLogoutError(
          String(error?.message || "Could not log out. Try again.")
        );
      }
    } finally {
      releaseAccountOperation?.();
      recoveryLogoutLockedRef.current = false;
      if (mountedRef.current) setRecoveryLoggingOut(false);
    }
  };

  const storageRecoveryRequired =
    Object.keys(storageHydrationErrors || {}).length > 0 ||
    storagePurgeResult?.pendingRetry === true;

  // Account and UID-scoped device state must both resolve before any tab can
  // mutate defaults that may otherwise race a late storage read.
  if (initializing || !storageHydrated) {
    return (
      <View
        style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        accessibilityLabel="Loading account data"
      >
        <ActivityIndicator size="large" color={theme.actionButton} />
      </View>
    );
  }

  if (storageRecoveryRequired) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 28,
          backgroundColor: theme.background,
        }}
        accessibilityLabel="Local data recovery required"
      >
        <Ionicons
          name="warning-outline"
          size={44}
          color={theme.warning || theme.danger}
        />
        <Text
          style={{
            marginTop: 16,
            color: theme.textPrimary,
            fontSize: 20,
            fontWeight: "700",
            textAlign: "center",
          }}
        >
          Local data needs attention
        </Text>
        <Text
          style={{
            marginTop: 10,
            color: theme.textSecondary,
            fontSize: 15,
            lineHeight: 22,
            textAlign: "center",
          }}
        >
          Pantrio could not safely load or finish clearing local data. Your
          stored data has not been replaced. Retry to recover access.
        </Text>
        <Pressable
          onPress={() => {
            setRecoveryLogoutError("");
            retryStorageHydration();
          }}
          disabled={recoveryLoggingOut}
          accessibilityRole="button"
          accessibilityLabel="Retry loading local data"
          style={({ pressed }) => ({
            marginTop: 22,
            minWidth: 128,
            alignItems: "center",
            paddingHorizontal: 22,
            paddingVertical: 12,
            borderRadius: 10,
            backgroundColor: theme.actionButton,
            opacity: recoveryLoggingOut ? 0.5 : pressed ? 0.75 : 1,
          })}
        >
          <Text style={{ color: "#FFFFFF", fontSize: 16, fontWeight: "700" }}>
            Retry
          </Text>
        </Pressable>
        <Pressable
          onPress={() => void logoutFromRecovery()}
          disabled={recoveryLoggingOut}
          accessibilityRole="button"
          accessibilityLabel="Log out of this account"
          style={({ pressed }) => ({
            marginTop: 12,
            minWidth: 128,
            alignItems: "center",
            paddingHorizontal: 22,
            paddingVertical: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: theme.border,
            opacity: recoveryLoggingOut ? 0.5 : pressed ? 0.75 : 1,
          })}
        >
          {recoveryLoggingOut ? (
            <ActivityIndicator color={theme.textPrimary} />
          ) : (
            <Text
              style={{
                color: theme.textPrimary,
                fontSize: 16,
                fontWeight: "700",
              }}
            >
              Log out
            </Text>
          )}
        </Pressable>
        {recoveryLogoutError ? (
          <Text
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            style={{
              marginTop: 12,
              color: theme.danger || "#B3261E",
              fontSize: 14,
              lineHeight: 20,
              textAlign: "center",
            }}
          >
            {recoveryLogoutError}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        tabBarActiveTintColor: theme.actionButton,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.card, borderColor: theme.border, },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          headerShown: false,
          title: "Home",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          header: () => <ChatTabHeader />,
          title: "Chat",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="chatbubble-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="fridge"
        options={{
          title: "Fridge",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cube-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="list"
        options={{
          title: "Shopping List",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="cart-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}

export default function TabsLayout() {
  const { user } = useAuth();

  // The protected root stack removes this layout after sign-out. Keep this
  // guard for the brief render in which the auth update is propagating.
  if (!user) return null;

  return (
    <AppleSubscriptionProvider key={user.uid} accountId={user.uid} enabled>
      <AccountSessionProvider authUser={user}>
        <SessionBackedGlobalProvider authUser={user}>
          <GptProvider>
            <ThemedTabs />
          </GptProvider>
        </SessionBackedGlobalProvider>
      </AccountSessionProvider>
    </AppleSubscriptionProvider>
  );
}
