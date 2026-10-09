import test from "node:test";
import assert from "node:assert/strict";
import { createRefreshCoordinator } from "../src/domain/refresh-coordinator";
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
test("overlapping ordinary catalog polls use one request", async () => {
  let calls = 0, release!: () => void;
  const refresh = createRefreshCoordinator(async () => { calls++; await new Promise<void>(resolve => { release = resolve; }); });
  const first = refresh();
  await flush();
  assert.equal(refresh(), first); assert.equal(refresh(), first);
  release(); await first;
  assert.equal(calls, 1);
});
test("writes arriving during a poll trigger one newer read and callers await it", async () => {
  let calls = 0;
  const releases: (() => void)[] = [];
  const refresh = createRefreshCoordinator(async () => { calls++; await new Promise<void>(resolve => { releases.push(resolve); }); });
  const initial = refresh(); await flush();
  const firstWrite = refresh(true), secondWrite = refresh(true);
  releases[0](); await flush();
  assert.equal(calls, 2);
  releases[1](); await Promise.all([initial, firstWrite, secondWrite]);
  assert.equal(calls, 2);
});
test("a failed poll does not poison future refreshes", async () => {
  let calls = 0;
  const refresh = createRefreshCoordinator(async () => { if (++calls === 1) throw new Error("offline"); });
  await assert.rejects(refresh(), /offline/);
  await refresh();
  assert.equal(calls, 2);
});

test("recent foreground polls reuse fresh data but mutation refreshes bypass freshness", async () => {
  let clock = 1000, calls = 0;
  const refresh = createRefreshCoordinator(async () => { calls++; }, 25000, () => clock);
  await refresh(); await refresh(); assert.equal(calls, 1);
  await refresh(true); assert.equal(calls, 2);
  clock += 25000; await refresh(); assert.equal(calls, 3);
});
