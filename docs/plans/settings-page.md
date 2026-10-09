# Settings page redesign

## Plan

- Replace the flat list in the centered settings dialog with a full-page Settings view using the shared Sheet `fullPage` variant owned by parent.
- Follow the reference's centered page header, profile summary and rounded grouped cards, using Skopje Parking's existing light/dark/cosmetic palette rather than introducing new colors.
- Show real identity, guest state and points. A compact Manage account action opens the existing account screen; do not invent profile fields or account actions.
- Group the entry points into General, Account and Support. Keep detailed appearance, language, navigation and reminder controls behind their respective rows, with a header Back action instead of the old large body button.
- Use accessible radio rows for choices. Preserve preference writes, navigation saving/error states, GPS refresh/permissions and background reminder information. Keep both English and Macedonian text.
- Own SettingsSheet only. Parent owns Sheet layout and the independent native critic owns component interaction tests. No APK build, commit or push.

## Documentation and reference

Package uses Expo57 / React Native0.86. Expo57 docs and llms index were checked in this task context; current React Native Pressable and accessibility radio/checked/header APIs were read before implementation. Parent supplied the screenshot at `C:/Users/matej/Pictures/Screenshots/Screenshot 2026-10-02 122821.png`.

## Implementation / validation

Settings now uses the full-page Sheet header/back behavior and a profile summary with real username or guest identity, points and one compact Manage action. General contains appearance, language, navigation and location/reminders. Account contains rewards and privacy/data. Support contains coverage/sources, reminder information and terms. Rounded cards, inset dividers and theme-colored icons use existing palette tokens; headings and rows remain readable in both languages and dark mode.

Appearance, language and navigation use radio semantics with checked state. Saving navigation disables choices and retains the existing recoverable error message. GPS refresh, system permissions and the background-reminder controls remain available within their own page. Header Back returns to root, then closes; navigation actions reset the section and route to the existing app screens. No fake profile fields, contact links or duplicate account controls were added.

Final full Expo lint and TypeScript pass; 13 navigation/startup/account regression tests pass. The independent native critic approved the design/source and added eight passing actual Settings/Sheet component tests covering section/back/close behavior, reopening, checked choices, preference saving/failure, real profile/guest state, routes and reminders. The screenshot structure was inspected during implementation and review. Only SettingsSheet and this plan were edited by this agent; parent owns shared Sheet behavior and the critic owns its tests. No APK build was run.
