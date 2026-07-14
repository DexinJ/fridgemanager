import { Link, useRouter } from "expo-router";
import { createUserWithEmailAndPassword, onAuthStateChanged } from "firebase/auth";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { auth } from "../auth/firebaseClient";

// ✅ set this to your backend base URL (HTTP, not WS)
const BACKEND_HTTP_URL = env.EXPO_PUBLIC_API_BASE_URL || "https://oversanguinely-metabolous-maxine.ngrok-free.dev";
  // process.env.EXPO_PUBLIC_BACKEND_HTTP_URL || "http://192.168.0.163:3000";

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
    throw new Error(`Backend save failed: ${resp.status} ${text.slice(0, 200)}`);
  }

  return resp.json();
}

export default function SignupScreen() {
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) router.replace("/(app)");
    });
    return unsub;
  }, [router]);

  const signup = async () => {
    const u = username.trim();
    const e = email.trim();

    if (!u || !e || !pw || !pw2) return Alert.alert("Missing info", "Fill out all fields.");
    if (u.length < 2 || u.length > 20) return Alert.alert("Username", "Username must be 2–20 characters.");
    if (pw !== pw2) return Alert.alert("Passwords don’t match", "Please retype your password.");
    if (pw.length < 6) return Alert.alert("Weak password", "Password must be at least 6 characters.");

    setLoading(true);
    try {
      // 1) Create Firebase user (auto signs in)
      const cred = await createUserWithEmailAndPassword(auth, e, pw);

      // 2) Get token for backend
      const idToken = await cred.user.getIdToken();

      // 3) Save username+uid in backend (backend derives uid from token)
      await saveUserProfileToBackend({ idToken, username: u });

      // 4) Redirect (auth listener will do it, but we can also do it explicitly)
      router.replace("/(app)");
    } catch (err) {
      Alert.alert("Sign up failed", err?.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create account</Text>

      <Text style={styles.label}>Username</Text>
      <TextInput
        value={username}
        onChangeText={setUsername}
        autoCapitalize="none"
        placeholder="e.g. tonyjin"
        style={styles.input}
      />

      <Text style={styles.label}>Email</Text>
      <TextInput
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="you@example.com"
        style={styles.input}
      />

      <Text style={styles.label}>Password</Text>
      <TextInput
        value={pw}
        onChangeText={setPw}
        secureTextEntry
        placeholder="••••••••"
        style={styles.input}
      />

      <Text style={styles.label}>Confirm password</Text>
      <TextInput
        value={pw2}
        onChangeText={setPw2}
        secureTextEntry
        placeholder="••••••••"
        style={styles.input}
      />

      <Pressable style={[styles.button, loading && styles.buttonDisabled]} onPress={signup} disabled={loading}>
        {loading ? <ActivityIndicator /> : <Text style={styles.buttonText}>Create account</Text>}
      </Pressable>

      <Text style={styles.footer}>
        Already have an account?{" "}
        <Link href="/(auth)/login" style={styles.link}>
          Log in
        </Link>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: "center", gap: 10 },
  title: { fontSize: 28, fontWeight: "700", marginBottom: 16 },
  label: { fontSize: 14, opacity: 0.8 },
  input: { borderWidth: 1, borderColor: "#ccc", borderRadius: 12, padding: 12, fontSize: 16 },
  button: { backgroundColor: "#111", borderRadius: 12, padding: 14, alignItems: "center", marginTop: 8 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "white", fontWeight: "700", fontSize: 16 },
  footer: { marginTop: 16, textAlign: "center" },
  link: { fontWeight: "700" },
});
