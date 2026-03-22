# Cupcake Metrics Skill

## Trigger phrases
- "metrics", "stats", "usage", "cost", "how much have you spent", "weekly digest", "daily report"
- "how many messages", "error rate", "response time", "token usage"

## Description
Returns a structured summary of Cupcake's operational metrics: message volume, model usage, tool calls, errors, response times, and estimated API cost.

## Usage

### Get today's metrics
```
GET http://127.0.0.1:9090/metrics
```

### Get weekly metrics (JSON)
```
GET http://127.0.0.1:9090/metrics/weekly
```

### Get weekly Telegram digest (formatted text)
```
GET http://127.0.0.1:9090/metrics/digest
```

### Health check
```
GET http://127.0.0.1:9090/health
```

## Integration

The metrics server is started automatically when the bot initializes. To start it manually:

```typescript
import { startMetricsServer } from './src/observability/metrics-collector.js';
await startMetricsServer(9090);
```

Or from your main entry point, add to initialization:

```typescript
if (process.env.CUPCAKE_METRICS_ENABLED === 'true') {
  const { startMetricsServer } = await import('./observability/metrics-collector.js');
  await startMetricsServer(parseInt(process.env.CUPCAKE_METRICS_PORT ?? '9090', 10));
}
```

## Agent response format

When a user asks for metrics, query the `/metrics/digest` endpoint and return the result directly. Example:

> User: "How's Cupcake doing this week?"
>
> Response: [fetch http://127.0.0.1:9090/metrics/digest and return verbatim]

## Weekly digest cron

A cron job sends the weekly digest every Monday at 8am:

```
node scripts/cupcake-metrics-cron.mjs --install-cron
```

## Env vars

| Variable | Default | Description |
|---|---|---|
| `CUPCAKE_METRICS_ENABLED` | `true` | Enable metrics server |
| `CUPCAKE_METRICS_PORT` | `9090` | HTTP port |
| `CUPCAKE_METRICS_FILE` | `~/.openclaw/logs/metrics.jsonl` | Metrics persistence file |
| `CUPCAKE_WEEKLY_DIGEST_TELEGRAM_ID` | — | Chat ID for weekly digest |
