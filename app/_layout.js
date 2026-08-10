// app/_layout.js
import * as Sentry from '@sentry/react-native';
import { Stack } from "expo-router";
import { useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-get-random-values";
import { AuthProvider, useAuth } from "../auth/useAuth";

Sentry.init({
  dsn: "https://9d707a565864181830d59147b126ac25@o4511787964432384.ingest.us.sentry.io/4511787964563456",
  environment:
    process.env.EXPO_PUBLIC_APP_ENV ||
    (__DEV__ ? "development" : "production"),
  sendDefaultPii: false,

  // Prevent independent transmission of application logs.
  enableLogs: false,

  // Do not record ordinary sessions.
  replaysSessionSampleRate: 0,

  // Keep replay useful for diagnosing production-only failures without
  // recording every error session.
  replaysOnErrorSampleRate: __DEV__ ? 0 : 0.1,

  integrations: [
    Sentry.mobileReplayIntegration({
      maskAllText: true,
      maskAllImages: true,
      maskAllVectors: true,
    }),
  ],
  beforeSend(event) {
    if (event.request?.headers) {
      const headers = { ...event.request.headers };
      delete headers.Authorization;
      delete headers.authorization;
      delete headers.Cookie;
      delete headers.cookie;
      event.request.headers = headers;
    }

    if (event.user) {
      event.user = event.user.id ? { id: event.user.id } : undefined;
    }

    return event;
  },
});

function RootErrorFallback({ resetError }) {
  return (
    <View style={styles.errorFallback} accessibilityRole="alert">
      <Text style={styles.errorTitle}>Pantrio ran into a problem</Text>
      <Text style={styles.errorMessage}>
        Your saved data is still on this device. Try loading the app again.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={resetError}
        style={styles.retryButton}
      >
        <Text style={styles.retryButtonText}>Try again</Text>
      </Pressable>
    </View>
  );
}

function AuthRecoveryFallback({ error, onRetry, onSignOut }) {
  return (
    <View style={styles.errorFallback} accessibilityRole="alert">
      <Text style={styles.errorTitle}>We could not verify your account</Text>
      <Text style={styles.errorMessage}>
        {error?.message ||
          "Check your connection and try again. Your account data has not been opened."}
      </Text>
      <View style={styles.recoveryActions}>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={styles.retryButton}
        >
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onSignOut}
          style={styles.signOutButton}
        >
          <Text style={styles.signOutButtonText}>Sign out</Text>
        </Pressable>
      </View>
    </View>
  );
}

function AppNavigator({ user, loading }) {
  return (
    <View style={styles.container}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!loading && !user}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={!loading && Boolean(user)}>
          <Stack.Screen name="(tabs)" />
        </Stack.Protected>
      </Stack>

      {loading ? (
        <View
          style={styles.loadingOverlay}
          accessibilityLabel="Checking sign-in status"
        >
          <ActivityIndicator size="large" />
        </View>
      ) : null}
    </View>
  );
}

function RootLayoutContent() {
  const {
    authRecoveryError,
    consumePostAuthNotice,
    loading,
    postAuthNotice,
    retryAuthRecovery,
    signOutFromRecovery,
    user,
  } = useAuth();

  useEffect(() => {
    if (authRecoveryError || loading || user || !postAuthNotice) {
      return undefined;
    }

    let active = true;
    const task = InteractionManager.runAfterInteractions(() => {
      if (!active) return;
      consumePostAuthNotice();
      Alert.alert(postAuthNotice.title, postAuthNotice.message);
    });

    return () => {
      active = false;
      task.cancel?.();
    };
  }, [
    authRecoveryError,
    consumePostAuthNotice,
    loading,
    postAuthNotice,
    user,
  ]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {authRecoveryError ? (
        <AuthRecoveryFallback
          error={authRecoveryError}
          onRetry={retryAuthRecovery}
          onSignOut={signOutFromRecovery}
        />
      ) : (
        <AppNavigator user={user} loading={loading} />
      )}
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(function Layout() {
  return (
    <Sentry.ErrorBoundary
      fallback={({ resetError }) => (
        <RootErrorFallback resetError={resetError} />
      )}
    >
      <AuthProvider>
        <RootLayoutContent />
      </AuthProvider>
    </Sentry.ErrorBoundary>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    backgroundColor: "#ffffff",
    justifyContent: "center",
  },
  errorFallback: {
    alignItems: "center",
    backgroundColor: "#ffffff",
    flex: 1,
    justifyContent: "center",
    padding: 28,
  },
  errorTitle: {
    color: "#182022",
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  errorMessage: {
    color: "#526064",
    fontSize: 16,
    lineHeight: 23,
    marginTop: 12,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: "#0A8E91",
    borderRadius: 12,
    marginTop: 24,
    paddingHorizontal: 22,
    paddingVertical: 13,
  },
  retryButtonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
  recoveryActions: {
    alignItems: "center",
    width: "100%",
  },
  signOutButton: {
    borderColor: "#0A8E91",
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 12,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  signOutButtonText: {
    color: "#0A7376",
    fontSize: 16,
    fontWeight: "700",
  },
});
