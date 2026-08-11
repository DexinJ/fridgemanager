import { getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app =
  getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// 🔥 THIS enables persistence in React Native
// Native builds resolve firebaseClient.native.js and use encrypted storage.
// Web/SSR uses Firebase's platform persistence implementation.
export const auth = getAuth(app);
