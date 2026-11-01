# experience/: trajectories linked to principles

Design: [`../../docs/experience-graph.md`](../../docs/experience-graph.md).
Schema: [`schema.json`](schema.json) (`cupcake.experience.v1`).

The live file is `intent/experience/experience.jsonl` in the **private**
workspace. Nothing real goes in this public repo.

## Shape (placeholder example, not real data)

```jsonl
{"kind":"trajectory","id":"t-20261101-1","date":"2026-11-01","tried":"<what was tried>","result":"failed","because":"<why>","goal":"G1","domain":"other","source":"scorecard/2026-11-01.md#L20","provenance":{"author":"matt","status":"confirmed"}}
{"kind":"principle","id":"p-example-rule","statement":"<don't do Z when Y>","polarity":"dont","review_by":"2026-12-01","provenance":{"author":"cupcake","status":"draft"}}
{"kind":"edge","from":"t-20261101-1","to":"p-example-rule","rel":"supports","provenance":{"author":"cupcake","status":"draft"}}
```

## Rules

- Append-only. To correct a record, append a new one with
  `provenance.supersedes`.
- Cupcake may append `draft` records. Only Matt's confirmation makes a
  principle `confirmed`; only confirmed principles may be copied into the
  "Standing principles" section of `goals.md`.
- A principle needs at least two `supports` edges from different dates before
  Cupcake proposes it (one bad day is not a rule).
- `source` points at a file and line or a library action name. Never copy raw
  health or money values into this file.
