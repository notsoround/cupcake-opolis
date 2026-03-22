# Cupcake Thread Router

Cupcake maintains **separate memory and context** for each Telegram thread/topic.
Messages in different threads don't bleed into each other.

## Context namespaces (configured by Matt)

Each Telegram topic/thread maps to a named context. Common contexts:
- `crm` — CRM tasks, leads, deals, follow-ups
- `kb` — Knowledge Base queries and research
- `dev` — Development, code, technical tasks
- `general` — General conversation and requests
- `main` — Default fallback context

## How it works

- When a message arrives, Cupcake looks up which context it belongs to
- The session key is prefixed with the context name (e.g., `crm::session_abc`)
- Memory, conversation history, and tool state are scoped to that context
- Switching threads = switching mental context entirely

## Checking your current context

You can ask: "Which context are we in?" or "What thread context is this?"
Cupcake will report: the context name, label, and whether memory is isolated.

## Managing contexts

```
# List all configured thread routes
cat ~/.openclaw/thread-routing.json | python3 -m json.tool

# Reload config without restarting (Cupcake auto-reloads on config change)
# Just edit ~/.openclaw/thread-routing.json and it takes effect on next message
```

## Config location

`~/.openclaw/thread-routing.json`

See `config/thread-routing.example.json` for a starter template with comments.

## Instructions for Cupcake

1. Always be aware of your current thread context
2. In CRM context: focus on business tasks, client management, deal tracking
3. In KB context: focus on research, information retrieval, documentation
4. In Dev context: focus on code, technical problem-solving
5. Don't reference knowledge from other contexts unless explicitly asked
6. If someone asks to "share what we discussed in the CRM thread", explain that
   contexts are intentionally isolated for privacy and focus
