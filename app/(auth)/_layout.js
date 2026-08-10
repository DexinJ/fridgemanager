// app/(auth)/_layout.js
import { Stack } from "expo-router";
import { GlobalProvider } from "../../context/GlobalContext";

export default function AuthLayout() {
  return (
    <GlobalProvider>
      <Stack
        screenOptions={{ headerShown: false }}
        initialRouteName="onboarding"
      />
    </GlobalProvider>
  );
}
