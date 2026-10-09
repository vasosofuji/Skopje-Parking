import test from "node:test";
import assert from "node:assert/strict";
import { watchLocation } from "../src/services/location.web";
import {
  canAddAtLocation,
  nearbyOrigin,
  preferFix,
  usableFix,
} from "../src/domain/location";
import type { Fix } from "../src/domain/arrival";
import {
  startBrowserLocation,
  startNativeLocation,
  type NativeLocationAdapter,
  type LocationIssue,
} from "../src/domain/locationWatch";

test("browser GPS requests fresh high accuracy fixes, forwards errors and stops its watch", async () => {
  let success!: PositionCallback,
    failure!: PositionErrorCallback,
    cleared = false;
  const seen: Fix[] = [],
    errors: LocationIssue[] = [];
  const geolocation = {
    watchPosition(
      ok: PositionCallback,
      error: PositionErrorCallback,
      options: PositionOptions,
    ) {
      assert.deepEqual(options, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 30000,
      });
      success = ok;
      failure = error;
      return 42;
    },
    clearWatch(id: number) {
      assert.equal(id, 42);
      cleared = true;
    },
  } as Geolocation;
  const stop = await watchLocation(
    (fix) => seen.push(fix),
    (error) => errors.push(error),
    geolocation,
  );
  const fix = {
    latitude: 52.23,
    longitude: 21.01,
    accuracy: 15,
    speed: 0,
    timestamp: Date.now(),
  };
  success({
    coords: fix,
    timestamp: fix.timestamp,
  } as unknown as GeolocationPosition);
  assert.deepEqual(
    seen,
    [fix],
    "coordinates are preserved even outside Skopje",
  );
  failure({ code: 1 } as GeolocationPositionError);
  assert.deepEqual(
    errors.map((e) => e.code),
    ["blocked"],
  );
  stop();
  assert.equal(cleared, true);
});

test("browser falls back to a network-assisted position after GPS failure and ignores late updates", () => {
  let failWatch!: PositionErrorCallback,
    network!: PositionCallback,
    failNetwork!: PositionErrorCallback;
  const fixes: Fix[] = [],
    issues: LocationIssue[] = [];
  const geo = {
    watchPosition(_ok: PositionCallback, fail: PositionErrorCallback) {
      failWatch = fail;
      return 7;
    },
    clearWatch() {},
    getCurrentPosition(
      ok: PositionCallback,
      fail: PositionErrorCallback,
      options: PositionOptions,
    ) {
      assert.equal(options.enableHighAccuracy, false);
      network = ok;
      failNetwork = fail;
    },
  } as Geolocation;
  const stop = startBrowserLocation(geo, {
    onFix: (f) => fixes.push(f),
    onIssue: (e) => issues.push(e),
  });
  failWatch({ code: 3 } as GeolocationPositionError);
  failNetwork({
    code: 2,
    message: "Provider unavailable",
  } as GeolocationPositionError);
  assert.equal(issues[0].code, "unavailable");
  const position = {
    coords: { latitude: 42, longitude: 21.43, accuracy: 70, speed: 0 },
    timestamp: Date.now(),
  } as GeolocationPosition;
  failWatch({ code: 2 } as GeolocationPositionError);
  network(position);
  assert.equal(fixes.length, 1);
  stop();
  network(position);
  assert.equal(fixes.length, 1);
});

test("insecure browser contexts explain HTTPS instead of starting a failing watch", () => {
  const issues: LocationIssue[] = [];
  startBrowserLocation(
    undefined,
    {
      onFix() {
        assert.fail();
      },
      onIssue: (e) => issues.push(e),
    },
    false,
  )();
  assert.equal(issues[0].code, "insecure");
});

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
test("nearby parking never falls back to Skopje and adding requires a fresh precise stationary fix", () => {
  const now = Date.now(),
    fix: Fix = {
      latitude: 42,
      longitude: 21.43,
      accuracy: 8,
      speed: 0,
      timestamp: now,
    };
  assert.equal(nearbyOrigin(null, null, now), null);
  assert.equal(
    nearbyOrigin(null, { ...fix, timestamp: now - 31000 }, now),
    null,
  );
  assert.equal(nearbyOrigin(null, { ...fix, accuracy: 51 }, now), null);
  assert.deepEqual(nearbyOrigin(null, fix, now), fix);
  const destination = { latitude: 41.99, longitude: 21.42 };
  assert.deepEqual(nearbyOrigin(destination, null, now), destination);
  assert.equal(canAddAtLocation(fix, now), true);
  for (const value of [
    null,
    { ...fix, accuracy: 26 },
    { ...fix, timestamp: now - 31000 },
    { ...fix, speed: 4 },
  ])
    assert.equal(canAddAtLocation(value, now), false);
});
function nativeAdapter(
  overrides: Partial<NativeLocationAdapter> = {},
): NativeLocationAdapter {
  return {
    permission: async () => ({ granted: true, canAskAgain: true }),
    requestPermission: async () => ({ granted: true, canAskAgain: true }),
    servicesEnabled: async () => true,
    cached: async () => null,
    current: async () => ({
      coords: { latitude: 41.99, longitude: 21.43, accuracy: 8, speed: 0 },
      timestamp: Date.now(),
    }),
    watch: async () => ({ remove() {} }),
    ...overrides,
  };
}
test("native GPS requests permission once, starts with a fresh position even when stationary, and removes its watch", async () => {
  const fixes: Fix[] = [];
  let requested = 0,
    removed = false;
  const stop = startNativeLocation(
    nativeAdapter({
      permission: async () => ({ granted: false, canAskAgain: true }),
      requestPermission: async () => {
        requested++;
        return { granted: true, canAskAgain: true };
      },
      watch: async () => ({
        remove() {
          removed = true;
        },
      }),
    }),
    { onFix: (f) => fixes.push(f), onIssue: (e) => assert.fail(e.code) },
  );
  await flush();
  assert.equal(requested, 1);
  assert.equal(fixes[0].accuracy, 8);
  stop();
  assert.equal(removed, true);
});
test("native denied permissions and disabled services are distinct and do not start GPS", async () => {
  for (const blocked of [true, false]) {
    const issues: LocationIssue[] = [];
    const stop = startNativeLocation(
      nativeAdapter({
        permission: async () => ({ granted: !blocked, canAskAgain: false }),
        requestPermission: async () => {
          assert.fail("Do not re-prompt blocked permission");
        },
        servicesEnabled: async () => false,
        current: async () => {
          assert.fail("Do not start GPS without permission/services");
        },
        watch: async () => {
          assert.fail("Do not watch without permission/services");
        },
      }),
      {
        onFix() {
          assert.fail();
        },
        onIssue: (e) => issues.push(e),
      },
    );
    await flush();
    stop();
    assert.equal(issues[0].code, blocked ? "blocked" : "services-off");
  }
});
test("Android can enable location services and a cancelled permission request never starts a watch", async () => {
  let enabled = false,
    count = 0;
  const stop = startNativeLocation(
    nativeAdapter({
      servicesEnabled: async () => enabled,
      enableServices: async () => {
        enabled = true;
      },
      watch: async () => {
        count++;
        return { remove() {} };
      },
    }),
    { onFix() {}, onIssue: (e) => assert.fail(e.code) },
  );
  await flush();
  stop();
  assert.equal(enabled, true);
  assert.equal(count, 1);
  let grant!: (v: { granted: boolean; canAskAgain: boolean }) => void;
  const cancel = startNativeLocation(
    nativeAdapter({
      permission: () =>
        new Promise((resolve) => {
          grant = resolve;
        }),
      watch: async () => {
        assert.fail("Cancelled mount must not start a watch");
      },
    }),
    {
      onFix() {
        assert.fail();
      },
      onIssue() {
        assert.fail();
      },
    },
  );
  cancel();
  grant({ granted: true, canAskAgain: true });
  await flush();
});

test("location rejects stale/invalid readings and prefers a precise fix over recent coarse drift", () => {
  const now = Date.now(),
    fix: Fix = {
      latitude: 41.99,
      longitude: 21.43,
      accuracy: 15,
      speed: 0,
      timestamp: now,
    };
  assert.equal(usableFix(fix, now), true);
  for (const bad of [
    { timestamp: now - 31000 },
    { timestamp: now + 6000 },
    { latitude: NaN },
    { longitude: 190 },
    { accuracy: -1 },
    { accuracy: null },
  ])
    assert.equal(usableFix({ ...fix, ...bad }, now), false);
  assert.equal(
    preferFix(fix, { ...fix, accuracy: 5000, timestamp: now + 1000 }),
    false,
  );
  assert.equal(
    preferFix({ ...fix, accuracy: 5000 }, { ...fix, timestamp: now + 1000 }),
    true,
  );
  assert.equal(preferFix(fix, { ...fix, timestamp: now - 1 }), false);
  assert.equal(
    preferFix(fix, { ...fix, accuracy: 5000, timestamp: now + 21000 }),
    true,
  );
  assert.equal(preferFix(fix, { ...fix, longitude: 21.431, accuracy: 180, speed: 12, timestamp: now + 1000 }), true, "ordinary driving fixes stay live despite reduced accuracy");
  assert.equal(preferFix(fix, { ...fix, longitude: 21.43002, accuracy: 110, speed: 1.2, timestamp: now + 1000 }), true, "walking movement is not frozen by the previous precise reading");
  assert.equal(preferFix(fix, { ...fix, accuracy: 5000, timestamp: now + 5000 }), true, "coarse fallback is shown as approximate after at most five seconds");
  assert.equal(preferFix(fix, fix), false, "duplicate cached/watch events do not rerender the marker");
  assert.equal(preferFix(fix, { ...fix, accuracy: 5 }), true, "accuracy improvements with the same timestamp are accepted");
  // ~1.1 km in 2 s with tight accuracy circles is a multipath jump, not a car.
  assert.equal(preferFix(fix, { ...fix, latitude: 42.0, accuracy: 10, timestamp: now + 2000 }), false);
  assert.equal(preferFix(fix, { ...fix, latitude: 42.0, accuracy: 10, timestamp: now + 10000 }), true, "after a gap (tunnel, garage) any fix is accepted");
  assert.equal(preferFix(fix, { ...fix, latitude: 41.9909, accuracy: 10, speed: 22, timestamp: now + 2000 }), true, "100 m in 2 s at 80 km/h is real driving");
});

test("Android approximate-only permission is reported so the driver can switch to precise", async () => {
  const precision: boolean[] = [];
  const stop = startNativeLocation(nativeAdapter({ permission: async () => ({ granted: true, canAskAgain: true, android: { accuracy: "coarse" } }) }),
    { onFix: () => {}, onIssue: e => assert.fail(e.code), onPrecision: value => precision.push(value) });
  await flush();
  assert.deepEqual(precision, [false]);
  stop();
  const precise: boolean[] = [];
  const again = startNativeLocation(nativeAdapter({ permission: async () => ({ granted: true, canAskAgain: true, android: { accuracy: "fine" } }) }),
    { onFix: () => {}, onIssue: e => assert.fail(e.code), onPrecision: value => precise.push(value) });
  await flush();
  assert.deepEqual(precise, [true]);
  again();
});
