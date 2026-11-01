# Proactive surfacing: the 7 AM briefing

Goal (from the brief): RingConn sleep, the Robyn dashboard and Plaid spend show
up in the 7 AM briefing **without Matt asking**. Pipes with pressure.

Nothing in n8n was changed for this document.

## Which briefing is live

- **Live:** n8n workflow **Cupcake Morning Briefing** on the hales droplet,
  schedule trigger 7 AM America/Chicago, Telegram HTML with a plain-text
  fallback. It ran successfully every morning this week, including today.
  Its structure is owned by `notsoround/voice-vault` `build/morning_briefing.py`
  ("edit here, re-run, don't hand-edit the nodes in the n8n UI").
- **Not live:** an OpenClaw cron job also named "Morning Briefing" exists on
  brain-01 under the old Mac cron store and has not run since late August.

## Inputs today (verified from the workflow's node list)

Sequential chain (a deliberate barrier against n8n's fan-in race):

| Node                       | Source                                         | Feeds                                                        |
| -------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| Get Unread Emails          | Gmail                                          | inbox section                                                |
| Get Today's Events         | Google Calendar                                | today's events                                               |
| Check n8n Failures         | n8n API (local)                                | automation health                                            |
| Website Health Check       | `https://hales.ai`                             | site health                                                  |
| Brain Health Check         | fixed SSH command to brain-01                  | brain, backups, capture, memory-outbox health                |
| Read Commitments           | Google Sheets                                  | promises kept/broken (live rows only)                        |
| Read Activity              | Google Sheets (Health Connect rows from phone) | **sleep hours, steps, heart rate, glucose snapshot, weight** |
| Read Weight History        | library `weight_list`                          | canonical weight                                             |
| Get Sent Yesterday         | Gmail                                          | what went out yesterday                                      |
| Inspiration (3 nodes)      | feed                                           | one quote/idea                                               |
| Format Briefing → Telegram | code node                                      | the message                                                  |

## Gaps against the brief

| Wanted              | Today                                                                                                                                                                                   | Gap                                                                                                                                  |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **RingConn sleep**  | Sleep comes from the Health Connect `Activity` sheet row, not RingConn                                                                                                                  | RingConn nights land in the library (`ringconn_night_*`, phone sends ~6 AM, catch-ups 8 and 10 AM) but the briefing never reads them |
| **Plaid spend**     | No spend at all. Plaid is fetched only by the Robyn/weekly-digest workflow (`Plaid Fetch` → `Bank Purchases`), and the brain answers `lookup_spending` / `recent_bank_events` on demand | Nothing pushes yesterday's spend                                                                                                     |
| **Robyn dashboard** | Not referenced. The library has viewer data, Robyn's notes and chat log, and token expiry                                                                                               | No "Robyn left a note" or "her link expires in 2 days" line                                                                          |
| **Today's focus**   | Not referenced                                                                                                                                                                          | No `attention.md` check                                                                                                              |

## Proposed change (to be made in voice-vault `build/morning_briefing.py`, then re-run; not done here)

Add four fetches to the existing sequential chain, each with the same
`alwaysOutputData` + `onError: continueRegularOutput` + `executeOnce`
pattern, so a failure prints an honest gap instead of killing the message:

1. **Read RingConn Night** → library owner action
   `ringconn_night_list {start: yesterday, end: today}` (summaries only).
   Formatter: prefer RingConn for last night's sleep (asleep time, session,
   resting HR); fall back to the Health Connect row with the label
   "Health Connect (RingConn not in yet)". Never print 0 for missing.
2. **Read Spend Yesterday** → reuse the brain's existing `lookup_spending`
   path (same webhook the `cupcake-nutrition` plugin already calls) rather
   than a second Plaid client. Formatter: yesterday's total, food & drink,
   top merchant, using the same exclusions as `cupcake_bank_purchases.py`
   (transfers, income, payments, refunds). A failed fetch prints "spend
   unavailable", never $0.
3. **Read Robyn Activity** → library `robyn_notes_list {limit: 5}` and
   `viewer_token_list`. Formatter: "Robyn left N notes since yesterday" and
   "her dashboard link expires in N days" only. No note text in Telegram
   unless Matt opts in.
4. **Read Today's Focus** → extend the fixed, read-only brain-01 command that
   `Brain Health Check` already runs (or add a sibling fixed command) to
   report `{date, set: true|false}` for `workspace-ara/intent/attention.md`.
   Formatter: if not set for today, end the briefing with one question:
   "What's the one thing that makes today a win?" Cupcake (the `ara` agent on
   Telegram) writes Matt's answer to `attention.md`.

Ordering is fine as is: RingConn's first send is ~6 AM, before 7 AM. If the
6 AM send failed, the catch-ups land after the briefing, so the fallback label
matters.

## Rollout

1. PR on voice-vault: `morning_briefing.py` + formatter + its existing tests
   (`briefing_*_tests.py`) extended with fixtures for each new gap case.
2. Dry run with the script's `--run-now` test banner to Matt's chat.
3. Matt approves, then the script PUTs the workflow. Rollback = re-run the
   previous script version.
