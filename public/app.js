const form = document.querySelector("#generate-form");
const imageInput = document.querySelector("#image-input");
const audioInput = document.querySelector("#audio-input");
const imageName = document.querySelector("#image-name");
const audioName = document.querySelector("#audio-name");
const resolutionInputs = document.querySelectorAll('input[name="resolution"]');
const submitButton = document.querySelector("#submit-button");
const startRecordingButton = document.querySelector("#start-recording");
const stopRecordingButton = document.querySelector("#stop-recording");
const rerecordAudioButton = document.querySelector("#rerecord-audio");
const useRecordingButton = document.querySelector("#use-recording");
const recordingStatus = document.querySelector("#recording-status");
const recordingPreview = document.querySelector("#recording-preview");
const recordingError = document.querySelector("#recording-error");
const activeAudioSource = document.querySelector("#active-audio-source");
const formError = document.querySelector("#form-error");
const statusPill = document.querySelector("#status-pill");
const logs = document.querySelector("#logs");
const imageUrl = document.querySelector("#image-url");
const audioUrl = document.querySelector("#audio-url");
const requestId = document.querySelector("#request-id");
const selectedResolution = document.querySelector("#selected-resolution");
const videoResult = document.querySelector("#video-result");
const videoUrl = document.querySelector("#video-url");
const resultJson = document.querySelector("#result-json");
const FIRST_RESPONSE_TIMEOUT_MS = 90000;
let mediaRecorder;
let recordedChunks = [];
let recordedAudioBlob;
let recordedAudioFile;
let recordedAudioUrl;
let selectedAudioFile;
let isRecording = false;
let activeAudioKind = null;

function getResolution() {
  return document.querySelector('input[name="resolution"]:checked')?.value ?? "480p";
}

function getSupportedRecordingMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];

  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

function getActiveAudioFile() {
  if (activeAudioKind === "recording") return recordedAudioFile;
  if (activeAudioKind === "upload") return selectedAudioFile;
  return null;
}

function appendLog(message) {
  logs.textContent += `${logs.textContent.endsWith("\n") ? "" : "\n"}${message}`;
  logs.scrollTop = logs.scrollHeight;
}

function renderUrl(target, url) {
  target.textContent = "";

  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noreferrer";
  link.textContent = url;

  target.append(link);
}

function setStatus(text, state = "active") {
  statusPill.textContent = text;
  statusPill.classList.toggle("is-active", state === "active");
  statusPill.classList.toggle("is-done", state === "done");
  statusPill.classList.toggle("is-error", state === "error");
}

function setRecordingError(message) {
  recordingError.textContent = message;
  recordingError.hidden = !message;
}

function setFormError(message) {
  formError.textContent = message;
  formError.hidden = !message;
}

function setRecordingStatus(text, state = "idle") {
  recordingStatus.textContent = text;
  recordingStatus.classList.toggle("is-recording", state === "recording");
  recordingStatus.classList.toggle("is-ready", state === "ready");
  recordingStatus.classList.toggle("is-error", state === "error");
}

function setActiveAudioSource(kind) {
  activeAudioKind = kind;

  if (kind === "upload" && selectedAudioFile) {
    activeAudioSource.textContent = `Uploaded file: ${selectedAudioFile.name}`;
  } else if (kind === "recording" && recordedAudioFile) {
    activeAudioSource.textContent = `Browser recording: ${recordedAudioFile.name}`;
  } else {
    activeAudioSource.textContent = "Choose an audio file or use a recording";
    activeAudioKind = null;
  }

  updateGenerateButtonState();
}

function updateGenerateButtonState() {
  const hasImage = Boolean(imageInput.files?.[0]);
  const hasAudio = Boolean(getActiveAudioFile());
  submitButton.disabled = !hasImage || !hasAudio || isRecording;

  if (isRecording) {
    submitButton.textContent = "Stop recording to generate";
  } else if (!hasImage && !hasAudio) {
    submitButton.textContent = "Add image and audio";
  } else if (!hasImage) {
    submitButton.textContent = "Add an image";
  } else if (!hasAudio) {
    submitButton.textContent = "Add or record audio";
  } else {
    submitButton.textContent = `Generate ${getResolution()} Video`;
  }
}

function setSelectedFile(input, label) {
  const file = input.files?.[0];
  label.textContent = file ? `${file.name} (${formatFileSize(file.size)})` : "No file selected";
  input.closest(".drop-zone").classList.toggle("has-file", Boolean(file));
}

function clearRecording() {
  if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);

  recordedChunks = [];
  recordedAudioBlob = null;
  recordedAudioFile = null;
  recordedAudioUrl = null;
  recordingPreview.removeAttribute("src");
  recordingPreview.hidden = true;
  useRecordingButton.disabled = true;
  rerecordAudioButton.disabled = true;

  if (activeAudioKind === "recording") {
    setActiveAudioSource(selectedAudioFile ? "upload" : null);
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function convertRecordingToWav(recordingBlob) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("This browser cannot convert the recording to WAV.");
  }

  const audioContext = new AudioContextClass();

  try {
    const arrayBuffer = await recordingBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    return audioBufferToWavBlob(audioBuffer);
  } finally {
    await audioContext.close?.();
  }
}

function audioBufferToWavBlob(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = audioBuffer.length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  let offset = 0;

  function writeString(value) {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset, value.charCodeAt(i));
      offset += 1;
    }
  }

  writeString("RIFF");
  view.setUint32(offset, 36 + dataSize, true);
  offset += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true);
  offset += 4;
  view.setUint16(offset, 1, true);
  offset += 2;
  view.setUint16(offset, numChannels, true);
  offset += 2;
  view.setUint32(offset, sampleRate, true);
  offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true);
  offset += 4;
  view.setUint16(offset, blockAlign, true);
  offset += 2;
  view.setUint16(offset, bytesPerSample * 8, true);
  offset += 2;
  writeString("data");
  view.setUint32(offset, dataSize, true);
  offset += 4;

  for (let i = 0; i < audioBuffer.length; i += 1) {
    for (let channel = 0; channel < numChannels; channel += 1) {
      const samples = audioBuffer.getChannelData(channel);
      const sample = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function setupDropZone(input, label) {
  const zone = input.closest(".drop-zone");

  input.addEventListener("change", () => {
    setFormError("");
    setSelectedFile(input, label);
    selectedAudioFile = input === audioInput ? input.files?.[0] ?? null : selectedAudioFile;

    if (input === audioInput) {
      setActiveAudioSource(selectedAudioFile ? "upload" : recordedAudioFile ? "recording" : null);
    }

    updateGenerateButtonState();
  });

  for (const eventName of ["dragenter", "dragover"]) {
    zone.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add("is-dragging");
    });
  }

  for (const eventName of ["dragleave", "drop"]) {
    zone.addEventListener(eventName, () => {
      zone.classList.remove("is-dragging");
    });
  }

  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    setFormError("");
    const file = event.dataTransfer.files?.[0];
    if (!file) return;

    const files = new DataTransfer();
    files.items.add(file);
    input.files = files.files;
    setSelectedFile(input, label);

    if (input === audioInput) {
      selectedAudioFile = file;
      setActiveAudioSource("upload");
    }

    updateGenerateButtonState();
  });
}

function resetRunState() {
  const resolution = getResolution();
  logs.textContent = "Starting...";
  imageUrl.textContent = "Waiting for upload";
  audioUrl.textContent = "Waiting for upload";
  requestId.textContent = "Waiting for completion";
  selectedResolution.textContent = resolution;
  videoResult.hidden = true;
  videoUrl.textContent = "";
  videoUrl.removeAttribute("href");
  resultJson.textContent = "Waiting for result.";
}

async function startRecording() {
  if (!("MediaRecorder" in window) || !navigator.mediaDevices?.getUserMedia) {
    setRecordingStatus("Unsupported", "error");
    setRecordingError("This browser does not support microphone recording with MediaRecorder.");
    return;
  }

  setRecordingError("");
  clearRecording();

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeType = getSupportedRecordingMimeType();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    recordedChunks = [];

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) recordedChunks.push(event.data);
    });

    mediaRecorder.addEventListener("stop", async () => {
      stream.getTracks().forEach((track) => track.stop());

      try {
        const browserRecordingBlob = new Blob(recordedChunks, {
          type: mediaRecorder.mimeType || "audio/webm",
        });

        setRecordingStatus("Converting", "ready");
        recordedAudioBlob = await convertRecordingToWav(browserRecordingBlob);
        recordedAudioFile = new File([recordedAudioBlob], "recording.wav", {
          type: "audio/wav",
        });
        recordedAudioUrl = URL.createObjectURL(recordedAudioBlob);

        recordingPreview.src = recordedAudioUrl;
        recordingPreview.hidden = false;
        useRecordingButton.disabled = false;
        rerecordAudioButton.disabled = false;
        setRecordingStatus("Preview ready", "ready");
      } catch (error) {
        clearRecording();
        setRecordingStatus("Conversion failed", "error");
        setRecordingError(
          "The browser recording could not be converted to WAV. Please try again or upload an audio file.",
        );
      } finally {
        startRecordingButton.disabled = false;
        stopRecordingButton.disabled = true;
        isRecording = false;
        updateGenerateButtonState();
      }
    });

    mediaRecorder.start();
    isRecording = true;
    startRecordingButton.disabled = true;
    stopRecordingButton.disabled = false;
    rerecordAudioButton.disabled = true;
    useRecordingButton.disabled = true;
    setRecordingStatus("Recording", "recording");
    updateGenerateButtonState();
  } catch (error) {
    isRecording = false;
    setRecordingStatus("Mic blocked", "error");
    setRecordingError(
      error?.name === "NotAllowedError"
        ? "Microphone permission was denied. Allow microphone access or upload an audio file instead."
        : "Could not start recording. Check your microphone and try again.",
    );
    updateGenerateButtonState();
  }
}

function stopRecording() {
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
    stopRecordingButton.disabled = true;
    setRecordingStatus("Processing", "ready");
  }
}

async function readEventStream(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const line = chunk.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;

      handleEvent(JSON.parse(line.slice(6)));
    }
  }
}

async function ensureServerIsReachable() {
  let response;

  try {
    response = await fetch("/api/health", {
      cache: "no-store",
    });
  } catch {
    throw new Error(
      "Cannot reach the local Node server. In Terminal, run npm run web, then refresh this page.",
    );
  }

  if (!response.ok) {
    throw new Error(`Local server health check failed with HTTP ${response.status}.`);
  }

  const health = await response.json();

  if (!health.hasFalKey) {
    throw new Error(
      'The local server is running without FAL_KEY. Stop it, run export FAL_KEY="your_fal_api_key_here", then run npm run web again.',
    );
  }
}

function handleEvent(event) {
  if (event.type === "log") {
    appendLog(event.message);
    return;
  }

  if (event.type === "uploaded") {
    if (event.label === "image") renderUrl(imageUrl, event.url);
    if (event.label === "audio") renderUrl(audioUrl, event.url);
    appendLog(`Uploaded ${event.label}: ${event.url}`);
    return;
  }

  if (event.type === "queue") {
    setStatus(event.status);
    appendLog(`Queue status: ${event.status}`);
    return;
  }

  if (event.type === "done") {
    setStatus("Done", "done");
    requestId.textContent = event.requestId ?? "No request ID returned";
    selectedResolution.textContent = event.resolution ?? selectedResolution.textContent;
    resultJson.textContent = JSON.stringify(event.result, null, 2);

    if (event.videoUrl) {
      videoUrl.href = event.videoUrl;
      videoUrl.textContent = event.videoUrl;
      videoResult.hidden = false;
      appendLog(`Final video URL: ${event.videoUrl}`);
    } else {
      appendLog("No final video URL was found in the result object.");
    }
    return;
  }

  if (event.type === "error") {
    setStatus("Error", "error");
    appendLog(`Error: ${event.message}`);
    if (event.body) appendLog(JSON.stringify(event.body, null, 2));
  }
}

setupDropZone(imageInput, imageName);
setupDropZone(audioInput, audioName);
updateGenerateButtonState();

startRecordingButton.addEventListener("click", startRecording);
stopRecordingButton.addEventListener("click", stopRecording);
rerecordAudioButton.addEventListener("click", startRecording);
useRecordingButton.addEventListener("click", () => {
  if (!recordedAudioFile) return;
  setRecordingError("");
  setFormError("");
  setActiveAudioSource("recording");
});

for (const input of resolutionInputs) {
  input.addEventListener("change", () => {
    const resolution = getResolution();
    selectedResolution.textContent = resolution;
    updateGenerateButtonState();
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!imageInput.files?.[0]) {
    setStatus("Error", "error");
    setFormError("Please choose a portrait image first.");
    logs.textContent = "Please choose a portrait image first.";
    return;
  }

  const audioFile = getActiveAudioFile();

  if (!audioFile) {
    setStatus("Error", "error");
    setFormError("Please upload audio or use a browser recording.");
    logs.textContent = "Please upload audio or use a browser recording.";
    return;
  }

  setFormError("");
  resetRunState();
  setStatus("Checking server");
  submitButton.disabled = true;

  const formData = new FormData();
  formData.append("image", imageInput.files[0]);
  formData.append("audio", audioFile);
  formData.append("resolution", getResolution());

  try {
    appendLog(`Selected image from UI: ${imageInput.files[0].name} (${formatFileSize(imageInput.files[0].size)})`);
    appendLog(`Selected audio source: ${activeAudioKind}`);
    appendLog(`Selected audio: ${audioFile.name} (${formatFileSize(audioFile.size)})`);
    appendLog(`Selected resolution: ${getResolution()}`);
    appendLog("Checking local Node server...");
    await ensureServerIsReachable();

    setStatus("Sending files");
    appendLog("Sending selected files to the local Node server...");

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(
        new Error(
          "Timed out before the server responded. Make sure npm run web is still running, then try again.",
        ),
      );
    }, FIRST_RESPONSE_TIMEOUT_MS);

    const response = await fetch("/api/generate", {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`Request failed with HTTP ${response.status}`);
    }

    await readEventStream(response);
  } catch (error) {
    setStatus("Error", "error");
    appendLog(error.message ?? "Request failed.");
  } finally {
    submitButton.disabled = false;
    updateGenerateButtonState();
  }
});

window.addEventListener("beforeunload", () => {
  if (recordedAudioUrl) URL.revokeObjectURL(recordedAudioUrl);
});
