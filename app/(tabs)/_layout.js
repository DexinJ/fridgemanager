import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import "react-native-get-random-values";
import { useAuth } from "../../auth/useAuth";
import { PlainHeader } from "../../components/Header";
import {
  AccountSessionProvider,
  useAccountSession,
} from "../../context/AccountSessionContext";
import { GlobalContext, GlobalProvider } from "../../context/GlobalContext";
import { AppleSubscriptionProvider } from "../../context/SubscriptionContext";

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
          header: () => <PlainHeader title="Chat" />,
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
        <GlobalProvider authUser={user}>
          <ThemedTabs />
        </GlobalProvider>
      </AccountSessionProvider>
    </AppleSubscriptionProvider>
  );
}
