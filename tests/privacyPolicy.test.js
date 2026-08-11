import assert from "node:assert/strict";
import test from "node:test";
import {
  shouldClearChatOnIncognitoExit,
  shouldPersistChat,
} from "../utils/chatStoragePolicy.js";
import {
  canFetchLinkPreview,
  shouldAutoLoadLinkPreview,
} from "../utils/linkPreviewPolicy.js";

test("incognito chat is never persisted", () => {
  assert.equal(shouldPersistChat({ privacy: { incognito: true } }), false);
  assert.equal(shouldPersistChat({ privacy: { incognito: false } }), true);
});

test("leaving incognito clears the private in-memory conversation before persistence resumes", () => {
  assert.equal(shouldClearChatOnIncognitoExit(true, false), true);
  assert.equal(shouldClearChatOnIncognitoExit(true, true), false);
  assert.equal(shouldClearChatOnIncognitoExit(false, false), false);
});

test("link metadata never loads automatically", () => {
  assert.equal(shouldAutoLoadLinkPreview(), false);
  assert.equal(shouldAutoLoadLinkPreview({ incognito: true }), false);
});

test("preview URL policy rejects local, private, credentialed, and insecure URLs", () => {
  for (const url of [
    "http://example.com",
    "https://localhost/path",
    "https://127.0.0.1/",
    "https://10.1.2.3/",
    "https://192.168.1.1/",
    "https://user:password@example.com/",
    "https://printer.local/",
  ]) {
    assert.equal(canFetchLinkPreview(url), false, url);
  }
  assert.equal(canFetchLinkPreview("https://example.com/article"), true);
});
