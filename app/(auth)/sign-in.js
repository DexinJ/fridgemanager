import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { onAuthStateChanged, signInWithEmailAndPassword } from "firebase/auth";
import React, { useContext, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform, // ✅ CHANGED: needed to show Apple only on iOS
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { auth } from "../../auth/firebaseClient";
import { GlobalContext } from "../../context/GlobalContext";

import { signInWithApple } from "../../auth/appleAuth"; // ✅ CHANGED: Apple login helper
import { signInWithGoogleNative } from "../../auth/googleAuth";

const BACKEND_HTTP_URL = env.EXPO_PUBLIC_API_BASE_URL || "https://oversanguinely-metabolous-maxine.ngrok-free.dev";

async function getUserProfileFromBackend({ idToken, uid }) {
  const resp = await fetch(`${BACKEND_HTTP_URL}/api/users/${uid}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Backend GET failed: ${resp.status} ${text.slice(0, 200)}`
    );
  }

  return resp.json();
}

export default function SignInScreen() {
  const router = useRouter();
  const { theme, settings, setUsername } = useContext(GlobalContext);

  const fontSize = settings?.ux?.fontSize || 16;

  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false); // ✅ CHANGED

  const [didBackendSync, setDidBackendSync] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setDidBackendSync(false);
        return;
      }

      if (!didBackendSync) {
        try {
          const idToken = await user.getIdToken();
          const uid = user.uid;
          const profile = await getUserProfileFromBackend({ idToken, uid });

          setUsername(profile.username);
          setDidBackendSync(true);
        } catch (err) {
          Alert.alert("Backend sync failed", err?.message || "Unknown error");
          return;
        }
      }

      router.replace("/(tabs)");
    });

    return unsub;
  }, [router, didBackendSync, setUsername]);

  const isBusy = loading || googleLoading || appleLoading; // ✅ CHANGED

  const submit = async () => {
    const e = email.trim();

    if (!e || !pw) {
      return Alert.alert("Missing info", "Enter email and password.");
    }

    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, e, pw);
    } catch (err) {
      Alert.alert("Login failed", err?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const onGoogle = async () => {
    setGoogleLoading(true);
    try {
      const userCred = await signInWithGoogleNative(auth);
      if (!userCred?.user) return;
    } catch (err) {
      Alert.alert("Google sign-in failed", err?.message || "Unknown error");
    } finally {
      setGoogleLoading(false);
    }
  };

  // ✅ CHANGED: Apple sign-in handler
  const onApple = async () => {
    setAppleLoading(true);
    try {
      const result = await signInWithApple();
      if (!result?.user) return;
    } catch (err) {
      if (err?.code === "ERR_REQUEST_CANCELED") return;
      Alert.alert("Apple sign-in failed", err?.message || "Unknown error");
    } finally {
      setAppleLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <Text
        style={[
          styles.title,
          { color: theme.textPrimary, fontSize: fontSize * 1.6 },
        ]}
      >
        Log in
      </Text>

      <Text style={[styles.label, { color: theme.textSecondary }]}>Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="you@example.com"
        placeholderTextColor={theme.textPlaceholder}
        style={[
          styles.input,
          {
            backgroundColor: theme.inputBackground,
            borderColor: theme.border,
            color: theme.inputText,
            fontSize,
          },
        ]}
      />

      <Text style={[styles.label, { color: theme.textSecondary }]}>
        Password
      </Text>
      <TextInput
        value={pw}
        onChangeText={setPw}
        secureTextEntry
        placeholder="••••••••"
        placeholderTextColor={theme.textPlaceholder}
        style={[
          styles.input,
          {
            backgroundColor: theme.inputBackground,
            borderColor: theme.border,
            color: theme.inputText,
            fontSize,
          },
        ]}
      />

      <Pressable
        style={[
          styles.button,
          {
            backgroundColor: theme.actionButton,
            opacity: isBusy ? 0.6 : 1,
          },
        ]}
        onPress={submit}
        disabled={isBusy}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={[styles.buttonText, { fontSize }]}>Log in</Text>
        )}
      </Pressable>

      <View style={styles.oauthRowWrap}>
        <Text style={[styles.oauthLabel, { color: theme.textSecondary }]}>
          Or continue with
        </Text>

        <View style={styles.oauthRow}>
          <Pressable
            style={[
              styles.oauthIconButton,
              {
                backgroundColor: theme.card,
                borderColor: theme.border,
                opacity: isBusy ? 0.35 : 1,
              },
            ]}
            onPress={onGoogle}
            disabled={isBusy}
            accessibilityRole="button"
            accessibilityLabel="Continue with Google"
          >
            {googleLoading ? (
              <ActivityIndicator color={theme.accent} />
            ) : (
              <Ionicons name="logo-google" size={22} color={theme.accent} />
            )}
          </Pressable>

          {/* ✅ CHANGED: Apple login is now enabled on iOS */}
          {Platform.OS === "ios" && (
            <Pressable
              style={[
                styles.oauthIconButton,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                  opacity: isBusy ? 0.35 : 1,
                },
              ]}
              onPress={onApple}
              disabled={isBusy}
              accessibilityRole="button"
              accessibilityLabel="Continue with Apple"
            >
              {appleLoading ? (
                <ActivityIndicator color={theme.accent} />
              ) : (
                <Ionicons
                  name="logo-apple"
                  size={22}
                  color={theme.textPrimary}
                />
              )}
            </Pressable>
          )}

          <Pressable
            style={[
              styles.oauthIconButton,
              {
                backgroundColor: theme.card,
                borderColor: theme.border,
                opacity: 0.35,
              },
            ]}
            disabled
            accessibilityLabel="Facebook (coming soon)"
          >
            <Ionicons
              name="logo-facebook"
              size={22}
              color={theme.textSecondary}
            />
          </Pressable>
        </View>
      </View>

      <Text style={[styles.footer, { color: theme.textSecondary }]}>
        New here?{" "}
        <Text
          style={[styles.link, { color: theme.accent }]}
          onPress={() => router.push("/(auth)/sign-up")}
        >
          Create an account
        </Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: "center", gap: 10 },
  title: { fontWeight: "700", marginBottom: 16 },
  label: { fontSize: 14, opacity: 0.9 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  button: {
    borderRadius: 12,
    padding: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { color: "#fff", fontWeight: "700" },

  oauthRowWrap: {
    marginTop: 10,
    gap: 10,
    alignItems: "center",
  },
  oauthLabel: { fontSize: 12, fontWeight: "700", opacity: 0.7 },
  oauthRow: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  oauthIconButton: {
    width: 48,
    height: 48,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  footer: { marginTop: 16, textAlign: "center" },
  link: { fontWeight: "700" },
});