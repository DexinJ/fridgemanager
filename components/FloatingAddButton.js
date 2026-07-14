import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, TouchableOpacity } from "react-native";

/**
 * Reusable floating action button (FAB).
 */
export default function FloatingAddButton({
  onPress,
  disabled = false,
  theme,
  icon = "add",
  size = 28,
  style,
  testID,
}) {
  return (
    <TouchableOpacity
      testID={testID}
      style={[
        styles.fab,
        style,
        {
          backgroundColor: theme?.actionButton ?? "#4CAF50",
          opacity: disabled ? 0.35 : 1,
        },
      ]}
      onPress={disabled ? undefined : onPress}
      activeOpacity={0.85}
    >
      <Ionicons name={icon} size={size} color="#fff" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    bottom: 30,
    right: 20,
    borderRadius: 30,
    padding: 15,
    elevation: 4,
  },
});
