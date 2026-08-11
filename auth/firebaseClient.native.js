import { getApps, initializeApp } from "firebase/app";
import {
  getAuth,
  getReactNativePersistence,
  initializeAuth,
} from "firebase/auth";
import { secureFirebaseStorage } from "./secureFirebaseStorage";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

let initializedAuth;
try {
  initializedAuth = initializeAuth(app, {
    persistence: getReactNativePersistence(secureFirebaseStorage),
  });
} catch (error) {
  if (error?.code !== "auth/already-initialized") throw error;
  initializedAuth = getAuth(app);
}

export const auth = initializedAuth;
