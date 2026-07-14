import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";

/**
 * Reusable bottom sheet sort modal.
 *
 * options: [{ label, value }]
 */
export default function SortSheetModal({
  visible,
  onClose,
  options = [],
  sortKey,
  setSortKey,
  sortDir,
  setSortDir,
  theme,
  fontSize = 16,
  title = "Sort by",
}) {
  return (
    <Modal transparent animationType="none" visible={!!visible} onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: theme?.card }]} onPress={() => {}}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
              <Ionicons name="chevron-back" size={fontSize * 1.2} color={theme?.textPrimary} />
            </TouchableOpacity>

            <Text style={{ fontSize: fontSize * 1.05, fontWeight: "800", color: theme?.textPrimary }}>
              {title}
            </Text>

            <TouchableOpacity onPress={onClose} style={styles.headerBtn}>
              <Ionicons name="close" size={fontSize * 1.2} color={theme?.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={[styles.divider, { backgroundColor: theme?.border }]} />

          {options.map((opt) => {
            const selected = opt.value === sortKey;
            return (
              <TouchableOpacity
                key={opt.value}
                style={styles.row}
                activeOpacity={0.75}
                onPress={() => {
                  setSortKey?.(opt.value);
                  onClose?.();
                }}
              >
                <Text
                  style={{
                    fontSize,
                    color: theme?.textPrimary,
                    fontWeight: selected ? "800" : "600",
                  }}
                >
                  {opt.label}
                </Text>

                {selected ? (
                  <Ionicons name="checkmark" size={fontSize * 1.2} color={theme?.textPrimary} />
                ) : (
                  <View style={{ width: fontSize * 1.2 }} />
                )}
              </TouchableOpacity>
            );
          })}

          <View style={[styles.divider, { backgroundColor: theme?.border, marginTop: 6 }]} />

          <TouchableOpacity
            style={styles.row}
            activeOpacity={0.75}
            onPress={() => setSortDir?.((d) => (d === "asc" ? "desc" : "asc"))}
          >
            <Text style={{ fontSize, color: theme?.textPrimary, fontWeight: "700" }}>
              Direction: {sortDir === "asc" ? "Ascending" : "Descending"}
            </Text>
            <Ionicons
              name={sortDir === "asc" ? "arrow-up" : "arrow-down"}
              size={fontSize * 1.2}
              color={theme?.textPrimary}
            />
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 10,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  headerBtn: {
    width: 44,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: { height: StyleSheet.hairlineWidth },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
});
