# Entry UX v3 memory

## Plan

- Keep sign source selection in the existing popup and immediately show Take photo / Open gallery. Preserve capture, selected-photo preview, upload retry, AI review and correction.
- Remove the manual-entry opening reflow: a one-line asynchronous draft-loading placeholder currently collapses the centered popup. Use one stable entry surface, make the whole choice row the tap target, and keep Back beside Close in the popup header.
- Keep only zone optional. Require pricing or an explicit free choice for simple entries; detailed entries additionally require total spaces, a current free-space estimate and a valid perimeter. Save completed steps individually and retain unfinished/failed drafts.
- Verify focused progressive-entry tests, lint and typecheck. Parent will review and test the integrated phone build.

## Scope

Own PhotoPicker, SignPhotos, ProposalSheet, ParkingDetails, ManualParkingWizard, ui header support and progressive-entry validators/tests. No map/settings edits. Loading/navigation agent owns SignReviewSheet spinner replacement and LoadingIndicator.

## API evidence

- package.json Expo ~57.0.26, React Native 0.86.3.
- Read AGENTS.md; fetched Expo 57 SDK index, image picker docs, Expo llms index, React Native Modal and Pressable docs. Picker launch is user-triggered; iOS onDismiss is dismissal completion. Inline source selection removes an extra nested Modal and its presentation/dismissal race.

## Findings

- Current photograph route opens a form with Add sign photo before the actual custom chooser.
- Current manual route waits for AsyncStorage and renders only Opening entry, temporarily shrinking the centered sheet.
- Current pricing/count stages expose Skip; perimeter Done succeeds without a perimeter.
- Current Back/Correct this step is a full-width body button.

## Implementation

- Photograph a sign now changes the existing popup to Parking sign photo with Take photo/Open gallery immediately. The extra Add sign photo action and nested source Modal are gone. Selected image preview, Change/Remove, upload retry and custom permission recovery remain.
- Manual choice labels are non-intercepting children of the full row. A branded loader and the wizard share a minimum 188px body, preventing the one-line asynchronous opening collapse.
- Back/Correct this step registers in Sheet's header beside X. Both compact controls retain effective 44px touch targets. Busy steps disable Back; Close still retains unfinished drafts.
- Zone is the only Skip. Simple pricing requires an amount or explicit free choice; detailed parking areas require total/current free counts plus valid drawn perimeter. Imported unchanged perimeters with holes remain accepted. Aggregate tariff zones intentionally have no count stage because the API rejects capacity on zones.
- Completion checks stored successful operations, so old/unfinished 'done' drafts cannot clear missing pricing/counts/perimeter. Completed-step background saves and account-bound retries remain.
- Returned map geometry takes precedence over an older stored draft and auto-saves after Android unmounts/re-mounts hidden Modal children.
- Existing-place sign review is now a sibling of the details Modal; iOS waits for source dismissal before preview and waits for review dismissal before restoring choices. Existing confirmed photo viewer remains available.

## Verification

- 17 focused tests pass (14 progressive/draft tests + 3 actual wizard UI harness tests).
- Independent critic found inert Back on post-sign offer; hidden there because the offer has no prior unsaved form step. Updated existing offline-photo harness for the new callback ref; seven photo-service/offline-control regressions pass.
- Independent critic found photo-created parking could be duplicated by Back → Manual after upload failure. Manual fallback now receives the saved place and an authoritative existingPlaceId; even if the catalog is still pending, the writer reuses that ID and cannot create a fresh contribution. Actual Proposal UI and writer regressions prove identity reuse. Final focused entry/photo suite: 26 passing tests; lint/typecheck pass.
- UI tests cover zone-only Skip, mandatory free/paid price, mandatory total/free counts, missing perimeter retaining saved steps, header Back routing, and returned-boundary autosave after remount.
- Lint and typecheck pass.
- Parent will perform independent critique and connected Android test. iOS physical camera/review presentation still requires an iPhone; lifecycle branches follow documented onDismiss behavior.
