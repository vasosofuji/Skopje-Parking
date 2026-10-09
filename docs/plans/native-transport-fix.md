# Native transport timeout independent review

Reviewer: entry_v3. Transport implementation and regression work belong to parent. No build, push or device actions by reviewer; phone is disconnected.

## Confirmed failure

Installed Expo remains SDK57 / React Native 0.86.3. React Native's installed `Libraries/Core/setUpXHR.js` assigns global AbortController and AbortSignal from installed abort-controller 3.0.0. That AbortSignal has no static timeout method. The old readiness call evaluated AbortSignal.timeout before fetch; readiness caught the resulting TypeError as a retryable network error and repeated until its 75-second budget expired. Native Terms acceptance could therefore fail without sending any request.

## Review plan

- Check explicit controller/timer compatibility with the actual installed polyfill.
- Ensure timers clear on successful completion, fetch/body failure and timeout.
- Preserve shared health probing, cooldown and write-once behavior.
- Exercise the real polyfill in VM regression tests; inspect timeout/body handling and error propagation.
- Run transport tests, lint and typecheck when parent source/tests are stable.

## Preliminary findings

Explicit AbortController fixes the confirmed missing static API. Parent's timer encloses fetch and response parsing and clears in finally.

Sent parent a body deadline edge: installed whatwg-fetch removes its abort listener when XHR reaches readyState4, while Response.json delegates to text/FileReader without the AbortSignal. A timer that only aborts the controller cannot strictly settle a body read that ignores the signal. If body completion must be bounded, timed needs a rejecting timeout promise as well as native abort, with a regression whose json Promise ignores signal.

## Final review and verification

Parent corrected timed to race a rejecting deadline against the operation and abort the controller. Deadline failure remains useful even when the body read ignores AbortSignal. The timer clears in finally for every result. Request failures also invalidate cached readiness; read-only health probing remains the only retry path, so writes are never replayed automatically.

Independently executed the installed abort-controller: static timeout is undefined, explicit abort marks signal.aborted and dispatches one abort event. Independently ran all seven final transport tests, including real-polyfill VM successful health/write and ignored-abort body deadline regressions. All pass. The body regression verifies signal abort, empty timer inventory, one write attempt and a fresh health probe after interruption. Shared concurrent readiness, 75-second cold-host budget, 429 cooldown and redirect/cookie protections also pass.

Source review approved: no remaining concrete blocker. Parent reports full suite 185/185 and lint passing; reviewer independently ran Expo lint and TypeScript successfully. No build, push or device action performed by reviewer. Actual native user-flow verification remains unavailable while phone is disconnected.
