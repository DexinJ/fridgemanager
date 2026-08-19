// utils/markdownSegments.js
// Splits assistant markdown text at URLs so each URL can be replaced by an
// inline link-preview card. Fenced code blocks, inline code spans, and
// markdown links ([label](url)) are preserved so the markdown renderer can
// handle them normally.

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
const FENCE_OPEN = /^```[A-Za-z0-9_+-]*\s*$/;
const FENCE_CLOSE = /^```\s*$/;

export function cleanUrl(raw) {
  return String(raw || "").replace(/[),.?!:;"'\]]+$/g, "");
}

function isInsideMarkdownLink(source, urlIndex) {
  let openParen = -1;
  for (let i = urlIndex - 1; i >= 0; i -= 1) {
    if (source[i] === "(") {
      openParen = i;
      break;
    }
    if (source[i] === "\n") break;
  }
  return openParen >= 1 && source[openParen - 1] === "]";
}

function pushUrlSegments(segments, plainText) {
  let textBuffer = "";
  let i = 0;

  const emitText = (value) => {
    if (value) segments.push({ type: "text", value });
  };

  while (i < plainText.length) {
    const backtickIndex = plainText.indexOf("`", i);
    URL_PATTERN.lastIndex = i;
    const urlMatch = URL_PATTERN.exec(plainText);

    if (!urlMatch) {
      textBuffer += plainText.slice(i);
      break;
    }

    if (backtickIndex >= 0 && backtickIndex < urlMatch.index) {
      // Inline code span comes first: keep it verbatim, no URL splitting.
      const end = plainText.indexOf("`", backtickIndex + 1);
      if (end < 0) {
        textBuffer += plainText.slice(i);
        break;
      }
      textBuffer += plainText.slice(i, end + 1);
      i = end + 1;
      continue;
    }

    if (isInsideMarkdownLink(plainText, urlMatch.index)) {
      // [label](url) — leave it for the markdown renderer.
      textBuffer += plainText.slice(i, urlMatch.index + urlMatch[0].length);
      i = urlMatch.index + urlMatch[0].length;
      continue;
    }

    emitText(textBuffer + plainText.slice(i, urlMatch.index));
    textBuffer = "";

    const rawUrl = urlMatch[0];
    const url = cleanUrl(rawUrl);
    if (url) segments.push({ type: "url", value: url });
    // Keep trailing punctuation (e.g. ".") in the text instead of dropping it.
    textBuffer += rawUrl.slice(url.length);
    i = urlMatch.index + rawUrl.length;
  }

  emitText(textBuffer);
}

/**
 * Split a message into text/url segments. Text segments are rendered with
 * markdown; URL segments are replaced by inline preview cards.
 */
export function splitMessageSegments(text) {
  const segments = [];
  const source = String(text ?? "");
  const lines = source.split(/\r?\n/);

  let plainBuffer = [];
  let fenceLines = [];
  let inFence = false;

  const flushPlain = () => {
    if (plainBuffer.length) {
      pushUrlSegments(segments, plainBuffer.join("\n"));
      plainBuffer = [];
    }
  };

  const flushFence = () => {
    if (fenceLines.length) {
      segments.push({ type: "text", value: fenceLines.join("\n") });
      fenceLines = [];
    }
  };

  for (const line of lines) {
    if (inFence) {
      fenceLines.push(line);
      if (FENCE_CLOSE.test(line.trim())) {
        inFence = false;
        flushFence();
      }
      continue;
    }

    if (FENCE_OPEN.test(line.trim())) {
      flushPlain();
      fenceLines.push(line);
      inFence = true;
      continue;
    }

    plainBuffer.push(line);
  }

  if (inFence) flushFence();
  flushPlain();

  return segments;
}
