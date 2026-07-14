// app/(auth)/_layout.js
import { Redirect, Stack } from "expo-router";
import { useAuth } from "../../auth/useAuth";

export default function AuthLayout() {
  const { loggedIn, loading } = useAuth();
  if (loading) return null;
  if (loggedIn) return <Redirect href="/(tabs)" />;
  return (
    <Stack screenOptions={{ headerShown: false }} initialRouteName="onboarding" />
  );
}