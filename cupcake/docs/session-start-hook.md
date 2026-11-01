# Reading goals and attention at session start

Status: **documented, not applied.** No config or workspace file on brain-01
was changed.

## Constraint found

OpenClaw injects workspace bootstrap files at session start, but only these
basenames: `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `BOOTSTRAP.md`,
`MEMORY.md` (`docs/concepts/agent-workspace.md`,
`docs/automation/hooks/bundled-hooks.md`). The bundled `bootstrap-extra-files`
hook accepts extra paths but **still only those six basenames**, so it cannot
inject `goals.md` or `attention.md` directly. A config-only change therefore
does not work, and none was made.

Also: the agent Matt talks to is **`ara`** (workspace
`/home/openclaw/workspace-ara`), not `main`.

## Options

**A. One line in the workspace `AGENTS.md` (recommended).** The `ara` workspace
`AGENTS.md` already has a "Session Startup" section that is injected every
session. Add:

```md
- In private sessions with Matt, read `intent/goals.md` and `intent/attention.md`
  before replying to the first message. If `attention.md` is not dated today
  (America/Chicago), ask Matt for today's one focus in one short line.
```

The agent then reads the files with its normal file tool. Cost: one file read
per new session. Risk: none to other agents; reversible by deleting the line.
This is a workspace edit on brain-01, made by Matt or with his explicit OK.

**B. Fold the north star into `USER.md`.** OpenClaw's `USER.md` is meant for
"active-project context" as dated directives and is always injected, but it
has a hard 4,000-character cap shared with everything else in it. Good for a
three-line summary of the top goal, not for the full file.

**C. Plugin hook (later).** A small `agent:bootstrap` hook in the
`cupcake-brain` plugin could inject `intent/goals.md` and today's
`attention.md` as context, with a staleness flag. Cleanest long-term, but it
is code on brain-01 and needs the plugin in source control first.

**D. Standing intent.** Not a fit: standing intents fire on keywords, not on
session start.

Recommendation: A now, C once `cupcake-brain` is in this repo.
