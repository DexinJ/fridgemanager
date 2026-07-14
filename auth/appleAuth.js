import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { OAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from './firebaseClient';

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

export async function signInWithApple() {
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

  const userCred = await signInWithCredential(auth, firebaseCredential);

  return {
    user: userCred.user,
    appleCredential,
  };
}