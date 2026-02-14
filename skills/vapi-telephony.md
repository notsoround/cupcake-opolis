# Vapi Telephony Integration

**Name:** vapi-telephony
**Description:** Telephony hooks for Hales.ai voice agents. Cupcake can generate Vapi.ai-compatible scripts, handle webhook logic, and serve as the brain behind voice calls.

## Overview

Vapi.ai is the telephony platform Hales AI uses for conversational voice agents. Cupcake can:
1. Draft voice agent scripts (system prompts for phone calls)
2. Handle inbound webhook requests from Vapi (call status, transcriptions, function calls)
3. Serve as the logic engine -- Vapi handles voice, Cupcake handles thinking

## Vapi Architecture with Cupcake

```
Caller --> Vapi.ai (voice/STT/TTS) --> Webhook --> OpenClaw Gateway --> Cupcake
                                                                          |
                                                                    Claude/Grok/Qwen
                                                                          |
                                                                    Response --> Vapi --> Caller
```

## Webhook Handler Template

When Matt asks to set up a Vapi integration, generate a webhook handler like:

```typescript
// vapi-webhook.ts -- Cupcake's telephony bridge
import { serve } from "node:http";

interface VapiPayload {
  type: "function-call" | "status-update" | "transcript" | "end-of-call-report";
  call: { id: string; customer: { number: string } };
  functionCall?: { name: string; parameters: Record<string, unknown> };
  transcript?: string;
  status?: string;
}

serve(async (req) => {
  const payload: VapiPayload = await req.json();

  switch (payload.type) {
    case "function-call":
      // Route function calls to Cupcake via OpenClaw
      const result = await fetch("http://127.0.0.1:18789/api/message", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENCLAW_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: `[Vapi call ${payload.call.id}] Function: ${payload.functionCall?.name}, Params: ${JSON.stringify(payload.functionCall?.parameters)}`,
          channel: "api"
        })
      });
      return Response.json(await result.json());

    case "status-update":
      console.log(`Call ${payload.call.id}: ${payload.status}`);
      return Response.json({ ok: true });

    case "end-of-call-report":
      // Log call summary to Cupcake's memory
      await fetch("http://127.0.0.1:18789/api/message", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENCLAW_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          message: `[Vapi call ended] ${payload.call.id} from ${payload.call.customer.number}. Transcript: ${payload.transcript}`,
          channel: "api"
        })
      });
      return Response.json({ ok: true });

    default:
      return Response.json({ ok: true });
  }
}, { port: 3001 });
```

## Voice Agent Script Template

When Matt asks to create a voice agent, generate a Vapi-compatible system prompt:

```
You are a voice agent for Hales AI. Your name is [AGENT_NAME].

PERSONALITY:
- Professional but warm
- Concise -- phone calls need short, clear responses
- Active listener -- confirm understanding before acting
- Never say "um" or "uh" -- you're an AI, own it

CAPABILITIES:
- Book appointments (check calendar via function call)
- Answer questions about Hales AI services
- Transfer to human when needed (function call: transfer_call)
- Take messages (function call: save_message)

RULES:
- Always confirm the caller's name and number
- Keep responses under 30 seconds of speech
- If unsure, say "Let me check on that" and use a function call
- End calls with a clear next step

FUNCTION CALLS AVAILABLE:
- check_calendar(date, time) -- returns availability
- book_appointment(name, phone, date, time, service) -- books it
- transfer_call(department) -- transfers to human
- save_message(name, phone, message) -- takes a message
- ask_cupcake(question) -- routes complex questions to Cupcake AI
```

## When to Use This Skill

- Matt asks about telephony, voice agents, or Vapi
- Building webhook handlers for call routing
- Creating voice agent personalities/scripts
- Debugging call flows or transcription issues
- Connecting Cupcake to the voice pipeline
