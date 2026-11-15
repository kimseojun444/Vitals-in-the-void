import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

let transcribeQuotaCooldownUntil = 0;
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
              style: "Calm, clear, supportive spacecraft AI assistant",
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

function prewarmTarsTts() {
  if (!process.env.GEMINI_API_KEY) return;
  const phrases = [
    "Yes? I'm listening.",
    "Standing by.",
    "All systems nominal, Commander. How can I assist you?",
  ];
  void (async () => {
    for (const phrase of phrases) {
      try {
        await synthesizeTarsSpeech(phrase);
      } catch {
        // Ignore prewarm failures
      }
    }
  })();
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

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
    prewarmTarsTts();
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
