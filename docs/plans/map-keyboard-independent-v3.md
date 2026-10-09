# Android map keyboard independent review

Reviewer: entry-v3 agent. Read-only critique; implementation belongs to parking_flow. Device evidence supplied by parent: RN search blur/Keyboard.dismiss fails once RNCWebView owns Android IME focus.

## Documentation and native wiring

- Expo package remains ~57.0.26. Re-read Expo57 index, Modules API/get-started, and Android WindowInsetsController/InputMethodManager official references.
- Local module shape is compatible with SDK57. Installed Expo autolinking resolves parkino-map-keyboard and its Kotlin module classifier. Gradle plugin declarations match installed expo-blur. Queues.MAIN is documented and present in installed expo-modules-core.
- API30+ WindowInsetsController.hide(Type.ime) and older InputMethodManager fallback are appropriately SDK-gated. Module requires rebuild; optional loader safely supports older clients/non-Android.

## Findings sent to owner/root

1. P2: unconditional RN Keyboard.dismiss runs before the native map-focus guard; delayed WebView messages can blur a newly focused search/form even when native refuses to hide. Parent blankMap/pan/select callbacks can repeat this JS dismissal. Guard the whole callback pipeline.
2. P2: activity.currentFocus may retain map while a dialog has another focused window. Require actual map/window focus before hiding. Android documents that inset hides may defer until a window gains control, so background-window calls must be avoided.
3. P2: clustered pin click only generates camera/zoom replies, deliberately excluded from IME dismissal. Passive destination-marker clicks also need an explicit user-interaction path. Keep programmatic GPS/camera messages excluded.
4. Follow-up race: a native check can succeed before JS continuation while a form opens. Post-resolution current-interaction validation must include modal-open or all-input focus generation, not only search focus.

## Corrections and final source review

- Android helper now calls the guarded native method first and returns its boolean. It does not dispatch unguarded RN blur before native focus validation.
- Kotlin runs on the UI queue and requires the current focused WebView, bundled-map title, live map window focus and Activity decor window focus before requesting IME hide. It never clears/refocuses controls or captures gestures.
- Bridge interactions are stamped, validated against later search focus and visible Sheets before native dispatch, then rechecked against current committed callbacks after native completion. Closed/unmounted maps drop late completions. Sheet blocking includes details/proposals/settings/legend/location help and the shared arrival visibility.
- Cluster/destination taps now emit direct interaction messages; programmatic GPS/camera/projection replies remain excluded.
- Independently ran keyboard/Leaflet/appearance/Google interaction tests: 15 passing, including real component async-acceptance/refocus rejection and actual Leaflet cluster/destination behavior. Native guard checks are static source tests; autolinking was independently resolved.

No remaining source blocker found. Approval is for local compile/device verification; it does not claim Samsung IME correctness. Parent will locally rebuild and repeat keyboard/pan/selection/drawing and form-refocus checks. Kotlin compilation and actual OEM behavior remain required evidence.

## Final pan critic loop

Parent's subsequent physical tests confirmed blank-map/pin taps hide the IME and search can refocus/type. They also found map drag can retain the RN search focus, so requiring native IME acceptance for onPan would discard intentional camera movement and permit a late initial GPS recenter.

Reviewed owner's narrow source-only correction: current pan records onPan synchronously after mounted/timestamp/sheet guards; it performs no keyboard mutation and waits for no native Promise. Tap callbacks retain native acceptance and post-resolution current-focus guards. Native module scope is unchanged.

Independently executed six keyboard/Leaflet bridge tests: all pass. The actual component regression asserts pan intent fires synchronously despite an IME rejection path, creates no pending keyboard work, and remains suppressed for stale focus/sheet events. Source review approved for parent's incremental build/retest; no remaining blocker found.

## Final boundary drawing critic loop

Parent physically observed two rapid corner taps triggering Leaflet double-click zoom and moving the first vertex on screen. Reviewed the narrow fix against the official Leaflet 1.9.4 handler reference: the bundled native script disables the actual doubleClickZoom handler while drawing and enables it when drawing ends; the web renderer applies the same handler change when its drawing prop changes. Updating map options alone would not disable the live handler; this implementation correctly uses disable/enable.

Map dragging, touchZoom/pinch, individual vertex dragging, camera intent and native keyboard code are unchanged. Normal exploration restores double-click zoom. Independently ran seven keyboard/Leaflet bridge tests; all pass. The new actual-script test cycles into drawing, dispatches four corner clicks with intervening redraws, confirms double-click zoom remains disabled, then confirms the handler is enabled again and normal blank taps resume.

No remaining source blocker found. Owner reports all 16 focused map tests, lint and typecheck pass. Approved for parent's final incremental build and physical rapid-corner drawing check; the source regression is not a claim of a completed device retest.

## Parent's completion evidence

The parent subsequently built and installed final source `79a8b7a` locally, with the original test signature. Samsung blank-map taps hid the IME; four rapid corners retained their intended screen positions and corner dragging worked. No live parking record was submitted. Final 173-test/lint/typecheck/Doctor/export results and remaining physical iOS/field limits are recorded in `docs/VALIDATION.md`.
