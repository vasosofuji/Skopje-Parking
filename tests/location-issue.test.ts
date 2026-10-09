import test from "node:test";
import assert from "node:assert/strict";
import { classifyLocationError, locationIssueAdvice, locationIssueTitle } from "../src/domain/locationIssue";
import { startNativeLocation, type LocationIssue } from "../src/domain/locationWatch";

test("provider errors retain their specific reason and map to actionable failure categories", () => {
  const cases = [
    [{ code: "E_LOCATION_UNAUTHORIZED", message: "Permission denied" }, "blocked"],
    [new Error("Location services are disabled"), "services-off"],
    [new Error("Location request timed out"), "timeout"],
    ["GPS provider unavailable", "unavailable"],
  ] as const;
  for (const [error, code] of cases) {
    const issue = classifyLocationError(error);
    assert.equal(issue.code, code);
    assert.ok(issue.detail);
    assert.ok(locationIssueTitle(issue, en => en).length);
  }
  assert.match(locationIssueAdvice({ code: "timeout" }, false, en => en), /timed out/);
  assert.match(locationIssueAdvice({ code: "unsupported" }, true, en => en), /supported browser/);
  assert.match(locationIssueAdvice({ code: "blocked" }, true, en => en), /site settings/);
  assert.match(locationIssueAdvice({ code: "denied" }, false, en => en), /Try again/);
});

test("native permission API failures preserve useful details instead of becoming unknown GPS failures", async () => {
  const issues: LocationIssue[] = [];
  const stop = startNativeLocation({
    permission: async () => { throw { code: "E_LOCATION_UNAUTHORIZED", message: "Location permission is denied" }; },
    requestPermission: async () => { assert.fail(); }, servicesEnabled: async () => { assert.fail(); },
    cached: async () => { assert.fail(); }, current: async () => { assert.fail(); }, watch: async () => { assert.fail(); },
  }, { onFix: () => assert.fail(), onIssue: issue => issues.push(issue) });
  await new Promise<void>(yes => setImmediate(yes)); stop();
  assert.deepEqual(issues, [{ code: "blocked", detail: "Location permission is denied" }]);
});
