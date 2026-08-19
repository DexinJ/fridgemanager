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

export async function buildVoiceUploadFormData(
  uri,
  {
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

  // React Native's FormData implementation recognizes this file descriptor
  // and streams the file URI instead of serializing the object as text.
  formData.append("file", {
    uri: recordingUri,
    type: "audio/mp4",
    name: "recording.m4a",
  });
  return formData;
}
