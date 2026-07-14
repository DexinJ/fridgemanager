import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import ActionTile from "./ActionTile";

/**
 * Reusable bottom action bar for multi-select mode.
 *
 * props:
 * - visible: boolean
 * - selectedCount: number
 * - canSelectAll: boolean
 * - onSelectAll: () => void
 * - onClear: () => void
 * - actions: same shape as ActionGridPopover actions
 */
export default function SelectionActionBar({
  visible,
  selectedCount,
  canSelectAll = true,
  onSelectAll,
  onClear,
  actions = [],
  theme,
  fontSize = 16,
  style,
}) {
  if (!visible) return null;

  return (
    <View style={[styles.bar, style, { backgroundColor: theme?.card, borderColor: theme?.border }]}>
      <View style={styles.topRow}>
        <Text style={{ color: theme?.textSecondary, fontSize: fontSize * 0.9, fontWeight: "700" }}>
          {selectedCount === 0 ? "Select items" : `${selectedCount} selected`}
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {selectedCount === 0 ? (
            <TouchableOpacity
              onPress={canSelectAll ? onSelectAll : undefined}
              activeOpacity={0.8}
              style={[styles.pillBtn, !canSelectAll && { opacity: 0.4 }]}
              disabled={!canSelectAll}
            >
              <Text style={{ color: theme?.textPrimary, fontSize: fontSize * 0.9, fontWeight: "800" }}>
                Select all
              </Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={onClear} activeOpacity={0.8} style={styles.pillBtn}>
              <Text style={{ color: theme?.textPrimary, fontSize: fontSize * 0.9, fontWeight: "800" }}>
                Clear
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <View style={styles.grid}>
        {actions.map((a) => (
          <ActionTile
            key={a.key}
            icon={a.icon}
            label={a.label}
            danger={!!a.danger}
            disabled={!!a.disabled || selectedCount === 0}
            onPress={a.onPress}
            tint={theme?.textPrimary ?? "#333"}
            dangerTint={theme?.danger ?? "#ff4d4f"}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 1,
    height: "20%",
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  pillBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.2)",
  },
  grid: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
});
