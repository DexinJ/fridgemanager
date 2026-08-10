import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";

let configured = false;

const GOOGLE_WEB_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const GOOGLE_IOS_CLIENT_ID =
  process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

function requireGoogleClientId(name, clientId) {
  const value = String(clientId || "").trim();
  if (!value) {
    throw new Error(
      `${name} is not configured. Add it to the selected Expo/EAS environment.`
    );
  }
  return value;
}

/**
 * Configure native Google Sign-In once. The iOS URL scheme is derived from the
 * same iOS client ID in app.config.js, so native and runtime configuration
 * cannot drift independently.
 */
export function configureGoogleSignIn() {
  if (configured) return;

  GoogleSignin.configure({
    webClientId: requireGoogleClientId(
      "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID",
      GOOGLE_WEB_CLIENT_ID
    ),
    iosClientId: requireGoogleClientId(
      "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID",
      GOOGLE_IOS_CLIENT_ID
    ),
  });

  configured = true;
}

/**
 * Exchange a native Google ID token for a Firebase Authentication session.
 * @param {import("firebase/auth").Auth} auth
 * @returns {Promise<import("firebase/auth").UserCredential>}
 */
export async function signInWithGoogleNative(auth) {
  configureGoogleSignIn();

  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const userInfo = await GoogleSignin.signIn();
  let idToken = userInfo?.idToken;

  if (!idToken) {
    const tokens = await GoogleSignin.getTokens();
    idToken = tokens?.idToken;
  }

  if (!idToken) throw new Error("No Google idToken returned");

  const credential = GoogleAuthProvider.credential(idToken);
  return signInWithCredential(auth, credential);
}

/**
 * Clear the native Google session without revoking the user's grant. Firebase
 * sign-out remains a separate operation so callers can complete it even if the
 * native provider reports an error.
 */
export async function signOutFromGoogleNative() {
  configureGoogleSignIn();
  if (!GoogleSignin.hasPreviousSignIn()) return false;

  await GoogleSignin.signOut();
  return true;
}

/**
 * Revoke the native Google grant. This is intentionally separate from normal
 * logout and should be called only for an explicit account-deletion action.
 */
export async function revokeGoogleAccessNative() {
  configureGoogleSignIn();
  if (!GoogleSignin.hasPreviousSignIn()) return false;

  await GoogleSignin.revokeAccess();
  return true;
}
