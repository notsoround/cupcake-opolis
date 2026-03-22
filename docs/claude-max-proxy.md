# Claude Max API Proxy

Route Cupcake's Anthropic API calls through your **Claude Max subscription** (claude.ai)
instead of paying per-token API credits.

## Why

| Approach | Cost | Limit |
|----------|------|-------|
| Anthropic API | ~$15/M tokens (Opus 4.6) | Pay-per-use |
| Claude Max ($100/mo) | $100/mo flat | Rate-limited but generous |
| Claude Max ($200/mo) | $200/mo flat | Higher rate limits |

If you're using Claude heavily for Cupcake and already pay for a Max subscription,
the proxy approach eliminates per-token costs.

## Quick Start

### 1. Get your session cookie

1. Open [claude.ai](https://claude.ai) in Chrome
2. Open DevTools → Application → Storage → Cookies → `https://claude.ai`
3. Find `sessionKey` and copy its value (long string starting with `sk-ant-...`)

### 2. Configure

Add to `~/.openclaw/.env`:

```env
CUPCAKE_MAX_PROXY_ENABLED=true
CUPCAKE_MAX_PROXY_SESSION_KEY=sk-ant-sid01-your-session-key-here
CUPCAKE_MAX_PROXY_PORT=7199
# CUPCAKE_MAX_PROXY_ORG_ID=  # only needed for Team/Enterprise accounts
```

### 3. Start the proxy

```bash
# Foreground (development)
node scripts/claude-max-proxy.mjs

# Background with pm2 (recommended for persistent use)
npm install -g pm2
pm2 start scripts/claude-max-proxy.mjs --name cupcake-max-proxy
pm2 startup  # auto-start on reboot
pm2 save
```

### 4. Configure OpenClaw to use the proxy

Add to `~/.openclaw/openclaw.json` (under `agents.providers`):

```json
{
  "agents": {
    "model": "claude-max/claude-opus-4-6",
    "providers": [
      {
        "id": "claude-max",
        "name": "Claude Max (local proxy)",
        "api": "anthropic-messages",
        "baseURL": "http://127.0.0.1:7199",
        "apiKey": "not-used",
        "models": [
          {
            "id": "claude-opus-4-6",
            "name": "Claude Opus 4.6 (Max)",
            "contextWindow": 200000,
            "maxTokens": 32000,
            "cost": { "input": 0, "output": 0 }
          },
          {
            "id": "claude-sonnet-4-6",
            "name": "Claude Sonnet 4.6 (Max)",
            "contextWindow": 200000,
            "maxTokens": 16000,
            "cost": { "input": 0, "output": 0 }
          }
        ]
      }
    ]
  }
}
```

### 5. Verify

```bash
# Health check
curl http://localhost:7199/health

# Test a completion
curl http://localhost:7199/v1/messages \
  -H "content-type: application/json" \
  -d '{"model":"claude-opus-4-6","messages":[{"role":"user","content":"say hi"}],"max_tokens":100}'
```

## Session key rotation

The `sessionKey` cookie typically expires after ~30 days. When Cupcake starts
returning auth errors:

1. Get a new `sessionKey` from claude.ai cookies
2. Update `~/.openclaw/.env`
3. Restart the proxy: `pm2 restart cupcake-max-proxy`

## Alternative: Use the official ANTHROPIC_BASE_URL

If you prefer a different proxy solution (LiteLLM, OpenRouter, etc.):

```env
# In ~/.openclaw/.env
ANTHROPIC_BASE_URL=http://localhost:4000  # your proxy's base URL
ANTHROPIC_API_KEY=your-api-key
```

OpenClaw respects the standard `ANTHROPIC_BASE_URL` environment variable.

## Limitations

- This proxy uses Claude.ai's internal web API (unofficial). It may break if
  Anthropic changes their web interface.
- Tool/function calling support is simplified — complex multi-step tool chains
  may not work perfectly through the proxy.
- Vision/image inputs require additional proxy-side handling.
- For production workloads, the official Anthropic API with API credits is more
  reliable.

## Rate limits

Claude Max has soft rate limits (not hard token limits). If you hit limits,
the proxy will return errors that OpenClaw can fall back from (to Grok or Qwen3
via the existing fallback chain).

## Files

| File | Purpose |
|------|---------|
| `scripts/claude-max-proxy.mjs` | The proxy server |
| `docs/claude-max-proxy.md` | This document |
| `~/.openclaw/.env` | Your session key and config |
