# Branded loading and preferred navigation

## Plan / persistent task notes

- Add a lightweight Parkino loading mark using existing React Native Animated transforms, not a dependency or raster animation. Respect Reduce Motion, stop while inactive, clean up subscriptions and animation loops, and expose an accessible status label.
- Use it for account startup, onboarding initialization, loading contribution drafts, AI sign processing, and meaningful account/data loading. Coordinate MapScreen changes with its owner rather than editing map flows.
- Add a grouped Navigation setting with Default, Google Maps and Waze. Store the choice locally and use it for every parking-navigation action.
- Validate coordinates and open only fixed provider URLs. Prefer the selected native app, fall back to that provider's web directions when unavailable, and retain a default platform option. Handle failures with the existing navigation error UI.
- Keep third-party navigation external; Expo Router continues to own in-app routes.
- Test persisted preference races, native/app-to-web fallback, malicious/nonfinite coordinates and animation cleanup/reduced motion. Run Expo lint and TypeScript, then request independent review.

## Ownership / coordination

This task owns SettingsSheet, new loading component and navigation preference/service files. Map/preview owner applies the navigation helper and search-loader integration. Entry owner owns Sheet header and wizard/source forms; provide the loader API and coordinate the narrow SignReview replacement.

## Documentation checked

Expo package is `~57.0.26`. Read Expo SDK57 reference and llms index, Expo57 Linking, current React Native Animated/AccessibilityInfo, and official Google Maps URLs/iOS scheme/Waze deep-link documentation before changes.

## Implementation

`LoadingIndicator` draws a parking P and orbiting dot with native-driven transform animation. Reduce Motion defaults to still until read, live accessibility events override stale initial reads, inactive/hidden loaders stop, and both subscriptions plus the loop are cleaned up. Web uses the supported JS animation driver. Startup/onboarding, sign reading, reminder checking and contribution history now use the shared mark; entry/map owners integrate it in their loading surfaces.

Settings has a separate Navigation app category. A device-local preference store coalesces reads, serializes writes, retains the last successful value on storage failure, and prevents late hydration from overriding a new choice. Startup waits for preference hydration before exposing the map; a rejected storage read releases startup using the phone default. Navigation launches directly from the press without awaiting storage. Google Maps and Waze try their app routes first then their own HTTPS fallback. Default uses Apple's route on iOS or the platform map destination intent on Android. All coordinates are finite/bounded; no arbitrary URLs enter the opener.

## Validation / review

Nine routing/persistence tests pass, including immediate launch timing, installed-app failure, invalid coordinates, storage failure during hydration, and serialized rapid writes. Three actual-component loader tests pass for accessibility races, inactivity/hidden state, native/web drivers and cleanup. Independent review caught that merely starting hydration before account initialization did not guarantee it finished first; the explicit startup gate fixes this. Three additional actual-layout/service tests verify delayed hydration with an already-ready account, synchronous saved-provider launch, read-failure recovery, notification readiness and unmount cleanup. The account guest-screen harness was updated for the loader import and passes. Full Expo lint and TypeScript pass after the entry/map integration. Native provider installation and device visual verification remain part of root integration.
