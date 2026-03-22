# here.now — Agent-Native Artifact Publisher

Publish any file (HTML report, PDF, image, CSV) to a public URL instantly.
No backend needed. No manual upload. Just generate and share.

## When to use this skill

Use whenever the user asks you to:
- "publish this report" / "share this file" / "give me a link"
- "generate a PDF and send it"
- "create an HTML page I can share"
- "upload this to somewhere I can access it"
- Any time you've generated an artifact and want to make it publicly accessible

## How to publish

### Simple file publish (transfer.sh — no auth needed)
```bash
node scripts/here-now-publish.mjs /path/to/file.html
```

### Publish from generated content
```bash
# Generate HTML content and pipe directly
python3 -c "print('<html><body><h1>Cupcake Report</h1></body></html>')" | \
  node scripts/here-now-publish.mjs --stdin --name report.html
```

### Publish with specific backend
```bash
# GitHub Gist (text files, permanent, requires GITHUB_TOKEN)
node scripts/here-now-publish.mjs report.md --backend gist

# Fly.io (requires FLY_API_TOKEN + FLY_APP_NAME)
node scripts/here-now-publish.mjs report.html --backend fly
```

### Publish a PDF
```bash
# Generate PDF first (using the pdf skill or wkhtmltopdf)
wkhtmltopdf report.html /tmp/report.pdf
node scripts/here-now-publish.mjs /tmp/report.pdf
```

## Output format

The command outputs JSON:
```json
{
  "success": true,
  "url": "https://transfer.sh/abc123/report.html",
  "backend": "transfer.sh",
  "ttl": "14 days",
  "fileName": "report.html"
}
```

Always share the `url` field with the user.

## Full example: generate + publish a report

```bash
# Step 1: Write an HTML report to a temp file
cat > /tmp/cupcake-report.html << 'EOF'
<!DOCTYPE html>
<html>
<head><title>Cupcake Daily Report</title>
<style>body{font-family:sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem}</style>
</head>
<body>
<h1>🎀 Cupcake Daily Report</h1>
<p>Generated: 2026-03-21</p>
<!-- report content here -->
</body>
</html>
EOF

# Step 2: Publish it
node scripts/here-now-publish.mjs /tmp/cupcake-report.html
```

## Supported file types

| Extension | MIME type | Notes |
|-----------|-----------|-------|
| `.html` | text/html | Renders in browser |
| `.pdf` | application/pdf | Opens in PDF viewer |
| `.png`, `.jpg`, `.gif` | image/* | Displays directly |
| `.svg` | image/svg+xml | Renders as image |
| `.md` | text/markdown | Raw text |
| `.json`, `.csv` | application/* | Downloads |
| `.txt` | text/plain | Displays as text |

## Backends comparison

| Backend | Auth required | TTL | File types | Notes |
|---------|--------------|-----|-----------|-------|
| `transfer` | None | 14 days | All | Default. Fast. No account needed. |
| `gist` | GITHUB_TOKEN | Permanent | Text only | Best for code/markdown/HTML |
| `fly` | FLY_API_TOKEN | Permanent | All | Best for production artifacts |

## Config (in ~/.openclaw/.env)

```env
HERE_NOW_BACKEND=transfer          # default backend
HERE_NOW_TRANSFER_URL=https://transfer.sh  # custom endpoint (optional)
GITHUB_TOKEN=ghp_xxx               # for gist backend
FLY_API_TOKEN=xxx                  # for fly backend
FLY_APP_NAME=cupcake-opolis        # your Fly.io app name
```

## Instructions for Cupcake

1. When asked to publish/share an artifact, always use this skill
2. Run the publish command and parse the JSON output
3. Share the `url` with the user as a clickable link
4. Mention the TTL if using transfer.sh (14 days)
5. If the file doesn't exist yet, generate it first (use pdf/html skills), then publish
6. If a backend fails, fall back: try `transfer` (no auth required)
