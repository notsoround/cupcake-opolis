# Experience graph: trajectories linked to principles

## Idea

Flat logs say what happened. An experience graph also says **why it worked
or failed** and turns repeated lessons into principles that steer the next
attempt. This is the pattern in G-Memory (Zhang et al., NeurIPS 2025,
arXiv:2506.07398): an insight graph (abstract lessons), a query graph (task
records) and an interaction graph (detailed trajectories), traversed up and
down at query time. The paper reports gains of **up to 20.89%** in embodied
action success and up to 10.12% in knowledge-QA accuracy. The 20.89 is
**percentage points in one best case** (MacNet + Qwen-2.5-14B on ALFWorld,
58.21% → 79.10%); average gains are smaller (about 5 to 11 points). It is a
benchmark result for multi-agent task teams, not evidence about personal
coaching, so treat it as design inspiration only. One useful detail: the
paper's ablation found **1-hop** expansion best and 2 to 3 hops harmful,
which supports keeping Cupcake's graph expansion to one hop.

Matt's self-review habit already does this by hand. The scaffold makes it a
small, typed file.

## Cupcake mapping (three levels, like G-Memory)

| G-Memory level    | Cupcake                                                                     |
| ----------------- | --------------------------------------------------------------------------- |
| Insight graph     | `principle` records (`do` / `dont`), confirmed ones copied into `goals.md`  |
| Query graph       | `goals.md` ids (`G1`…) and daily `attention.md` focuses                     |
| Interaction graph | `trajectory` records, each pointing at its scorecard line or library source |

Edges: `supports`, `contradicts` (trajectory → principle), `serves_goal`
(→ goal), `refines` (principle → principle), `same_pattern`
(trajectory → trajectory). Schema:
[`../intent/experience/schema.json`](../intent/experience/schema.json).

## Storage

- One append-only JSONL file in the private workspace:
  `intent/experience/experience.jsonl`. Plain text, diffable, indexed by
  Memory Core like any workspace file.
- No database, no new dependency. If it ever outgrows a file, the library is
  the natural home (one table per record kind, same JSON).

## Rules that keep it honest

1. Only Matt confirms. Cupcake writes `draft`; principles become `confirmed`
   only on Matt's word.
2. Two strikes. Cupcake proposes a principle only after at least two
   supporting trajectories on different dates.
3. Contradictions surface. A `contradicts` edge on a confirmed principle is
   raised in the next scorecard, never silently dropped.
4. Every principle has `review_by`. Stale principles are re-asked, not
   assumed.
5. No raw values. `source` points at the scorecard line or library action;
   numbers stay in their stores.

## How it gets automated (later, each step separately approved)

1. **Scorecard parser (deterministic).** A small script reads confirmed
   `tried: … | result: … | because: … | goal: … | id: …` lines from new
   scorecards and appends `trajectory` records. No model call.
2. **Principle proposer (model, bounded).** Weekly, a cron turn reads the last
   N trajectories plus existing principles and proposes `draft` principles and
   edges, each citing ids. Output is JSONL only; a validator rejects anything
   that fails the schema or the two-strikes rule.
3. **Review in chat.** Cupcake asks Matt to confirm or reject each draft in one
   message. Confirmation appends a superseding `confirmed` record.
4. **Use at decision time.** When a request touches a goal, retrieval does a
   one-hop expansion: goal → confirmed principles → the trajectories behind
   them, and Cupcake cites the principle ("last two times you tried X it failed
   because Y").
5. **Guardian input.** Confirmed `dont` principles become extra lines in the
   guardian checklist's "matches goals" check.

The OpenClaw-native way to run steps 1 and 2 is a scheduled task on the
`ara` agent. That is a cron change on brain-01, so it is **not** part of this
PR.
