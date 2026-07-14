import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

/**
 * Reusable section header with optional pill counter.
 */
export default function SectionHeaderPill({
  title,
  count,
  theme,
  fontSize = 16,
  tone = "neutral", // "danger" | "warning" | "neutral"
  style,
}) {
  if (!title) return null;

  const isDanger = tone === "danger";
  const isWarning = tone === "warning";

  const tint = isDanger ? theme?.danger : isWarning ? theme?.warning : theme?.textSecondary;
  const pillBg = isDanger ? theme?.danger : isWarning ? theme?.warning : theme?.textSecondary;

  return (
    <View style={[styles.wrap, style, { backgroundColor: theme?.background }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {typeof count === "number" && (
          <View style={[styles.pill, { backgroundColor: pillBg }]}>
            <Ionicons name="warning" size={fontSize * 1.0} color="#fff" />
            <Text style={[styles.pillText, { fontSize: fontSize * 0.86 }]}>{count}</Text>
          </View>
        )}

        <Text
          style={[
            styles.title,
            {
              color: tint,
              fontSize: Math.max(12, fontSize * 0.8),
            },
          ]}
        >
          {title}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 14,
  },
  title: {
    letterSpacing: 1,
    fontWeight: "900",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  pillText: {
    color: "#fff",
    fontWeight: "900",
  },
});
