/**
 * Cupcake Voice Transcriber
 * ────────────────────────────────────────────────────────────────────────────
 * Transcribes Telegram voice messages and audio files to text, then hands
 * them off for normal message processing.
 *
 * Backend priority:
 *   1. Deepgram (DEEPGRAM_API_KEY) — fast, accurate, cheap
 *   2. OpenAI Whisper API (OPENAI_API_KEY) — reliable fallback
 *   3. Local whisper.cpp (WHISPER_CPP_PATH) — offline option
 *
 * Env vars:
 *   DEEPGRAM_API_KEY=...              — Deepgram API key
 *   DEEPGRAM_MODEL=nova-3             — Deepgram model (default: nova-3)
 *   OPENAI_API_KEY=...                — OpenAI key (Whisper fallback)
 *   OPENAI_WHISPER_MODEL=whisper-1    — Whisper model
 *   WHISPER_CPP_PATH=/path/to/main    — Local whisper.cpp binary (optional)
 *   CUPCAKE_VOICE_LANGUAGE=en         — Default language hint (ISO 639-1)
 *   CUPCAKE_VOICE_MAX_FILE_MB=25      — Max audio file size in MB (default: 25)
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import https from "node:https";
import http from "node:http";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { emitActivity } from "../logging/activity-log.js";

const log = createSubsystemLogger("cupcake/voice-transcriber");

// ─── Types ────────────────────────────────────────────────────────────────────

export type TranscriptionResult = {
  text: string;
  language?: string;
  backend: "deepgram" | "openai-whisper" | "whisper-cpp";
  durationMs?: number;
  confidence?: number;
};

export type VoiceInput = {
  /** Local file path or URL to audio file */
  filePath?: string;
  fileUrl?: string;
  /** MIME type (audio/ogg, audio/mp4, etc.) */
  mimeType?: string;
  /** File size in bytes */
  fileSize?: number;
  /** Language hint (e.g., "en", "es") */
  language?: string;
};

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpGet(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https://") ? https : http;
    lib.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function httpPost(url: string, headers: Record<string, string>, body: Buffer): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: "POST", headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ─── Backend: Deepgram ────────────────────────────────────────────────────────

async function transcribeWithDeeepgram(
  audioData: Buffer,
  mimeType: string,
  language?: string
): Promise<string> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error("DEEPGRAM_API_KEY not set");

  const model = process.env.DEEPGRAM_MODEL ?? "nova-3";
  const langParam = language ? `&language=${language}` : "";
  const url = `https://api.deepgram.com/v1/listen?model=${model}&smart_format=true&punctuate=true${langParam}`;

  const result = await httpPost(url, {
    "authorization": `Token ${apiKey}`,
    "content-type": mimeType,
    "content-length": String(audioData.length),
  }, audioData);

  if (result.status !== 200) {
    throw new Error(`Deepgram returned ${result.status}: ${result.body.slice(0, 200)}`);
  }

  const parsed = JSON.parse(result.body);
  const transcript = parsed?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  if (!transcript) throw new Error("Deepgram returned empty transcript");
  return transcript;
}

// ─── Backend: OpenAI Whisper ──────────────────────────────────────────────────

async function transcribeWithWhisper(
  audioData: Buffer,
  fileName: string,
  language?: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const model = process.env.OPENAI_WHISPER_MODEL ?? "whisper-1";

  // Build multipart form data manually (no external deps)
  const boundary = `----CupcakeVoice${Date.now()}`;
  const parts: Buffer[] = [];

  const addField = (name: string, value: string) => {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    ));
  };

  const addFile = (fieldName: string, fName: string, data: Buffer, ctype: string) => {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${fName}"\r\nContent-Type: ${ctype}\r\n\r\n`
    ));
    parts.push(data);
    parts.push(Buffer.from("\r\n"));
  };

  addField("model", model);
  if (language) addField("language", language);
  addFile("file", fileName, audioData, "audio/ogg");
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const body = Buffer.concat(parts);
  const result = await httpPost("https://api.openai.com/v1/audio/transcriptions", {
    "authorization": `Bearer ${apiKey}`,
    "content-type": `multipart/form-data; boundary=${boundary}`,
    "content-length": String(body.length),
  }, body);

  if (result.status !== 200) {
    throw new Error(`Whisper API returned ${result.status}: ${result.body.slice(0, 200)}`);
  }

  const parsed = JSON.parse(result.body);
  return parsed.text ?? "";
}

// ─── Backend: whisper.cpp (local) ─────────────────────────────────────────────

async function transcribeWithWhisperCpp(
  audioFilePath: string,
  language?: string
): Promise<string> {
  const binaryPath = process.env.WHISPER_CPP_PATH;
  if (!binaryPath) throw new Error("WHISPER_CPP_PATH not set");

  const { spawn } = await import("node:child_process");

  return new Promise((resolve, reject) => {
    const args = ["-m", "models/ggml-base.en.bin", "-f", audioFilePath, "--output-txt"];
    if (language) args.push("-l", language);

    const child = spawn(binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout?.on("data", (d: Buffer) => { out += d.toString(); });
    child.on("close", (code) => {
      if (code === 0) resolve(out.replace(/\[.*?\]/g, "").trim());
      else reject(new Error(`whisper.cpp exited ${code}`));
    });
    child.on("error", reject);
  });
}

// ─── Main transcription orchestrator ─────────────────────────────────────────

export async function transcribeVoice(input: VoiceInput): Promise<TranscriptionResult> {
  const maxFileMb = parseFloat(process.env.CUPCAKE_VOICE_MAX_FILE_MB ?? "25");
  const language = input.language ?? process.env.CUPCAKE_VOICE_LANGUAGE;

  // Validate file size
  if (input.fileSize && input.fileSize > maxFileMb * 1024 * 1024) {
    throw new Error(`Audio file too large (${(input.fileSize / 1024 / 1024).toFixed(1)}MB > ${maxFileMb}MB limit)`);
  }

  const startMs = Date.now();

  // Download if URL
  let audioData: Buffer | null = null;
  let localFilePath = input.filePath ?? null;

  if (input.fileUrl && !localFilePath) {
    log.info("Downloading voice file", { url: input.fileUrl.slice(0, 80) });
    audioData = await httpGet(input.fileUrl);
    // Write to temp file for whisper.cpp compatibility
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "cupcake-voice-"));
    localFilePath = path.join(tmpDir, `voice_${Date.now()}.ogg`);
    await fs.writeFile(localFilePath, audioData);
  } else if (localFilePath) {
    audioData = await fs.readFile(localFilePath);
  }

  if (!audioData) {
    throw new Error("No audio data provided");
  }

  const mimeType = input.mimeType ?? "audio/ogg";
  const fileName = path.basename(localFilePath ?? `voice_${Date.now()}.ogg`);

  // Try backends in order
  const errors: string[] = [];

  // 1. Deepgram
  if (process.env.DEEPGRAM_API_KEY) {
    try {
      const text = await transcribeWithDeeepgram(audioData, mimeType, language);
      const result: TranscriptionResult = {
        text,
        language,
        backend: "deepgram",
        durationMs: Date.now() - startMs,
      };
      emitActivity({ event: "tool_result", tool: "voice-transcriber/deepgram", content: text.slice(0, 200) });
      log.info("Transcribed with Deepgram", { chars: text.length, durationMs: result.durationMs });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("Deepgram failed, trying fallback", { error: msg });
      errors.push(`Deepgram: ${msg}`);
    }
  }

  // 2. OpenAI Whisper
  if (process.env.OPENAI_API_KEY) {
    try {
      const text = await transcribeWithWhisper(audioData, fileName, language);
      const result: TranscriptionResult = {
        text,
        language,
        backend: "openai-whisper",
        durationMs: Date.now() - startMs,
      };
      emitActivity({ event: "tool_result", tool: "voice-transcriber/whisper", content: text.slice(0, 200) });
      log.info("Transcribed with OpenAI Whisper", { chars: text.length, durationMs: result.durationMs });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("OpenAI Whisper failed, trying fallback", { error: msg });
      errors.push(`Whisper: ${msg}`);
    }
  }

  // 3. Local whisper.cpp
  if (process.env.WHISPER_CPP_PATH && localFilePath) {
    try {
      const text = await transcribeWithWhisperCpp(localFilePath, language);
      const result: TranscriptionResult = {
        text,
        language,
        backend: "whisper-cpp",
        durationMs: Date.now() - startMs,
      };
      emitActivity({ event: "tool_result", tool: "voice-transcriber/whisper-cpp", content: text.slice(0, 200) });
      log.info("Transcribed with whisper.cpp", { chars: text.length, durationMs: result.durationMs });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`whisper.cpp: ${msg}`);
    }
  }

  // All backends failed
  const errorDetail = errors.length > 0 ? errors.join("; ") : "No transcription backends configured";
  throw new Error(`Voice transcription failed: ${errorDetail}. Set DEEPGRAM_API_KEY or OPENAI_API_KEY.`);
}

/**
 * Format transcription for display.
 * Prefixes with a 🎤 indicator so recipients know it was a voice message.
 */
export function formatTranscription(result: TranscriptionResult, showBackend = false): string {
  const prefix = "🎤 *[Voice message]*";
  const suffix = showBackend ? `\n_(transcribed via ${result.backend})_` : "";
  return `${prefix}\n${result.text}${suffix}`;
}
