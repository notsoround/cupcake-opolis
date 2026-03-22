# Cupcake Task Delegation

Cupcake can delegate long-running tasks to a background worker so she stays
responsive while heavy work happens asynchronously.

## When to delegate

Delegate a task when:
- It will take more than ~10 seconds
- It involves: research, large batch processing, file analysis, web scraping,
  comprehensive audits, generating long reports, processing many items
- The user says: "in the background", "async", "don't wait", "let me know when done"

Do NOT delegate:
- Simple questions/answers (< 5 seconds)
- Quick lookups or calculations
- Conversational replies

## How to delegate

When you detect a long-running task:

1. **Tell the user** it's being delegated:
   > "That's a big one — I'm sending it to the background. I'll ping you here when it's done. 🎀"

2. **Enqueue the task** using the task queue API (available to the gateway layer):
   ```
   taskQueue.enqueue({
     description: "Research SaaS competitor landscape",
     prompt: "<full detailed prompt>",
     replyTo: { channel: "telegram", chat_id: 123456 },
     estimatedSeconds: 90,
     priority: "normal"
   })
   ```

3. **Continue being responsive** to new messages while the task runs

4. When done, the task queue **automatically delivers** the result back to the
   originating chat

## Checking task status

If the user asks "is it done yet?" or "how's that task going?":

```bash
# In your shell tool, you can check via the queue's getAll() method
# or ask Cupcake to check the activity log for task_queue events
grep '"tool":"task-queue' ~/.openclaw/logs/activity.jsonl | tail -5 | python3 -m json.tool
```

## Task prioritization

- `high` — urgent, time-sensitive requests
- `normal` — default
- `low` — background housekeeping

Max concurrent background tasks: 3 (configurable via `CUPCAKE_TASK_QUEUE_MAX_CONCURRENT`)

## Example delegation patterns

**User:** "Research the top 10 AI agent frameworks and write me a comparison report"
**Cupcake:** "On it — backgrounding this research. Should take 2-3 minutes. I'll send the report here. 🎀"
→ *delegates, immediately available for next message*

**User:** "Process all 50 invoices in my inbox and extract the totals"
**Cupcake:** "That's a batch job — sending to background queue. I'll DM you the spreadsheet when done."
→ *delegates with high estimated seconds*

## Instructions for Cupcake

1. Always announce delegation before enqueuing (never silently start background tasks)
2. Give a rough time estimate when possible
3. Use priority="high" if the user sounds urgent
4. Don't forget to follow up — if a user messages again, remind them the task is running
5. Results are delivered automatically — you don't need to "check in" actively
