import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanUrl,
  splitMessageSegments,
} from "../utils/markdownSegments.js";

test("cleanUrl trims trailing punctuation", () => {
  assert.equal(cleanUrl("https://example.com."), "https://example.com");
  assert.equal(cleanUrl("https://example.com/a),"), "https://example.com/a");
  assert.equal(cleanUrl("https://example.com"), "https://example.com");
});

test("splitMessageSegments replaces a plain URL with a url segment", () => {
  assert.deepEqual(splitMessageSegments("check https://example.com out"), [
    { type: "text", value: "check " },
    { type: "url", value: "https://example.com" },
    { type: "text", value: " out" },
  ]);
});

test("splitMessageSegments keeps trailing punctuation in the text", () => {
  assert.deepEqual(splitMessageSegments("see https://x.com."), [
    { type: "text", value: "see " },
    { type: "url", value: "https://x.com" },
    { type: "text", value: "." },
  ]);
});

test("splitMessageSegments protects fenced code blocks", () => {
  const source = "```js\nconst u = 'https://x.com';\n```";
  assert.deepEqual(splitMessageSegments(source), [
    { type: "text", value: source },
  ]);
});

test("splitMessageSegments protects inline code spans", () => {
  const source = "run `npm i https://x.com` now";
  assert.deepEqual(splitMessageSegments(source), [
    { type: "text", value: source },
  ]);
});

test("splitMessageSegments protects markdown links", () => {
  const source = "[OpenAI](https://openai.com) docs";
  assert.deepEqual(splitMessageSegments(source), [
    { type: "text", value: source },
  ]);
});

test("splitMessageSegments emits multiple url segments", () => {
  assert.deepEqual(
    splitMessageSegments("a https://one.com b https://two.com c"),
    [
      { type: "text", value: "a " },
      { type: "url", value: "https://one.com" },
      { type: "text", value: " b " },
      { type: "url", value: "https://two.com" },
      { type: "text", value: " c" },
    ]
  );
});

test("splitMessageSegments handles empty and invalid input", () => {
  assert.deepEqual(splitMessageSegments(""), []);
  assert.deepEqual(splitMessageSegments(null), []);
  assert.deepEqual(splitMessageSegments("no urls here"), [
    { type: "text", value: "no urls here" },
  ]);
});
