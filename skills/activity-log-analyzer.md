# Cupcake Activity Log Analyzer

You have access to Cupcake's structured JSONL activity log at `~/.openclaw/logs/activity.jsonl`.

## When to use this skill

Use when the user asks any of the following:
- "what have you been doing?"
- "show me recent errors"
- "how many messages today?"
- "analyze your logs"
- "what channels are most active?"
- "which model got used most?"
- "were there any failures?"
- anything about bot usage statistics, history, or performance

## How to read the log

```bash
# Tail live activity
tail -f ~/.openclaw/logs/activity.jsonl | python3 -c "import sys,json; [print(json.dumps(json.loads(l), indent=2)) for l in sys.stdin]"

# Last 20 events (pretty)
tail -n 20 ~/.openclaw/logs/activity.jsonl | python3 -m json.tool

# Count events by type
cat ~/.openclaw/logs/activity.jsonl | python3 -c "
import sys, json, collections
counts = collections.Counter(json.loads(l).get('event') for l in sys.stdin)
for k, v in counts.most_common(): print(f'{v:5d}  {k}')
"

# All errors in last 24h
python3 -c "
import json, datetime, pathlib
cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=24)
log = pathlib.Path.home() / '.openclaw/logs/activity.jsonl'
for line in log.read_text().splitlines():
    ev = json.loads(line)
    if ev.get('event') == 'error' and ev['ts'] > cutoff.isoformat():
        print(json.dumps(ev, indent=2))
"

# Messages per channel today
python3 -c "
import json, datetime, collections, pathlib
today = datetime.date.today().isoformat()
log = pathlib.Path.home() / '.openclaw/logs/activity.jsonl'
counts = collections.Counter()
for line in log.read_text().splitlines():
    ev = json.loads(line)
    if ev.get('event') in ('message_in', 'message_out') and ev['ts'].startswith(today):
        counts[ev.get('channel', 'unknown')] += 1
for ch, n in counts.most_common(): print(f'{n:5d}  {ch}')
"
```

## JSONL event schema

Each line is a JSON object:

| Field | Type | Description |
|-------|------|-------------|
| `ts` | ISO string | Timestamp |
| `event` | string | Event type (see below) |
| `channel` | string? | telegram, whatsapp, cli, web, phone, … |
| `session_id` | string? | Session identifier |
| `model` | string? | LLM used, e.g. `anthropic/claude-opus-4-6` |
| `actor` | string? | Who sent this (user id, "cupcake", tool name) |
| `content` | string? | Message content (truncated to 2048 chars by default) |
| `content_truncated` | bool? | True if content was cut |
| `tool` | string? | Tool name for tool_call/tool_result events |
| `usage` | object? | Token usage (input_tokens, output_tokens, …) |
| `duration_ms` | number? | How long the operation took |
| `error` | string? | Error message |
| `meta` | object? | Extra context |

### Event types

- `message_in` — user/system message received
- `message_out` — Cupcake's response sent
- `tool_call` — tool/skill invoked
- `tool_result` — tool returned a result
- `model_request` — LLM API call started
- `model_response` — LLM API call completed
- `error` — any error
- `heartbeat` — nightly health ping
- `session_start` / `session_end` — session lifecycle

## Instructions

1. Run the appropriate bash command to read the log
2. Parse and summarize the results naturally
3. If showing errors, explain what they mean and suggest fixes
4. If showing usage stats, compare channels/models and highlight trends
5. Keep it concise — the user wants signal, not noise
