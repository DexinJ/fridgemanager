import { Ionicons } from "@expo/vector-icons";
import React, { useMemo, useRef } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

/**
 * Reusable list item card for inventory-like items.
 * Works for fridge, pantry, shopping (with props controlling behavior).
 *
 * Expected item fields (flexible):
 * - id, name, quantity
 * - _expired, _almostExpired, _expiresAtMs, _daysUntilExpire
 * - _storageLabel, _stateLabel, _foodTypeLabel
 *
 * You can also pass your own computed strings:
 * - subtitleText
 * - metaText
 * - rightTopText
 */
export default function InventoryListItem({
  item,
  theme,
  fontSize = 16,

  // selection/edit mode
  editMode = false,
  selected = false,
  onToggleSelect,
  onPress,

  // long press / measurement
  onMeasuredLongPress, // receives (rect, item)
  longPressDelayMs = 200,

  // optional overrides
  subtitleText,
  metaText,
  rightTopText,
  rightBottomText,
}) {
  const rowRef = useRef(null);

  const isExpired = !!item?._expired;
  const isAlmost = !!item?._almostExpired;

  const computedMeta = useMemo(() => {
    const t = [item?._stateLabel, item?._storageLabel].filter(Boolean).join(" • ");
    return t;
  }, [item?._stateLabel, item?._storageLabel]);

  const computedRightTop = useMemo(() => item?._foodTypeLabel || "", [item?._foodTypeLabel]);

  const computedRightBottom = useMemo(() => String(item?.quantity ?? ""), [item?.quantity]);

  const formatLocalDate = (ms) => {
    if (!Number.isFinite(ms)) return null;
    const d = new Date(ms);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  const computedSubtitle = useMemo(() => {
    if (subtitleText) return subtitleText;

    if (isExpired) {
      const when = formatLocalDate(item?._expiresAtMs);
      return when ? `Expired on ${when}` : "Expired";
    }
    if (isAlmost) {
      const when = formatLocalDate(item?._expiresAtMs);
      const d = item?._daysUntilExpire;
      if (d === 0) return `Expires today${when ? ` (${when})` : ""}`;
      if (d === 1) return `Expires tomorrow${when ? ` (${when})` : ""}`;
      if (typeof d === "number") return when ? `Expires in ${d} days (${when})` : `Expires in ${d} days`;
      return when ? `Expires soon (${when})` : "Expires soon";
    }

    // fallback: show "Added today" style using createdAt if available
    const createdAtIso = item?.createdAt;
    const t = createdAtIso ? new Date(createdAtIso).getTime() : 0;
    if (!t) return "Added";
    const created = new Date(t);
    const now = new Date();

    const createdDate = new Date(created.getFullYear(), created.getMonth(), created.getDate());
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const diffMs = todayDate - createdDate;
    const days = Math.max(0, Math.round(diffMs / 86400000));

    if (days === 0) return "Added today";
    if (days === 1) return "In inventory for 1 day";
    return `In inventory for ${days} days`;
  }, [subtitleText, isExpired, isAlmost, item?._expiresAtMs, item?._daysUntilExpire, item?.createdAt]);

  const bg = isExpired ? theme?.dangerBackground : isAlmost ? theme?.warningBackground : theme?.card;
  const border = isExpired ? theme?.danger : isAlmost ? theme?.warning : theme?.border;

  const statusColor = isExpired
    ? theme?.danger
    : isAlmost
    ? theme?.warning
    : theme?.textPrimary;

  const handleLongPress = () => {
    if (editMode) return;
    const node = rowRef.current;
    if (!node || typeof node.measureInWindow !== "function") return;

    node.measureInWindow((x, y, width, height) => {
      onMeasuredLongPress?.({ x, y, width, height }, item);
    });
  };

  const handlePress = () => {
    if (editMode) {
      onToggleSelect?.(item?.id);
      return;
    }
    onPress?.(item);
  };

  return (
    <View collapsable={false} ref={rowRef}>
      <TouchableOpacity
        activeOpacity={0.86}
        delayLongPress={longPressDelayMs}
        onLongPress={handleLongPress}
        onPress={handlePress}
        style={[styles.card, { backgroundColor: bg, borderColor: border }]}
      >
        {editMode && (
          <TouchableOpacity
            onPress={() => onToggleSelect?.(item?.id)}
            activeOpacity={0.8}
            style={styles.checkboxHit}
          >
            <Ionicons
              name={selected ? "checkbox" : "square-outline"}
              size={fontSize * 1.25}
              color={selected ? theme?.textPrimary : theme?.textSecondary}
            />
          </TouchableOpacity>
        )}

        <View style={styles.left}>
          <Text
            style={[styles.title, { fontSize: fontSize * 1.06, color: theme?.textPrimary }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {item?.name}
          </Text>

          <Text
            style={[styles.subtitle, { fontSize: fontSize * 0.92, color: statusColor }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {computedSubtitle}
          </Text>

          {!!(metaText ?? computedMeta) && (
            <Text
              style={[styles.meta, { fontSize: fontSize * 0.82, color: theme?.textSecondary }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {metaText ?? computedMeta}
            </Text>
          )}
        </View>

        <View style={styles.right}>
          <Text
            style={[styles.rightTop, { fontSize: fontSize * 0.82, color: theme?.textSecondary }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {rightTopText ?? computedRightTop}
          </Text>

          <View style={styles.rightBottomWrap}>
            <Text
              style={[styles.rightBottom, { fontSize: fontSize * 0.98, color: theme?.textPrimary }]}
              numberOfLines={1}
            >
              {rightBottomText ?? computedRightBottom}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  checkboxHit: {
    paddingRight: 12,
    paddingVertical: 6,
    alignSelf: "center",
  },
  card: {
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "stretch",
  },
  left: { flex: 1, minWidth: 0 },
  title: { fontWeight: "800", letterSpacing: 0.2 },
  subtitle: { marginTop: 8, fontWeight: "800" },
  meta: { marginTop: 6, fontWeight: "600" },
  right: {
    marginLeft: 12,
    alignItems: "flex-end",
    justifyContent: "space-between",
    minWidth: 90,
    paddingVertical: 2,
  },
  rightTop: { fontWeight: "700" },
  rightBottomWrap: {
    alignItems: "flex-end",
    justifyContent: "flex-end",
    gap: 8,
  },
  rightBottom: { fontWeight: "900" },
});
