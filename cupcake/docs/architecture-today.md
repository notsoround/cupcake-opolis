# Cupcake architecture today (verified read-only, Nov 1, 2026)

Method: read-only inspection of this repo at `origin/main` `81edfb7fc`, of
brain-01 and of the hales droplet (file listings, `systemctl`, read-only
SQLite opens), on 2026-11-01 around 7:40 AM CST. Nothing was changed on
either host. Counts and personal values are deliberately left out of this
public file.

## 1. This repo

`notsoround/cupcake-opolis` is a **public** fork of `openclaw/openclaw`
(upstream merge `2026.10.4`, Oct 17). Almost everything at the root is
upstream OpenClaw: `src/` (Gateway, agents, memory host), `extensions/`
(bundled plugins), `ui/` (Control UI, Lit), `apps/` (macOS/iOS/Android),
`packages/`, `docs/` (Mintlify site), `skills/`, `scripts/`, `test/`, `qa/`.

Cupcake-specific material (the fork's own commits, PRs #1 to #10):

| Where                                                     | What                                                           |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `CUPCAKE-README.md`, `PLAN.md`, root `SOUL.md`            | Persona, the Oct 18 one-app plan, persona manifesto            |
| `prompts/{claude,grok,qwen}-prompt.md`                    | Per-model persona prompts                                      |
| `skills/*.md` (drama-slider, hales-ai-info, …)            | Cupcake skill notes                                            |
| `extensions/cupcake-nutrition`                            | Read-only `nutrition.*` Gateway methods over the library       |
| `extensions/vapi-call-context`                            | Vapi assistant-request/tool-calls server (runs on the droplet) |
| `scripts/cupcake-heartbeat-*`, `cupcake-metrics-cron.mjs` | Heartbeat/metrics cron installers                              |
| `ui/src/pages/nutrition/*`, `ui/src/app/accent-heat.ts`   | Today/nutrition UI (frozen by `PLAN.md`)                       |
| `docs/IDEAS.md`                                           | Product backlog                                                |

**Not in any repo:** the `cupcake-brain` plugin (`@matt/cupcake-brain` 0.2.1)
that gives the live agent its tools (library search, sleep/weight/glucose
status, spending lookups, calls, email, calendar, `deploy_hales_ai`,
`rollback_hales_ai`, approve/deny). It exists only under
`~/.openclaw/extensions/` on brain-01. That is the biggest source-control gap
found.

## 2. brain-01 (the brain)

- `openclaw.service` runs
  `/opt/openclaw-releases/2026.10.4-cupcake-81edfb7/…/openclaw.mjs gateway`.
  **Deployed commit = `81edfb7` = current `origin/main`.** Older release dirs
  are kept for rollback.
- Two agents:
  - **`ara`** is the actual Cupcake (IDENTITY name "Cupcake"); Telegram and
    WhatsApp are bound to it. Workspace `/home/openclaw/workspace-ara`:
    `AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `DREAMS.md`, plus
    `memory/` with subfolders (calls, entities, ideas, projects, transcripts,
    reviewed-notes, inbox, dreaming) and `memory/MEMORY.md`.
  - **`main`** is a near-default agent (blank identity). Workspace
    `/home/openclaw/workspace-brain/main`. It has no `MEMORY.md` and no daily
    notes; its memory index is empty.
- Memory Core is on, `memory.search.provider: local`, sources `memory` +
  `sessions`, `rememberAcrossConversations: true`.
- Memory Dreaming is on (3 AM America/Chicago). The `Memory Dreaming Promotion`
  cron job runs and reports `ok`, but the last phase reports on disk are from
  Oct 17 and the last deep report ranked 0 candidates. Empty sweeps write no
  files, so this probably means "nothing eligible", not "broken". Worth a
  look (read-only) before relying on promotion.
- Cron store: `Memory Dreaming Promotion`, `heartbeat-ara` (every 30 min),
  `skill-collection-review-{main,ara}`. Rows for an OpenClaw "Morning
  Briefing", "Daily Cost Check" and two Ara nudges sit under the **old Mac
  store key** and have not run since late August. They are legacy, not live.
- Private memory bridges in `/usr/local/lib/cupcake-memory-events/`:
  reviewed notes, conversation capture, call-memory publish and a memory
  outbox that publishes source events to the library.

## 3. The hales droplet (data and pipes)

- `cupcake-library.service` (`/opt/cupcake-library/server.py` + modules,
  deployed from `notsoround/voice-vault` `build/`): SQLite at
  `/var/lib/cupcake-library/` (`library.sqlite3`, `source-events.sqlite3`,
  `pending-actions.sqlite3`). Search is **FTS5 BM25 only**, no vectors.
- Library tables relevant here: RingConn nights (snapshots + heads), phone
  daily uploads (steps etc.), weight, food meals/items, exercise entries,
  receipts, reconcile (`recon_*`, Plaid/bank alerts/receipts), talk sessions
  and lines, quick chat, personal outcomes, decisions, analyses, projects,
  coach plan and body check-ins, Robyn viewer tokens/notes/chat log, source
  events.
- `cupcake-connector.service` (`https://connector.hales.ai/mcp`: status,
  journal, log, code drafts) and `cupcake-health-connector.service`
  (`https://connector.hales.ai/health/mcp`: Cupcake Live). Both speak MCP
  protocol `2025-11-25`, behind OAuth.
- `cupcake-recordings`, `cupcake-vapi-call-context` services.
- n8n 2.37.10 (host process, `/root/.n8n/database.sqlite`): the
  **Cupcake Morning Briefing** workflow runs daily at 7 AM CT and succeeded
  every day this week. See [`proactive-briefing.md`](proactive-briefing.md).
- `hales-ai-website` container serves `https://hales.ai/cupcake` (the only
  public Cupcake app, per `PLAN.md`).

## What I'd consolidate later (nothing deleted in this PR)

| Today                                              | Proposed                                              | Why                                                                             |
| -------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------- |
| `cupcake-brain` plugin only on brain-01            | Add it to this repo as `extensions/cupcake-brain`     | Live agent tools with deploy/email/call powers have no history or review        |
| Root `SOUL.md`, `prompts/`, `CUPCAKE-README.md`    | Move under `cupcake/persona/`                         | Root `SOUL.md` is not what brain-01 loads (workspace copy is); misleading       |
| `main` agent (blank identity, empty memory)        | Retire or give it a clear job                         | Two agents split memory; Cupcake is `ara`                                       |
| Legacy Mac-store cron rows (Morning Briefing etc.) | Remove via `openclaw cron` after Matt confirms        | They look live in the UI but have not run since August                          |
| `ara` `memory/MEMORY.md` (inside `memory/`)        | Check whether it should be workspace-root `MEMORY.md` | Only root `MEMORY.md` is injected at session start; this one is only searchable |
| `ui/src/pages/nutrition/*` Today UI                | Keep frozen, remove after hales.ai cut-over           | `PLAN.md` already decided hales-ai-website is the app                           |

Every row above needs Matt's go-ahead and its own PR.
