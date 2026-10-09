# Loading / navigation independent critique

Reviewer: entry-v3 agent. Read-only review of LoadingIndicator, navigation domain/service, SettingsSheet, startup Navigator and ParkingPreview integration. No implementation edits.

## Finding requiring correction

- P2: startup begins preference hydration but does not wait for it. Navigator calls useNavigationPreference and only gates account readiness. If AsyncStorage resolves after account readiness, the first Go can open the phone default while a saved Google Maps/Waze choice is still loading. Requested explicit preference readiness and startup gating, with read errors settling to default, while preserving direct user-gesture URL launch after readiness. Sent to owner and root.

## Passed checks

- Custom loader has stable accessible progress semantics, a decorative hidden P/dot mark, reduced-motion-safe initial state, live accessibility event ordering, inactive/hidden stop, loop/subscription cleanup and the correct web/native animation drivers. Unit harness exercises real component effects.
- Navigation URLs are fixed provider routes with finite/range-checked numeric coordinates. Native launch occurs before a storage await and fallback only tries the chosen provider's HTTPS route. No arbitrary URL input.
- Persistence coalesces reads, serializes writes and advances revision after successful durable writes. Late hydration cannot replace an already committed selection; storage write failure retains the last successful selection.
- Settings groups Navigation separately and reports storage failure; button disabled state prevents accidental competing writes. Actual pin Go uses the shared preference-aware opener.
- Android Phone default opens the destination map intent; explicit Google Maps/Waze choices use driving navigation deep links.

## Correction and final review

Owner added useNavigationReady and gated Navigator (including notification handoff) on account and preference readiness. The persisted provider now settles before any map Go is exposed; read rejection settles to the phone default, and unmount suppresses late state writes. The opener still launches synchronously in the user gesture.

Re-read corrected service/layout and actual startup harness. Fifteen loading/navigation/startup tests pass, including delayed storage with already-ready account, failure recovery, cold first Go choosing saved Waze, and unmount cleanup. No remaining implementation blocker found. Physical installed/uninstalled provider behavior remains root's phone test.
