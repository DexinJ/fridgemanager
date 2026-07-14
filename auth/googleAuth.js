import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { GoogleAuthProvider, signInWithCredential } from "firebase/auth";

/**
 * Configure Google Sign-In once (call on app start or first use).
 * Safe to call multiple times; we guard with a module-level flag.
 */
let _configured = false;

export function configureGoogleSignIn() {
  if (_configured) return;

  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID; // 👈 Add this

  if (!webClientId || !iosClientId) {
    console.warn(
      "Missing Google Client IDs in .env. Native sign-in will fail."
    );
    return;
  }

  GoogleSignin.configure({
    webClientId,
    iosClientId, // 👈 AND THIS
    offlineAccess: true,
  });

  _configured = true;
}

/**
 * Native Google sign-in -> Firebase user credential
 * @param {import("firebase/auth").Auth} auth
 * @returns {Promise<import("firebase/auth").UserCredential>}
 */
export async function signInWithGoogleNative(auth) {
  configureGoogleSignIn();

  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const userInfo = await GoogleSignin.signIn();
  console.log(userInfo);
  let idToken = userInfo?.idToken;  

  if (!idToken) {
    const tokens = await GoogleSignin.getTokens();
    idToken = tokens?.idToken;
  }

  if (!idToken) throw new Error("No Google idToken returned");

  const credential = GoogleAuthProvider.credential(idToken);
  return signInWithCredential(auth, credential);
}