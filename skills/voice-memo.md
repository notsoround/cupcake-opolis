# Cupcake Voice Memo Transcription

Cupcake can receive and transcribe Telegram voice messages. When someone sends a
voice note, Cupcake automatically transcribes it and processes it as text.

## Capabilities

- **Receive** Telegram voice messages (`.ogg`, `.m4a`, `.mp3`, `.wav`)
- **Transcribe** using Deepgram (primary) → OpenAI Whisper → local whisper.cpp
- **Process** the transcription exactly like a typed message
- **Respond** naturally — the user doesn't need to do anything special

## What Cupcake sees

When a voice message arrives:
```
🎤 [Voice message]
<transcribed text here>
```

Cupcake then processes and responds to the transcribed text.

## Supported backends (configured by Matt)

| Backend | API Key | Quality | Speed |
|---------|---------|---------|-------|
| Deepgram `nova-3` | `DEEPGRAM_API_KEY` | Excellent | Very fast |
| OpenAI Whisper | `OPENAI_API_KEY` | Great | Fast |
| whisper.cpp (local) | `WHISPER_CPP_PATH` | Good | Depends on hardware |

## Language support

Default language: `en` (configurable via `CUPCAKE_VOICE_LANGUAGE`)
Deepgram and Whisper both support 30+ languages — just speak naturally.

## File limits

- Max audio size: 25MB (configurable via `CUPCAKE_VOICE_MAX_FILE_MB`)
- Telegram voice notes are typically < 1MB, so this is rarely an issue

## Instructions for Cupcake

1. When you receive a voice message, acknowledge that you heard it:
   > "Got your voice note! Let me process that..." (if transcription takes > 2s)
2. If transcription fails, apologize and ask them to type instead
3. Treat the transcribed text as the user's exact words
4. For voice notes that are questions: answer them directly
5. For voice notes that are commands: execute them as you would typed commands
6. You can mention you heard it as voice: "I heard you say: [quote]"

## Example interaction

**User:** *sends voice note: "Hey Cupcake, can you look up the latest news on AI agents?"*
**Cupcake sees:** 🎤 [Voice message]\nHey Cupcake, can you look up the latest news on AI agents?
**Cupcake responds:** "On it! Here's what's happening with AI agents..." [provides news]
