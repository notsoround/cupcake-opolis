# Guardian: a thin supervisor for Code Cupcake

## What the standard actually says

The brief cited an "OWASP Agent Control Standard (Sept 2026)". It exists:
**Agent Control Standard (ACS)**, an OWASP GenAI Security Project resource
dated **Sept 1, 2026**, spec **v0.1.0**
([OWASP page](https://genai.owasp.org/resource/agent-control-standard-acs/),
[spec](https://genai-security-project.github.io/agent-control-standard/docs/spec/instrument/specification/),
[repo](https://github.com/GenAI-Security-Project/agent-control-standard),
Apache-2.0). Its model:

- An **Observed Agent** sends lifecycle hooks (notably `toolCallRequest`
  before a tool runs and `toolCallResult` before its output is ingested) to a
  separate **Guardian Agent** over an authenticated channel.
- The Guardian answers with a disposition: `allow`, `deny`, `ask` (route to a
  human/approver), `defer`, and SHOULD support `modify`.
- Deterministic policy (Cedar/Rego) runs first; an LLM layer is optional.
- Note: ACS's default failure posture is **proceed** unless configured to
  deny. Cupcake's guardian deliberately chooses fail-closed for high-impact
  actions.

The brief's "escalate" is ACS's `ask`.

## Design for Cupcake: start at the prompt level

No new service, no new identity infrastructure yet.

1. **Where it runs.** A separate reviewer pass, not the planner's own
   self-check: a fresh session (or sub-agent) with only
   [`../guardian/CHECKLIST.md`](../guardian/CHECKLIST.md), the planned action
   and its evidence. Prefer a different model from the planner so the two
   don't share blind spots. This approximates ACS's "outside the trust
   boundary" without building one.
2. **What it reviews.** Code Cupcake's high-impact moves: deploy/rollback
   tools, outbound email/calls/messages, writes to Matt's health, money or
   memory records, merges, paid inference, anything touching secrets or live
   config (full list in the checklist).
3. **Verdicts.** `allow`, `modify` (re-reviewed, never auto-run), `deny`,
   `escalate` (to Matt, with one question).
4. **Fail closed.** High impact + any failed or unverifiable check → deny or
   escalate. Never allow.
5. **Confidence floor.** Below 0.80 → escalate, any tier. High impact below
   0.95 → escalate.
6. **Logging.** Each verdict is one `cupcake_log` journal entry
   (`kind: review`) with the verdict and reason, no personal values.

## Phase 2: real enforcement point (later, separate PR)

OpenClaw already has the hook that matches ACS's `toolCallRequest`:
`before_tool_call` (`docs/plugins/hooks/tool-policy.md`). A plugin handler
can return `block` (deny), rewritten `params` (modify) or `requireApproval`
(ask/escalate, which pauses the run and asks Matt through plugin approvals),
and it sees `ctx.requester.senderIsOwner`. So the path is:

1. Put `cupcake-brain` under source control (it is not today).
2. Add a `before_tool_call` handler for the high-impact tool names that:
   runs deterministic rules first (deny list, owner check, time windows),
   then calls the guardian prompt on a separate model, then maps the verdict
   to `block` / `params` / `requireApproval`. Timeout or error on a high-impact
   tool → `block` (fail closed).
3. Ship it observe-only first (log verdicts, never block) for a week, compare
   against what Matt would have wanted, then turn on enforcement.

## Inspiration

Baseline Bob, a separate teammate bot, already has the instinct to call out
Matt's bullshit. Guardian points that instinct at Code Cupcake's own
correctness. It borrows the attitude only; it is not connected to Bob.
