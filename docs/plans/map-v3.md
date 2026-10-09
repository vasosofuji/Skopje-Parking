# Map clarity and selection, version 3

## Plan

- Use one pure marker-appearance helper across Google Maps, web Leaflet, native Leaflet, previews and rows. Incomplete/unreviewed places get a distinct fill and `?`; pricing-free places get a teal neutral fill and `0` cue. Recent availability retains green/red fills and contributor cosmetics retain a separate border.
- Treat official verification, confirmed sign details, human zone labels, current human pricing, or positive presence confirmation as review evidence. An imported name alone is not review. Presence only confirms the place; it must not invent price/sign details.
- Trace selection/camera/preview behavior before editing: inspect marker focus panning, stale asynchronous projection replies, marker rebuilds and popup measurement. Fix those causes with stable selection and layout rather than decorative animation.
- Blank-map taps blur the search input and dismiss the keyboard, with renderer-level picking/drawing events kept separate.
- Add a concise legend to the map and integrate the navigation/loading helper supplied by the other UI agent.
- Verify marker combinations, stale evidence, free pricing vs free spaces, stable overlay placement and picking. Run lint/typecheck, perform self-review and report device-only limits.

## Documentation and findings

- Read AGENTS.md, Expo SDK 57 reference and docs index, Expo react-native-maps, React Native 0.86 Keyboard, react-native-maps 1.27.2 MapView/Marker and Leaflet map sizing documentation before API edits.
- Initial inspection: choosing a second pin can briefly reuse the first pin's screen position before the asynchronous WebView projection arrives. Preview height starts at a guessed 170 px, then jumps after layout. Leaflet render calls invalidateSize with default panning on every selection; markers allow focus-triggered automatic panning. These are concrete instability paths to address.

## Implementation and validation

- Added `marker-appearance.ts` and applied it to all three renderers, previews and rows. Needs-review locations retain a purple `?`; if recent availability exists, a separate green check/red cross carries that report without implying review. Reviewed free parking uses teal when availability is unknown and retains a `0` fee badge when full/available. Contributor border colors remain separate.
- Review evidence uses official verification, confirmed signs, current human prices, human zone labels, or a positive majority in the server's 90-day presence aggregate. Presence does not manufacture price or sign details. Old OSM names and availability alone do not count as persistent review.
- Added a map legend through the map info control. The preview now opens the selected navigation app through the supplied navigation service; map search uses the shared branded loading indicator.
- Blank-map taps explicitly blur the search field, dismiss the keyboard and close search results. Native polygons use a gate for Android's named overlay events and Apple's unlabelled paired event at the same coordinate, so selecting a polygon is not immediately cleared. Drawing picks are still dispatched once.
- Removed focus-induced Leaflet panning and repeated selection-time size invalidation. Leaflet projection replies include selection identity and anchor coordinates. Google success and rejection paths both reject stale projections. Selecting a different pin clears the old screen anchor before rendering its preview.
- Preview cards measure before becoming visible, scroll when long and keep a bounded placement. Pointer arrows render only when actually aligned with the pin. A review caught a two-pixel maximum-height mismatch; the scroll allowance now includes padding, borders and margin.
- Marker frames keep a stable center/size during selection and contain free/status badges in native marker bitmaps. Independent review identified clipping in the original frame; it is now 60×48 with a separate inner selection halo.
- The map receives ParkingContext's explicit clock, including marker and clustering dependencies, so cached/offline availability and prices expire without requiring a pan. One-second GPS updates still move only the location dot/accuracy overlays.
- Validation: **11 focused tests passed**, including actual native Leaflet script behavior and a transpiled Google component harness for delayed projection rejection and footprint picks. Final lint, typecheck and diff checks passed. A full suite run passed 160/161 with the one unrelated photo test missing a `useRef` mock; the entry owner repaired that harness.

## Self-review and remaining limits

- No claim that presence review verifies prices: the fee badge requires usable price evidence and both first/following hours equal zero. Unknown/expired information falls back to needs-review or a reviewed neutral pin.
- The backend supplies already-filtered presence aggregates without per-vote timestamps. Offline presence review has the same freshness limitation as that saved catalog; no new permanence guarantee is inferred.
- Native camera/keyboard timing and visual behavior still require the parent's connected-phone pass. Apple overlay handling is verified against the installed native source and tested for paired-event suppression, not an iOS physical device.

## Android keyboard repair after device testing

- The parent's Samsung device test reproduced an open IME after a blank-map tap. Android reported the served view as `RNCWebView`, while the RN search input had already lost focus. Inspection of installed RN 0.86 `dismissKeyboard` and `TextInputState` confirmed both `Keyboard.dismiss()` and the input's `blur()` only dispatch for RN's tracked current TextInput, so repeating them cannot address this state.
- Rechecked [SDK 57 WebView](https://docs.expo.dev/versions/v57.0.0/sdk/webview/), [WebView reference](https://github.com/react-native-webview/react-native-webview/blob/master/docs/Reference.md), [Expo local modules](https://docs.expo.dev/modules/get-started/), [module queues](https://docs.expo.dev/modules/module-api/), [autolinking](https://docs.expo.dev/modules/autolinking/), and [Android keyboard visibility](https://developer.android.com/develop/ui/views/touch-and-input/keyboard-input/visibility). WebView 13.16.1 has no Android clear-focus/dismiss command; its keyboard-display prop is iOS-only. A supported local module avoids refocusing the search field or intercepting map gestures.
- Added Android-only `modules/skopje-parking-map-keyboard`, outside generated projects and without external dependencies. Its small asynchronous method runs on the UI queue and checks the current focused view is a WebView with the bundled map's fixed title. The map and activity decor must both own window focus, preventing a background map window from queuing a hide while a native Modal owns input. A native text field, other view, other WebView, inactive window, or absent activity returns without any keyboard mutation. It hides the map IME via window insets on API 30+ and the map's window token on older Android. It retains map focus for gestures and accessibility.
- The native Leaflet component invokes it only for map tap/pick messages (blank, selection, valid picking/vertex paths, explicit cluster/destination clicks). GPS, camera and projection messages do not dismiss the keyboard. On Android native acceptance gates tap callbacks, with no preceding RN blur. Messages carry their event time, and subsequent search focus or a visible sheet rejects stale events both before native dispatch and after its result. Committed callback references update in a layout effect; unmounted maps reject late work. RN dismissal remains for iOS and development clients lacking the Android local module; the Android fix requires a new native binary.
- Independent review identified and repaired three additional gaps before rebuild: pre-guard RN dismissal, inactive Modal-window focus, and cluster/destination clicks that had no direct interaction message. The callback guard also prevents a newly opened form from being affected during the native round trip.
- Validation: **15/15 map-focused tests passed**, including an actual component harness checking deferred acceptance, rejected native focus, search/sheet changes during native dispatch, interaction dispatch and no gesture capture; actual Leaflet cluster/destination clicks; Android/non-Android module dispatch and activity-loss handling; plus static native focus/window-guard/autolinking wiring checks. Lint and typecheck passed. Expo's Android autolinking resolver found `skopje-parking-map-keyboard` and its Kotlin module class. Static checks cannot prove OEM IME behavior; the parent's local native build and device rerun remain necessary.

### Local rebuild handoff

Copy the `modules/` tree together with the updated `src/` into the parent's local build snapshot. Regenerate native/autolinking configuration with the existing local Expo prebuild workflow before running its cached Gradle build; a JS-only rebundle cannot add this module. Do not hand-edit generated `android/` or use EAS. Verify `expo-modules-autolinking resolve --platform android --json` lists `skopje-parking-map-keyboard`, then rerun search → blank map on Samsung, search → marker, map pan/pinch/destination/boundary picks, and search typing again after dismissal. Confirm the IME hides in `dumpsys input_method`, not just that search loses focus.

### Device-confirmed taps and pan follow-up

The parent verified on Samsung that blank-map and parking-pin taps now hide the keyboard (`mInputShown=false`, with screenshots), and search can be focused and typed into afterward. Dragging can instead retain `ReactEditText` focus while moving the map. Therefore drag intent now immediately calls `onPan` after the same event-time/sheet/unmount guards, without requesting keyboard dismissal or waiting for its native acceptance. This preserves `cameraMoved` so a late initial GPS fix cannot undo a real pan. Tap dismissal and drag behavior have separate expectations: taps close the IME; dragging may keep search focused. The actual component regression covers immediate pan after native tap rejection, zero native keyboard requests for that pan, and continued rejection of stale/occluded pan events. This follow-up changes JavaScript only and needs an incremental local rebundle/Gradle build, without another prebuild.

### Rapid boundary taps

The parent's four-tap drawing test exposed Leaflet's default double-click zoom, moving earlier corners on screen while adding later ones. After checking the [Leaflet 1.9.4 handler API](https://leafletjs.com/reference.html#map-doubleclickzoom), both native WebView Leaflet and web Leaflet now disable only `doubleClickZoom` while drawing and re-enable it afterward. Pinch zoom, panning, wheel/manual zoom and corner click delivery remain intact. The actual bundled-script regression verifies handler state through drawing entry, four corner clicks/updates and drawing exit. The separate react-native-maps renderer does not use Leaflet; its documented `zoomTapEnabled` is iOS Google-only, unsupported on Android/Apple Maps, so no unrelated native gesture or all-zoom restriction was introduced.

Final rapid-tap repair validation: **16/16 map-focused tests passed**, with lint, typecheck and diff checks clean. This is a source-only change for the parent's incremental local build/device verification.

### Parent's final device result

The final locally built APK at source `79a8b7a` installed successfully on Samsung. Blank-map taps still hide the IME. Four rapid drawing taps kept the first corner at x=348.5 for an intended x=350, with all four vertices present; dragging that corner moved it to x=422.5. The draft was canceled without submitting a parking. The complete final suite passed 173 tests, with lint/typecheck, Doctor and platform exports passing. Final evidence and APK digest are in `docs/VALIDATION.md`; the temporary USB stay-awake setting was restored.
