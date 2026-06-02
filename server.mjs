import { fal } from "@fal-ai/client";
import express from "express";
import multer from "multer";
import { File } from "node:buffer";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODEL_ID = "veed/fabric-1.0";
const PORT = Number(process.env.PORT ?? 3000);
const MAX_UPLOAD_MB = 150;
const SUPPORTED_RESOLUTIONS = new Set(["480p", "720p"]);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 2,
    fileSize: MAX_UPLOAD_MB * 1024 * 1024,
  },
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    hasFalKey: Boolean(process.env.FAL_KEY),
  });
});

function sendEvent(res, event) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function getFinalVideoUrl(result) {
  return result?.data?.video?.url ?? result?.video?.url ?? null;
}

async function uploadFalFile(file, label) {
  const falFile = new File([file.buffer], file.originalname, {
    type: file.mimetype || "application/octet-stream",
  });

  const url = await fal.storage.upload(falFile);
  return { label, url };
}

app.post(
  "/api/generate",
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "audio", maxCount: 1 },
  ]),
  async (req, res) => {
    console.log(`[${new Date().toISOString()}] Received generation request.`);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    try {
      if (!process.env.FAL_KEY) {
        sendEvent(res, {
          type: "error",
          message:
            'FAL_KEY is missing. Stop the server, run export FAL_KEY="your_fal_api_key_here", then start it again.',
        });
        return res.end();
      }

      const image = req.files?.image?.[0];
      const audio = req.files?.audio?.[0];
      const resolution = SUPPORTED_RESOLUTIONS.has(req.body?.resolution)
        ? req.body.resolution
        : "480p";

      console.log(
        `Files received: image=${image?.originalname ?? "missing"}, audio=${audio?.originalname ?? "missing"}, resolution=${resolution}`,
      );

      if (!image) {
        sendEvent(res, { type: "error", message: "Please choose an image file." });
        return res.end();
      }

      if (!audio) {
        sendEvent(res, { type: "error", message: "Please choose an audio file." });
        return res.end();
      }

      if (!image.mimetype.startsWith("image/")) {
        sendEvent(res, { type: "error", message: "The image upload must be an image file." });
        return res.end();
      }

      if (!audio.mimetype.startsWith("audio/")) {
        sendEvent(res, { type: "error", message: "The audio upload must be an audio file." });
        return res.end();
      }

      sendEvent(res, { type: "log", message: `Uploading ${image.originalname} to fal storage...` });
      console.log(`Uploading image to fal storage: ${image.originalname}`);
      const uploadedImage = await uploadFalFile(image, "image");
      sendEvent(res, { type: "uploaded", label: uploadedImage.label, url: uploadedImage.url });
      console.log(`Uploaded image: ${uploadedImage.url}`);

      sendEvent(res, { type: "log", message: `Uploading ${audio.originalname} to fal storage...` });
      console.log(`Uploading audio to fal storage: ${audio.originalname}`);
      const uploadedAudio = await uploadFalFile(audio, "audio");
      sendEvent(res, { type: "uploaded", label: uploadedAudio.label, url: uploadedAudio.url });
      console.log(`Uploaded audio: ${uploadedAudio.url}`);

      sendEvent(res, {
        type: "log",
        message: `Submitting ${MODEL_ID} generation at ${resolution}...`,
      });
      console.log(`Submitting ${MODEL_ID} generation at ${resolution}`);

      const result = await fal.subscribe(MODEL_ID, {
        input: {
          image_url: uploadedImage.url,
          audio_url: uploadedAudio.url,
          resolution,
        },
        logs: true,
        onQueueUpdate: (update) => {
          sendEvent(res, { type: "queue", status: update.status });

          for (const log of update.logs ?? []) {
            if (log.message) {
              sendEvent(res, { type: "log", message: log.message });
            }
          }
        },
      });

      sendEvent(res, {
        type: "done",
        requestId: result.requestId,
        imageUrl: uploadedImage.url,
        audioUrl: uploadedAudio.url,
        resolution,
        videoUrl: getFinalVideoUrl(result),
        result,
      });
      console.log(`Generation complete. Video URL: ${getFinalVideoUrl(result) ?? "none"}`);
      res.end();
    } catch (error) {
      console.error("Generation failed:", error);
      sendEvent(res, {
        type: "error",
        message: error?.message ?? "Generation failed.",
        body: error?.body,
      });
      res.end();
    }
  },
);

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      error: `Upload failed: ${error.message}. Max file size is ${MAX_UPLOAD_MB} MB per file.`,
    });
  }

  next(error);
});

app.listen(PORT, () => {
  console.log(`Fabric test web app running at http://localhost:${PORT}`);
  console.log("Press Ctrl+C to stop the server.");
});
