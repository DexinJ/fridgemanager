import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";

/**
 * A reusable icon+label tile button.
 * Works for popovers, bottom action bars, dashboards, etc.
 */
export default function ActionTile({
  icon,
  label,
  onPress,
  disabled = false,
  danger = false,
  tint = "#444",
  dangerTint = "#ff4d4f",
  size = 22,
  style,
  labelStyle,
  testID,
}) {
  const color = danger ? dangerTint : tint;

  return (
    <TouchableOpacity
      testID={testID}
      style={[styles.tile, style, disabled && { opacity: 0.35 }]}
      activeOpacity={0.8}
      onPress={disabled ? undefined : onPress}
    >
      <Ionicons name={icon} size={size} color={color} />
      <Text style={[styles.label, { color }, labelStyle]} numberOfLines={2}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: {
    width: "23%",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.12)",
  },
  label: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
});
