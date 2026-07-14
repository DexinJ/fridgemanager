import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useContext, useMemo, useState } from "react";
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

import { createUserWithEmailAndPassword } from "firebase/auth";

import { auth } from "../../auth/firebaseClient";
import {
  configureGoogleSignIn,
  signInWithGoogleNative,
} from "../../auth/googleAuth";
import { signInWithApple } from "../../auth/appleAuth"; // ✅ CHANGED: Apple login helper
import { GlobalContext } from "../../context/GlobalContext";

const BACKEND_HTTP_URL = "https://oversanguinely-metabolous-maxine.ngrok-free.dev";

async function saveUserProfileToBackend({ idToken, username }) {
  const resp = await fetch(`${BACKEND_HTTP_URL}/api/users`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ username }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(
      `Backend save failed: ${resp.status} ${text.slice(0, 200)}`
    );
  }

  return resp.json().catch(() => ({}));
}

function makeFallbackUsername(user, typedUsername = "") {
  // ✅ CHANGED: shared fallback username helper for Google + Apple
  return (
    typedUsername.trim() ||
    user?.displayName?.replace(/\s+/g, "").slice(0, 20) ||
    user?.email?.split("@")[0].slice(0, 20) ||
    "user"
  );
}

export default function SignUpScreen() {
  const router = useRouter();

  const { theme, settings, setUsername: setUsernameInApp } =
    useContext(GlobalContext);

  const fontSize = settings?.ux?.fontSize || 16;

  const [username, setUsernameInput] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [appleLoading, setAppleLoading] = useState(false); // ✅ CHANGED

  useMemo(() => {
    configureGoogleSignIn();
  }, []);

  const isBusy = loading || googleLoading || appleLoading; // ✅ CHANGED

  const submit = async () => {
    const e = email.trim();
    const u = username.trim();

    if (!u || !e || !pw || !pw2) {
      return Alert.alert("Missing info", "Fill out all fields.");
    }
    if (u.length < 2 || u.length > 20) {
      return Alert.alert("Username", "Username must be 2–20 characters.");
    }
    if (pw !== pw2) {
      return Alert.alert("Passwords don’t match", "Please retype your password.");
    }
    if (pw.length < 6) {
      return Alert.alert("Weak password", "Password must be at least 6 characters.");
    }

    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, e, pw);
      const idToken = await cred.user.getIdToken();

      await saveUserProfileToBackend({ idToken, username: u });

      setUsernameInApp(u);
      router.replace("/(tabs)");
    } catch (err) {
      Alert.alert("Sign up failed", err?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const onPressGoogle = async () => {
    const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    if (!webClientId) {
      return Alert.alert(
        "Google not configured",
        "Missing EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID in .env"
      );
    }

    setGoogleLoading(true);
    try {
      const userCred = await signInWithGoogleNative(auth);
      if (!userCred?.user) return;

      const fallbackUsername = makeFallbackUsername(userCred.user, username);
      const firebaseIdToken = await userCred.user.getIdToken();

      await saveUserProfileToBackend({
        idToken: firebaseIdToken,
        username: fallbackUsername,
      });

      setUsernameInApp(fallbackUsername);
      router.replace("/(tabs)");
    } catch (err) {
      Alert.alert("Google sign-in failed", err?.message || "Unknown error");
    } finally {
      setGoogleLoading(false);
    }
  };

  // ✅ CHANGED: Apple sign-up/sign-in handler
  const onPressApple = async () => {
    setAppleLoading(true);
    try {
      const result = await signInWithApple();
      if (!result?.user) return;

      const appleName = result.appleCredential?.fullName;
      const displayNameFromApple = appleName
        ? `${appleName.givenName || ""}${appleName.familyName || ""}`.trim()
        : "";

      const fallbackUsername = makeFallbackUsername(
        {
          ...result.user,
          displayName: result.user?.displayName || displayNameFromApple,
        },
        username
      );

      const firebaseIdToken = await result.user.getIdToken();

      await saveUserProfileToBackend({
        idToken: firebaseIdToken,
        username: fallbackUsername,
      });

      setUsernameInApp(fallbackUsername);
      router.replace("/(tabs)");
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
        Create account
      </Text>

      <Text style={[styles.label, { color: theme.textSecondary }]}>Username</Text>
      <TextInput
        value={username}
        onChangeText={setUsernameInput}
        autoCapitalize="none"
        placeholder="e.g. johndoe"
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

      <Text style={[styles.label, { color: theme.textSecondary }]}>Password</Text>
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

      <Text style={[styles.label, { color: theme.textSecondary }]}>
        Confirm password
      </Text>
      <TextInput
        value={pw2}
        onChangeText={setPw2}
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
          <Text style={[styles.buttonText, { fontSize }]}>Create account</Text>
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
            onPress={onPressGoogle}
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

          {/* ✅ CHANGED: Apple is now enabled on iOS */}
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
              onPress={onPressApple}
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
            <Ionicons name="logo-facebook" size={22} color={theme.textSecondary} />
          </Pressable>
        </View>
      </View>

      <Text style={[styles.footer, { color: theme.textSecondary }]}>
        Already have an account?{" "}
        <Text
          style={[styles.link, { color: theme.accent }]}
          onPress={() => router.push("/(auth)/sign-in")}
        >
          Log in
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