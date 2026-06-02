const form = document.querySelector("#generate-form");
const imageInput = document.querySelector("#image-input");
const audioInput = document.querySelector("#audio-input");
const imageName = document.querySelector("#image-name");
const audioName = document.querySelector("#audio-name");
const resolutionInputs = document.querySelectorAll('input[name="resolution"]');
const submitButton = document.querySelector("#submit-button");
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

function getResolution() {
  return document.querySelector('input[name="resolution"]:checked')?.value ?? "480p";
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

function setSelectedFile(input, label) {
  const file = input.files?.[0];
  label.textContent = file ? `${file.name} (${formatFileSize(file.size)})` : "No file selected";
  input.closest(".drop-zone").classList.toggle("has-file", Boolean(file));
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setupDropZone(input, label) {
  const zone = input.closest(".drop-zone");

  input.addEventListener("change", () => setSelectedFile(input, label));

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
    const file = event.dataTransfer.files?.[0];
    if (!file) return;

    const files = new DataTransfer();
    files.items.add(file);
    input.files = files.files;
    setSelectedFile(input, label);
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

for (const input of resolutionInputs) {
  input.addEventListener("change", () => {
    const resolution = getResolution();
    selectedResolution.textContent = resolution;
    submitButton.textContent = `Generate ${resolution} Video`;
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!imageInput.files?.[0]) {
    setStatus("Error", "error");
    logs.textContent = "Please choose an image file.";
    return;
  }

  if (!audioInput.files?.[0]) {
    setStatus("Error", "error");
    logs.textContent = "Please choose an audio file.";
    return;
  }

  resetRunState();
  setStatus("Checking server");
  submitButton.disabled = true;

  const formData = new FormData();
  formData.append("image", imageInput.files[0]);
  formData.append("audio", audioInput.files[0]);
  formData.append("resolution", getResolution());

  try {
    appendLog(`Selected image from UI: ${imageInput.files[0].name} (${formatFileSize(imageInput.files[0].size)})`);
    appendLog(`Selected audio from UI: ${audioInput.files[0].name} (${formatFileSize(audioInput.files[0].size)})`);
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
  }
});
