import test from "node:test";
import assert from "node:assert/strict";
import { createReminderWatch } from "../src/domain/reminderWatch";

test("concurrent browser resumes create one location watcher", async () => {
  let starts = 0;
  const watcher = createReminderWatch(async () => true, () => ++starts, () => {});
  await Promise.all([watcher.resume(), watcher.resume(), watcher.resume()]);
  assert.equal(starts, 1);
  assert.equal(watcher.running(), true);
});
test("opt-out during storage check cannot create an orphan location watcher", async () => {
  let allow!: (enabled: boolean) => void, starts = 0;
  const watcher = createReminderWatch(() => new Promise(resolve => { allow = resolve; }), () => ++starts, () => {});
  const pending = watcher.resume();
  watcher.stop();
  allow(true);
  await pending;
  assert.equal(starts, 0);
  assert.equal(watcher.running(), false);
});
test("stop clears an active watcher once", async () => {
  const removed: number[] = [];
  const watcher = createReminderWatch(async () => true, () => 42, id => removed.push(id));
  await watcher.resume();
  watcher.stop(); watcher.stop();
  assert.deepEqual(removed, [42]);
});
