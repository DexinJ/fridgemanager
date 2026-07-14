import { Ionicons } from "@expo/vector-icons";
import React, { useContext } from "react";
import { StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlobalContext } from "../context/GlobalContext";

export function PlainHeader({ title }) {
  const { theme } = useContext(GlobalContext);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  return (
    <View
      style={[
        styles.plain_header,
        { paddingTop: insets.top, backgroundColor: theme.card, borderBottomColor: theme.border },
      ]}
    >
      <Text style={[styles.headerText, { fontSize: width * 0.05, color: theme.textPrimary }]}>
        {title}
      </Text>
    </View>
  );
}

/**
 * ✅ Minimal, backward-compatible upgrade:
 * - Existing screens can keep using: <HeaderWithButton title buttonLabel onPress />
 * - New optional props enable: [Left Button]  Title  [Right Button]
 *
 * New props (optional):
 * - leftButtonLabel?: string
 * - onLeftPress?: () => void
 * - showLeftButton?: boolean
 */
export function HeaderWithButton({
  title,
  buttonLabel,
  onPress,
  leftButtonLabel,
  onLeftPress,
  showLeftButton = false,
}) {
  const { theme } = useContext(GlobalContext);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  // ✅ keep title size as-is, but cap button sizes so "Select All" doesn't get huge
  const buttonFont = Math.min(17, Math.max(14, width * 0.042)); // iOS-ish 14–17

  return (
    <View
      style={[
        styles.header,
        { paddingTop: insets.top, backgroundColor: theme.card, borderBottomColor: theme.border },
      ]}
    >
      {/* LEFT: optional Select All / Clear */}
      {showLeftButton ? (
        <TouchableOpacity
          onPress={onLeftPress}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.leftBtnWrap} // ✅ limits visual width only (does NOT change layout positions)
        >
          <Text
            style={[styles.editButton, { fontSize: buttonFont, color: theme.accent }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {leftButtonLabel}
          </Text>
        </TouchableOpacity>
      ) : (
        // Spacer to keep the centered title truly centered when left button is hidden
        <View style={{ width: 90 }} />
      )}

      {/* CENTER: title (unchanged) */}
      <Text
        style={[
          styles.headerText,
          {
            fontSize: width * 0.05,
            color: theme.textPrimary,
            position: "absolute",
            left: 0,
            right: 0,
            top: insets.top,
            textAlign: "center",
          },
        ]}
        pointerEvents="none"
        numberOfLines={1}
      >
        {title}
      </Text>

      {/* RIGHT: existing button (Edit / Done) */}
      <TouchableOpacity
        onPress={onPress}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={styles.rightBtnWrap} // ✅ optional: also cap right side so it doesn't balloon
      >
        <View>
          <Text style={[styles.editButton, { fontSize: buttonFont, color: theme.accent }]}>
            {buttonLabel}
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

export function HeaderWithHiddenButton({ title, onPress, hideButton = true }) {
  const { theme } = useContext(GlobalContext);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  return (
    <>
      {!hideButton && (
        <View
          style={[
            styles.hide_header,
            { paddingTop: insets.top, backgroundColor: theme.card, borderBottomColor: theme.border },
          ]}
        >
          <TouchableOpacity onPress={onPress}>
            <Ionicons name="arrow-back" size={24} color={theme.accent} />
          </TouchableOpacity>
          <Text
            style={[
              styles.headerText,
              {
                fontSize: width * 0.05,
                color: theme.textPrimary,
                position: "absolute",
                left: 0,
                right: 0,
                top: insets.top,
                textAlign: "center",
              },
            ]}
            pointerEvents="none"
            numberOfLines={1}
          >
            {title}
          </Text>
        </View>
      )}
      {hideButton && (
        <View
          style={[
            styles.plain_header,
            { paddingTop: insets.top, backgroundColor: theme.card, borderBottomColor: theme.border },
          ]}
        >
          <Text style={[styles.headerText, { fontSize: width * 0.05, color: theme.textPrimary }]}>
            {title}
          </Text>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between", // ✅ unchanged
  },
  plain_header: {
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "center",
  },
  hide_header: {
    paddingVertical: 15,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  headerText: {
    fontWeight: "600",
  },
  editButton: {
    fontWeight: "600",
    alignSelf: "flex-end", // ✅ you asked to keep this
  },

  // ✅ visual constraints only (doesn't affect the absolute-centered title)
  leftBtnWrap: {
    maxWidth: 90, // keep Select All/Clear from looking huge
  },
  rightBtnWrap: {
    maxWidth: 70, // optional: keeps "Done" / "Edit" tidy
    alignItems: "flex-end",
  },
});
