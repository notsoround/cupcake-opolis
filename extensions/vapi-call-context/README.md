# Vapi Call Context (Cupcake)

Direct Vapi call flow for Cupcake's voice agent, replacing the n8n Code nodes that built
call bodies. One owner assembles everything a call needs at call start:

- **welcome** (`firstMessage`, mirrored into `variableValues.welcome`)
- **system prompt**: Cupcake's persona (ported from the canonical private
  `voice-vault/build/persona.py`) + the call's mission + a live data block
- **voice** locked to `{ provider: "vapi", voiceId: "Clara", version: "2" }`
- **model** `xai / grok-4.20-0309-non-reasoning` (configurable)

Every value is rendered server-side. Nothing template-shaped reaches Vapi; assembly fails
loudly instead of shipping a blank (see "Placeholder bug" below).

## Surfaces

| Surface                                             | Entry                                                                                                               | Notes                                                                                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Vapi server URL (`assistant-request`, `tool-calls`) | `index.ts` (Gateway route `/plugins/vapi-call-context`) or `src/standalone.ts` (loopback `:8791/vapi/call-context`) | Verified with `X-Vapi-Secret` / `Authorization: Bearer` / optional HMAC before parsing. Fails closed without a secret.                                             |
| Outbound call                                       | `src/outbound.ts` `placeOutboundCall()`; CLI `src/cli.ts`                                                           | Dry run by default. Posts to `POST /call` only with `--send` **and** `CUPCAKE_VAPI_OUTBOUND_ENABLED=1`. Quiet hours 23:00–06:30 and a 25-minute double-ring guard. |
| n8n plaintext key checker                           | `scripts/scan-n8n-plaintext-keys.ts`                                                                                | Read-only SQLite open; prints locations and fingerprints, never values.                                                                                            |
| Secret generation (prep)                            | `scripts/generate-cupcake-secrets.sh`                                                                               | Writes new secrets to a new 0600 staging dir; changes nothing live.                                                                                                |

Runbooks: [`runbooks/key-rotation.md`](runbooks/key-rotation.md),
[`runbooks/n8n-voice-cutover.md`](runbooks/n8n-voice-cutover.md). Service unit example:
[`deploy/vapi-call-context.service`](deploy/vapi-call-context.service).

## Call routing (inbound `assistant-request`)

Mirrors the n8n "Cupcake Inbound Router" approved-phone-numbers policy:

- `call.type === "inboundPhoneCall"`, `phoneNumberId` matches, caller number normalized
  to E.164, outer `customer`/`phoneNumber` consistent — otherwise **public** assistant.
- Owner number → private Cupcake with live context (`assistantId` + `assistantOverrides`).
- Coach number → coach assistant (saved config; overrides not yet ported).
- Anyone else → public assistant. Unknown callers never get private data.
- 23:00–05:00 with `CUPCAKE_VAPI_NIGHT_ASSISTANT_ID` set → calm register on that
  tool-less assistant, no data fetched. Without it the live behavior is kept (day prompt
  plus "softer, brief tone at night").

If assembly throws, the call still connects on the saved owner assistant.

## Data sources

All fetched in parallel, each with its own timeout (`CUPCAKE_VAPI_SOURCE_TIMEOUT_MS`,
default 1500 ms) and a short TTL cache (`CUPCAKE_VAPI_CACHE_TTL_MS`, default 60 s). A
failed source is listed as "not available on this call" in the prompt; she is told not to
guess and not to claim anything is broken.

| Source                                                         | Status                   | Where it reads                                                                                                                                             |
| -------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Food totals 24h / 7d (kcal, protein, carbs, fat, sugar, meals) | **Real**                 | Cupcake library `POST /cupcake-library {action: "food_history"}` (127.0.0.1:8768, `food_meals` in `library.sqlite3`). Coverage is logged food photos only. |
| Current purchase amount + merchant                             | **Real**                 | Triggering event (bank alert). Merchant from the alert is fact; Plaid only enriches.                                                                       |
| Recent purchases / 7-day spend                                 | **Real**                 | Plaid `/transactions/get` (14 days, same as n8n "Plaid Lookup").                                                                                           |
| Last-call recap                                                | **Real**                 | Vapi `GET /call?assistantId&createdAtGe` → `analysis.summary`, else tail of `artifact.transcript`.                                                         |
| Glucose                                                        | **Partial**              | Owner-reported readings via library `glucose_manual_list`. **Not ported yet:** Libre 3 CGM is only in the n8n Libre3 workflow / Google Sheet.              |
| Coach overrides, sleep rescue, deferred overnight queue        | **Stubbed / not ported** | See the "Not ported yet" notes in `handler.ts` and `outbound.ts`.                                                                                          |

## Alarms

`src/alarms.ts` flags (configurable): `spend_single_high` ($25), `repeat_merchant`,
`food_spend_7d_high` ($150), `calories_24h_high` (3000), `sugar_24h_high` (75 g),
`glucose_high` (180), `glucose_low` (70, urgent). Missing sources are skipped, never
treated as "all clear". Flags appear in the prompt and as `variableValues.alarms`.

## Placeholder bug (fixed here)

The live Mpesa and Location system prompts contain n8n expressions such as
`{{ $json.amount }}` and `{{ $json.merchant_guess }}` inside plain Code-node strings. n8n
never evaluates expressions there, so Vapi received them raw and its Liquid renderer
blanked them: "CATEGORY: ", "Amount: $ | Merchant:  ()". Here every placeholder is a
`{{name}}` rendered by `src/template.ts`; a missing value throws, the rendered prompt is
checked for any surviving `{{`, `{%`, `$json`, or `${`, and untrusted values (merchant
names, transcripts) are stripped of brace sequences so data cannot be evaluated by Liquid.

## Persona and private data

The public repo carries the persona with personal facts parameterized:
`CUPCAKE_VAPI_OWNER_NAME`, `CUPCAKE_VAPI_OWNER_AGE`, `CUPCAKE_VAPI_SUPPORT_CONTACT_NAME`.
To run the exact private text, point `CUPCAKE_VAPI_PERSONA_FILE` at a JSON file (kept on
the host, outside git) with any of these keys: `ownerBrief`, `character`, `persuasion`,
`registerConfrontational`, `registerCalm`, `epistemics`, `toolRule`, `safetyFloor`,
`voiceRules`. Use `{{ownerName}}`-style placeholders only; n8n `{{ $json.x }}` syntax is
rejected at render time.

## Configuration

See the `Vapi call context` block in the repository `.env.example`. Secrets resolve from
`NAME`, `NAME_FILE`, or `$CREDENTIALS_DIRECTORY/<credential>` (systemd `LoadCredential=`):
`vapi-webhook-secret`, `vapi-webhook-hmac`, `vapi-api-key`, `cupcake-library-key`,
`plaid-client-id`, `plaid-secret`, `plaid-access-token`.

Mid-call tools: Vapi `assistantOverrides` cannot remove tools and Vapi withholds org
credentials from server URLs supplied in a request, so tools are referenced by
`CUPCAKE_VAPI_TOOL_IDS` (saved Vapi tools using a `credentialId`), never inlined with
header keys. The tool rule is only added to the prompt when tool IDs are configured.

## Tests

```bash
pnpm test extensions/vapi-call-context --maxWorkers=1
```
