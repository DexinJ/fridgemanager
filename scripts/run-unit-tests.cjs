const { readdirSync } = require("node:fs");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");

const nodeMajor = Number(process.versions.node.split(".")[0]);
const testFiles = readdirSync(join(process.cwd(), "tests"))
  .filter((name) => name.endsWith(".test.js"))
  .map((name) => join("tests", name));
const moduleModeArgs =
  nodeMajor >= 24
    ? ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"]
    : ["--experimental-default-type=module"];
const result = spawnSync(
  process.execPath,
  [...moduleModeArgs, "--test", ...testFiles],
  { stdio: "inherit" }
);

process.exit(result.status ?? 1);
