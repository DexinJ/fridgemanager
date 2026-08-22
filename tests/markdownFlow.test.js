import assert from "node:assert/strict";
import test from "node:test";

import {
  createMarkdownParser,
  parseMarkdownFlow,
} from "../utils/markdownFlow.js";

const parser = createMarkdownParser();

test("plain text becomes one text block", () => {
  assert.deepEqual(parseMarkdownFlow("hello", parser), [
    { type: "text", segments: [{ kind: "text", value: "hello" }] },
  ]);
});

test("empty source produces no blocks", () => {
  assert.deepEqual(parseMarkdownFlow("", parser), []);
});

test("inline styling is captured as nested segments", () => {
  assert.deepEqual(
    parseMarkdownFlow(
      "Hello **bold** and *italic* and ~~strike~~ and `code`",
      parser
    ),
    [
      {
        type: "text",
        segments: [
          { kind: "text", value: "Hello " },
          { kind: "strong", children: [{ kind: "text", value: "bold" }] },
          { kind: "text", value: " and " },
          { kind: "em", children: [{ kind: "text", value: "italic" }] },
          { kind: "text", value: " and " },
          { kind: "s", children: [{ kind: "text", value: "strike" }] },
          { kind: "text", value: " and " },
          { kind: "code", value: "code" },
        ],
      },
    ]
  );
});

test("paragraphs become separate text blocks", () => {
  assert.deepEqual(parseMarkdownFlow("first\n\nsecond", parser), [
    { type: "text", segments: [{ kind: "text", value: "first" }] },
    { type: "text", segments: [{ kind: "text", value: "second" }] },
  ]);
});

test("headings keep their level", () => {
  assert.deepEqual(parseMarkdownFlow("## Title", parser), [
    {
      type: "heading",
      level: 2,
      segments: [{ kind: "text", value: "Title" }],
    },
  ]);
});

test("bullet lists get bullet prefixes", () => {
  assert.deepEqual(parseMarkdownFlow("- one\n- two", parser), [
    { type: "text", segments: [{ kind: "text", value: "• one" }] },
    { type: "text", segments: [{ kind: "text", value: "• two" }] },
  ]);
});

test("ordered lists get sequential numbers", () => {
  assert.deepEqual(parseMarkdownFlow("1. first\n2. second", parser), [
    { type: "text", segments: [{ kind: "text", value: "1. first" }] },
    { type: "text", segments: [{ kind: "text", value: "2. second" }] },
  ]);
});

test("nested lists are indented with spaces", () => {
  assert.deepEqual(parseMarkdownFlow("- parent\n  - child", parser), [
    { type: "text", segments: [{ kind: "text", value: "• parent" }] },
    { type: "text", segments: [{ kind: "text", value: "  • child" }] },
  ]);
});

test("fenced code blocks strip the trailing newline", () => {
  assert.deepEqual(parseMarkdownFlow("```js\nconst a = 1;\n```", parser), [
    { type: "code", content: "const a = 1;" },
  ]);
});

test("indented code blocks are captured", () => {
  assert.deepEqual(parseMarkdownFlow("    const x = 1;", parser), [
    { type: "code", content: "const x = 1;" },
  ]);
});

test("blockquotes nest their own blocks", () => {
  assert.deepEqual(parseMarkdownFlow("> hi", parser), [
    {
      type: "quote",
      blocks: [
        { type: "text", segments: [{ kind: "text", value: "hi" }] },
      ],
    },
  ]);
});

test("horizontal rules are standalone blocks", () => {
  assert.deepEqual(parseMarkdownFlow("a\n\n---\n\nb", parser), [
    { type: "text", segments: [{ kind: "text", value: "a" }] },
    { type: "hr" },
    { type: "text", segments: [{ kind: "text", value: "b" }] },
  ]);
});

test("links keep their href and children", () => {
  assert.deepEqual(parseMarkdownFlow("[label](https://example.com)", parser), [
    {
      type: "text",
      segments: [
        {
          kind: "link",
          href: "https://example.com",
          children: [{ kind: "text", value: "label" }],
        },
      ],
    },
  ]);
});

test("tables render as readable text rows", () => {
  assert.deepEqual(
    parseMarkdownFlow("| A | B |\n|---|---|\n| 1 | 2 |", parser),
    [
      { type: "text", segments: [{ kind: "text", value: "A | B" }] },
      { type: "text", segments: [{ kind: "text", value: "--- | ---" }] },
      { type: "text", segments: [{ kind: "text", value: "1 | 2" }] },
    ]
  );
});

test("single line breaks become newline segments", () => {
  assert.deepEqual(parseMarkdownFlow("line1\nline2", parser), [
    {
      type: "text",
      segments: [
        { kind: "text", value: "line1" },
        { kind: "newline" },
        { kind: "text", value: "line2" },
      ],
    },
  ]);
});

test("images fall back to their alt text", () => {
  assert.deepEqual(
    parseMarkdownFlow("![alt text](https://example.com/img.png)", parser),
    [
      {
        type: "text",
        segments: [{ kind: "text", value: "alt text" }],
      },
    ]
  );
});
