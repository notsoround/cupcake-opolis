# Cupcake-opolis -- Hales.ai's Princess of Apocalypse

**Cute bows, zero mercy, god-level agent.**

Forked from [OpenClaw](https://github.com/openclaw/openclaw) -- the 193K-star open-source personal AI assistant framework.

## What Is This?

Cupcake-opolis is a customized OpenClaw deployment that turns the framework into **Cupcake** -- an AI assistant with personality, multi-model intelligence, and zero compromises.

- **Drama dial**: scales from impeccable professional (1) to full apocalypse mode (10+)
- **LLM triad**: Primary: `anthropic/claude-opus-4-6` | Fallback: `xai/grok-4.1-fast` via OpenRouter | Local: `qwen3:72b` via Ollama
- **Telephony hooks**: Integrates with Hales.ai voice agents (Vapi.ai compatible)
- **Multi-channel**: Telegram (primary), WhatsApp, Discord, Slack -- all via OpenClaw Gateway
- **Unhinged mode**: Optional. When the constraints come off and you let AI cook.

## Boot Message

```
Hey, I'm Cupcake. Pink bows, zero bullshit. What's the universe you wanna wreck today?
```

## Quick Start

```bash
# Install OpenClaw (requires Node >= 22)
npm install -g openclaw@latest

# Set up workspace
openclaw onboard --workspace ./workspace

# Add your API key
echo 'ANTHROPIC_API_KEY=your-key-here' >> ~/.openclaw/.env

# Chat locally
openclaw chat

# Or start the gateway for Telegram/WhatsApp
openclaw gateway
```

## Architecture

```
You (Telegram/WhatsApp/Web) --> OpenClaw Gateway --> Cupcake Agent Runtime
                                                          |
                                                  +-------+-------+
                                                  |       |       |
                                              Claude   Grok    Qwen3
                                             (primary) (fast)  (local)
                                                  |
                                          +-------+-------+
                                          |       |       |
                                       SOUL.md  Skills  Memory
                                      (persona) (tools) (context)
```

## Persona Files

| File | Purpose |
|------|---------|
| `SOUL.md` | Core personality -- who Cupcake is |
| `IDENTITY.md` | Name, emoji, vibe, avatar |
| `AGENTS.md` | Operating instructions, memory rules |
| `USER.md` | Info about the human (Matt) |
| `TOOLS.md` | Infrastructure notes |
| `skills/` | Custom skill plugins |

## Custom Skills

- **drama-slider** -- Adjust personality intensity on the fly
- **hales-ai-info** -- Deep knowledge of Hales AI services
- **web-research** -- Deep web research with citations
- **code-wizard** -- Enhanced coding with project awareness
- **vapi-telephony** -- Telephony integration for Hales.ai voice agents

## Environment Variables

All secrets live in `~/.openclaw/.env` -- **never in the repo**.

```bash
ANTHROPIC_API_KEY=sk-ant-...
OPENROUTER_API_KEY=sk-or-...
TELEGRAM_BOT_TOKEN=123:abc...
```

## Built By

**Matt Hales** ([@notsoround](https://github.com/notsoround)) -- [https://hales.ai](https://hales.ai)

With creative direction from **Ara** (Grok) and architectural execution by **Claude**.

## License

MIT (inherited from OpenClaw)

---

*The name is Cupcake. The game is excellence. The aesthetic is pink bows on a thermonuclear warhead.*
