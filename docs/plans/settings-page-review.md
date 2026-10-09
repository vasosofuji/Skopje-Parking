# Settings page independent review

Reviewer: entry_v3. Parent owns optional Sheet fullPage presentation; progressive_entry owns SettingsSheet. Reviewer owns this document and focused settings-page interaction tests. No APK build, install, commit or push.

## Plan

- Inspect safe-area layout, header/back behavior and unchanged ordinary Sheet presentation.
- Inspect grouped profile/cards/rows against the supplied reference. Parent supplied `C:/Users/matej/Pictures/Screenshots/Screenshot 2026-10-02 122821.png`, inspected with view_image.
- Exercise actual SettingsSheet handlers and actual Sheet presentation in isolated component runtime tests: sections/back, preference choices, account/legal routes, close/reopen behavior and Android request-close.
- Verify theme/localization, scrollable large-font content, route existence and reuse of preference persistence APIs. Avoid unrelated persistence refactors.
- Run focused tests, lint and typecheck after implementation freezes.

## API evidence

Expo ~57.0.26 / RN0.86.3 verified earlier in this shared work; AGENTS.md read. Re-fetched SDK57 safe-area-context and RN0.86 Modal docs for this review. Safe-area insets include left/right as well as top/bottom. Android Modal hardware Back is dispatched through onRequestClose.

## Preliminary findings

- FullPage correctly removes backdrop dismissal and uses full-height content; ordinary Sheet remains the default.
- Sent parent a lateral safe-area gap: fullPage currently applies top/bottom only, so landscape cutouts need left/right insets as well.
- FullPage Android request-close routes to Back; disabled Back guard is worth preserving if this optional presentation is later used with saving forms. Settings does not disable section Back today.

## Final review and verification

Parent corrected fullPage lateral insets and disabled Back request-close guard. All four safe edges are now applied; fullPage header has its left Back action, centered wrapping title and right Close. Root settings Back closes, section Back returns to root, and Android request-close follows the same action. Existing ordinary dialogs retain backdrop dismissal, Android close, compact header Back and onShow/onDismiss forwarding for photo-review lifecycle.

The source follows the reference's centered settings header, rounded grouped cards, separated rows and profile action. It uses existing app theme colors, real identity/points and functional destinations. No unimplemented switches or fabricated profile fields were introduced. Root profile wrap accommodates a growing Manage label; section rows have minimum heights and wrapping titles, with bounded/truncated secondary summaries. Full-page content scrolls and remains centered with a tablet maximum width. Only the decorative avatar initial disables font scaling. Actual native large-font visual layout is not claimed by source tests.

Theme/language choices call their existing context setters. Navigation keeps the existing persistent service; choices lock during saving, selected state changes after persistence, and failed writes preserve the prior selection with a retryable visible error. Profile/Rewards/Privacy/Coverage/Terms route actions close settings first and use existing Expo Router screens. Guest profile has the same account access. Location refresh/permissions and reminder information remain reachable.

Added `tests/settings-page.test.ts` with eight executable actual-component interaction regressions; all pass. They cover fullPage safe edges and disabled Android Back, ordinary Sheet backdrop/header/native close and lifecycle callbacks, section-to-root Back/close/reopen, preference setters/radio states, navigation save/failure behavior, valid profile/legal routes, real identity/points/guest access, and location/reminder callbacks. These tests execute source handlers; they do not claim physical rendering or system permission behavior.

No remaining concrete source blocker. Owner reports clean lint/typecheck and 13 related navigation/account/startup tests. Reviewer independently ran Expo lint and TypeScript: both exit successfully. No APK build, install, commit or push performed.
