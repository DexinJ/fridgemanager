import assert from "node:assert/strict";
import test from "node:test";
import { extractGoogleIdTokenFromSignInResponse } from "../auth/googleSignInResponse.js";

test("extracts the Google Sign-In v16 success token without a cache read", async () => {
  let cacheReads = 0;
  const token = await extractGoogleIdTokenFromSignInResponse(
    { type: "success", data: { idToken: "interactive-token" } },
    {
      getTokens: async () => {
        cacheReads += 1;
        return { idToken: "cached-token" };
      },
    }
  );

  assert.equal(token, "interactive-token");
  assert.equal(cacheReads, 0);
});

test("never falls back to a cached Google token after cancellation", async () => {
  let cacheReads = 0;

  await assert.rejects(
    extractGoogleIdTokenFromSignInResponse(
      { type: "cancelled", data: null },
      {
        getTokens: async () => {
          cacheReads += 1;
          return { idToken: "previous-user-token" };
        },
      }
    ),
    { code: "GOOGLE_SIGN_IN_CANCELLED" }
  );

  assert.equal(cacheReads, 0);
});

test("uses getTokens only when a successful v16 response omits its token", async () => {
  let cacheReads = 0;
  const token = await extractGoogleIdTokenFromSignInResponse(
    { type: "success", data: { idToken: null } },
    {
      getTokens: async () => {
        cacheReads += 1;
        return { idToken: "successful-account-token" };
      },
    }
  );

  assert.equal(token, "successful-account-token");
  assert.equal(cacheReads, 1);
});

test("rejects unknown responses without consulting the native token cache", async () => {
  let cacheReads = 0;

  await assert.rejects(
    extractGoogleIdTokenFromSignInResponse(
      { type: "unexpected", data: null },
      {
        getTokens: async () => {
          cacheReads += 1;
          return { idToken: "cached-token" };
        },
      }
    ),
    { code: "GOOGLE_SIGN_IN_INVALID_RESPONSE" }
  );

  assert.equal(cacheReads, 0);
});

test("retains compatibility with the pre-v16 direct token response", async () => {
  assert.equal(
    await extractGoogleIdTokenFromSignInResponse({ idToken: "legacy-token" }),
    "legacy-token"
  );
});
