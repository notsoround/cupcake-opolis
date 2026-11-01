# scorecard/: dated self-reviews

One file per review: `scorecard/YYYY-MM-DD.md` (America/Chicago date). This
evolves Matt's pinned grok.com chat "Matt's self review" into dated, versioned
files. That chat is not readable by Cupcake, so nothing has been imported from
it; Matt can paste past snapshots into dated files himself if he wants the
history.

**Public repo:** only `TEMPLATE.md`, this README and empty stubs live here.
Filled reviews go in the private workspace (`intent/scorecard/` under
`/home/openclaw/workspace-ara/`), never in this repo.

## Format

Copy [`TEMPLATE.md`](TEMPLATE.md). Four required sections, in this order:

1. **Where I am**: a snapshot. Facts with sources, not adjectives.
2. **What I wanted**: what Matt set out to do since the last review (link the
   `goals.md` ids and the `attention.md` focuses of the period).
3. **What actually happened**: tried / worked / failed, each as a short
   trajectory line that can be linked to a principle (see
   [`../experience/README.md`](../experience/README.md)).
4. **Carry forward**: at most three items, each tagged `keep`, `change` or
   `drop`, plus any proposed edit to `goals.md`.

## Cadence

- Matt decides. Suggested: weekly (the Wednesday coaching week already used by
  the weekly digest), plus ad hoc when direction shifts.
- A review older than its cadence is a nudge for the briefing, not a failure.

## Who writes what

| Section       | Matt   | Cupcake                                                             |
| ------------- | ------ | ------------------------------------------------------------------- |
| Where I am    | writes | may pre-fill **sourced** numbers (library, app) marked `draft`      |
| What I wanted | writes | may list the period's `attention.md` focuses verbatim               |
| What happened | writes | may draft trajectory lines from logs, marked `draft`, Matt confirms |
| Carry forward | writes | never                                                               |

Agents never write opinions about Matt into a scorecard, and never mark a
`draft` line as confirmed.

## How memory uses it

Scorecards sit in the private workspace, so Memory Core indexes them as dated
notes: recency decay (30-day half-life) applies, and dreaming can promote what
keeps getting recalled. Confirmed `what happened` lines feed the experience
graph. See [`../../docs/memory-tiers.md`](../../docs/memory-tiers.md).
