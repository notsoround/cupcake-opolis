# Retiring n8n from Cupcake's voice path — migration runbook

> **Status: plan only.** No n8n workflow was edited or deactivated, nothing was deployed,
> and Vapi was not reconfigured. Each phase needs Matt's go-ahead.

## Target

```
Vapi phone number ──assistant-request──▶ nginx /vapi/call-context ──▶ vapi-call-context (127.0.0.1:8791)
                                                                        ├─ library food_history / glucose_manual_list
                                                                        ├─ Plaid /transactions/get
                                                                        └─ Vapi GET /call (last-call recap)
purchase / glucose / location detector ──placeOutboundCall()──▶ Vapi POST /call (assistantId + rendered overrides)
mid-call data tools ──saved Vapi tools (credentialId)──▶ brain (unchanged for now)
```

## Phase 0 — prerequisites

1. Matt approves the key-rotation plan (at least `vapi-webhook-secret` and a Vapi private
   API key for `GET /call`).
2. Host: checkout at `/opt/cupcake-opolis` with `pnpm install`; settings in
   `/etc/cupcake-vapi-call-context/env` (see `.env.example`); secrets via LoadCredential.
3. Optional private persona file at `/etc/cupcake-vapi-call-context/persona.json`
   (`CUPCAKE_VAPI_PERSONA_FILE`) with the verbatim voice-vault text.
4. Saved Vapi tools for lookup_spending, recent_bank_events, glucose_status, sleep_status,
   location_status, commitment_status, report_status, system_health, cupcake_command (and
   optionally `get_call_context` → this server URL), each with `credentialId`. Put their
   IDs in `CUPCAKE_VAPI_TOOL_IDS`.
5. A tool-less saved "Cupcake — Night" assistant → `CUPCAKE_VAPI_NIGHT_ASSISTANT_ID`.

## Phase 1 — shadow

1. Install `deploy/vapi-call-context.service`, start it, `curl 127.0.0.1:8791/healthz`.
2. Replay a synthetic `assistant-request` from loopback with the secret header and check
   the rendered `assistantOverrides` (no `{{`, Clara v2, correct model, data block).
3. CLI dry runs (no POST): `src/cli.ts --trigger purchase --amount 12.94 --merchant "Test"`.

## Phase 2 — inbound cutover

1. Vapi dashboard: Custom Credential (Bearer, header `X-Vapi-Secret`, no prefix) with the
   new `vapi-webhook-secret`.
2. Point the phone number's server URL from `…/webhook/cupcake-inbound` to
   `https://automate.hales.ai/vapi/call-context` with that `credentialId`. (It must be
   set on the saved phone number — request-supplied server URLs get no credential.)
3. Test calls: owner (private context), coach (coach assistant), unknown (public), and one
   after 23:00 if the night assistant exists.
4. Rollback: point the phone number back to `…/webhook/cupcake-inbound`.

## Phase 3 — outbound cutover

The purchase detector (Tasker webhook → classifier → Spend Gate → Dedupe → Quiet Hours)
still lives in "Matts Mpesa". Move in this order:

1. Replace "Build Call Context" + "Build Vapi Body" + "Ara Intervention Call" with a call to
   `placeOutboundCall()` (in-process from the future detector, or the CLI with `--send`
   and `CUPCAKE_VAPI_OUTBOUND_ENABLED=1`). Quiet hours and the double-ring guard move
   with it.
2. **TODO before retiring the workflow:** port the Spend Gate, Dedupe Gate, and the
   deferred overnight queue / 07:45 Morning Flush (n8n static data today).
3. Location and glucose calls use the same helper (`--trigger location|glucose`).

## Phase 4 — deactivate n8n voice workflows (after 48 h clean)

Deactivate (do not delete; keep for rollback 30 days):

| Workflow                                     | ID                 | When                                        |
| -------------------------------------------- | ------------------ | ------------------------------------------- |
| Cupcake Inbound Router                       | `OzmwqFPNr5axY6QO` | after Phase 2                               |
| Matts Mpesa — call branch                    | `SZeNPqmYxtptpzVP` | after Phase 3 step 2                        |
| Cupcake Location Interventions — call branch | `Dy4owG3feav6JSRd` | after Phase 3 step 3                        |
| Libre3 Glucose Tracker — call branch         | `Ct6VW2NLo5ZbjuDt` | after a CGM source is persisted outside n8n |

Stay on n8n for now (not ported): Cupcake Sleep Sentinel (night rescue call), Cupcake
Personal Actions (the coach call action), Cupcake Call Memory (end-of-call reports), Cupcake
Brain Connector (mid-call tools).

After each deactivation, re-run the plaintext-key checker; the rotation can only finish
once no active workflow carries a key.
