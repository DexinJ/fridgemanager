import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL(
    "../modules/apple-subscriptions/ios/AppleSubscriptionsModule.swift",
    import.meta.url
  ),
  "utf8"
);

test("routine StoreKit snapshots enumerate current entitlements, not all history", () => {
  assert.match(
    source,
    /else\s*\{[\s\S]*?StoreKit\.Transaction\.currentEntitlements[\s\S]*?discovery\.include/
  );
});

test("only explicit restore snapshots request full StoreKit history", () => {
  assert.match(
    source,
    /restorePurchases[\s\S]*?makeSnapshot\(\s*productIDs: normalizedIDs,\s*includeTransactionHistory: true/
  );
  assert.match(
    source,
    /if includeTransactionHistory\s*\{[\s\S]*?StoreKit\.Transaction\.all[\s\S]*?discovery\.include/
  );
  assert.equal(
    [...source.matchAll(/StoreKit\.Transaction\.all/g)].length,
    1
  );
});
