// components/MarkdownText.js
// Renders assistant markdown as one selectable <Text> run per message (with
// nested <Text> for inline styling) so iOS lets the user drag selection
// handles across paragraphs and formatted spans, like on a web page. Native
// selection can't cross <View> boundaries, so code blocks, blockquotes, and
// horizontal rules are rendered as their own blocks (their text is still
// individually selectable).

import { memo, useMemo } from "react";
import { Linking, Text, View } from "react-native";

import LinkPreviewCard from "./LinkPreviewCard";
import {
  createMarkdownParser,
  parseMarkdownFlow,
} from "../utils/markdownFlow";
import { splitMessageSegments } from "../utils/markdownSegments";

const MONO_FONT = "Menlo";

function openUrl(url) {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) return true;
  Linking.canOpenURL(safeUrl)
    .then((supported) => {
      if (supported) return Linking.openURL(safeUrl);
      return undefined;
    })
    .catch(() => {});
  return true;
}

function buildMarkdownStyles(theme, fontSize) {
  const headingSizes = [6, 4, 2, 1, 0, 0];
  const styles = {
    body: { color: theme.textPrimary, fontSize },
    strong: { fontWeight: "700" },
    em: { fontStyle: "italic" },
    s: { textDecorationLine: "line-through" },
    link: { color: theme.accent },
    codeInline: {
      backgroundColor: theme.inputBackground,
      fontFamily: MONO_FONT,
      fontSize: fontSize - 1,
      color: theme.textPrimary,
      borderRadius: 4,
      paddingHorizontal: 3,
    },
    codeBlockView: {
      backgroundColor: theme.inputBackground,
      borderRadius: 10,
      padding: 10,
      marginVertical: 6,
    },
    codeBlockText: {
      fontFamily: MONO_FONT,
      fontSize: fontSize - 1,
      color: theme.textPrimary,
    },
    blockquote: {
      borderLeftWidth: 4,
      borderLeftColor: theme.border,
      paddingLeft: 10,
      opacity: 0.85,
      marginVertical: 4,
    },
    hr: {
      height: 1,
      backgroundColor: theme.border,
      marginVertical: 8,
    },
  };

  headingSizes.forEach((extra, index) => {
    styles[`heading${index + 1}`] = {
      color: theme.textPrimary,
      fontSize: fontSize + extra,
      fontWeight: "700",
    };
  });

  return styles;
}

function renderInlineSegments(segments, styles, keyPrefix) {
  return segments.map((segment, index) => {
    const key = `${keyPrefix}-${index}`;

    switch (segment.kind) {
      case "text":
        return segment.value;
      case "newline":
        return "\n";
      case "code":
        return (
          <Text key={key} style={styles.codeInline}>
            {segment.value}
          </Text>
        );
      case "strong":
        return (
          <Text key={key} style={styles.strong}>
            {renderInlineSegments(segment.children, styles, key)}
          </Text>
        );
      case "em":
        return (
          <Text key={key} style={styles.em}>
            {renderInlineSegments(segment.children, styles, key)}
          </Text>
        );
      case "s":
        return (
          <Text key={key} style={styles.s}>
            {renderInlineSegments(segment.children, styles, key)}
          </Text>
        );
      case "link":
        return (
          <Text
            key={key}
            style={styles.link}
            onPress={() => openUrl(segment.href)}
          >
            {renderInlineSegments(segment.children, styles, key)}
          </Text>
        );
      default:
        return null;
    }
  });
}

function renderBlocks(blocks, styles) {
  const elements = [];
  let run = [];
  let elementKey = 0;
  let runItemKey = 0;

  const flushRun = () => {
    if (run.length) {
      elements.push(
        <Text key={`run-${elementKey}`} selectable style={styles.body}>
          {run}
        </Text>
      );
      elementKey += 1;
      run = [];
    }
  };

  const pushSeparator = () => {
    if (run.length) run.push("\n");
  };

  for (const block of blocks) {
    switch (block.type) {
      case "text":
        if (!block.segments.length) break;
        pushSeparator();
        run.push(
          ...renderInlineSegments(
            block.segments,
            styles,
            `item-${runItemKey}`
          )
        );
        runItemKey += 1;
        break;

      case "heading": {
        pushSeparator();
        const key = `item-${runItemKey}`;
        runItemKey += 1;
        run.push(
          <Text key={key} style={styles[`heading${block.level}`]}>
            {renderInlineSegments(block.segments, styles, key)}
          </Text>
        );
        break;
      }

      case "code":
        flushRun();
        elements.push(
          <View key={`code-${elementKey}`} style={styles.codeBlockView}>
            <Text selectable style={styles.codeBlockText}>
              {block.content}
            </Text>
          </View>
        );
        elementKey += 1;
        break;

      case "hr":
        flushRun();
        elements.push(<View key={`hr-${elementKey}`} style={styles.hr} />);
        elementKey += 1;
        break;

      case "quote":
        flushRun();
        elements.push(
          <View key={`quote-${elementKey}`} style={styles.blockquote}>
            {renderBlocks(block.blocks, styles)}
          </View>
        );
        elementKey += 1;
        break;

      default:
        break;
    }
  }

  flushRun();
  return elements;
}

function MarkdownSegment({ source, parser, styles }) {
  const blocks = useMemo(
    () => parseMarkdownFlow(source, parser),
    [source, parser]
  );
  return <>{renderBlocks(blocks, styles)}</>;
}

function MarkdownText({ text, theme, fontSize = 16 }) {
  const parser = useMemo(() => createMarkdownParser(), []);
  const segments = useMemo(() => splitMessageSegments(text), [text]);
  const styles = useMemo(
    () => buildMarkdownStyles(theme, fontSize),
    [theme, fontSize]
  );

  return (
    <View>
      {segments.map((segment, index) =>
        segment.type === "url" ? (
          <LinkPreviewCard
            key={`${index}-${segment.value}`}
            url={segment.value}
            theme={theme}
          />
        ) : (
          <MarkdownSegment
            key={`markdown-${index}`}
            source={segment.value}
            parser={parser}
            styles={styles}
          />
        )
      )}
    </View>
  );
}

export default memo(MarkdownText);
