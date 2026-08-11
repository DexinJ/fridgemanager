import assert from "node:assert/strict";
import test from "node:test";
import { createLatestTaskQueue } from "../utils/latestTaskQueue.js";

test("invalidation runs after active work and supersedes queued stale work", async () => {
  const queue = createLatestTaskQueue();
  const events = [];
  let releaseActive;
  let markActiveStarted;
  const activeGate = new Promise((resolve) => {
    releaseActive = resolve;
  });
  const activeStarted = new Promise((resolve) => {
    markActiveStarted = resolve;
  });

  const active = queue.runLatest(async () => {
    events.push("active-start");
    markActiveStarted();
    await activeGate;
    events.push("active-end");
  });
  await activeStarted;
  const stale = queue.runLatest(
    async () => events.push("stale"),
    { supersededValue: "superseded" }
  );
  const cancellation = queue.invalidateAndRun(async () => {
    events.push("cancel");
  });
  releaseActive();

  await active;
  assert.equal(await stale, "superseded");
  await cancellation;
  assert.deepEqual(events, ["active-start", "active-end", "cancel"]);
});

test("only the newest queued task executes", async () => {
  const queue = createLatestTaskQueue();
  const first = queue.runLatest(async () => "first", {
    supersededValue: "superseded",
  });
  const second = queue.runLatest(async () => "second");
  assert.equal(await first, "superseded");
  assert.equal(await second, "second");
});
