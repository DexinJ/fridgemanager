// app/_layout.js
import * as Sentry from '@sentry/react-native';
import { Stack } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-get-random-values";
import { useAuth } from "../auth/useAuth";
import {
  AccountSessionProvider,
  useAccountSession,
} from "../context/AccountSessionContext";
import { GlobalProvider } from "../context/GlobalContext";
import { AppleSubscriptionProvider } from "../context/SubscriptionContext";

Sentry.init({
  dsn: "https://9d707a565864181830d59147b126ac25@o4511787964432384.ingest.us.sentry.io/4511787964563456",

  // Keep this only if you accept that error information may be
  // linked to an account, IP address, or device.
  sendDefaultPii: true,

  // Prevent independent transmission of application logs.
  enableLogs: false,

  // Do not record ordinary sessions.
  replaysSessionSampleRate: 0,

  // Record replay context only when an error occurs.
  replaysOnErrorSampleRate: 1,

  integrations: [
    Sentry.mobileReplayIntegration({
      maskAllText: true,
      maskAllImages: true,
      maskAllVectors: true,
    }),
  ],
});

function AppNavigator({ user }) {
  const { initializing: sessionInitializing } = useAccountSession();

  // A failed load is exposed in Settings; only the initial attempt gates tabs.
  if (user && sessionInitializing) {
    return (
      <View
        style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
        accessibilityLabel="Checking account access"
      >
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return user ? (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
    </Stack>
  ) : (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
    </Stack>
  );
}

export default Sentry.wrap(function Layout() {
  const { user, loading } = useAuth();

  // Keep native splash while resolving auth
  if (loading) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppleSubscriptionProvider
        key={user?.uid || "signed-out"}
        accountId={user?.uid || null}
        enabled={!!user}
      >
        <AccountSessionProvider
          key={user?.uid || "signed-out-session"}
          authUser={user}
        >
          <GlobalProvider authUser={user}>
            <AppNavigator user={user} />
          </GlobalProvider>
        </AccountSessionProvider>
      </AppleSubscriptionProvider>
    </GestureHandlerRootView>
  );
});
