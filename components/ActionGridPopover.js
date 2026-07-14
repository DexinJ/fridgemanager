import React from "react";
import { StyleSheet, View } from "react-native";
import Popover from "react-native-popover-view";
import ActionTile from "./ActionTile";

/**
 * Reusable grid popover for context actions (long-press menus).
 *
 * actions: Array of
 * {
 *   key: string,
 *   icon: string,
 *   label: string,
 *   onPress: () => void,
 *   danger?: boolean,
 *   disabled?: boolean,
 * }
 */
export default function ActionGridPopover({
  visible,
  fromRect,
  onRequestClose,
  onCloseComplete,
  actions = [],
  theme,
  placement = "top",
  backdrop = "rgba(0,0,0,0.25)",
  borderRadius = 14,
}) {
  const cardBg = theme?.card ?? "#fff";

  return (
    <Popover
      isVisible={!!visible && !!fromRect}
      from={fromRect}
      placement={placement}
      popoverStyle={{ backgroundColor: cardBg, borderRadius }}
      backgroundStyle={{ backgroundColor: backdrop }}
      onRequestClose={onRequestClose}
      onCloseComplete={onCloseComplete}
    >
      <View style={[styles.menu, { backgroundColor: cardBg, borderRadius }]}>
        <View style={styles.grid}>
          {actions.map((a) => (
            <ActionTile
              key={a.key}
              icon={a.icon}
              label={a.label}
              danger={!!a.danger}
              disabled={!!a.disabled}
              onPress={a.onPress}
              tint={theme?.textPrimary ?? "#333"}
              dangerTint={theme?.danger ?? "#ff4d4f"}
            />
          ))}
        </View>
      </View>
    </Popover>
  );
}

const styles = StyleSheet.create({
  menu: {
    padding: 12,
    minHeight: 76,
  },
  grid: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
});
