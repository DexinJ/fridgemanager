import AsyncStorage from "@react-native-async-storage/async-storage";

const ACCOUNT_DELETION_PREFIX = "pantrio.accountDeletion.v1.";
const APPLE_LINK_PREFIX = "pantrio.appleLink.v1.";
const POST_AUTH_NOTICE_KEY = "pantrio.postAuthNotice.v1";

function normalizedUid(uid) {
  const value = String(uid || "").trim();
  if (!value) throw new Error("A Firebase UID is required.");
  return value;
}

function uidKey(prefix, uid) {
  return `${prefix}${encodeURIComponent(normalizedUid(uid))}`;
}

function parseObject(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export async function getAccountDeletionLifecycle(uid) {
  return parseObject(
    await AsyncStorage.getItem(uidKey(ACCOUNT_DELETION_PREFIX, uid))
  );
}

export async function updateAccountDeletionLifecycle(uid, patch = {}) {
  const key = uidKey(ACCOUNT_DELETION_PREFIX, uid);
  const previous = parseObject(await AsyncStorage.getItem(key)) || {};
  const now = new Date().toISOString();
  const next = {
    version: 1,
    uid: normalizedUid(uid),
    requestedAt: previous.requestedAt || now,
    ...previous,
    ...patch,
    updatedAt: now,
  };
  await AsyncStorage.setItem(key, JSON.stringify(next));
  return next;
}

export async function clearAccountDeletionLifecycle(uid) {
  await AsyncStorage.removeItem(uidKey(ACCOUNT_DELETION_PREFIX, uid));
}

export async function getAppleLinkState(uid) {
  return parseObject(await AsyncStorage.getItem(uidKey(APPLE_LINK_PREFIX, uid)));
}

export async function setAppleLinkState(uid, state = {}) {
  const value = {
    version: 1,
    uid: normalizedUid(uid),
    status: state.status === "linked" ? "linked" : "relink_required",
    code: state.code ? String(state.code) : null,
    httpStatus: Number.isFinite(state.httpStatus) ? state.httpStatus : null,
    updatedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(
    uidKey(APPLE_LINK_PREFIX, uid),
    JSON.stringify(value)
  );
  return value;
}

export async function clearAppleLinkState(uid) {
  await AsyncStorage.removeItem(uidKey(APPLE_LINK_PREFIX, uid));
}

export async function getDurablePostAuthNotice() {
  return parseObject(await AsyncStorage.getItem(POST_AUTH_NOTICE_KEY));
}

export async function setDurablePostAuthNotice(notice) {
  const title = String(notice?.title || "Account update").trim();
  const message = String(notice?.message || "").trim();
  if (!message) return null;
  const value = {
    version: 1,
    title,
    message,
    audienceUid: notice?.audienceUid
      ? String(notice.audienceUid).trim() || null
      : null,
    createdAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(POST_AUTH_NOTICE_KEY, JSON.stringify(value));
  return value;
}

export async function clearDurablePostAuthNotice() {
  await AsyncStorage.removeItem(POST_AUTH_NOTICE_KEY);
}
