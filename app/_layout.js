// app/_layout.js
import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-get-random-values";
import { useAuth } from "../auth/useAuth";
import { GlobalProvider } from "../context/GlobalContext";

export default function Layout() {
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
}