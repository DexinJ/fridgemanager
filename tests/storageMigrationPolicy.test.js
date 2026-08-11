import assert from "node:assert/strict";
import test from "node:test";

import { canMigrateLegacyProviderCredentials } from "../utils/migrations.js";

test("legacy provider credentials move only after authoritative settings load", () => {
  assert.equal(
    canMigrateLegacyProviderCredentials({
      settingsReadStatus: "fulfilled",
      settingsLoadError: null,
    }),
    true
  );
  assert.equal(
    canMigrateLegacyProviderCredentials({
      settingsReadStatus: "rejected",
      settingsLoadError: new Error("temporary read failure"),
    }),
    false
  );
  assert.equal(
    canMigrateLegacyProviderCredentials({
      settingsReadStatus: "fulfilled",
      settingsLoadError: new Error("malformed settings"),
    }),
    false
  );
});
