import assert from "node:assert/strict";
import test from "node:test";

import { resolveAiProvider } from "../api/aiProviderPolicy.js";

test("Apple Intelligence selections remain on the on-device provider", () => {
  assert.equal(resolveAiProvider("apple", false), "apple");
  assert.equal(resolveAiProvider("apple", true), "apple");
});

test("supported AI providers and legacy custom settings remain intact", () => {
  assert.equal(resolveAiProvider("pantrio", false), "pantrio");
  assert.equal(resolveAiProvider("custom", false), "custom");
  assert.equal(resolveAiProvider(undefined, true), "custom");
  assert.equal(resolveAiProvider("unknown", false), "pantrio");
});
