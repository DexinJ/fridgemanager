// components/MarkdownText.js

import { memo, useMemo } from "react";
import { Linking, View } from "react-native";
import Markdown from "react-native-markdown-display";

import LinkPreviewCard from "./LinkPreviewCard";
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

function buildMarkdownStyle(theme, fontSize) {
  return {
    body: { color: theme.textPrimary, fontSize },
    paragraph: { marginTop: 0, marginBottom: 4 },
    strong: { fontWeight: "700" },
    em: { fontStyle: "italic" },
    s: { textDecorationLine: "line-through" },
    link: { color: theme.accent },
    code_inline: {
      backgroundColor: theme.inputBackground,
      fontFamily: MONO_FONT,
      fontSize: fontSize - 1,
      color: theme.textPrimary,
      borderRadius: 4,
      paddingHorizontal: 3,
    },
    fence: {
      backgroundColor: theme.inputBackground,
      fontFamily: MONO_FONT,
      fontSize: fontSize - 1,
      color: theme.textPrimary,
      borderRadius: 10,
      padding: 10,
      marginVertical: 6,
    },
    code_block: {
      backgroundColor: theme.inputBackground,
      fontFamily: MONO_FONT,
      fontSize: fontSize - 1,
      color: theme.textPrimary,
      borderRadius: 10,
      padding: 10,
      marginVertical: 6,
    },
    heading1: {
      color: theme.textPrimary,
      fontSize: fontSize + 6,
      fontWeight: "700",
    },
    heading2: {
      color: theme.textPrimary,
      fontSize: fontSize + 4,
      fontWeight: "700",
    },
    heading3: {
      color: theme.textPrimary,
      fontSize: fontSize + 2,
      fontWeight: "700",
    },
    heading4: {
      color: theme.textPrimary,
      fontSize: fontSize + 1,
      fontWeight: "700",
    },
    heading5: {
      color: theme.textPrimary,
      fontSize,
      fontWeight: "700",
    },
    heading6: {
      color: theme.textPrimary,
      fontSize,
      fontWeight: "700",
    },
    blockquote: {
      borderLeftColor: theme.border,
      opacity: 0.85,
    },
    hr: { backgroundColor: theme.border },
  };
}

function MarkdownText({ text, theme, fontSize = 16 }) {
  const segments = useMemo(() => splitMessageSegments(text), [text]);
  const markdownStyle = useMemo(
    () => buildMarkdownStyle(theme, fontSize),
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
          <Markdown
            key={`markdown-${index}`}
            style={markdownStyle}
            onLinkPress={openUrl}
          >
            {segment.value}
          </Markdown>
        )
      )}
    </View>
  );
}

export default memo(MarkdownText);
