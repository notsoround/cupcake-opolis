# here.now Agent-Native Hosting

Cupcake can publish generated artifacts (HTML pages, PDFs, images, reports) to
publicly accessible URLs without any backend infrastructure. This is the
**agent-native hosting** approach: the bot handles the entire publish flow itself.

## What "agent-native hosting" means

Traditional workflow:
1. Agent generates a file
2. Human downloads it
3. Human uploads it somewhere

Agent-native workflow:
1. Agent generates a file
2. Agent publishes it → returns a URL
3. Human clicks the link

## Quick start (zero config)

No setup required for the default backend (transfer.sh):

```bash
# Generate a file and publish it
node scripts/here-now-publish.mjs /path/to/report.html
# → https://transfer.sh/abc123/report.html
```

Or from Cupcake directly:
> "Generate a market research report as HTML and share a link with me"

Cupcake will generate the HTML, run `here-now-publish.mjs`, and paste the URL.

## Backends

### 1. transfer.sh (default — no config needed)

[transfer.sh](https://transfer.sh) is a free, privacy-respecting file transfer service.

- **No auth required**
- **14-day TTL** (files auto-expire)
- **10GB max** per file
- **All file types** supported

```env
HERE_NOW_BACKEND=transfer
HERE_NOW_TRANSFER_URL=https://transfer.sh  # or self-hosted instance
```

### 2. GitHub Gist

Best for text-based artifacts (HTML, Markdown, JSON, CSV) that should persist.

**Setup:**
1. Create a GitHub personal access token: https://github.com/settings/tokens
   - Grant the `gist` scope
2. Add to `~/.openclaw/.env`:
   ```env
   HERE_NOW_BACKEND=gist
   GITHUB_TOKEN=ghp_your_token_here
   ```

Published gists appear at `gist.github.com` and have permanent URLs.

### 3. Fly.io Static Hosting

Best for production artifacts and large files that need to persist long-term.

**Prerequisites:**
- A Fly.io account and app deployed (your Cupcake instance)
- Tigris object storage enabled on your Fly.io app

**Setup:**
```bash
# Install flyctl
curl -L https://fly.io/install.sh | sh

# Authenticate
flyctl auth login

# Get your token
flyctl tokens create deploy -x 999999h  # or use FLY_API_TOKEN from fly.io dashboard

# Enable Tigris storage
flyctl storage create --app cupcake-opolis
```

Then in `~/.openclaw/.env`:
```env
HERE_NOW_BACKEND=fly
FLY_API_TOKEN=FlyV1_your_token_here
FLY_APP_NAME=cupcake-opolis
```

### 4. Self-hosted / Custom

You can point `HERE_NOW_TRANSFER_URL` at any transfer.sh-compatible endpoint
(e.g., your own instance of [transfer.sh](https://github.com/dutchcoders/transfer.sh)):

```env
HERE_NOW_TRANSFER_URL=https://your-instance.example.com
```

## Example: Full report generation + publish pipeline

```bash
# 1. Generate HTML report
python3 - << 'EOF' > /tmp/daily-report.html
import datetime, json, pathlib

log_path = pathlib.Path.home() / '.openclaw/logs/activity.jsonl'
events = [json.loads(l) for l in log_path.read_text().splitlines() if l.strip()]
today = datetime.date.today().isoformat()
today_events = [e for e in events if e['ts'].startswith(today)]

html = f"""<!DOCTYPE html>
<html>
<head><title>Cupcake Daily Report — {today}</title>
<style>body{{font-family:sans-serif;max-width:800px;margin:2rem auto}}
table{{border-collapse:collapse;width:100%}}td,th{{border:1px solid #ddd;padding:8px}}</style>
</head>
<body>
<h1>🎀 Cupcake Daily Report</h1>
<p>Date: {today} | Events: {len(today_events)}</p>
<h2>Event Summary</h2>
<table><tr><th>Event</th><th>Count</th></tr>
{''.join(f'<tr><td>{k}</td><td>{v}</td></tr>'
  for k, v in sorted(dict.fromkeys(e['event'] for e in today_events).items(),
  key=lambda x: -sum(1 for e in today_events if e['event']==x[0])))
  .replace('{', '').replace('}', '')}
</table>
</body></html>"""
print(html)
EOF

# 2. Publish it
node scripts/here-now-publish.mjs /tmp/daily-report.html
```

## Integration with the heartbeat cron job

The nightly heartbeat (`scripts/cupcake-heartbeat-install.mjs`) can be extended
to publish an HTML digest:

In `~/.openclaw/openclaw.json`, update the heartbeat job payload to include:
```
"...then generate an HTML version of the summary and publish it using
the here.now skill. Share the link in the Telegram digest."
```

## Files

| File | Purpose |
|------|---------|
| `scripts/here-now-publish.mjs` | Publish script (callable from agent tools) |
| `skills/here-now.md` | OpenClaw skill file — teaches Cupcake how to publish |
| `docs/here-now-hosting.md` | This documentation |

## Supported MIME types for direct browser preview

- **HTML** (`.html`) — renders directly, no download needed
- **PDF** (`.pdf`) — in-browser PDF viewer
- **Images** (`.png`, `.jpg`, `.gif`, `.svg`) — displays inline
- **Text** (`.txt`, `.md`) — renders as plain text
- All others — download prompt
