import * as FileSystem from "expo-file-system/legacy";

const ROOT_DIRECTORY = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}pantrio-chat-attachments/`
  : null;

function safeUserDirectoryName(uid) {
  return encodeURIComponent(String(uid || "anonymous").trim() || "anonymous");
}

function userDirectory(uid) {
  return ROOT_DIRECTORY
    ? `${ROOT_DIRECTORY}${safeUserDirectoryName(uid)}/`
    : null;
}

export function isManagedChatAttachment(uri) {
  return Boolean(
    ROOT_DIRECTORY &&
      typeof uri === "string" &&
      uri.startsWith(ROOT_DIRECTORY)
  );
}

export async function persistChatAttachment(uid, sourceUri) {
  const normalizedSource = String(sourceUri || "").trim();
  if (!normalizedSource) throw new Error("The image file is missing.");
  if (
    !ROOT_DIRECTORY
  ) return normalizedSource;
  if (isManagedChatAttachment(normalizedSource)) return normalizedSource;

  const directory = userDirectory(uid);
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  const filename = `${Date.now()}-${Math.random().toString(16).slice(2)}.jpg`;
  const destination = `${directory}${filename}`;
  await FileSystem.copyAsync({ from: normalizedSource, to: destination });
  return destination;
}

export async function deleteChatAttachments(uid) {
  const directory = userDirectory(uid);
  if (!directory) return;
  await FileSystem.deleteAsync(directory, { idempotent: true });
}

export async function pruneChatAttachments(uid, retainedUris = []) {
  const directory = userDirectory(uid);
  if (!directory) return;

  const directoryInfo = await FileSystem.getInfoAsync(directory);
  if (!directoryInfo.exists) return;

  const retained = new Set(
    (Array.isArray(retainedUris) ? retainedUris : []).filter((uri) =>
      isManagedChatAttachment(uri)
    )
  );
  const filenames = await FileSystem.readDirectoryAsync(directory);
  await Promise.allSettled(
    filenames.map((filename) => {
      const uri = `${directory}${filename}`;
      return retained.has(uri)
        ? Promise.resolve()
        : FileSystem.deleteAsync(uri, { idempotent: true });
    })
  );
}
