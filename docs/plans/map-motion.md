# Smooth map camera motion

## Plan and scope

Own the native Leaflet HTML, web Leaflet map, react-native-maps renderer and focused regressions. Make selection, cluster expansion and destination/recenter changes use short, interruptible camera transitions. Keep initial presentation immediate, avoid catalog/GPS refreshes replaying movement, and retain drawing, keyboard and projection safeguards. Respect OS/browser reduced motion with immediate movement. No dependency, build, commit or push work; the phone is unavailable.

## API evidence

Reviewed current sources and the installed Leaflet 1.9.4/react-native-maps 1.27.2 APIs. [Leaflet flyTo/stop](https://leafletjs.com/reference.html#map-flyto) supplies cancellable pan/zoom; [React Native accessibility](https://reactnative.dev/docs/0.86/accessibilityinfo) supplies reduced-motion state/events. [Native MapView methods](https://github.com/react-native-maps/react-native-maps/blob/v1.27.2/docs/mapview.md#methods) note animation duration is not honored on iOS, so reduced motion must use a genuinely nonanimated operation. Browser motion preference uses [prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion).

## Implementation decisions

- Brief camera movement for a new selection, preserving closer zoom; cluster expansion zooms one level; destination/recenter uses the existing overview scale.
- Selection identity includes its anchor and moves only when it changes. Drawing suppresses automatic selection movement and stops pending transitions; corner double-tap safeguards remain.
- Preview projections stay hidden during camera motion and publish again on completion, with the existing identity/race guards retained.
- Validate behavior with executable renderer/bridge harnesses, then lint and typecheck. Physical animation timing cannot be evaluated without the phone.

## Implemented behavior

- Native WebView and web Leaflet use interruptible 450 ms `flyTo` moves for new parking selections, cluster expansion and changed destination/recenter intent. New selections use the tapped anchor and keep any zoom closer than level 16. Initial framing is immediate.
- The native Maps renderer applies matching 450 ms region moves after readiness, preserving closer region deltas for selections. Reduced motion uses `fitToCoordinates` with `animated: false` after `onMapReady`, rather than relying on the iOS-unsupported animation duration parameter. iOS retains its provider-controlled animation timing.
- OS reduced-motion changes stop native camera motion; browser media-query changes stop Leaflet motion. Enabling drawing stops pending movement, suppresses automatic selection focus, and keeps the separate double-click handler fix.
- Destination and selection identity keys prevent clock/catalog/location refreshes replaying travel. The parent marks selection as deliberate camera intent; cluster zoom dispatches the existing pan-intent callback before motion/keyboard gating, preventing a late initial GPS fix from undoing that action.
- Leaflet `cameraChanging` covers the stop-to-new-flight handoff, so an old `moveend` cannot publish an intermediate position for the new pin. Preview projections stay null throughout motion and become visible after settling; existing asynchronous native projection revision guards remain.

## Validation and critic loop

- **20 focused map tests passed** across `map-bridge`, `google-map-interactions`, `web-map-motion`, `map-keyboard` and `marker-appearance`.
- Actual native Leaflet script tests cover short camera commands, selection replacement including a stop-triggered old moveend, hidden moving projections, initial/reduced immediate motion, drawing cancellation and no replay on routine updates. An executable web renderer harness covers the same mode/preference/replay behavior. Native Maps harness covers readiness, tapped-anchor focus, hidden projections, reduced motion and drawing cancellation.
- Retained keyboard, polygon-event, rapid-corner, marker-evidence and stale-projection regressions. Independent critic requested stronger stop/moveend simulation; it is implemented and passing.
- Final lint, typecheck and diff checks passed. No phone animation test, build, commit or push was performed by this agent for this task; native provider timing remains a physical-device validation limit.
- Independent camera/popup critic approved the final sources and stronger stop/moveend regression, independently passing 19 camera/keyboard/popup tests plus lint/typecheck. Source freeze handed to parent for integration.
