import test from "node:test";
import assert from "node:assert/strict";
import { completeOnboarding, hasCurrentTerms, initialOnboardingStep, type OnboardingIntent } from "../src/domain/onboarding";
import { TERMS_VERSION } from "../src/domain/account";

function accountActions() {
  const calls: unknown[][] = [];
  return {
    calls,
    guest: async (accepted: boolean) => { calls.push(["guest", accepted]); },
    register: async (username: string, accepted: boolean, password: string) => { calls.push(["create", username, accepted, password]); },
    login: async (username: string, password: string, accepted: boolean) => { calls.push(["login", username, password, accepted]); },
  };
}

test("first launch starts with language while later sign-ins keep saved preferences", () => {
  assert.equal(initialOnboardingStep(null), "language");
  assert.equal(initialOnboardingStep("corrupt"), "language");
  assert.equal(initialOnboardingStep("1"), "account");
});
test("cached profiles with stale Terms cannot enter the app before renewing consent", () => {
  assert.equal(hasCurrentTerms(null), false);
  assert.equal(hasCurrentTerms({ termsVersion: "old" }), false);
  assert.equal(hasCurrentTerms({ termsVersion: TERMS_VERSION }), true);
});

test("guest and registration require explicit Terms acceptance", async () => {
  const actions = accountActions();
  const choices: OnboardingIntent[] = [
    { mode: "guest" },
    { mode: "create", username: "driver", password: "Safe sample 123" },
  ];
  for (const choice of choices) await assert.rejects(completeOnboarding(choice, false, actions), /Terms/);
  assert.deepEqual(actions.calls, []);
});

test("returning users sign in without repeating or silently renewing consent", async () => {
  const actions = accountActions();
  await completeOnboarding({ mode: "login", username: "driver", password: "Safe sample 123" }, false, actions);
  assert.deepEqual(actions.calls, [["login", "driver", "Safe sample 123", false]]);
  assert.equal(hasCurrentTerms({ termsVersion: TERMS_VERSION }), true);
  assert.equal(hasCurrentTerms({ termsVersion: "old" }), false);
});

test("guest entry needs no invented username or password", async () => {
  const actions = accountActions();
  await completeOnboarding({ mode: "guest" }, true, actions);
  assert.deepEqual(actions.calls, [["guest", true]]);
});

test("credentials normalize the username without modifying the password", async () => {
  const actions = accountActions();
  const password = "  Safe sample 123  ";
  await completeOnboarding({ mode: "create", username: "  Ｄriver_1  ", password }, true, actions);
  await completeOnboarding({ mode: "login", username: "  Ｄriver_1  ", password }, true, actions);
  assert.deepEqual(actions.calls, [["create", "Driver_1", true, password], ["login", "Driver_1", password, true]]);
});

test("invalid credential input does not send authentication requests", async () => {
  const actions = accountActions();
  await assert.rejects(completeOnboarding({ mode: "create", username: "<script>", password: "Safe sample 123" }, true, actions), /username/);
  await assert.rejects(completeOnboarding({ mode: "create", username: "driver", password: "short" }, true, actions), /password/);
  await assert.rejects(completeOnboarding({ mode: "login", username: "driver", password: "" }, true, actions), /password/);
  await assert.rejects(completeOnboarding({ mode: "login", username: "driver", password: "a".repeat(129) }, true, actions), /password/);
  assert.deepEqual(actions.calls, []);
});
