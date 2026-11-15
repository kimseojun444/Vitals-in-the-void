import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import {
  buildTarsContext,
  clearAllMemories,
  clearConversationHistory,
  completeReminder,
  createReminder,
  deleteMemory,
  deleteReminder,
  getAllMemories,
  getAllReminders,
  getRecentConversation,
  saveMemory,
  saveMessage,
  startConversation,
  TARS_PRIMARY_MODEL,
  type TarsChatTurn,
  type TarsCrewContext,
} from "./tarsAssistant.ts";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

let transcribeQuotaCooldownUntil = 0;
let chatPrimaryCooldownUntil = 0;
const ttsCache = new Map<string, { audioBase64: string; mimeType: string }>();

function isQuotaError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return status === 429 || /RESOURCE_EXHAUSTED|"code"\s*:\s*429/i.test(msg);
}

function isTransientUnavailableError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    /UNAVAILABLE|high demand|timeout|DEADLINE_EXCEEDED|"code"\s*:\s*503/i.test(msg)
  );
}

function isAuthOrKeyError(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    status === 400 ||
    status === 401 ||
    status === 403 ||
    /API_KEY_INVALID|PERMISSION_DENIED|API key not valid/i.test(msg)
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const err = new Error(`${label} timed out after ${ms}ms`);
      (err as { status?: number }).status = 504;
      reject(err);
    }, ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function synthesizeTarsSpeech(text: string): Promise<{ audioBase64: string; mimeType: string }> {
  const key = text.trim().slice(0, 600);
  const cached = ttsCache.get(key);
  if (cached) {
    return cached;
  }

  const response = await ai.models.generateContent({
    model: "gemini-3.8-flash-lite-tts",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: key,
            speechMetadata: {
              style: "Dry-witted, calm, clear spacecraft AI companion",
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: "Charon" },
        },
      },
    },
  });

  const inlineData = response.candidates?.[0]?.content?.parts?.[0]?.inlineData;
  if (!inlineData?.data) {
    const err = new Error("No audio returned from speech model.");
    (err as { status?: number }).status = 502;
    throw err;
  }

  const result = {
    audioBase64: inlineData.data,
    mimeType: inlineData.mimeType || "audio/wav",
  };
  if (ttsCache.size >= 64) {
    const firstKey = ttsCache.keys().next().value;
    if (firstKey !== undefined) ttsCache.delete(firstKey);
  }
  ttsCache.set(key, result);
  return result;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  app.get("/api/tars/state", (_req, res) => {
    res.json({
      greeting: startConversation(),
      memories: getAllMemories(30),
      reminders: getAllReminders(),
      recentConversation: getRecentConversation(12),
    });
  });

  app.post("/api/tars/memories", (req, res) => {
    const { category, content } = req.body ?? {};
    if (typeof content !== "string" || !content.trim()) {
      res.status(400).json({ error: "Memory content is required." });
      return;
    }
    const saved = saveMemory(typeof category === "string" && category.trim() ? category : "personal", content);
    res.json({ saved, memories: getAllMemories(30) });
  });

  app.delete("/api/tars/memories/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid memory ID." });
      return;
    }
    const deleted = deleteMemory(id);
    res.json({ deleted, memories: getAllMemories(30) });
  });

  app.post("/api/tars/memories/clear", (_req, res) => {
    clearAllMemories();
    res.json({ cleared: true, memories: [] });
  });

  app.post("/api/tars/reminders", (req, res) => {
    try {
      const { description, due_at } = req.body ?? {};
      if (typeof description !== "string" || !description.trim()) {
        res.status(400).json({ error: "Reminder description is required." });
        return;
      }
      const id = createReminder(description, typeof due_at === "string" ? due_at : null);
      res.json({ id, reminders: getAllReminders() });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Invalid reminder." });
    }
  });

  app.post("/api/tars/reminders/:id/complete", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid reminder ID." });
      return;
    }
    const completed = completeReminder(id);
    res.json({ completed, reminders: getAllReminders() });
  });

  app.delete("/api/tars/reminders/:id", (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid reminder ID." });
      return;
    }
    const deleted = deleteReminder(id);
    res.json({ deleted, reminders: getAllReminders() });
  });

  app.post("/api/tars/conversation/clear", (_req, res) => {
    clearConversationHistory();
    res.json({ cleared: true });
  });

  app.post("/api/tars/chat", async (req, res) => {
    try {
      const { message, history, humor, honesty, humorMode, context } = req.body ?? {};
      if (typeof message !== "string" || !message.trim()) {
        res.status(400).json({ error: "Missing chat message." });
        return;
      }
      if (!process.env.GEMINI_API_KEY) {
        res.status(500).json({
          error: "GEMINI_API_KEY is not configured. Please check Settings > Secrets.",
        });
        return;
      }

      const humorPct = Math.max(0, Math.min(100, Number.isFinite(Number(humor)) ? Number(humor) : 75));
      const humorEnabled = humorMode === undefined ? humorPct > 0 : Boolean(humorMode) && humorPct > 0;
      const honestyPct = Math.max(50, Math.min(100, Number.isFinite(Number(honesty)) ? Number(honesty) : 90));

      const cleanHistory: TarsChatTurn[] = Array.isArray(history)
        ? history
            .filter(
              (t: unknown): t is TarsChatTurn =>
                Boolean(t) &&
                typeof t === "object" &&
                ((t as TarsChatTurn).role === "user" || (t as TarsChatTurn).role === "model") &&
                typeof (t as TarsChatTurn).text === "string" &&
                (t as TarsChatTurn).text.trim().length > 0
            )
            .slice(-10)
        : [];

      const { systemInstruction, contents, memorySaved, reminderSaved } = buildTarsContext({
        userMessage: message,
        clientHistory: cleanHistory,
        humor: humorPct,
        honesty: honestyPct,
        humorMode: humorEnabled,
        crewContext: context && typeof context === "object" ? (context as TarsCrewContext) : undefined,
      });

      const candidates: Array<{ model: string; level: ThinkingLevel; timeoutMs: number }> = [];
      if (Date.now() >= chatPrimaryCooldownUntil) {
        candidates.push({ model: TARS_PRIMARY_MODEL, level: ThinkingLevel.MINIMAL, timeoutMs: 8000 });
      }
      candidates.push({ model: "gemini-4-hydrogen", level: ThinkingLevel.LOW, timeoutMs: 12000 });

      let rawJson = "";
      let usedModel = candidates[0].model;
      let lastErr: unknown = null;

      for (const candidate of candidates) {
        try {
          const response = await withTimeout(
            ai.models.generateContent({
              model: candidate.model,
              contents,
              config: {
                systemInstruction,
                temperature: 0.7,
                maxOutputTokens: 220,
                thinkingConfig: { thinkingLevel: candidate.level },
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    reply: {
                      type: Type.STRING,
                      description: "TARS's conversational reply in plain spoken-ready text, no markdown.",
                    },
                    emoji: {
                      type: Type.STRING,
                      description: "One fitting emoji for TARS's mood (e.g. 🐱, 😺, 😼, 🩺, 📡, 🚨).",
                    },
                    severity: {
                      type: Type.STRING,
                      description: "Either 'normal' or 'alert' (only 'alert' for urgent medical safety issues).",
                    },
                  },
                  required: ["reply", "emoji", "severity"],
                },
              },
            }),
            candidate.timeoutMs,
            candidate.model
          );
          rawJson = (response.text ?? "").trim();
          usedModel = candidate.model;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (candidate.model === TARS_PRIMARY_MODEL && (isQuotaError(err) || isTransientUnavailableError(err))) {
            chatPrimaryCooldownUntil = Date.now() + 2 * 60 * 1000;
            continue;
          }
          if (!isQuotaError(err) && !isTransientUnavailableError(err)) {
            throw err;
          }
        }
      }

      if (lastErr !== null) {
        if (isQuotaError(lastErr)) {
          res.status(429).json({
            error: "Gemini API quota reached (429). Wait a moment or check your billing/quota in Settings > Secrets.",
          });
          return;
        }
        res.status(503).json({
          error: "TARS AI model is temporarily busy (503). Please try again in a moment.",
        });
        return;
      }

      let parsed: { reply?: string; emoji?: string; severity?: string } = {};
      try {
        parsed = JSON.parse(rawJson);
      } catch {
        parsed = { reply: rawJson, emoji: "🤖", severity: "normal" };
      }

      const reply = (parsed.reply || rawJson || "Hmm, I seem to have lost my words. Try again?").trim();
      const emoji = (parsed.emoji || "🐱").trim().slice(0, 8);
      const severity = parsed.severity === "alert" ? "alert" : "normal";

      saveMessage("user", message.trim());
      saveMessage("assistant", reply);

      res.json({ reply, emoji, severity, model: usedModel, memorySaved, reminderSaved });
    } catch (err: unknown) {
      if (isAuthOrKeyError(err)) {
        res.status(403).json({
          error: "Gemini API key was rejected or lacks permission. Please verify your API key in Settings > Secrets.",
        });
        return;
      }
      if (isQuotaError(err)) {
        res.status(429).json({
          error: "Gemini API quota reached (429). Please wait a moment and try again.",
        });
        return;
      }
  const message = err instanceof Error ? err.message : "TARS AI chat failed.";
      const status =
        typeof (err as { status?: number })?.status === "number"
          ? (err as { status: number }).status
          : 500;
      console.error("[/api/tars/chat] Error:", err);
      res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
    }
  });

  app.post("/api/tars/chat/stream", async (req, res) => {
    try {
      const { message, history, humor, honesty, humorMode, context } = req.body ?? {};
      if (typeof message !== "string" || !message.trim()) {
        res.status(400).json({ error: "Missing chat message." });
        return;
      }
      if (!process.env.GEMINI_API_KEY) {
        res.status(500).json({
          error: "GEMINI_API_KEY is not configured. Please check Settings > Secrets.",
        });
        return;
      }

      const humorPct = Math.max(0, Math.min(100, Number.isFinite(Number(humor)) ? Number(humor) : 75));
      const humorEnabled = humorMode === undefined ? humorPct > 0 : Boolean(humorMode) && humorPct > 0;
      const honestyPct = Math.max(50, Math.min(100, Number.isFinite(Number(honesty)) ? Number(honesty) : 90));

      const cleanHistory: TarsChatTurn[] = Array.isArray(history)
        ? history
            .filter(
              (t: unknown): t is TarsChatTurn =>
                Boolean(t) &&
                typeof t === "object" &&
                ((t as TarsChatTurn).role === "user" || (t as TarsChatTurn).role === "model") &&
                typeof (t as TarsChatTurn).text === "string" &&
                (t as TarsChatTurn).text.trim().length > 0
            )
            .slice(-10)
        : [];

      const { systemInstruction: baseInstruction, contents, memorySaved, reminderSaved } = buildTarsContext({
        userMessage: message,
        clientHistory: cleanHistory,
        humor: humorPct,
        honesty: honestyPct,
        humorMode: humorEnabled,
        crewContext: context && typeof context === "object" ? (context as TarsCrewContext) : undefined,
      });
      const streamInstruction =
        baseInstruction +
        "\nStreaming Output Format:\n- Output ONLY TARS's direct spoken reply as plain text (no JSON, no braces, no markdown, no bullet points). Begin immediately with the first word so voice synthesis can speak sentence-by-sentence in real time.";

      const candidates: Array<{ model: string; level: ThinkingLevel }> = [];
      if (Date.now() >= chatPrimaryCooldownUntil) {
        candidates.push({ model: TARS_PRIMARY_MODEL, level: ThinkingLevel.MINIMAL });
      }
      candidates.push({ model: "gemini-4-hydrogen", level: ThinkingLevel.LOW });

      let clientClosed = false;
      res.on("close", () => {
        if (!res.writableEnded) {
          clientClosed = true;
        }
      });

      let headersSent = false;
      let fullText = "";
      let usedModel = candidates[0].model;
      let lastErr: unknown = null;

      for (const candidate of candidates) {
        if (clientClosed) break;
        try {
          const streamResponse = await ai.models.generateContentStream({
            model: candidate.model,
            contents,
            config: {
              systemInstruction: streamInstruction,
              temperature: 0.7,
              maxOutputTokens: 220,
              thinkingConfig: { thinkingLevel: candidate.level },
            },
          });

          for await (const chunk of streamResponse) {
            if (clientClosed) break;
            const delta = chunk.text ?? "";
            if (!delta) continue;
            if (!headersSent) {
              headersSent = true;
              res.status(200);
              res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
              res.setHeader("Cache-Control", "no-cache, no-transform");
              res.setHeader("Connection", "keep-alive");
              res.setHeader("X-Accel-Buffering", "no");
              res.flushHeaders?.();
            }
            fullText += delta;
            res.write(`data: ${JSON.stringify({ delta })}\n\n`);
          }

          usedModel = candidate.model;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (!headersSent && candidate.model === "gemini-3.1-flash-lite" && (isQuotaError(err) || isTransientUnavailableError(err))) {
            chatPrimaryCooldownUntil = Date.now() + 2 * 60 * 1000;
            continue;
          }
          if (headersSent) {
            break;
          }
          if (!isQuotaError(err) && !isTransientUnavailableError(err)) {
            throw err;
          }
        }
      }

      if (clientClosed) {
        if (!res.writableEnded) res.end();
        return;
      }

      if (lastErr !== null && !headersSent) {
        if (isQuotaError(lastErr)) {
          res.status(429).json({
            error: "Gemini API quota reached (429). Wait a moment or check your billing/quota in Settings > Secrets.",
          });
          return;
        }
        res.status(503).json({
          error: "TARS AI model is temporarily busy (503). Please try again in a moment.",
        });
        return;
      }

      if (!headersSent) {
        headersSent = true;
        res.status(200);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders?.();
      }

      if (lastErr !== null) {
        const errMsg = lastErr instanceof Error ? lastErr.message : "TARS stream interrupted.";
        res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
        res.end();
        return;
      }

      const cleanReply = (fullText || "Hmm, I seem to have lost my words. Try again?").trim();
      saveMessage("user", message.trim());
      saveMessage("assistant", cleanReply);

      const lowerAll = `${message} ${cleanReply}`.toLowerCase();
      const isAlert =
        /\b(decompression|hypoxia|storm shelter|dosimeter|code red|emergency|fainting|chest pain|oxygen mask)\b/i.test(
          lowerAll
        );
      const emoji = isAlert
        ? "🚨"
        : /\b(heart|bpm|spo2|vitals|temp|stress|exercise|medical officer)\b/i.test(lowerAll)
          ? "🩺"
          : humorEnabled && humorPct >= 60
            ? "😼"
            : "🐱";

      res.write(
        `data: ${JSON.stringify({
          done: true,
          reply: cleanReply,
          emoji,
          severity: isAlert ? "alert" : "normal",
          model: usedModel,
          memorySaved,
          reminderSaved,
        })}\n\n`
      );
      res.end();
    } catch (err: unknown) {
      if (isAuthOrKeyError(err)) {
        if (!res.headersSent) {
          res.status(403).json({
            error: "Gemini API key was rejected or lacks permission. Please verify your API key in Settings > Secrets.",
          });
        } else {
          res.write(`data: ${JSON.stringify({ error: "Gemini API key was rejected or lacks permission." })}\n\n`);
          res.end();
        }
        return;
      }
      if (isQuotaError(err)) {
        if (!res.headersSent) {
          res.status(429).json({
            error: "Gemini API quota reached (429). Please wait a moment and try again.",
          });
        } else {
          res.write(`data: ${JSON.stringify({ error: "Gemini API quota reached (429)." })}\n\n`);
          res.end();
        }
        return;
      }
      const message = err instanceof Error ? err.message : "TARS AI stream failed.";
      const status =
        typeof (err as { status?: number })?.status === "number"
          ? (err as { status: number }).status
          : 500;
      console.error("[/api/tars/chat/stream] Error:", err);
      if (!res.headersSent) {
        res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
      } else {
        res.write(`data: ${JSON.stringify({ error: message })}\n\n`);
        res.end();
      }
    }
  });

  app.options("/api/tars/transcribe", (_req, res) => {
    res.sendStatus(204);
  });

  app.post("/api/tars/transcribe", async (req, res) => {
    try {
      const { audioBase64, mimeType, mode } = req.body ?? {};
      if (typeof audioBase64 !== "string" || !audioBase64.trim()) {
        res.status(400).json({ error: "Missing audio recording data." });
        return;
      }

      if (!process.env.GEMINI_API_KEY) {
        res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
        return;
      }

      const rawMime = typeof mimeType === "string" ? mimeType.split(";")[0].trim() : "";
      const cleanMimeType = rawMime.startsWith("audio/") ? rawMime : "audio/webm";

      const audioPart = {
        inlineData: {
          mimeType: cleanMimeType,
          data: audioBase64,
        },
      };

      const audioBytes = Buffer.from(audioBase64, "base64").length;
      const fallbackPrompt =
        mode === "wake"
          ? "Transcribe ONLY exact spoken words verbatim (speaker may say 'Hey TARS' or 'TARS'). If silence/noise only, output NONE."
          : "Transcribe ONLY exact spoken words verbatim. If silence/noise only, output NONE.";

      let text = "";
      let usedModel = "gemini-3.5-transcribe";
      let finishReason: string | undefined;
      let lastErr: unknown = null;

      if (Date.now() >= transcribeQuotaCooldownUntil) {
        try {
          const response = await withTimeout(
            ai.models.generateContent({
              model: "gemini-3.5-transcribe",
              contents: {
                parts: [audioPart, { text: "Transcribe this audio." }],
              },
            }),
            2200,
            "gemini-3.5-transcribe"
          );
          text = (response.text ?? "").trim();
          finishReason = response.candidates?.[0]?.finishReason;
          lastErr = null;
        } catch (err) {
          lastErr = err;
          if (isQuotaError(err)) {
            transcribeQuotaCooldownUntil = Date.now() + 15 * 60 * 1000;
            console.warn("[/api/tars/transcribe] gemini-3.5-transcribe quota reached; switching to fast fallback.");
          } else if (isTransientUnavailableError(err)) {
            transcribeQuotaCooldownUntil = Date.now() + 3 * 60 * 1000;
            console.warn("[/api/tars/transcribe] gemini-3.5-transcribe unavailable/slow; switching to fast fallback.");
          } else {
            throw err;
          }
        }
      } else {
        lastErr = new Error("Cooldown active");
      }

      if (lastErr !== null) {
        const fallbackCandidates: Array<{ model: string; level: ThinkingLevel }> = [
          { model: "gemini-3.1-flash-lite", level: ThinkingLevel.MINIMAL },
          { model: "gemini-4-hydrogen", level: ThinkingLevel.LOW },
        ];
        for (const candidate of fallbackCandidates) {
          try {
            const response = await ai.models.generateContent({
              model: candidate.model,
              contents: {
                parts: [audioPart, { text: fallbackPrompt }],
              },
              config: {
                systemInstruction:
                  "Precise speech-to-text transcriber. Output only the exact spoken words, or NONE if silent.",
                thinkingConfig: { thinkingLevel: candidate.level },
              },
            });
            const raw = (response.text ?? "").trim();
            text = /^NONE[.!]?$/i.test(raw) ? "" : raw;
            usedModel = candidate.model;
            finishReason = response.candidates?.[0]?.finishReason;
            lastErr = null;
            break;
          } catch (fallbackErr) {
            lastErr = fallbackErr;
            if (!isQuotaError(fallbackErr) && !isTransientUnavailableError(fallbackErr)) {
              throw fallbackErr;
            }
          }
        }
      }

      if (lastErr !== null) {
        const status = isQuotaError(lastErr) ? 429 : 503;
        res.status(status).json({
          error:
            status === 429
              ? "Gemini transcription quota exceeded (429). Please wait a moment or use Hey TARS live recognition."
              : "Transcription model is temporarily busy (503). Please try again.",
        });
        return;
      }

      console.log("[/api/tars/transcribe]", {
        model: usedModel,
        mimeType: cleanMimeType,
        audioBytes,
        mode: mode || "standard",
        textLen: text.length,
        finishReason,
      });
      res.json({ text });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Audio transcription failed.";
      const status =
        typeof (err as { status?: number })?.status === "number"
          ? (err as { status: number }).status
          : 500;
      console.error("[/api/tars/transcribe] Error:", err);
      res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
    }
  });

  app.post("/api/tars/speak", async (req, res) => {
    try {
      const { text } = req.body ?? {};
      if (typeof text !== "string" || !text.trim()) {
        res.status(400).json({ error: "Missing text to speak." });
        return;
      }
      if (!process.env.GEMINI_API_KEY) {
        res.status(500).json({ error: "GEMINI_API_KEY is not configured on the server." });
        return;
      }

      const audio = await synthesizeTarsSpeech(text);
      res.json(audio);
    } catch (err: unknown) {
      if (isQuotaError(err)) {
        res.status(429).json({ error: "Speech generation quota reached (429)." });
        return;
      }
      const message = err instanceof Error ? err.message : "Speech generation failed.";
      const status =
        typeof (err as { status?: number })?.status === "number"
          ? (err as { status: number }).status
          : 500;
      console.error("[/api/tars/speak] Error:", err);
      res.status(status >= 400 && status < 600 ? status : 500).json({ error: message });
    }
  });

  const distDir = path.resolve("dist");
  const isDev =
    process.argv.includes("--dev") || !fs.existsSync(path.join(distDir, "index.html"));

  if (isDev) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distDir, "index.html"));
    });
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`Server listening on http://0.0.0.0:${port}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
