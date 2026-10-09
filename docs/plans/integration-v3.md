# Contribution and map refinement — persistent integration memory

## Scope and ownership

- `entry-v3.md`: direct custom photo-source popup, stable manual entry, required follow-up steps, compact header Back.
- `map-v3.md`: review/free-price marker semantics, selection stability, map keyboard dismissal.
- `loading-navigation-v3.md`: accessible branded loading, persistent Google Maps/Waze preference and launch fallback.
- Parent: integration and independent criticism of each change, complete tests/lint/typecheck, platform bundles, signed test update and connected Samsung checks.

## Decisions

The existing contribution data determines whether a pin has useful reviewed information; no new server flag or migration is necessary. Free pricing is distinct from available spaces. Status fills and separate zero-price badges preserve this distinction, while earned contributor accents remain separate borders.

Only the zone-label step can be skipped in manual entry. Simple entries require a price or explicit Free choice. Detailed individual parking entries also require total/current-free estimates and a perimeter. Tariff zones cannot have individual-area capacity according to the existing API, so their detailed flow requires price and perimeter. Each completed step keeps its current autosave behavior; closing does not erase previously saved work.

Testing uses the already-authorized temporary guest in Parking Test. Do not alter real parking information. The connected API uses hosted HTTPS and does not depend on USB forwarding. Original test signing credentials must be retained for an update that preserves application data.

## Review and validation

Parent criticism and agent cross-review found and repaired the following integration defects:

- Native marker badges extended beyond Android's bitmap bounds; a larger stable frame preserves their complete shape without resizing on selection.
- A failed old coordinate projection could clear a newer successful selection. Both promise outcomes now use request/selection guards.
- Android and Apple Maps duplicate polygon taps could immediately clear the selected area. A narrow overlay gate consumes the paired map event. Area handlers also honor destination picking before that duplicate is consumed.
- Maximum-height previews were two pixels outside the visibility allowance. Scroll content is now bounded below the measured outer-card limit.
- Offline map memoization lacked the context clock, preserving expired colors until another interaction. All marker renderers and grouping now receive the same 30-second clock, independent of live GPS updates.
- Hidden Android Modal content can unmount during drawing. Returned map geometry explicitly overrides the restored draft and is saved on remount.
- Existing-sign review is now a sibling modal with iOS dismissal-completion handoffs in both directions.
- The optional post-sign offer had an inert Back action; the offer omits it, while its detailed wizard can return to the offer.
- Independent review identified that starting navigation-preference hydration alone did not prevent a first-tap race. Startup readiness must include preference hydration; a failed storage read must settle to the default.

The user explicitly requires local APK tools rather than EAS. The queued EAS build `94a00320-f5b3-4675-a6d0-91652aee18a2` was canceled successfully before a worker started. Future APK work in this task uses the local Expo/Gradle workflow. Generated native projects stay in the external short-path snapshot; no generated native directories are created or edited in the repository. The test update retains package `mk.parkskopje.app.dev`, the original signing key, the hosted HTTPS API and cleartext disabled.

The reviewed refinement at `a88e3ae` passed all 168 tests, lint, typecheck, Expo Doctor (21/21), and Android/iOS/web exports. The local release build succeeded and installed over the existing Samsung test application, retaining the guest account and appearance.

Connected folded Galaxy Z Fold4 checks confirmed direct Photograph a sign → custom Take photo/Open gallery actions, Samsung camera launch with a one-time permission, system gallery launch, and successful cancellation back to the custom chooser. No photograph was captured, selected or uploaded. Tapping the manual-entry text reached the simple/detailed choices. Zone Skip and header Back worked; both simple and detailed price steps rejected an empty required first-hour price, without submitting real parking updates. Waze selection survived a cold launch, Google Maps selection worked, and Phone default was restored.

The first device keyboard check found a remaining Android WebView focus defect: a blank-map tap closed the selection but left the Samsung keyboard visible. An Android-only local Expo module now hides the IME only when the focused view and window belong to the bundled map. Native acceptance gates tap callbacks. Stamped events, current search focus and visible sheets are checked before and after the native round trip; delayed events and unmounted work cannot blur a new field. Cluster and destination taps also request dismissal. Independent review approved all repaired findings. Samsung blank-map and parking-pin tests confirmed the keyboard hides; search can refocus and type afterward.

Follow-up criticism found that a pan can retain RN search focus, so IME acceptance must not gate camera intent. Current pan callbacks now run synchronously without keyboard mutation. Physical drawing also exposed accidental double-click zoom; both Leaflet renderers disable only that handler while drawing and restore it afterward. The final APK placed four rapid corners without moving the first one (x=348.5 for a tap at x=350), and corner dragging remained functional. Drafts were canceled without changing real parking records.

Final source is `79a8b7a`; **173/173 tests**, lint/typecheck, all platform exports and Expo Doctor (21/21) pass. The local Gradle APK build succeeded and the final update installed with the original test signer. ZIP/signature/private-configuration checks pass; digest is `69D2F1CA87569E8A3CCA93175425B079AFCAF047DD0959550BE1427AFC9C2392`. No app crash-buffer entries appeared after final installation. The hosted API is healthy. Restored the original USB stay-awake preference and removed temporary phone-side screenshot/XML artifacts. See `../VALIDATION.md` for evidence and remaining physical iOS/field-test limits.
