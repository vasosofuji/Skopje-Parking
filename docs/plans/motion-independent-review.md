# Camera, popup motion and builder independent review

Reviewer: entry_v3. Read-only implementation critique; camera/popup changes belong to their implementation agents, builder changes belong to the parent. No build, push or phone actions: phone is disconnected.

## Review plan

1. Check camera movement command identity, interruption, reduced-motion handling and Leaflet projection updates during motion. Routine GPS/catalog updates must not replay camera travel.
2. Check popup entry identity, rapid selection cancellation, hidden press/accessibility behavior, anchor positioning and reduced motion. Projection-only changes must not replay entry animation.
3. Run focused component/bridge tests after source freeze; inspect lint/typecheck results.
4. Parse and review build-apk.ps1 without executing a build. Check quoted Gradle arguments, daemon strategy, cleanup and preservation of the original failure.

## References

- Expo package ~57.0.26 and React Native 0.86.3 verified from package.json; actual AGENTS.md re-read.
- [Expo SDK57](https://docs.expo.dev/versions/v57.0.0/) and [Expo documentation index](https://docs.expo.dev/llms.txt) fetched. The index links the animation guide.
- [React Native Animated](https://reactnative.dev/docs/0.86/animated), [AccessibilityInfo](https://reactnative.dev/docs/0.86/accessibilityinfo), and [Leaflet reference](https://leafletjs.com/reference.html) consulted for animation lifecycle, reduceMotionChanged, flyTo and stop.
- [Gradle daemon documentation](https://docs.gradle.org/current/userguide/gradle_daemon.html) and [Kotlin compiler execution strategy](https://kotlinlang.org/docs/gradle-compilation-and-caches.html) consulted. --no-daemon may still create a single-use JVM; --stop targets all daemons running the same Gradle version.

## Builder preliminary review

PowerShell AST parsing passes. Gradle build receives --no-daemon and one quoted Kotlin in-process property argument. The nested finally invokes --stop then restores location; the outer finally restores environment. Ordinary build exit-code failure retains a useful compilation exception.

Sent parent a cleanup edge for correction: a terminating exception launching the shutdown command could replace the original compilation exception or prevent publication after a successful build. Parent added a catch that reports launch exceptions as warnings. The broader same-version effect of --stop is intentional under the user's builder shutdown request, confirmed by parent.

Independently parsed the final PowerShell AST and ran its extracted compilation try/finally with mocked Gradle calls. Success, compilation-error and shutdown-launch-error paths each execute one shutdown attempt and one location restore. The compilation exception remains intact, a shutdown launch exception does not fail a successful compilation, and the Kotlin/JVM properties remain individual native arguments. No real build/Gradle processes were launched by this review. Builder source review approved; an actual build/process cleanup is parent verification.

## Motion review

### Popup

Independently executed all six actual ParkingPreview/hook runtime tests. The card waits for measured height, a valid visible projection and the accessibility preference result; pending/off-map/null states hide opacity, presses and accessibility descendants. Animation affects opacity/transforms only, uses native driving on native platforms and the web-supported driver on web, and creates no interaction handle.

Entry is recorded once per keyed selection; point changes do not replay it. Losing projection cancels/settles motion and hides the retained card. Live Reduce Motion settles an active entry, stale initial preference results cannot undo a newer event, lookup failure chooses still display, and unmount cancels both animation and asynchronous preference updates.

Found a same-place integration projection race: MapScreen.select only cleared the old screen point when place ID changed, allowing a different tapped point within the same polygon to display its previous projection briefly. Parent corrected clearing to compare next anchor latitude/longitude as well as ID. Re-read the correction and dependencies; keyed retention still avoids replay. Popup source review approved; hardware visual timing remains untested while phone is disconnected.

### Camera

Reviewed final native Leaflet, web Leaflet and react-native-maps source. New selections include the tapped anchor in their command identity, preserve closer zoom and use brief movement; destination/recenter identity separates explicit travel from routine updates. Each Leaflet command stops the previous flight. Native MapView operations wait for readiness and use a genuinely nonanimated fit for reduced motion rather than relying on an iOS-ignored duration.

Projections remain hidden during movement and publish after settling. Native Leaflet sets cameraChanging before stop, guarding a synchronous old moveend during replacement; the strengthened actual-script regression now simulates that event and verifies every replacement projection stays null until the new flight settles. Native asynchronous projection revision guards remain. Web moveend queues a redraw instead of directly publishing an old-camera point.

Drawing interrupts motion and suppresses automatic selection travel; the independent double-click, dragging and vertex behavior remains. Accessibility/media-query preference changes stop/settle movement. Explicit selection and cluster expansion record deliberate camera intent, preserving the protection against a late initial GPS fix recentering after a user's choice. Camera keys exclude catalog, clock and GPS-dot updates, so they do not replay movement.

Independently executed 19 focused camera/keyboard/popup tests, including the new executable web renderer harness and stronger stop/moveend replacement case; all pass. Independently ran Expo lint and TypeScript: both pass. Parent additionally reports the final full suite of 183 tests, lint and typecheck passing.

No remaining concrete source blocker found. Camera, popup and builder source review approved. Physical animation smoothness is unverified because the phone is disconnected. No real Gradle/build, device install, commit or push was performed by this reviewer; parent's subsequent local APK build/process cleanup is separate verification.
