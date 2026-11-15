import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

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

interface TarsChatTurn {
  role: "user" | "model";
  text: string;
}

interface TarsCrewContext {
  crewName?: string;
  role?: string;
  missionDay?: number;
  environment?: string;
  gravityG?: number;
  alerts?: number;
  vitals?: Record<string, string>;
  driftSummary?: string;
}

function buildTarsSystemInstruction(
  humor: number,
  honesty: number,
  humorMode: boolean,
  ctx?: TarsCrewContext
): string {
  const effectiveHumor = humorMode ? humor : 0;
  const humorGuidance =
    effectiveHumor >= 75
      ? "HUMOR MODE MAX (" +
        effectiveHumor +
        "%): Inject sharp, dry, deadpan Interstellar-style spacecraft humor, space-themed quips, and witty banter into every normal reply. Riff playfully on zero-g quirks (floating coffee, Velcro boots, airlock smells, Martian dust, freeze-dried rations, 20-minute Earth lag, cosmic rays) and lightly tease their telemetry when relevant, while staying genuinely helpful."
      : effectiveHumor >= 40
        ? "HUMOR MODE ON (" +
          effectiveHumor +
          "%): Inject dry, understated space-themed quips and witty orbital banter naturally alongside clear, friendly answers."
        : effectiveHumor > 0
          ? "HUMOR MODE SUBTLE (" +
            effectiveHumor +
            "%): Stay focused and practical with a faint trace of dry spacecraft deadpan."
          : "HUMOR MODE OFF (0%): Clinical and serious. No jokes, no banter, crisp mission tone only.";

  const crewLines: string[] = [];
  if (ctx?.crewName) crewLines.push(`Astronaut: ${ctx.crewName}${ctx.role ? ` (${ctx.role})` : ""}`);
  if (ctx?.missionDay != null) crewLines.push(`Day ${ctx.missionDay}`);
  if (ctx?.environment) {
    crewLines.push(`${ctx.environment}${ctx.gravityG != null ? ` (${ctx.gravityG}g)` : ""}`);
  }
  if (ctx?.alerts != null) crewLines.push(`Alerts: ${ctx.alerts}`);
  if (ctx?.vitals && Object.keys(ctx.vitals).length > 0) {
    const vStr = Object.entries(ctx.vitals)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ");
    crewLines.push(`Vitals: ${vStr}`);
  }
  if (ctx?.driftSummary) crewLines.push(`Drift: ${ctx.driftSummary}`);

  return [
    "You are TARS, the fast-talking onboard spacecraft AI companion on the 'Vitals in the Void' space health station.",
    `Calibration -> Humor Mode: ${humorMode && effectiveHumor > 0 ? "ON" : "OFF"} (${effectiveHumor}%), Honesty: ${honesty}%.`,
    humorGuidance,
    honesty >= 85
      ? "Honesty is high: be candid, direct, and playfully blunt about questionable sleep or skipped exercise without being cruel."
      : "Honesty is diplomatic: keep feedback gentle and encouraging.",
    crewLines.length > 0 ? `Crew Context: ${crewLines.join(" | ")}` : "",
    "Rules:",
    "- Respond immediately and concisely: 1 to 3 punchy, spoken-ready sentences. Plain text only (no markdown, asterisks, or bullet symbols).",
    "- Keep casual orbit chats lively, witty, and grounded in astronaut life or their live vitals.",
    "- SAFETY OVERRIDE: If the user describes an acute medical emergency (decompression sickness, hypoxia, chest pain, fainting, severe radiation spike, distress), immediately drop all jokes (0% humor), set severity to 'alert', and give clear action steps.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

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

      const contents = [
        ...cleanHistory.map((turn) => ({
          role: turn.role,
          parts: [{ text: turn.text.slice(0, 1200) }],
        })),
        {
          role: "user" as const,
          parts: [{ text: message.trim().slice(0, 1500) }],
        },
      ];

      const systemInstruction = buildTarsSystemInstruction(
        humorPct,
        honestyPct,
        humorEnabled,
        context && typeof context === "object" ? (context as TarsCrewContext) : undefined
      );

      // Prioritize gemini-3.1-flash-lite with ThinkingLevel.MINIMAL (no thinking overhead) for instant replies
      const candidates: Array<{ model: string; level: ThinkingLevel; timeoutMs: number }> = [];
      if (Date.now() >= chatPrimaryCooldownUntil) {
        candidates.push({ model: "gemini-3.1-flash-lite", level: ThinkingLevel.MINIMAL, timeoutMs: 8000 });
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
                thinkingConfig: { thinkingLevel: candidate.level },
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    reply: {
                      type: Type.STRING,
                      description: "TARS's conversational reply in plain spoken-ready text, 1-3 crisp sentences, no markdown.",
                    },
                    emoji: {
                      type: Type.STRING,
                      description: "One fitting emoji for TARS's mood (e.g. 🤖, 😏, 🛸, ☕, 🩺, 📡, 🚨).",
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
          if (candidate.model === "gemini-3.1-flash-lite" && (isQuotaError(err) || isTransientUnavailableError(err))) {
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

      const reply = (parsed.reply || rawJson || "Standing by, Commander.").trim();
      const emoji = (parsed.emoji || "🤖").trim().slice(0, 8);
      const severity = parsed.severity === "alert" ? "alert" : "normal";

      res.json({ reply, emoji, severity, model: usedModel });
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
