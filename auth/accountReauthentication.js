import { GoogleSignin } from "@react-native-google-signin/google-signin";
import * as AppleAuthentication from "expo-apple-authentication";
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import { Platform } from "react-native";
import {
  reauthenticateWithApple,
  tryLinkAppleAuthorizationToBackend,
} from "./appleAuth";
import { configureGoogleSignIn } from "./googleAuth";
import { extractGoogleIdTokenFromSignInResponse } from "./googleSignInResponse";

function providerIdsForUser(user) {
  return new Set(
    (user?.providerData || [])
      .map((provider) => String(provider?.providerId || "").trim())
      .filter(Boolean)
  );
}

async function appleReauthenticationAvailable() {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function getAccountDeletionReauthenticationMethod(user) {
  const providerIds = providerIdsForUser(user);

  // Prefer Apple when it is linked so this confirmation also produces the
  // fresh authorization code needed to repair a missing server revocation
  // credential before deletion.
  if (
    providerIds.has("apple.com") &&
    (await appleReauthenticationAvailable())
  ) {
    return "apple";
  }
  if (providerIds.has("google.com")) return "google";
  if (providerIds.has("password")) return "password";
  if (providerIds.has("apple.com")) return "apple_unavailable";
  return "unsupported";
}

async function reauthenticateWithGoogle(user) {
  configureGoogleSignIn();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  const idToken = await extractGoogleIdTokenFromSignInResponse(response, {
    getTokens: () => GoogleSignin.getTokens(),
    cancelledCode: "GOOGLE_REAUTHENTICATION_CANCELLED",
    cancelledMessage: "Google sign-in confirmation was cancelled.",
  });

  const credential = GoogleAuthProvider.credential(idToken);
  await reauthenticateWithCredential(user, credential);
  return { method: "google" };
}

export async function reauthenticateForAccountDeletion(user, options = {}) {
  if (!user) throw new Error("Sign in before deleting your account.");

  const method = await getAccountDeletionReauthenticationMethod(user);
  if (method === "apple") {
    const result = await reauthenticateWithApple(user);
    const appleLinkResult = await tryLinkAppleAuthorizationToBackend({
      user: result.user,
      authorizationCode: result.authorizationCode,
    });
    return { method, appleLinkResult };
  }

  if (method === "google") {
    return reauthenticateWithGoogle(user);
  }

  if (method === "password") {
    const password = String(options.password || "");
    if (!password) {
      const error = new Error("Enter your password to confirm account deletion.");
      error.code = "PASSWORD_REAUTHENTICATION_REQUIRED";
      throw error;
    }
    const email = String(user.email || "").trim();
    if (!email) throw new Error("This account does not have a sign-in email.");
    await reauthenticateWithCredential(
      user,
      EmailAuthProvider.credential(email, password)
    );
    return { method };
  }

  if (method === "apple_unavailable") {
    const error = new Error(
      "Apple confirmation is not available on this device. Sign out and sign in again on an Apple device, then delete the account from Settings."
    );
    error.code = "APPLE_REAUTHENTICATION_UNAVAILABLE";
    throw error;
  }

  const error = new Error(
    "This sign-in method cannot be confirmed in the app. Sign out, sign in again, and retry."
  );
  error.code = "UNSUPPORTED_REAUTHENTICATION_PROVIDER";
  throw error;
}
