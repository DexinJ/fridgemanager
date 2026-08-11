import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { shouldClearLegacyOwnedData } = require("../api/legacyPurgePolicy.cjs");

test("fallback purge removes ownerless or matching legacy data", () => {
  assert.equal(shouldClearLegacyOwnedData(null, "firebase-user"), true);
  assert.equal(shouldClearLegacyOwnedData("", "firebase-user"), true);
  assert.equal(
    shouldClearLegacyOwnedData("firebase-user", "firebase-user"),
    true
  );
});

test("fallback purge preserves legacy data explicitly owned by another user", () => {
  assert.equal(
    shouldClearLegacyOwnedData("different-user", "firebase-user"),
    false
  );
});
