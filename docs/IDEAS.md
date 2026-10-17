# Cupcake product ideas

A running list of product ideas for Cupcake, kept in the repo so they persist. Nothing here is committed scope until it gets its own issue or PR.

## Look and feel

1. **Ketone-driven calm/hot theme.** Tie the pink calm/hot drama modes to ketone readings: below 1.5 mmol/L is full hot magenta, above 3 mmol/L is soft rose, and values in between blend smoothly between the two.
2. **Mobile bottom tab bar with swipe.** Bottom tabs for Chat, Nutrition, Receipts and Settings, with swipe gestures between them. (PR #2 ships the tab bar; swipe was deferred because it conflicts with the drawer edge swipe and horizontal scrolling in chat.)
3. **Today screen as home.** Last meal, sugar number, calories left, and live deficit math that assumes meals are logged at the time they're eaten.

## Sharing with Robyn

4. **Shareable read-only dashboard for Robyn.** A link with a token that expires and rotates, showing calories, deficit, sugar number, weight trend and workout streak.
5. **Robyn note-taking.** An append-only log tied to Robyn's login, visible to Matt before Wednesday meetings.
6. **MCP server on the droplet.** Exposes tools such as get today's stats, log a note and read streak. Robyn authorizes through her own ChatGPT connector. Two-way: Robyn can send instructions through Cupcake that report back. Anything that changes data goes through a confirmation gate.
7. **Robyn's write scope.** Approvals, encouragement and notes only. No calorie edits and no target changes.
8. **Future v2: challenges with Robyn.** Group challenges and streaks with one rival, not a leaderboard.

## Distribution

9. **PWA installability.** Needs HTTPS, a manifest (name, start URL, standalone display, 192px and 512px icons) and a service worker with a fetch handler. Android withholds the install prompt without one.
10. **Google Play via Trusted Web Activity.** Package with Bubblewrap (about an 800 KB bundle), pay the $25 one-time developer fee, and serve `assetlinks.json` at `/.well-known/`. Avoid Play policy 4.3 (thin WebView wrappers).
11. **Apple App Store: deferred.** There's no PWA submission path. It would need Capacitor with genuine native behavior (push, biometrics, haptics) to clear guideline 4.2.

## Security and protocol notes

12. **MCP 2026 spec requirements.** OAuth 2.1 with audience-bound tokens, no token passthrough, third-party auth via URL elicitation, and tokens issued per person per client, read-scoped and expiring in days. Reference: the open-source quantified-self-mcp project (local-first health data, with private fields excluded from AI access).
