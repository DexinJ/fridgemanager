// utils/markdownFlow.js
// Parses assistant markdown into a plain, serializable block structure so the
// chat can render it as a single selectable <Text> run per message. On iOS,
// native text selection spans nested <Text> children but stops at <View>
// boundaries, so text-only blocks are grouped into runs and View-based blocks
// (code, blockquotes, horizontal rules) stay separate. Keeping the parse pure
// makes it unit-testable without React Native.

import MarkdownIt from "markdown-it";

export function createMarkdownParser() {
  // Mirror the settings react-native-markdown-display used: no raw HTML, no
  // auto-linking (plain URLs are already extracted into preview cards).
  return new MarkdownIt({
    html: false,
    linkify: false,
    typographer: false,
  });
}

export function parseMarkdownFlow(source, parser) {
  try {
    const tokens = parser.parse(String(source ?? ""), {});
    return parseBlocks(tokens, 0, tokens.length, 0);
  } catch (error) {
    console.warn("Markdown parse failed:", error);
    return [
      {
        type: "text",
        segments: [{ kind: "text", value: String(source ?? "") }],
      },
    ];
  }
}

function parseBlocks(tokens, start, end, listDepth) {
  const blocks = [];
  let i = start;

  while (i < end) {
    const token = tokens[i];

    switch (token.type) {
      case "paragraph_open": {
        const close = findClose(tokens, i);
        blocks.push({
          type: "text",
          segments: collectInlineSegments(tokens, i + 1, close),
        });
        i = close + 1;
        break;
      }

      case "heading_open": {
        const close = findClose(tokens, i);
        const rawLevel = Number.parseInt(token.tag?.[1] ?? "", 10);
        blocks.push({
          type: "heading",
          level: Number.isInteger(rawLevel)
            ? Math.min(Math.max(rawLevel, 1), 6)
            : 1,
          segments: collectInlineSegments(tokens, i + 1, close),
        });
        i = close + 1;
        break;
      }

      case "bullet_list_open": {
        const close = findClose(tokens, i);
        pushListBlocks(blocks, tokens, i + 1, close, listDepth, false);
        i = close + 1;
        break;
      }

      case "ordered_list_open": {
        const close = findClose(tokens, i);
        pushListBlocks(blocks, tokens, i + 1, close, listDepth, true);
        i = close + 1;
        break;
      }

      case "blockquote_open": {
        const close = findClose(tokens, i);
        blocks.push({
          type: "quote",
          blocks: parseBlocks(tokens, i + 1, close, listDepth),
        });
        i = close + 1;
        break;
      }

      case "fence":
      case "code_block":
        blocks.push({
          type: "code",
          content: stripTrailingNewline(token.content),
        });
        i += 1;
        break;

      case "hr":
        blocks.push({ type: "hr" });
        i += 1;
        break;

      case "table_open": {
        const close = findClose(tokens, i);
        blocks.push(...parseTable(tokens, i + 1, close));
        i = close + 1;
        break;
      }

      default:
        i += 1;
        break;
    }
  }

  return blocks;
}

function pushListBlocks(blocks, tokens, start, end, listDepth, ordered) {
  let i = start;
  let number = 1;

  while (i < end) {
    if (tokens[i].type === "list_item_open") {
      const close = findClose(tokens, i);
      const indent = "  ".repeat(listDepth);
      const marker = ordered ? `${indent}${number}. ` : `${indent}• `;
      number += 1;

      const itemBlocks = parseBlocks(tokens, i + 1, close, listDepth + 1);
      const firstRun = itemBlocks.find(
        (block) => block.type === "text" || block.type === "heading"
      );

      if (firstRun) {
        const first = firstRun.segments[0];
        if (first && first.kind === "text") {
          firstRun.segments[0] = {
            kind: "text",
            value: marker + first.value,
          };
        } else {
          firstRun.segments.unshift({ kind: "text", value: marker });
        }
      } else {
        blocks.push({
          type: "text",
          segments: [{ kind: "text", value: marker }],
        });
      }

      blocks.push(...itemBlocks);
      i = close + 1;
    } else {
      i += 1;
    }
  }
}

// markdown-it keeps inline content (text, strong, em, links, ...) inside the
// `children` array of an `inline` token rather than in the top-level stream.
function collectInlineSegments(tokens, start, end) {
  const children = [];
  for (let i = start; i < end; i += 1) {
    if (tokens[i].type === "inline" && Array.isArray(tokens[i].children)) {
      children.push(...tokens[i].children);
    }
  }
  return parseInline(children);
}

function parseInline(children) {
  const segments = [];
  let i = 0;

  while (i < children.length) {
    const token = children[i];

    switch (token.type) {
      case "text":
        segments.push({ kind: "text", value: token.content });
        i += 1;
        break;

      case "softbreak":
      case "hardbreak":
        segments.push({ kind: "newline" });
        i += 1;
        break;

      case "code_inline":
        segments.push({ kind: "code", value: token.content });
        i += 1;
        break;

      case "image": {
        const alt = token.content || "";
        const src =
          (token.attrs ?? []).find(([name]) => name === "src")?.[1] ?? "";
        segments.push({ kind: "text", value: alt || src });
        i += 1;
        break;
      }

      case "strong_open":
      case "em_open":
      case "s_open": {
        const close = findClose(children, i);
        const kind =
          token.type === "strong_open"
            ? "strong"
            : token.type === "em_open"
              ? "em"
              : "s";
        segments.push({
          kind,
          children: parseInline(children.slice(i + 1, close)),
        });
        i = close + 1;
        break;
      }

      case "link_open": {
        const close = findClose(children, i);
        const href =
          (token.attrs ?? []).find(([name]) => name === "href")?.[1] ?? "";
        segments.push({
          kind: "link",
          href,
          children: parseInline(children.slice(i + 1, close)),
        });
        i = close + 1;
        break;
      }

      default:
        i += 1;
        break;
    }
  }

  return segments;
}

function parseTable(tokens, start, end) {
  const rows = [];
  let row = null;
  let i = start;

  while (i < end) {
    const token = tokens[i];

    if (token.type === "tr_open") {
      row = [];
    } else if (token.type === "tr_close") {
      if (row) rows.push(row);
      row = null;
    } else if ((token.type === "th_open" || token.type === "td_open") && row) {
      const close = findClose(tokens, i);
      row.push(
        segmentsToPlainText(collectInlineSegments(tokens, i + 1, close))
      );
      i = close;
    }

    i += 1;
  }

  if (!rows.length) return [];

  const [header, ...bodyRows] = rows;
  const blocks = [
    {
      type: "text",
      segments: [{ kind: "text", value: header.join(" | ") }],
    },
  ];

  if (bodyRows.length) {
    blocks.push({
      type: "text",
      segments: [
        { kind: "text", value: header.map(() => "---").join(" | ") },
      ],
    });
    for (const rowCells of bodyRows) {
      blocks.push({
        type: "text",
        segments: [{ kind: "text", value: rowCells.join(" | ") }],
      });
    }
  }

  return blocks;
}

function segmentsToPlainText(segments) {
  let out = "";

  for (const segment of segments) {
    switch (segment.kind) {
      case "text":
      case "code":
        out += segment.value;
        break;
      case "newline":
        out += " ";
        break;
      case "strong":
      case "em":
      case "s":
      case "link":
        out += segmentsToPlainText(segment.children);
        break;
      default:
        break;
    }
  }

  return out;
}

function findClose(tokens, openIndex) {
  const openType = tokens[openIndex].type;
  const closeType = openType.replace("_open", "_close");
  let depth = 0;

  for (let i = openIndex; i < tokens.length; i += 1) {
    if (tokens[i].type === openType) depth += 1;
    if (tokens[i].type === closeType) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }

  return tokens.length - 1;
}

function stripTrailingNewline(value) {
  return typeof value === "string" && value.endsWith("\n")
    ? value.slice(0, -1)
    : value;
}
