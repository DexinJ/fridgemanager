export function normalizeComposerText(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function shouldShowSendButton(value) {
  return normalizeComposerText(value).length > 0;
}

export function mergeTranscriptIntoComposer(currentValue, transcript) {
  const current = normalizeComposerText(currentValue);
  const spoken = normalizeComposerText(transcript);

  if (!spoken) return current;
  return current ? `${current} ${spoken}` : spoken;
}

function normalizedMimeType(value, fallback) {
  const mimeType = String(value || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase();

  if (
    mimeType === "video/mp4" ||
    mimeType === "audio/x-m4a" ||
    mimeType === "audio/m4a"
  ) {
    return "audio/mp4";
  }

  return mimeType.startsWith("audio/") ? mimeType : fallback;
}

function extensionForMimeType(mimeType) {
  if (mimeType === "audio/mp4" || mimeType === "audio/m4a") return "m4a";
  if (mimeType === "audio/mpeg" || mimeType === "audio/mp3") return "mp3";
  if (mimeType === "audio/ogg") return "ogg";
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") return "wav";
  return "webm";
}

export async function buildVoiceUploadFormData(
  uri,
  platform,
  {
    fetchImpl = globalThis.fetch,
    FormDataImpl = globalThis.FormData,
  } = {}
) {
  const recordingUri = typeof uri === "string" ? uri.trim() : "";
  if (!recordingUri) {
    throw new Error("The recording did not produce a file.");
  }
  if (typeof FormDataImpl !== "function") {
    throw new Error("Audio uploads are not supported on this device.");
  }

  const formData = new FormDataImpl();

  if (platform === "web") {
    if (typeof fetchImpl !== "function") {
      throw new Error("The browser could not read the recording.");
    }
    const recordingResponse = await fetchImpl(recordingUri);
    if (!recordingResponse?.ok || typeof recordingResponse.blob !== "function") {
      throw new Error("The browser could not read the recording.");
    }
    const sourceBlob = await recordingResponse.blob();
    if (!sourceBlob?.size) {
      throw new Error("The recording is empty.");
    }

    const mimeType = normalizedMimeType(sourceBlob.type, "audio/webm");
    const uploadBlob =
      sourceBlob.type === mimeType
        ? sourceBlob
        : sourceBlob.slice(0, sourceBlob.size, mimeType);
    formData.append(
      "file",
      uploadBlob,
      `recording.${extensionForMimeType(mimeType)}`
    );
    return formData;
  }

  // React Native's FormData implementation recognizes this file descriptor
  // and streams the file URI instead of serializing the object as text.
  formData.append("file", {
    uri: recordingUri,
    type: "audio/mp4",
    name: "recording.m4a",
  });
  return formData;
}
