# Cupcake webhook key rotation — PREP ONLY

> **Status: pending Matt's approval. Nothing in this document has been executed.** No key
> was rotated, no workflow edited, no service restarted.

## Why

Two shared secrets are hardcoded as plaintext in n8n workflow code (Code-node strings and
HTTP header parameters) and are sent inline inside Vapi call bodies:

- `X-Cupcake-Brain-Key` — Vapi tools → `/webhook/cupcake-brain`
- `X-Cupcake-Key` — n8n ↔ library / commitment / recordings webhooks

The read-only checker (2026-10-17) found **22 references across 13 active workflows,
2 distinct values**: Matts Mpesa, Cupcake Location Interventions, Libre3 Glucose Tracker,
Cupcake Sleep Sentinel, Cupcake Inbound Router, Cupcake Personal Actions, Cupcake Call
Memory, Cupcake Delivery Watch, Cupcake Brain Connector, Cupcake Commitment Closer,
Cupcake Voice-to-Telegram Bridge, Cupcake Private Voice Session, the weekly coach wellness
report. Because the keys ride inside `assistantOverrides` / tool definitions, they are
also visible to anything that can read Vapi call records.

## 0. Inventory (read-only, safe to run any time)

```bash
cd /opt/cupcake-opolis   # a checkout with node_modules
node --import ./scripts/tsx.mjs extensions/vapi-call-context/scripts/scan-n8n-plaintext-keys.ts \
  --db /root/.n8n/database.sqlite
```

Prints workflow / node / header name / 12-char fingerprint. Never prints values. Exit 1
while plaintext keys remain.

## 1. Generate (prep, writes only to a new staging dir)

```bash
sudo extensions/vapi-call-context/scripts/generate-cupcake-secrets.sh /root/cupcake-rotation-YYYYMMDD
```

One secret per trust boundary (they were shared before):

| Staged file           | Used by                        | Store in                                                                                                          |
| --------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `vapi-webhook-secret` | Vapi → call-context server URL | Vapi Custom Credential (Bearer, header `X-Vapi-Secret` or `Authorization`) + `LoadCredential=vapi-webhook-secret` |
| `cupcake-brain-key`   | Vapi saved tools → brain       | Vapi Custom Credential on the **saved tools** (`credentialId`), n8n credential on the receiver                    |
| `cupcake-webhook-key` | n8n webhook callers            | n8n **Header Auth credential** (not Code-node strings)                                                            |
| `cupcake-library-key` | owner access to the library    | `/etc/cupcake-recordings/access-key` (already a file) → `LoadCredential=cupcake-library-key`                      |

## 2. Apply (requires approval; do in a maintenance window)

1. Receivers dual-accept: brain connector and library accept old **and** new key for the
   window. (The library compares a single key today — `server.py` `owner()`; dual-accept
   needs a small change there, outside this repo.)
2. Move senders off plaintext:
   - Vapi tools: create saved tools with `credentialId`; reference them via
     `CUPCAKE_VAPI_TOOL_IDS` / `model.toolIds`. Remove inline `server.headers`.
   - n8n HTTP Request nodes: switch to `genericCredentialType` + Header Auth credential.
   - n8n Code nodes that build Vapi bodies: retired by the cutover runbook; until then,
     read the key from an n8n credential/variable, never a string literal.
3. Install the new values as systemd credentials (never in `Environment=` or env files):
   `install -m 0600` into `/etc/cupcake-vapi-call-context/`, then the drop-in printed by
   the generator.
4. Re-run the checker until it exits 0.
5. Remove the old key from the receivers' accept list. Revoke/replace the Vapi private API
   key used by n8n if it was ever pasted into workflow code.

## 3. Verify

- Checker exits 0.
- Call-context: unsigned request → 401; signed request → 200.
- One owner test call: tools answer (brain logs show the new key fingerprint).
- `journalctl -u vapi-call-context` shows no `rejected request` lines from Vapi.

## Rollback

Receivers still accept the old key until step 5, so any sender can be pointed back. After
step 5, rollback means re-adding the old key to the accept list.
