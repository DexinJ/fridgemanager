import assert from "node:assert/strict";
import test from "node:test";
import {
  canExposeAccountData,
  isRefreshFresh,
  orderedStringListKey,
  productCatalogCoversIds,
} from "../context/refreshPolicy.js";

test("account data stays unmounted until session access is confirmed", () => {
  assert.equal(canExposeAccountData(null, false), false);
  assert.equal(canExposeAccountData({ user: { uid: "user-1" } }, true), false);
  assert.equal(canExposeAccountData({ user: { uid: "user-1" } }, false), true);
});

test("catalog keys distinguish only meaningful ordered ID changes", () => {
  assert.equal(
    orderedStringListKey(["monthly", "yearly"]),
    orderedStringListKey(["monthly", "yearly"])
  );
  assert.notEqual(
    orderedStringListKey(["monthly", "yearly"]),
    orderedStringListKey(["yearly", "monthly"])
  );
  assert.notEqual(orderedStringListKey(["monthly"]), orderedStringListKey([]));
});

test("refresh freshness uses a strict bounded age window", () => {
  assert.equal(isRefreshFresh(1_000, 30_000, 30_999), true);
  assert.equal(isRefreshFresh(1_000, 30_000, 31_000), false);
  assert.equal(isRefreshFresh(0, 30_000, 1_001), false);
  assert.equal(isRefreshFresh(2_000, 30_000, 1_000), false);
  assert.equal(isRefreshFresh(1_000, 0, 1_001), false);
});

test("only complete product responses are safe to reuse", () => {
  assert.equal(
    productCatalogCoversIds(
      [{ productId: "monthly" }, { productId: "yearly" }],
      ["monthly", "yearly"]
    ),
    true
  );
  assert.equal(
    productCatalogCoversIds([{ productId: "monthly" }], ["monthly", "yearly"]),
    false
  );
  assert.equal(productCatalogCoversIds([], ["monthly"]), false);
});
