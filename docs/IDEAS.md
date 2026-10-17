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

## Calls and context

13. **Purchase-call context enrichment.** Before Cupcake makes a phone call triggered by a purchase detection, enrich the call prompt with a 24-hour summary of food intake (calories, macros, meal count from the food ledger) and spend (total from Plaid-linked transactions). If it doesn't add meaningful latency, also include a 7-day rollup of the same data. The call should feel informed: not just "you made a purchase" but "you made a purchase, here's what you've eaten and spent recently."

    **Current state in cupcake-opolis** (checked by grepping `src/`, `extensions/`, `ui/`, `scripts/`, `skills/`):
    - **Phone calls exist.** `extensions/voice-call/` is the outbound/inbound call plugin (Twilio, Telnyx, Plivo and mock providers in `extensions/voice-call/src/providers/`). Outbound calls start through `initiateCall()` in `extensions/voice-call/src/manager/outbound.ts`, exposed as the `initiate_call` tool, the `voicecall.initiate` Gateway method and `openclaw voicecall call --message`. The call's opening text is a single `message` string, and AI replies use the `responseSystemPrompt` config (`extensions/voice-call/src/config.ts`). There's no hook that adds context before a call. `skills/vapi-telephony.md` only documents a Vapi webhook pattern; it isn't wired-in code.
    - **No purchase detection.** Nothing in the repo detects purchases or starts a call when one happens.
    - **No food ledger.** The repo has no server-side food or meal ledger, so there's no pagination to reuse. The only meal data is the Control UI's labeled sample adapter (`ui/src/pages/nutrition/nutrition-adapter.ts`, `nutrition-source.ts`). It keeps sample, quick-logged and receipt meals in browser localStorage, and its documented future Gateway methods (`nutrition.meals.list { start, end }`, `nutrition.receipts.list`) aren't implemented. The real `nutritionApi.ts` / `nutritionModel.ts` aren't in this repo.
    - **No Plaid integration.** The only match for "plaid" is the word in the session-slug word list (`src/agents/session-slug.ts`). The repo has no transaction fetching or caching, and `scripts/cupcake-metrics-cron.mjs` / `skills/metrics.md` track model API cost, not purchases.
    - **Reachability and latency.** Neither ledger nor spend data is cached or reachable from the call pipeline today. The latency cost of a 7-day rollup (including any new pagination) can't be estimated from this repo, because the data sources live outside it.

14. **FORGOTTEN IDEA.** Matt had a second idea for the idea box but couldn't remember it at the time. Fill this in when he remembers.

## Energy and activity

15. **Live energy-balance curve.** One timeline that plots calories consumed against calories burned: steps, exercise, elapsed time, and the baseline burn of normal living. Matt can watch the line go up when he eats and come down when he moves, instead of reading a single deficit number. Cupcake checks in on walking, exercise and time as data points, and the curve reflects each one as it comes in, so the balance updates live through the day.

16. **Quick-log exercise button on Today.** A single button on the Today screen. Matt taps it and describes what he did in plain words, by voice or by typing: push-ups, a plank and how long he held it, kettlebell rows, whatever it was. Cupcake estimates the calorie burn from that description and immediately drops the energy-balance curve (#15) to match. There's no structured form with sets, reps or pickers. He just talks or types, and the AI works out the number.

    - **Metabolic balance curve (follow-up from Matt).** Frame #15 as a live metabolic balance curve: one animated line that rises on logged food and on food purchases, and falls with steps, exercise and the baseline burn of living. Take cues from Calorie Clock (a clock-face feel for the day, glass panels, a "prism" accent mode), without copying it. #16 becomes talk-to-log: one tap starts dictation, with a text field when the browser can't do speech, and every entry lands in a visible exercise feed on Today with its kcal, time and an undo.

**Status:** #15 and #16 are in development on `feature/energy-balance-curve` (PR into `main`, stacked on PR #2). Steps and purchases are still sample data until real sources exist.
