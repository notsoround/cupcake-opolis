# Cupcake intent layer (proposal, Nov 1, 2026)

Status: **proposal for Matt's review**. Nothing here is loaded by the running
Gateway on brain-01, and nothing here changes runtime behavior. Merging this
directory changes no code, no config and no deploy.

## Read this first: this repo is public

`notsoround/cupcake-opolis` is a **public** fork of `openclaw/openclaw`. Every
file in this directory is therefore a **template or design doc only**. Matt's
real goals, daily focus and self-reviews must live in a private place:

- **Recommended:** the live Cupcake workspace on brain-01
  (`/home/openclaw/workspace-ara/intent/`), which is private, owner-only and
  already indexed by Memory Core.
- **Alternative:** a private repo (for example a new `notsoround/cupcake-intent`)
  checked out into that same workspace path.

Never commit filled-in goals, health numbers, money numbers, names of people
or call content to this repo.

## What is here

| Path                                                                               | What it is                                                            |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`intent/goals.md`](intent/goals.md)                                               | North-star template: prioritized goals with success criteria          |
| [`intent/attention.md`](intent/attention.md)                                       | One-focus-for-today template, with a staleness rule                   |
| [`intent/scorecard/`](intent/scorecard/README.md)                                  | Dated self-review format (README, template, a stub for 2026-11-01)    |
| [`intent/experience/`](intent/experience/README.md)                                | Experience-graph JSON Schema: trajectories linked to principles       |
| [`guardian/CHECKLIST.md`](guardian/CHECKLIST.md)                                   | Prompt-level guardian check for Code Cupcake's high-impact actions    |
| [`mcp/server-card.draft.json`](mcp/server-card.draft.json)                         | MCP Server Card draft for `connector.hales.ai` (not deployed)         |
| [`docs/architecture-today.md`](docs/architecture-today.md)                         | What actually runs today (repo layout, brain-01, droplet)             |
| [`docs/memory-tiers.md`](docs/memory-tiers.md)                                     | Five-tier memory evaluation, mapping and phased plan                  |
| [`docs/experience-graph.md`](docs/experience-graph.md)                             | Experience-graph design and automation path                           |
| [`docs/guardian.md`](docs/guardian.md)                                             | Guardian design, mapped to OWASP ACS and OpenClaw `before_tool_call`  |
| [`docs/mcp-server-card.md`](docs/mcp-server-card.md)                               | MCP exposure plan and what the Server Card can and cannot say         |
| [`docs/proactive-briefing.md`](docs/proactive-briefing.md)                         | 7 AM briefing: inputs today, gaps, proposed change                    |
| [`docs/session-start-hook.md`](docs/session-start-hook.md)                         | How goals/attention get read at session start (options, none applied) |
| [`docs/claims-verification-2026-11-01.md`](docs/claims-verification-2026-11-01.md) | What the design brief claimed vs what is true, with links             |

## Why a new top-level `cupcake/` directory

The repo root is upstream OpenClaw. Cupcake-specific material is scattered
(`CUPCAKE-README.md`, `PLAN.md`, root `SOUL.md`, `prompts/`, `skills/*.md`,
`extensions/cupcake-nutrition`, `extensions/vapi-call-context`,
`scripts/cupcake-*`). `docs/` is the upstream Mintlify site with its own nav,
lint and i18n checks, so Cupcake design docs do not belong there. One
`cupcake/` directory keeps the fork's own material in one place and makes
upstream merges painless. See
[`docs/architecture-today.md`](docs/architecture-today.md#what-id-consolidate-later-nothing-deleted-in-this-pr)
for what could move here later. **Nothing is moved or deleted in this PR.**
