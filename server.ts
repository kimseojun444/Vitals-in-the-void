import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "25mb" }));

  app.post("/api/tars/transcribe", async (req, res) => {
    try {
      const { audioBase64, mimeType } = req.body ?? {};
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
      const response = await ai.models.generateContent({
        model: "gemini-3.5-transcribe",
        contents: {
          parts: [audioPart, { text: "Transcribe this audio." }],
        },
      });

      const text = (response.text ?? "").trim();
      const finishReason = response.candidates?.[0]?.finishReason;
      console.log("[/api/tars/transcribe]", {
        mimeType: cleanMimeType,
        audioBytes,
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

  const distDir = path.resolve("dist");
  const isDev =
    process.env.NODE_ENV === "development" || !fs.existsSync(path.join(distDir, "index.html"));

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
