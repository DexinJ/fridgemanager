// // app/index.js
// // ✅ Now index is just a redirect based on login
// // ✅ Onboarding removed/ignored per request

// import { Redirect } from "expo-router";
// import { useAuth } from "../auth/useAuth";

// export default function Index() {
//   const { user, loading } = useAuth();

//   // Keep the splash (or avoid flicker) while auth restores
//   if (loading) return null;

//   if (!user) return <Redirect href="/(auth)" />;

//   return <Redirect href="/(tabs)" />;
// }
