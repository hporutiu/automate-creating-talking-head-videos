# Automate Creating Talking Head Videos

A compact Node.js demo app for generating talking-head videos with
`veed/fabric-1.0` through fal.ai.

Upload a portrait image, either upload an audio file or record your voice in the
browser, then generate a video with live queue updates.

![Automate creating talking head videos app screenshot](docs/app-screenshot.png)

## Why This App Exists

Fabric expects publicly accessible media URLs for `image_url` and `audio_url`.
That can make first-time API testing awkward when your files are sitting on your
laptop.

This demo removes that friction: it uploads your selected image and audio to fal
storage, sends those public fal.media URLs to Fabric, and shows the final result
in one local browser flow.

## Requirements

- Node.js 20 or newer
- A fal.ai API key with credits for VEED/Fabric usage

## Quick Start

Clone the repo:

```bash
git clone https://github.com/hporutiu/automate-creating-talking-head-videos.git
cd automate-creating-talking-head-videos
```

Install dependencies:

```bash
npm install
```

Set your fal.ai API key:

```bash
export FAL_KEY="your_fal_api_key_here"
```

Run locally:

```bash
npm start
```

Open:

```text
http://localhost:3000
```

## Demo Flow

1. Upload or drag in a clear portrait image.
2. Add audio in one of two ways:
   - Upload an audio file such as MP3, WAV, M4A, or WebM.
   - Record your voice directly in the browser, preview it, then click
     `Use recording`.
3. Choose `480p` or `720p`.
4. Click generate.
5. Watch the live logs and open the final video URL when the run completes.

## Tips For Best Results

- Use a clear, front-facing, well-lit image.
- Keep first tests short to save credits and speed up iteration.
- Trim long silences if you upload an existing audio file.
- Start with `480p` while testing, then switch to `720p` for better output.

## Notes

- Your `FAL_KEY` is read from the server environment and is never sent to the browser.
- Browser recordings use the MediaRecorder API, then the app converts them to
  `recording.wav` before upload so fal/Fabric sees a plain audio file.
- If microphone access is blocked or unsupported, upload an audio file instead.
- `.env` files are ignored by git. Use `.env.example` only as a placeholder reference.
