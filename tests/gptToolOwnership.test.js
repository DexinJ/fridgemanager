import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

import babel from "@babel/core";
import transformModulesCommonJs from "@babel/plugin-transform-modules-commonjs";

function loadToolOwnershipHelpers() {
  const source = readFileSync(
    new URL("../api/gptTools.js", import.meta.url),
    "utf8"
  );
  const { code } = babel.transformSync(source, {
    filename: "gptTools.js",
    plugins: [transformModulesCommonJs],
  });
  const module = { exports: {} };
  const require = (specifier) => {
    if (specifier === "react") return { useContext: () => ({}) };
    if (specifier === "../context/GlobalContext") {
      return { GlobalContext: {} };
    }
    throw new Error(`Unexpected test import: ${specifier}`);
  };
  vm.runInNewContext(
    `(function (require, module, exports) { ${code}\n})`,
    {},
    { filename: "gptTools.js" }
  )(require, module, module.exports);
  return module.exports;
}

test("mixed legacy batches assign only client tools and claim each ID once", () => {
  const { claimClientOwnedGPTToolCalls } = loadToolOwnershipHelpers();
  const claimedIds = new Set();
  const mixed = [
    { id: "server-search", function: { name: "webSearch" } },
    { id: "client-add", function: { name: "addFridgeItem" } },
  ];

  assert.deepEqual(
    claimClientOwnedGPTToolCalls(mixed, { claimedIds }).map(({ id }) => id),
    ["client-add"]
  );
  assert.deepEqual(
    claimClientOwnedGPTToolCalls(mixed, { claimedIds }).map(({ id }) => id),
    []
  );
  assert.deepEqual(
    claimClientOwnedGPTToolCalls([mixed[1]], {
      toolOwner: "client",
      round: 1,
      claimedIds,
    }).map(({ id }) => id),
    []
  );
});

test("explicit non-client ownership is never executed locally", () => {
  const { claimClientOwnedGPTToolCalls } = loadToolOwnershipHelpers();
  assert.equal(
    claimClientOwnedGPTToolCalls(
      [{ id: "unknown", function: { name: "addFridgeItem" } }],
      { toolOwner: "server" }
    ).length,
    0
  );
});
