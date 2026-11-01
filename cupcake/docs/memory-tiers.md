# Memory tiers: evaluation, mapping and phased plan

Scope of this PR: **mapping and plan only.** No store is rewritten, migrated
or reconfigured. brain-01's Automations, Heartbeat, Memory Dreaming and
Promotion config are not touched.

## 1. What the brief proposed, and what it actually is

The brief cited `shawnhack/exocortex` as "MIT's" local-first memory system.
Verified facts (details and links in
[`claims-verification-2026-11-01.md`](claims-verification-2026-11-01.md)):

- It is a **personal project by one developer** (Shawn Hack), MIT **license**,
  not the Massachusetts Institute of Technology. 1 star, created Jan 2026, last
  push Sep 28, 2026.
- Its README lists five tiers: working (24h auto-expire), episodic (decays),
  semantic (permanent), procedural (permanent) and **reference** (permanent).
  Hybrid retrieval (vector + BM25 + graph, fused with RRF) is the search
  layer, not a tier.
- "97% on LongMemEval" is **self-reported Recall@5** (retrieval only, 470 of
  500 questions, abstention excluded) using two-pass FTS5 + RRF. It is not the
  benchmark's end-to-end QA accuracy and is not comparable to published
  LongMemEval scores.
- MCP setup is one `claude mcp add …` line **after** cloning and building it
  locally.

**Recommendation: do not adopt Exocortex as a component.** It would be a third
memory store next to OpenClaw Memory Core and the Cupcake library, it is a
1-star single-maintainer project, and its headline number measures retrieval,
not answers. Adopt three **ideas** from it instead: tier labels as metadata,
RRF fusion, and one-hop link expansion.

## 2. What Cupcake already has (this matters more)

OpenClaw Memory Core, already running on brain-01, is closer to the brief
than the brief assumed (see `docs/concepts/memory-architecture.md`,
`memory-search.md`, `dreaming.md` in this repo):

- tiers: instructions, curated core (`MEMORY.md`, `USER.md`), episodic
  (`memory/YYYY-MM-DD.md` + transcripts), prospective (standing intents, cron),
  review (`DREAMS.md`)
- search: vector + BM25 in parallel, weighted merge, then
  `relevance × recency decay × importance`, then MMR. Dated notes decay with
  a **30-day half-life**; curated files are evergreen
- provenance on every chunk (owner / agent / untrusted / system) and a
  structural gate so untrusted content can never be promoted
- dreaming (light, REM, deep) promotes recalled-often episodic facts into
  `MEMORY.md`

What it lacks versus the brief: RRF (it uses a weighted merge), graph
expansion, and an explicit 24h working tier. And on brain-01 it is **barely
fed**: the `main` agent's index is empty, `ara` has one dated daily note and a
small index. Most of Cupcake's real memory lives in the library on the
droplet, which Memory Core does not index and which has BM25 only.

## 3. Mapping: brief tier → what exists → where it goes

| Tier (brief)               | Exists today                                                                                                                                                                                                             | Maps to                                                                                                                                     | Migrate?                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Working** (24h expiry)   | Session context + compaction flush; standing intents (expiry); library `pending-actions`; nothing that holds "today's focus"                                                                                             | `intent/attention.md` (dated; stale after midnight CT) + existing session context                                                           | **New file only.** No data moves                             |
| **Episodic** (decays)      | `memory/YYYY-MM-DD.md`, session transcripts, `ara` `memory/{calls,transcripts,reviewed-notes,inbox}`; library talk, quick chat, call memory, RingConn nights, phone daily, food, exercise, receipts, reconcile, outcomes | Keep each where it is. Add `intent/scorecard/YYYY-MM-DD.md` in the `ara` workspace so Memory Core indexes it with its existing 30-day decay | **Scorecards: yes** (clean fit). Sensor/finance rows: **no** |
| **Semantic** (permanent)   | `MEMORY.md`, `USER.md`, `ara` `memory/{entities,projects}`; library documents/chunks, decisions, analyses, coach plan                                                                                                    | `intent/goals.md` + confirmed principles; dreaming keeps promoting into `MEMORY.md`                                                         | **goals.md: new.** Library docs stay in library              |
| **Procedural** (permanent) | `AGENTS.md`, `SOUL.md`, workspace `skills/`, repo `skills/*.md`, `custodian-skills/`                                                                                                                                     | Unchanged, plus confirmed "do/don't" principles from the experience graph, and `guardian/CHECKLIST.md`                                      | **No move.** Add principles over time                        |
| **Reference** (Exocortex)  | Library imports, recordings, receipts photos                                                                                                                                                                             | Unchanged (library is the source of truth)                                                                                                  | No                                                           |
| **Hybrid retrieval**       | Memory Core: vector + BM25 + recency + importance + MMR. Library: BM25 only. No cross-store query                                                                                                                        | Phase 3: one fused query across both, RRF, plus one hop over experience-graph edges                                                         | Code change later, not now                                   |

Why sensor and money data do **not** migrate into agent memory: they are
time series with their own validation, provenance and backups (RingConn
receipts, Plaid reconcile links, weight versions). Copying them into Markdown
memory would duplicate private values into a less controlled store. The agent
should **query** them (cupcake-brain tools, Cupcake Live MCP, briefing),
not remember them. Only conclusions Matt confirms ("late meals wreck my
sleep") belong in memory, and they enter through scorecards and principles.

## 4. Phased plan

**Phase 0, this PR (done):** templates, mapping, schemas, guardian checklist,
Server Card drafts. No runtime change.

**Phase 1, files in the private workspace (Matt, ~30 min, reversible):**

1. Create `/home/openclaw/workspace-ara/intent/` with `goals.md`,
   `attention.md`, `scorecard/`, `experience/` copied from these templates.
2. Fill `goals.md` and today's `attention.md`.
3. Add one line to the `ara` workspace `AGENTS.md` "Session Startup" section
   (see [`session-start-hook.md`](session-start-hook.md), option A).
4. Read-only check: is `ara`'s `memory/MEMORY.md` meant to be the root
   `MEMORY.md`? Is dreaming finding zero candidates because nothing is
   eligible?

**Phase 2, pressure (needs separate approval per item):**

1. Briefing reads `attention.md` freshness and asks for a focus when stale
   ([`proactive-briefing.md`](proactive-briefing.md)).
2. Weekly scorecard nudge after the Wednesday digest; Cupcake pre-fills
   sourced numbers as `draft` lines.
3. Cupcake appends `draft` trajectories/principles to `experience.jsonl`
   ([`experience-graph.md`](experience-graph.md)).

**Phase 3, retrieval (code, own PRs, tests):**

1. Library: add a read-only `memory_search`-style action that returns ranked
   chunks with ids, so the brain can fuse both stores.
2. Brain side (`cupcake-brain` plugin, once it is in source control): fuse
   Memory Core results and library results with RRF (`score = Σ 1/(60 + rank)`),
   then expand one hop over `experience.jsonl` edges (trajectory → principle →
   goal). No new dependency: RRF is a few lines.
3. Evaluate on a small private question set before switching anything on.

**Phase 4, optional:** tier metadata (`tier: working|episodic|semantic|procedural`)
in front-matter of workspace files, if retrieval tuning needs it. Revisit
Exocortex only if it gains maintainers and an end-to-end benchmark.
