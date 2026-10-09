# Parking popup entrance motion

## Plan and scope

- Add a subtle 200ms fade, 8px upward settle and scale from 0.97 to 1 to ParkingPreview using existing React Native Animated. Animate only opacity/transforms; preserve layout measurement and card anchoring.
- Wait for both the first valid layout/projection and the Reduce Motion result before exposing the popup, avoiding a static first frame followed by an animation. If accessibility lookup fails, show the still version. Live Reduce Motion changes finish an active entrance immediately.
- Animate once per selected popup. Coordinate updates do not restart it; temporarily missing projections hide it without remounting. Rapid selection changes unmount/cancel the old animation and accessibility read.
- Parent owns the one-line MapScreen condition change retaining the keyed popup while selectedPoint is null. This task owns the nullable-point behavior in ParkingPreview and the dedicated animation hook/tests only.
- Add component/hook lifecycle coverage for first measurement, delayed accessibility hydration, reduced motion, coordinate/projection changes and rapid unmount. Run focused tests, Expo lint and TypeScript. No build, commit or push; phone is disconnected.

## Documentation

Read AGENTS.md and package.json (`expo ~57.0.26`, React Native 0.86.3), Expo SDK57 reference, Expo llms index and animation guide, and React Native 0.86 Animated/AccessibilityInfo. No dependency or native configuration change is needed.

## Implementation / validation

`useParkingPopupMotion` uses a stable Animated value and a once-per-mount entrance flag. It waits for accessibility hydration and the existing card measurement/projection gate, so the first displayed frame begins at the fade's start. The popup remains noninteractive and hidden from accessibility while projection, measurement or accessibility lookup is pending. Lookup failure selects the still version. Live Reduce Motion events override stale initial reads and finish any running entrance.

ParkingPreview accepts a nullable projection and retains its measured layout while the map moves. Parent changed the MapScreen render condition to preserve the keyed popup during that temporary null projection. Coordinate updates do not enter the motion effect; hiding an already-entered popup stops and settles the animation so the next projection appears without replay. A different selection unmounts the old value/subscription and starts a fresh popup.

Six actual-component/hook tests pass: delayed lookup and measurement, null/changed projections without replay, still mode and stale reads, motion changes mid-animation, rapid selection unmount and failed lookup, and native/web driver cleanup. Full Expo lint and TypeScript pass. An expanded map regression run passed popup/marker/Google/keyboard cases but initially hit missing `map.stop` in the concurrently edited map-bridge test harness; reported to the camera owner without changing their files. Independent popup review by the entry agent approved the source and reran all six tests successfully. The reviewer separately asked parent to clear the old projection on same-place/new-anchor taps while retaining the component key. Final integrated map tests belong to parent/camera owner. No device test was attempted because the phone is disconnected; no build, commit or push was performed by this agent.
