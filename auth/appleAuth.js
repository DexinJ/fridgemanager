import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import {
  OAuthProvider,
  reauthenticateWithCredential,
  signInWithCredential,
} from 'firebase/auth';
import { setAppleLinkState } from '../api/accountLifecycleStorage';
import {
  createBackendResponseError,
  parseBackendResponseText,
} from '../api/backendErrors';
import { API_BASE_URL } from '../api/backendConfig';
import { fetchWithTimeout } from '../api/fetchWithTimeout';
import { auth } from './firebaseClient';

const APPLE_LINK_TIMEOUT_MS = 15000;

async function makeNonce() {
  const randomBytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
 
async function sha256(str) { 
  return await Crypto.digestStringAsync( 
    Crypto.CryptoDigestAlgorithm.SHA256,
    str 
  );
} 

/**
 * Give the backend Apple's short-lived, single-use authorization code so it
 * can retain the server-side credential needed for account-deletion
 * revocation. Never persist or log the authorization code in the client.
 */
export async function linkAppleAuthorizationToBackend({
  user,
  authorizationCode,
}) {
  const code = String(authorizationCode || '').trim();
  if (!user?.getIdToken) {
    const error = new Error('A Firebase user is required to link Apple Sign In.');
    error.code = 'APPLE_FIREBASE_USER_MISSING';
    throw error;
  }
  if (!code) {
    const error = new Error('Apple did not return an authorization code.');
    error.code = 'APPLE_AUTHORIZATION_CODE_MISSING';
    throw error;
  }

  const firebaseIdToken = await user.getIdToken();
  const response = await fetchWithTimeout(
    `${API_BASE_URL}/api/auth/apple/link`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${firebaseIdToken}`,
      },
      body: JSON.stringify({ authorizationCode: code }),
    },
    {
      timeoutMs: APPLE_LINK_TIMEOUT_MS,
      timeoutMessage:
        'Linking Sign in with Apple to your account timed out.',
    }
  );
  const responseText = await response.text().catch(() => '');
  const payload = parseBackendResponseText(responseText) || {};

  if (!response.ok) {
    throw createBackendResponseError(payload, {
      status: response.status,
      fallbackMessage: 'Could not link Sign in with Apple to your account.',
    });
  }

  return payload;
}

/**
 * Apple credential capture strengthens later account deletion, but a temporary
 * backend failure must not undo an otherwise successful Firebase sign-in.
 */
export async function tryLinkAppleAuthorizationToBackend(options) {
  try {
    const payload = await linkAppleAuthorizationToBackend(options);
    await setAppleLinkState(options?.user?.uid, { status: 'linked' }).catch(
      () => {}
    );
    return { ok: true, payload };
  } catch (error) {
    // Log only stable metadata. The authorization code and backend payload may
    // contain authentication material and must never be written to logs.
    console.warn('[apple auth] authorization link warning', {
      name: String(error?.name || 'Error'),
      code: error?.code ? String(error.code) : null,
      status: Number.isFinite(error?.status) ? error.status : null,
    });
    if (options?.user?.uid) {
      await setAppleLinkState(options.user.uid, {
        status: 'relink_required',
        code: error?.code || null,
        httpStatus: error?.status,
      }).catch(() => {});
    }
    return {
      ok: false,
      code: error?.code || null,
      status: error?.status || null,
    };
  }
}

async function createAppleFirebaseCredential() {
  const rawNonce = await makeNonce();
  const hashedNonce = await sha256(rawNonce);

  const appleCredential = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });

  if (!appleCredential.identityToken) {
    throw new Error('Apple Sign In failed: no identity token returned.');
  }

  const provider = new OAuthProvider('apple.com');

  const firebaseCredential = provider.credential({
    idToken: appleCredential.identityToken,
    rawNonce, // MUST be raw (not hashed)
  });

  return { appleCredential, firebaseCredential };
}

export async function signInWithApple() {
  const { appleCredential, firebaseCredential } =
    await createAppleFirebaseCredential();

  const userCred = await signInWithCredential(auth, firebaseCredential);

  return {
    user: userCred.user,
    appleCredential,
    // Preserve the complete credential for existing callers while making the
    // short-lived code explicit for backend account-linking/provisioning flows.
    authorizationCode: appleCredential.authorizationCode || null,
  };
}

export async function reauthenticateWithApple(user) {
  if (!user) {
    const error = new Error('Sign in before reauthenticating with Apple.');
    error.code = 'AUTH_REQUIRED';
    throw error;
  }

  const { appleCredential, firebaseCredential } =
    await createAppleFirebaseCredential();
  const userCred = await reauthenticateWithCredential(user, firebaseCredential);

  return {
    user: userCred.user,
    appleCredential,
    authorizationCode: appleCredential.authorizationCode || null,
  };
}
