# Independent map v3 review

Reviewer: progressive-entry/loading agent. Read-only review of map owner changes; fixes remain with that owner. Source, installed native dependency behavior and focused domain tests were inspected. This is not a substitute for the root agent's device review.

## Findings sent to owner and root

1. **P2 — Long preview cards become invisible.** The scroll viewport maximum was `mapHeight - drawerHeight - 48`. Adding the enclosing card's 24px vertical padding and 2px border produces a card 22px shorter than the available map. The visibility helper requires 24px clearance. A long sign/name/error that fills the scroll viewport therefore fails visibility by 2px and remains opacity zero with pointer events disabled. Reduce the viewport allowance and cover the maximum-height measurement.
2. **P2 — Offline expiry does not update Leaflet markers.** Context advances `now` every 30 seconds even when catalog requests fail, but native Leaflet's memoized payload and web Leaflet's overlay effect had no clock dependency. Their availability colors, free-price badges and grouping can remain stale indefinitely until another map action. Thread the context clock through renderers and grouping while keeping one-second GPS changes out of overlay dependencies.
3. **P2 — A rejected old Google projection clears a newer selection.** The fulfilled `pointForCoordinate` path checks request version and selected ID; the rejected path originally cleared without either guard. Project A, then B, resolve B and reject A: B disappears until a future projection. Guard both outcomes and verify the delayed rejection case.
4. **P2 — Polygon taps are treated as blank taps.** The new map press handler excluded only `marker-press`. Installed `react-native-maps` Android `MapView.java` dispatches a polygon press first to the polygon and then to the map with `action: polygon-press`. Apple MapKit also dispatches a map press afterward, without an action tag. A footprint/zone thus selects and immediately clears. Ignore handled Android overlay actions and consume the matching Apple coordinate pair without swallowing unrelated subsequent taps.

## Positive checks

- Marker semantics are centralized across all renderers. Free price requires pricing evidence; recent spaces/full remain distinct and expire in the domain helper. Unknown imported data retains a question-mark cue even if availability is reported. Unconfirmed AI drafts cannot establish a free-price marker.
- Earned accents alter only the outer border. Selected outlines are additional, and clusters do not inherit one member's reward border or pretend to be free/available.
- Native and web Leaflet keep GPS overlays separate, so one-second fixes move the existing user dot without rebuilding parking markers or triggering catalog requests.
- Blank-map handling blurs the input, dismisses the keyboard, invalidates pending search and clears selection. Leaflet area handlers stop propagation and markers use the library's non-bubbling default.
- Preview measurement starts hidden and inaccessible, then becomes interactive only after measured and in-bounds. The long-card clearance issue above is the outstanding sizing defect.
- Native Leaflet position messages include selected ID; Google successful projections have a version guard. The stale rejection issue above is the outstanding confirmed asynchronous defect.

## Repair review

The map owner repaired all four findings. Preview viewport clearance is now 56px, with a test including real padding and border. An explicit context clock feeds all marker renderers and cluster calculations, including Leaflet memo/effect dependencies. Google projection failures have the same version/selection guard as successful results. The overlay tap gate consumes recognized Android actions or the matching Apple coordinate within 400ms, once only; tests cover later/different blank taps. Native Leaflet projection messages now include the anchor as well as selected ID.

Follow-up source review found no remaining blocker. Google rejection-race behavior is verified by source inspection; an executable component regression test was recommended to the owner. Actual native interaction and long-card visual checks remain part of root's device verification.

## Validation

Seven marker/layout tests and two executed Leaflet-bridge tests pass after repair. Combined with loading/navigation checks, 21 focused tests pass. Full Expo lint and TypeScript also passed before map-owner repairs; root/map owner are running the final integrated checks.
