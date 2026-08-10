import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app =
  getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// 🔥 THIS enables persistence in React Native
let initializedAuth;

try {
  initializedAuth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (error) {
  // Fast Refresh can re-evaluate this module after Auth already exists.
  // Only reuse that known instance; configuration failures must still fail.
  if (error?.code !== "auth/already-initialized") throw error;
  initializedAuth = getAuth(app);
}

export const auth = initializedAuth;
