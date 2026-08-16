import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

import babel from "@babel/core";
import transformModulesCommonJs from "@babel/plugin-transform-modules-commonjs";

function loadAppleIntelligence({ platform = "ios", nativeModule, nativeError } = {}) {
  const source = readFileSync(
    new URL("../modules/apple-intelligence/src/index.js", import.meta.url),
    "utf8"
  );
  const { code } = babel.transformSync(source, {
    filename: "modules/apple-intelligence/src/index.js",
    plugins: [transformModulesCommonJs],
  });
  const module = { exports: {} };
  const nativeLoads = [];
  const require = (specifier) => {
    if (specifier === "react-native") {
      return { Platform: { OS: platform } };
    }
    if (specifier === "expo-modules-core") {
      return {
        requireNativeModule(name) {
          nativeLoads.push(name);
          if (nativeError) throw nativeError;
          return nativeModule;
        },
      };
    }
    throw new Error(`Unexpected test import: ${specifier}`);
  };

  vm.runInNewContext(
    `(function (require, module, exports) { ${code}\n})`,
    { console },
    { filename: "modules/apple-intelligence/src/index.js" }
  )(require, module, module.exports);

  return { api: module.exports, nativeLoads };
}

test("Apple Intelligence stays lazy and unavailable off iOS", async () => {
  const { api, nativeLoads } = loadAppleIntelligence({ platform: "web" });

  assert.deepEqual(
    JSON.parse(JSON.stringify(await api.getAppleIntelligenceAvailability())),
    {
      status: "unsupported_platform",
      available: false,
      reason: "Apple Intelligence is only available on supported Apple devices.",
    }
  );
  assert.deepEqual(nativeLoads, []);
  await assert.rejects(
    api.generateAppleIntelligenceToolTurn("instructions", "prompt"),
    /only available on iOS/i
  );
  assert.deepEqual(nativeLoads, []);
});

test("Apple Intelligence forwards availability, settings, and tool turns on iOS", async () => {
  const calls = [];
  const nativeModule = {
    async getAvailability() {
      return { status: "available", available: true, reason: "Ready" };
    },
    async openSettings() {
      calls.push(["openSettings"]);
      return true;
    },
    async generateToolTurn(instructions, prompt) {
      calls.push(["generateToolTurn", instructions, prompt]);
      return { type: "final", name: "", arguments: "{}", text: "Done" };
    },
  };
  const { api, nativeLoads } = loadAppleIntelligence({ nativeModule });

  assert.deepEqual(
    JSON.parse(JSON.stringify(await api.getAppleIntelligenceAvailability())),
    { status: "available", available: true, reason: "Ready" }
  );
  assert.equal(await api.openAppleIntelligenceSettings(), true);
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        await api.generateAppleIntelligenceToolTurn("instructions", "prompt")
      )
    ),
    { type: "final", name: "", arguments: "{}", text: "Done" }
  );
  assert.deepEqual(nativeLoads, ["AppleIntelligence"]);
  assert.deepEqual(calls, [
    ["openSettings"],
    ["generateToolTurn", "instructions", "prompt"],
  ]);
});

test("missing native Apple Intelligence module reports a development-build requirement", async () => {
  const { api } = loadAppleIntelligence({
    nativeError: new Error("Native module is unavailable"),
  });

  assert.deepEqual(
    JSON.parse(JSON.stringify(await api.getAppleIntelligenceAvailability())),
    {
      status: "development_build_required",
      available: false,
      reason:
        "Apple Intelligence requires an iOS development or App Store build; it is not available in Expo Go.",
    }
  );
});
