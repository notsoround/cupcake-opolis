# MCP exposure and Server Cards

## What exists today

Cupcake already exposes itself over MCP, on the hales droplet, both behind
OAuth (protected-resource metadata at
`/.well-known/oauth-protected-resource`), both speaking protocol `2025-11-25`:

| Server                                                   | Tools                                                                                                                                                                                                                       |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `https://connector.hales.ai/mcp`                         | `cupcake_status`, `cupcake_journal`, `cupcake_log`, plus review-only code drafts (`request_code_fix`, `code_fix_status`, `code_fix_result`, `cancel_code_fix`, `list_code_fixes`, `code_source_catalog`)                    |
| `https://connector.hales.ai/health/mcp` ("Cupcake Live") | `health_status`, `latest_signals`, `glucose_latest`, `manual_glucose_list`, `weight_list`, `personal_outcome_list`, `checkin_list`, and owner-requested writes `weight_add`, `weight_correct`, `glucose_add`, `checkin_add` |

Both already return `401` for `/server-card` and
`/.well-known/ai-catalog.json` (everything is behind auth).

## What a Server Card is (and is not)

Verified against SEP-2127 (Final, merged Oct 6, 2026) and the extension
schema in `modelcontextprotocol/ext-server-card`:

- A static JSON document describing a **remote** MCP server for discovery
  **before** connecting: `name` (reverse-DNS, one slash), `version`,
  `description` (max 100 chars), optional `title`, `websiteUrl`,
  `repository`, `icons`, `remotes` (URL, transport, headers/variables,
  `supportedProtocolVersions`) and namespaced `_meta`.
- Recommended location `/server-card`; domain-level discovery through an
  AI Catalog at `/.well-known/ai-catalog.json`.
- It deliberately **does not** list tools, resources, prompts, capabilities or
  extensions. Clients still learn those at runtime after auth. So the brief's
  "static JSON for capability discovery" is not quite right: it is
  **connection** discovery.
- Cards are public: no credentials, internal topology or user data.

## Drafts in this PR (not deployed)

- [`../mcp/server-card.draft.json`](../mcp/server-card.draft.json):
  `ai.hales/cupcake` → `https://connector.hales.ai/mcp`
- [`../mcp/health-server-card.draft.json`](../mcp/health-server-card.draft.json):
  `ai.hales/cupcake-live` → `https://connector.hales.ai/health/mcp`

Both validate against the published `ServerCard` JSON Schema (checked on
2026-11-01 with a scratch validator outside this repo). Before publishing,
confirm each `version` against the live `serverInfo`.

## Is publishing worth it?

Small upside, small risk:

- Upside: any client that supports cards can auto-configure the URL and
  protocol version; the card is the "clean on-ramp" the brief wants.
- Risk: it advertises that a private health server exists at a known URL.
  OAuth still protects it, but obscurity is also gone. Matt should decide.
- The real future-proofing is already done: Cupcake's data and memory sit
  behind MCP servers that any model can use. The model is swappable today.

If approved, the change is one static route per server in the connector
(serve the JSON at `/server-card` with `Content-Type: application/json`,
`Access-Control-Allow-Origin: *`, a cache header, unauthenticated), plus an
optional `/.well-known/ai-catalog.json` that links both cards. That is a
droplet change and is **not** part of this PR.

## Related updates worth tracking

- **Tasks extension** (`io.modelcontextprotocol/tasks`, spec version
  `2026-07-28`): long-running `tools/call` returns a task handle; the client
  polls `tasks/get`, answers `tasks/update`, cancels with `tasks/cancel`. Good
  fit for `request_code_fix`, which is already a submit-then-poll job today
  (`code_fix_status`). Adopting it would replace the hand-rolled polling
  tools with the standard ones; keep both during a transition.
- **Stateless by default** applies to the **C# SDK v2** (Streamable HTTP
  `Stateless` defaults to true). The Cupcake connectors are Python, so this is
  not directly relevant; they are effectively stateless request handlers
  already.
- **Agent Skills** (the `SKILL.md` folder format) was donated to the Agentic
  AI Foundation on Oct 22, 2026. Cupcake's repo `skills/*.md` are older flat
  notes, not `SKILL.md` folders; converting the useful ones would make them
  portable to any skills-aware client. Optional, low priority.
