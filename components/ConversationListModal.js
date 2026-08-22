import { Ionicons } from "@expo/vector-icons";
import { useContext, useMemo } from "react";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlobalContext } from "../context/GlobalContext";

function formatRelativeTime(iso) {
  if (!iso) return "";
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return "";

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString();
}

export default function ConversationListModal({
  visible,
  onClose,
  conversations = [],
  activeConversationId = null,
  onSelect,
  onNewChat,
}) {
  const { theme } = useContext(GlobalContext);
  const insets = useSafeAreaInsets();
  const items = useMemo(
    () => (Array.isArray(conversations) ? conversations : []),
    [conversations]
  );

  const renderRow = ({ item }) => {
    const isActive = item.id === activeConversationId;
    return (
      <TouchableOpacity
        onPress={() => onSelect?.(item.id)}
        accessibilityRole="button"
        accessibilityLabel={`Open conversation ${item.title || "Chat"}`}
        accessibilityState={{ selected: isActive }}
        style={[
          styles.row,
          isActive && { backgroundColor: theme.inputBackground },
        ]}
      >
        <View style={styles.rowBody}>
          <Text
            style={[
              styles.rowTitle,
              { color: isActive ? theme.accent : theme.textPrimary },
            ]}
            numberOfLines={1}
          >
            {item.title || "Chat"}
          </Text>
          <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
            {formatRelativeTime(item.updatedAt || item.createdAt)}
          </Text>
        </View>
        {isActive ? (
          <Ionicons name="checkmark-circle" size={20} color={theme.accent} />
        ) : null}
      </TouchableOpacity>
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <Pressable
          style={styles.backdrop}
          onPress={onClose}
          accessibilityLabel="Close conversations"
        />
        <View
          style={[
            styles.drawer,
            {
              backgroundColor: theme.card,
              paddingTop: insets.top + 8,
              paddingBottom: insets.bottom + 12,
            },
          ]}
        >
          <View style={styles.drawerHeader}>
            <Text style={[styles.drawerTitle, { color: theme.textPrimary }]}>
              Chats
            </Text>
            <TouchableOpacity
              onPress={onNewChat}
              accessibilityRole="button"
              accessibilityLabel="New chat"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="add" size={26} color={theme.accent} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={onNewChat}
            accessibilityRole="button"
            accessibilityLabel="Start a new chat"
            style={[
              styles.newChatRow,
              { backgroundColor: theme.inputBackground },
            ]}
          >
            <Ionicons name="create-outline" size={20} color={theme.accent} />
            <Text style={[styles.newChatText, { color: theme.accent }]}>
              New chat
            </Text>
          </TouchableOpacity>

          {items.length === 0 ? (
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>
              No conversations yet.
            </Text>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderRow}
              style={styles.list}
              contentContainerStyle={styles.listContent}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: "row",
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
  },
  drawer: {
    width: "82%",
    maxWidth: 380,
    height: "100%",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 2, height: 0 },
    elevation: 12,
  },
  drawerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  drawerTitle: {
    fontSize: 22,
    fontWeight: "700",
  },
  newChatRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 10,
  },
  newChatText: {
    fontSize: 15,
    fontWeight: "600",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 10,
    marginHorizontal: 10,
    marginVertical: 2,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: "600",
  },
  rowMeta: {
    fontSize: 12,
  },
  emptyText: {
    textAlign: "center",
    marginTop: 28,
    fontSize: 14,
  },
  list: {
    flex: 1,
    marginTop: 6,
  },
  listContent: {
    paddingBottom: 12,
  },
});
