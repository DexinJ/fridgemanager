import React, { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  View,
  Text,
  TouchableOpacity,
  Modal,
  ScrollView,
  Pressable,
  StyleSheet,
  Platform,
  TextInput,
  Animated,
  Easing,
} from "react-native";
import MessageBubble from "./MessageBubble";
import { GlobalContext } from "../context/GlobalContext";
import DropDownPicker from "react-native-dropdown-picker";

/**
 * Renders a UI action card inside the chat list.
 */
function ActionCard({ action, onPress }) {
  if (!action) return null;

  if (action.kind === "add_all_to_fridge") {
    const items = Array.isArray(action.items) ? action.items : [];
    const title = action.title || "Add all to fridge";

    return (
      <View
        style={{
          padding: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "#ccc",
          marginVertical: 6,
        }}
      >
        <Text style={{ fontWeight: "600", marginBottom: 6 }}>
          I found {items.length} item(s):
        </Text>

        {items.slice(0, 6).map((it, idx) => (
          <Text key={idx} style={{ marginBottom: 2 }}>
            • {it?.name}
            {it?.quantity ? ` — ${it.quantity}` : ""}
          </Text>
        ))}
        {items.length > 6 ? (
          <Text style={{ marginTop: 4, opacity: 0.7 }}>
            +{items.length - 6} more…
          </Text>
        ) : null}

        <TouchableOpacity
          onPress={onPress}
          style={{
            marginTop: 10,
            paddingVertical: 10,
            borderRadius: 10,
            alignItems: "center",
            borderWidth: 1,
            borderColor: "#333",
          }}
        >
          <Text style={{ fontWeight: "700" }}>{title}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return null;
}

function ItemsConfirmModal({ visible, action, onClose, onConfirm }) {
  const { theme } = useContext(GlobalContext);

  const rawItems = Array.isArray(action?.items) ? action.items : [];
  const title = action?.title || "Confirm items";

  const [draftItems, setDraftItems] = useState([]);
  const [expandedIdx, setExpandedIdx] = useState(null);

  const [openKey, setOpenKey] = useState(null);
  const isOpen = (key) => openKey === key;
  const setOpenFor = (key, nextOpen) => setOpenKey(nextOpen ? key : null);

  const [sheetH, setSheetH] = useState(0);
  const translateY = useRef(new Animated.Value(9999)).current;
  const offscreenY = sheetH ? sheetH + 40 : 9999;

  // ✅ auto-scroll helpers
  const scrollRef = useRef(null);
  const scrollContentRef = useRef(null); // <— NEW: container inside ScrollView
  const [scrollY, setScrollY] = useState(0);
  const [viewportH, setViewportH] = useState(0);

  // ✅ measure sticky footer so we scroll enough to reveal State picker too
  const [footerH, setFooterH] = useState(0);

  // ✅ NEW: "anchor at end of editor" refs
  const editorEndRefs = useRef({}); // idx -> ref

  const ensureEditorVisible = (idx) => {
    const anchor = editorEndRefs.current[idx];
    if (!anchor || !scrollContentRef.current || viewportH <= 0) return;

    const padding = 16; // small breathing room
    const visibleH = Math.max(0, viewportH - footerH - padding);
    if (visibleH <= 0) return;

    // measure anchor relative to scroll content, so y is in scroll coordinates
    anchor.measureLayout(
      scrollContentRef.current,
      (_x, y, _w, h) => {
        const anchorBottom = y + h + padding;
        const visibleBottom = scrollY + visibleH;

        if (anchorBottom > visibleBottom) {
          const targetY = Math.max(0, anchorBottom - visibleH);
          scrollRef.current?.scrollTo({ y: targetY, animated: true });
        }
      },
      () => {}
    );
  };

  const DEFAULT_CATEGORIES = useMemo(
    () => ({
      storage: "Fridge",
      urgency: "Use soon",
      food_type: "Prepared",
    }),
    []
  );

  const coerceCategories = (cats) => {
    if (!cats || typeof cats !== "object" || Array.isArray(cats))
      return DEFAULT_CATEGORIES;

    const storage =
      String(cats.storage || "").trim() || DEFAULT_CATEGORIES.storage;
    const urgency =
      String(cats.urgency || "").trim() || DEFAULT_CATEGORIES.urgency;
    const food_type =
      String(cats.food_type || "").trim() || DEFAULT_CATEGORIES.food_type;
    const state = String(cats.state || "").trim();

    return state
      ? { storage, urgency, food_type, state }
      : { storage, urgency, food_type };
  };

  const STORAGE_ITEMS = useMemo(
    () => [
      { label: "Fridge", value: "Fridge" },
      { label: "Freezer", value: "Freezer" },
      { label: "Pantry", value: "Pantry" },
    ],
    []
  );
  const URGENCY_ITEMS = useMemo(
    () => [
      { label: "Eat first", value: "Eat first" },
      { label: "Use soon", value: "Use soon" },
      { label: "Lasts a while", value: "Lasts a while" },
      { label: "Long keeper", value: "Long keeper" },
    ],
    []
  );
  const FOODTYPE_ITEMS = useMemo(
    () => [
      { label: "Produce", value: "Produce" },
      { label: "Dairy", value: "Dairy" },
      { label: "Meat", value: "Meat" },
      { label: "Seafood", value: "Seafood" },
      { label: "Prepared", value: "Prepared" },
      { label: "Condiments", value: "Condiments" },
      { label: "Beverages", value: "Beverages" },
      { label: "Snacks", value: "Snacks" },
      { label: "Bakery", value: "Bakery" },
      { label: "Frozen", value: "Frozen" },
    ],
    []
  );
  const STATE_ITEMS = useMemo(
    () => [
      { label: "None", value: "" },
      { label: "Opened", value: "Opened" },
      { label: "Unopened", value: "Unopened" },
      { label: "Raw", value: "Raw" },
      { label: "Cooked", value: "Cooked" },
      { label: "Cut", value: "Cut" },
      { label: "Whole", value: "Whole" },
    ],
    []
  );

  const CHIP_COLORS = {
    storage: "#64B5F6",
    urgency: "#EF5350",
    food_type: "#66BB6A",
    state: "#FFB74D",
    default: "#9E9E9E",
  };

  useEffect(() => {
    if (visible && sheetH) {
      translateY.setValue(offscreenY);
      Animated.timing(translateY, {
        toValue: 0,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [visible, sheetH, offscreenY, translateY]);

  useEffect(() => {
    if (!visible) return;

    const seeded = rawItems.map((it) => ({
      ...it,
      selected: true,
      quantity: it?.quantity === 0 || it?.quantity ? String(it.quantity) : "1",
      categories: coerceCategories(it?.categories),
    }));

    setDraftItems(seeded);
    setExpandedIdx(null);
    setOpenKey(null);

    editorEndRefs.current = {}; // ✅ reset anchors
    setScrollY(0);
    setFooterH(0);
  }, [visible, action]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSelected = (idx) => {
    setDraftItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, selected: !it.selected } : it))
    );
  };

  const updateQty = (idx, text) => {
    const cleaned = String(text).replace(/[^0-9.]/g, "");
    setDraftItems((prev) =>
      prev.map((it, i) => (i === idx ? { ...it, quantity: cleaned } : it))
    );
  };

  const updateCategory = (idx, key, value) => {
    setDraftItems((prev) =>
      prev.map((it, i) => {
        if (i !== idx) return it;
        const next = { ...(it.categories || DEFAULT_CATEGORIES), [key]: value };
        if (key === "state" && !String(value || "").trim()) {
          const { state, ...rest } = next;
          return { ...it, categories: rest };
        }
        return { ...it, categories: next };
      })
    );
  };

  const [closing, setClosing] = useState(false);

  const handleConfirm = () => {
    if (closing) return;

    const selectedItems = draftItems
      .filter((it) => it.selected)
      .map((it) => {
        const q = parseFloat(String(it.quantity));
        const categories = coerceCategories(it.categories);
        return {
          ...it,
          quantity: Number.isFinite(q) && q > 0 ? q : 1,
          categories,
        };
      });

    const updatedAction = { ...action, items: selectedItems };

    setClosing(true);
    Animated.timing(translateY, {
      toValue: offscreenY,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      setClosing(false);
      onConfirm?.(updatedAction);
    });
  };

  const handleClose = () => {
    setOpenKey(null);
    setExpandedIdx(null);
    Animated.timing(translateY, {
      toValue: offscreenY,
      duration: 220,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => onClose?.());
  };

  const selectedCount = draftItems.filter((it) => it.selected).length;

  const Chip = ({ label, color }) => (
    <View style={[styles.chip, { backgroundColor: color }]}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
  );

  const SheetBg = theme?.card ?? "#fff";
  const Border = theme?.border ?? "#eee";
  const TextPrimary = theme?.textPrimary ?? "#111";
  const TextSecondary = theme?.textSecondary ?? "#666";
  const InputBg = theme?.inputBackground ?? "#fff";
  const InputText = theme?.inputText ?? "#111";

  return (
    <Modal
      visible={visible}
      animationType="none"
      transparent
      presentationStyle="overFullScreen"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <View style={styles.modalRoot}>
        <Pressable style={styles.backdrop} onPress={handleClose} />

        <Animated.View
          onLayout={(e) => setSheetH(e.nativeEvent.layout.height)}
          style={[
            styles.sheet,
            { backgroundColor: SheetBg, borderTopColor: Border },
            { transform: [{ translateY }] },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: Border }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: TextPrimary }]}>{title}</Text>
              <Text style={{ marginTop: 2, opacity: 0.7, color: TextSecondary }}>
                {selectedCount} selected
              </Text>
            </View>

            <TouchableOpacity onPress={handleClose} style={{ padding: 8 }}>
              <Text style={{ fontWeight: "700", color: TextPrimary }}>Close</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.scrollContent}
            onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}
            onScroll={(e) => setScrollY(e.nativeEvent.contentOffset.y)}
            scrollEventThrottle={16}
          >
            {/* ✅ NEW: measurable content container */}
            <View ref={scrollContentRef}>
              {draftItems.map((it, idx) => {
                const cats = coerceCategories(it.categories);
                const showEditor = expandedIdx === idx;

                return (
                  <View
                    key={`${it?.name ?? "item"}-${idx}`}
                    style={styles.itemBlock}
                  >
                    <View style={styles.itemRow}>
                      <TouchableOpacity
                        onPress={() => toggleSelected(idx)}
                        style={[styles.checkbox, it.selected && styles.checkboxChecked]}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: !!it.selected }}
                      >
                        {it.selected ? <Text style={styles.checkmark}>✓</Text> : null}
                      </TouchableOpacity>

                      <View style={{ flex: 1 }}>
                        <Text style={{ fontWeight: "700", color: TextPrimary }}>
                          {it?.name ?? "(unnamed)"}
                        </Text>

                        <View style={styles.chipRow}>
                          <Chip label={cats.storage} color={CHIP_COLORS.storage} />
                          <Chip label={cats.urgency} color={CHIP_COLORS.urgency} />
                          <Chip label={cats.food_type} color={CHIP_COLORS.food_type} />
                          {cats.state ? <Chip label={cats.state} color={CHIP_COLORS.state} /> : null}
                        </View>

                        <TouchableOpacity
                          onPress={() => {
                            setOpenKey(null);
                            setExpandedIdx((prev) => {
                              const next = prev === idx ? null : idx;

                              if (next === idx) {
                                // ✅ after render/layout, scroll using anchor
                                requestAnimationFrame(() => {
                                  requestAnimationFrame(() => ensureEditorVisible(idx));
                                });
                              }

                              return next;
                            });
                          }}
                          style={{ paddingVertical: 6, alignSelf: "flex-start" }}
                          disabled={!it.selected}
                        >
                          <Text
                            style={{
                              fontWeight: "800",
                              opacity: it.selected ? 1 : 0.4,
                              color: TextPrimary,
                            }}
                          >
                            {showEditor ? "Hide tags" : "Edit tags"}
                          </Text>
                        </TouchableOpacity>
                      </View>

                      <View style={styles.qtyRow}>
                        <Text style={{ opacity: 0.75, marginRight: 8, color: TextSecondary }}>
                          Qty
                        </Text>
                        <TextInput
                          value={String(it?.quantity ?? "1")}
                          onChangeText={(t) => updateQty(idx, t)}
                          keyboardType={Platform.OS === "ios" ? "decimal-pad" : "numeric"}
                          placeholder="1"
                          editable={it.selected}
                          style={[
                            styles.qtyInput,
                            { borderColor: Border, color: InputText, backgroundColor: InputBg },
                            !it.selected && { opacity: 0.4 },
                          ]}
                        />
                      </View>
                    </View>

                    {showEditor ? (
                      <View style={[styles.editor, { borderColor: Border }]}>
                        <Text style={[styles.editorLabel, { color: TextSecondary }]}>
                          Storage (required)
                        </Text>
                        <DropDownPicker
                          listMode="MODAL"
                          modalTitle="Select storage"
                          open={isOpen(`${idx}-storage`)}
                          value={cats.storage}
                          items={STORAGE_ITEMS}
                          setOpen={(v) => setOpenFor(`${idx}-storage`, v)}
                          onChangeValue={(v) => updateCategory(idx, "storage", v)}
                          searchable
                          searchPlaceholder="Search storage..."
                          style={[styles.dd, { backgroundColor: InputBg, borderColor: Border }]}
                          textStyle={{ color: InputText }}
                        />

                        <Text style={[styles.editorLabel, { color: TextSecondary }]}>
                          Urgency (required)
                        </Text>
                        <DropDownPicker
                          listMode="MODAL"
                          modalTitle="Select urgency"
                          open={isOpen(`${idx}-urgency`)}
                          value={cats.urgency}
                          items={URGENCY_ITEMS}
                          setOpen={(v) => setOpenFor(`${idx}-urgency`, v)}
                          onChangeValue={(v) => updateCategory(idx, "urgency", v)}
                          searchable
                          searchPlaceholder="Search urgency..."
                          style={[styles.dd, { backgroundColor: InputBg, borderColor: Border }]}
                          textStyle={{ color: InputText }}
                        />

                        <Text style={[styles.editorLabel, { color: TextSecondary }]}>
                          Food type (required)
                        </Text>
                        <DropDownPicker
                          listMode="MODAL"
                          modalTitle="Select food type"
                          open={isOpen(`${idx}-food_type`)}
                          value={cats.food_type}
                          items={FOODTYPE_ITEMS}
                          setOpen={(v) => setOpenFor(`${idx}-food_type`, v)}
                          onChangeValue={(v) => updateCategory(idx, "food_type", v)}
                          searchable
                          searchPlaceholder="Search food types..."
                          style={[styles.dd, { backgroundColor: InputBg, borderColor: Border }]}
                          textStyle={{ color: InputText }}
                        />

                        <Text style={[styles.editorLabel, { color: TextSecondary }]}>
                          State (optional)
                        </Text>
                        <DropDownPicker
                          listMode="MODAL"
                          modalTitle="Select state"
                          open={isOpen(`${idx}-state`)}
                          value={cats.state ?? ""}
                          items={STATE_ITEMS}
                          setOpen={(v) => setOpenFor(`${idx}-state`, v)}
                          onChangeValue={(v) => updateCategory(idx, "state", v)}
                          searchable
                          searchPlaceholder="Search state..."
                          style={[styles.dd, { backgroundColor: InputBg, borderColor: Border }]}
                          textStyle={{ color: InputText }}
                        />

                        {/* ✅ NEW: anchor at the very end of the editor */}
                        <View
                          ref={(r) => {
                            if (r) editorEndRefs.current[idx] = r;
                          }}
                          onLayout={() => {
                            // when the editor finishes laying out, ensure anchor is visible
                            requestAnimationFrame(() => ensureEditorVisible(idx));
                          }}
                          style={{ height: 1 }}
                        />
                      </View>
                    ) : null}
                  </View>
                );
              })}
            </View>
          </ScrollView>

          <View
            style={[styles.footer, { borderTopColor: Border, backgroundColor: SheetBg }]}
            onLayout={(e) => setFooterH(e.nativeEvent.layout.height)}
          >
            <TouchableOpacity
              onPress={handleConfirm}
              style={[
                styles.confirmBtn,
                { borderColor: TextPrimary },
                selectedCount === 0 && { opacity: 0.5 },
              ]}
              disabled={selectedCount === 0}
            >
              <Text style={{ fontWeight: "900", color: TextPrimary }}>
                Confirm ({selectedCount})
              </Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

function TypingIndicator({ theme }) {
  const d1 = useRef(new Animated.Value(0.2)).current;
  const d2 = useRef(new Animated.Value(0.2)).current;
  const d3 = useRef(new Animated.Value(0.2)).current;

  useEffect(() => {
    const mk = (v, delay) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(v, { toValue: 1, duration: 250, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.2, duration: 250, useNativeDriver: true }),
          Animated.delay(250),
        ])
      );

    const a1 = mk(d1, 0);
    const a2 = mk(d2, 120);
    const a3 = mk(d3, 240);

    a1.start(); a2.start(); a3.start();
    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, [d1, d2, d3]);

  return (
    <View
      style={{
        alignSelf: "flex-start",
        marginVertical: 6,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 16,
        maxWidth: "75%",
        backgroundColor: theme?.card ?? "#eee",
        borderWidth: 1,
        borderColor: theme?.border ?? "#ddd",
      }}
    >
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Animated.View
          style={{
            width: 6, height: 6, borderRadius: 3,
            backgroundColor: theme?.text ?? "#333",
            opacity: d1,
            transform: [{ translateY: d1.interpolate({ inputRange: [0.2, 1], outputRange: [2, -2] }) }],
          }}
        />
        <Animated.View
          style={{
            width: 6, height: 6, borderRadius: 3,
            backgroundColor: theme?.text ?? "#333",
            opacity: d2,
            transform: [{ translateY: d2.interpolate({ inputRange: [0.2, 1], outputRange: [2, -2] }) }],
          }}
        />
        <Animated.View
          style={{
            width: 6, height: 6, borderRadius: 3,
            backgroundColor: theme?.text ?? "#333",
            opacity: d3,
            transform: [{ translateY: d3.interpolate({ inputRange: [0.2, 1], outputRange: [2, -2] }) }],
          }}
        />
      </View>
    </View>
  );
}

export default function MessageList({ messages, onUiAction }) {
  const listRef = useRef(null);
  const { theme, waiting } = useContext(GlobalContext);
  const [modalVisible, setModalVisible] = useState(false);
  const [pendingAction, setPendingAction] = useState(null);

  const openActionModal = (action) => {
    setPendingAction(action);
    setModalVisible(true);
  };

  const closeActionModal = () => {
    setModalVisible(false);
    setPendingAction(null);
  };

  const confirmActionModal = (updatedAction) => {
    if (updatedAction) onUiAction?.(updatedAction);
    closeActionModal();
  };

  const data = useMemo(() => {
    const base = (messages || [])
      .filter((msg) => !msg?.text?.startsWith("[fromTool]"))
      .map((msg) => {
        if (msg?.type === "ui_action" && msg?.action) {
          return { kind: "ui_action", action: msg.action };
        }

        const text = msg?.content?.[0]?.text ?? msg?.text ?? null;

        const imageUri =
          msg?.imageUri ||
          msg?.content?.[0]?.image_url ||
          msg?.content?.[0]?.imageUri ||
          null;

        const isUser = msg?.role === "user";

        if (!text && !imageUri) return null;

        return { kind: "bubble", text, imageUri, isUser };
      })
      .filter(Boolean);

    if (waiting) base.push({ kind: "typing" });

    return base;
  }, [messages, waiting]);

  return (
    <>
      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(_, index) => index.toString()}
        renderItem={({ item }) => {
          if (item.kind === "ui_action") {
            return <ActionCard action={item.action} onPress={() => openActionModal(item.action)} />;
          }
          if (item.kind === "typing") return <TypingIndicator theme={theme} />;
          return <MessageBubble text={item.text} imageUri={item.imageUri} isUser={item.isUser} />;
        }}
        contentContainerStyle={{ padding: 10, paddingBottom: 20 }}
        onContentSizeChange={() => {
          setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 150);
        }}
      />

      <ItemsConfirmModal
        visible={modalVisible}
        action={pendingAction}
        onClose={closeActionModal}
        onConfirm={confirmActionModal}
      />
    </>
  );
}

const styles = StyleSheet.create({
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },

  sheet: {
    height: "85%",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: "hidden",
    borderTopWidth: 1,
    paddingBottom: Platform.OS === "ios" ? 0 : 0,
  },
  header: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: { fontSize: 16, fontWeight: "800" },

  scrollContent: { padding: 14, paddingBottom: 90 },

  itemBlock: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#333",
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: { backgroundColor: "#333" },
  checkmark: { color: "#fff", fontWeight: "900", lineHeight: 18 },

  qtyRow: { flexDirection: "row", alignItems: "center" },
  qtyInput: {
    minWidth: 70,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 10,
    textAlign: "center",
    fontWeight: "700",
  },

  chipRow: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginRight: 6,
    marginTop: 6,
  },
  chipText: { color: "#fff", fontWeight: "800", fontSize: 12 },

  editor: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  editorLabel: {
    marginTop: 6,
    marginBottom: 6,
    fontWeight: "700",
    opacity: 0.9,
  },
  dd: {
    borderWidth: 1,
    borderRadius: 10,
    minHeight: 44,
    marginBottom: 10,
  },

  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 14,
    borderTopWidth: 1,
  },
  confirmBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    borderWidth: 1,
  },
});
