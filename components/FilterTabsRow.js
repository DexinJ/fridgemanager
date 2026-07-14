import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";

/**
 * Reusable horizontal tabs row (pill buttons).
 *
 * tabs: [{ key, label, count? }]
 */
export default function FilterTabsRow({
  tabs = [],
  activeKey,
  onChange,
  theme,
  fontSize = 16,
  style,
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      style={style}
    >
      {tabs.map((t) => {
        const selected = t.key === activeKey;
        return (
          <TouchableOpacity
            key={t.key}
            style={[
              styles.pill,
              {
                backgroundColor: selected ? theme?.card : "transparent",
                borderColor: theme?.border,
              },
            ]}
            onPress={() => onChange?.(t.key)}
            activeOpacity={0.85}
          >
            <Text
              style={{
                fontSize: fontSize * 0.9,
                fontWeight: selected ? "700" : "600",
                color: selected ? theme?.textPrimary : theme?.textSecondary,
              }}
            >
              {t.label}
              {typeof t.count === "number" ? ` ${t.count}` : ""}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: "center",
    paddingRight: 6,
    gap: 8,
  },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
});
