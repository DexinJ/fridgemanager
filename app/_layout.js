// app/_layout.js
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-get-random-values";
import { useAuth } from "../auth/useAuth";
import { GlobalProvider } from "../context/GlobalContext";
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: 'https://9d707a565864181830d59147b126ac25@o4511787964432384.ingest.us.sentry.io/4511787964563456',

  // Adds more context data to events (IP address, cookies, user, etc.)
  // For more information, visit: https://docs.sentry.io/platforms/react-native/data-management/data-collected/
  sendDefaultPii: true,

  // Enable Logs
  enableLogs: true,

  // Configure Session Replay
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
  integrations: [Sentry.mobileReplayIntegration(), Sentry.feedbackIntegration()],

  // uncomment the line below to enable Spotlight (https://spotlightjs.com)
  // spotlight: __DEV__,
});

export default Sentry.wrap(function Layout() {
  const { user, loading } = useAuth();

  // Keep native splash while resolving auth
  if (loading) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <GlobalProvider authUser={user}>
      {/* Mount GlobalProvider only when logged in */}
      {user ? (     
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
          </Stack>     
      ) : (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(auth)" />
        </Stack>
      )}
       </GlobalProvider>
    </GestureHandlerRootView>
  );
});