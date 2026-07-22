// ShoppingListScreen.js (updated) — adds SearchAndSortBar like FridgeScreen
// NOTE: This keeps your existing category tabs + SectionList logic.
// It only adds search UI + filtering + sort-sheet modal (optional but matches your pattern).

import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "expo-router";
import React, { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { HeaderWithButton } from "../../components/Header";
import { GlobalContext } from "../../context/GlobalContext";

// ✅ pills UI
import FilterTabsRow from "../../components/FilterTabsRow";

// ✅ NEW: search/sort UI (same component as your FridgeScreen)
import SearchAndSortBar from "../../components/SearchAndSortBar";

// ✅ OPTIONAL: if you want the same sort sheet UX
import SortSheetModal from "../../components/SortSheetModal";

// ---- sort options (keep minimal; you can add more later) ----
const SORT_ITEMS = [
  { label: "Added", value: "added" },
  { label: "Name", value: "name" },
  { label: "Category", value: "category" },
];

const norm = (s) => String(s || "").trim().toLowerCase();

export default function ShoppingListScreen() {
  const {
    shoppingListItems,
    addToShoppingList,
    removeFromShoppingList,
    addToFridge,
    editShoppingListItem,
    settings,
    theme,
    tags,

    // ✅ from GlobalContext
    inferFoodTypeLabelFromName,
    streamlineLists,
  } = useContext(GlobalContext);

  const fontSize = settings?.ux?.fontSize || 16;

  const [newItemName, setNewItemName] = useState("");
  const [newItemQuantity, setNewItemQuantity] = useState("");
  const [checkedItems, setCheckedItems] = useState({});
  const [editMode, setEditMode] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // ✅ NEW: search + sort state
  const [search, setSearch] = useState("");
  const [sortSheetVisible, setSortSheetVisible] = useState(false);
  const [sortKey, setSortKey] = useState("added");
  const [sortDir, setSortDir] = useState("desc");

  const [activeCategory, setActiveCategory] = useState("All");

  const quantityInputRef = useRef(null);
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const hasCheckedItems = Object.values(checkedItems).some((v) => v);

  // -----------------------------
  // ✅ ⋯ Item menu (IMPLEMENTED)
  // -----------------------------
  const [itemMenuVisible, setItemMenuVisible] = useState(false);
  const [activeItem, setActiveItem] = useState(null);
  const [editName, setEditName] = useState("");
  const [editQty, setEditQty] = useState("");

  // ✅ category in edit modal
  const [editCategory, setEditCategory] = useState(""); // label
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);

  const toggleEditMode = () => setEditMode((prev) => !prev);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardVisible(false)
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // ---------------------------------------
  // ✅ OPTIONAL: keep list tidy
  // ---------------------------------------
  useEffect(() => {
    if (typeof streamlineLists !== "function") return;
    streamlineLists({ scope: "shopping", retag: false, dryRun: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shoppingListItems?.length]);

  // ---------------------------------------
  // ✅ Preset-tag-based categorization (silent)
  // ---------------------------------------
  const FOOD_TYPE_TAGS = useMemo(() => {
    return (Array.isArray(tags) ? tags : []).filter((t) => t?.type === "food_type");
  }, [tags]);

  const normalizeCategoriesArg = (labelOrNull) => {
    return labelOrNull ? [labelOrNull] : [];
  };

  const getItemCategoryLabel = (item) => {
    const ids = Array.isArray(item?.tagIds) ? item.tagIds : [];
    if (ids.length && FOOD_TYPE_TAGS.length) {
      const firstFoodType = FOOD_TYPE_TAGS.find((t) => ids.includes(t.id));
      if (firstFoodType?.label) return firstFoodType.label;
    }

    const v =
      item?.category ||
      item?.tag ||
      item?.food_type ||
      item?.type ||
      item?.storage ||
      item?.section ||
      item?.aisle ||
      "";
    return typeof v === "string" && v.trim() ? v.trim() : "Uncategorized";
  };

  const handleAdd = () => {
    if (!newItemName.trim() || !newItemQuantity.trim()) return;

    const inferredLabel =
      typeof inferFoodTypeLabelFromName === "function" ? inferFoodTypeLabelFromName(newItemName) : null;

    const categories = normalizeCategoriesArg(inferredLabel);

    addToShoppingList(newItemName, newItemQuantity, categories);

    setNewItemName("");
    setNewItemQuantity("");
  };

  const toggleCheck = (id) => {
    setCheckedItems((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleDoneShopping = () => {
    shoppingListItems.forEach((item) => {
      if (checkedItems[item.id]) {
        const categories = Array.isArray(item.tagIds) ? item.tagIds : [];
        addToFridge(item.name, item.quantity, categories);
        removeFromShoppingList(item.id);
      }
    });
    setCheckedItems({});
  };

  const deleteSelectedItems = () => {
    const ids = Object.keys(checkedItems).filter((id) => checkedItems[id]);
    if (ids.length === 0) return;

    ids.forEach((id) => removeFromShoppingList(id));
    setCheckedItems({});
  };

  // -------------------------
  // Pills: only show categories that have items
  // -------------------------
  const categoryPills = useMemo(() => {
    const counts = new Map();
    for (const it of shoppingListItems) {
      const cat = getItemCategoryLabel(it);
      if (!cat) continue;
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }

    const fromPreset = FOOD_TYPE_TAGS.map((t) => t.label).filter(Boolean);

    const raw =
      (tags?.shoppingCategories && Array.isArray(tags.shoppingCategories) && tags.shoppingCategories) ||
      (tags?.shopping && Array.isArray(tags.shopping) && tags.shopping) ||
      (tags?.categories && Array.isArray(tags.categories) && tags.categories) ||
      [];

    const cleaned = raw
      .map((t) => (typeof t === "string" ? t.trim() : t?.label || t?.name || ""))
      .filter(Boolean);

    const merged = Array.from(new Set([...fromPreset, ...cleaned]));
    const present = merged.filter((label) => (counts.get(label) || 0) > 0);

    if ((counts.get("Uncategorized") || 0) > 0 && !present.includes("Uncategorized")) {
      present.push("Uncategorized");
    }

    const order = new Map(merged.map((c, idx) => [c, idx]));
    present.sort((a, b) => {
      const ai = order.has(a) ? order.get(a) : 9999;
      const bi = order.has(b) ? order.get(b) : 9999;
      if (ai !== bi) return ai - bi;
      return a.localeCompare(b);
    });

    return ["All", ...present];
  }, [shoppingListItems, FOOD_TYPE_TAGS, tags]);

  // ✅ NEW: tabs include counts (optional but nice)
  const categoryTabs = useMemo(() => {
    const counts = new Map();
    for (const it of shoppingListItems) {
      const c = getItemCategoryLabel(it);
      counts.set(c, (counts.get(c) || 0) + 1);
    }

    return categoryPills.map((label) => ({
      key: label,
      label,
      count: label === "All" ? shoppingListItems.length : (counts.get(label) || 0),
    }));
  }, [categoryPills, shoppingListItems]);

  useEffect(() => {
    if (activeCategory === "All") return;
    if (!categoryPills.includes(activeCategory)) setActiveCategory("All");
  }, [categoryPills, activeCategory]);

  // ✅ NEW: search + category filter (before sectioning)
  const filteredShoppingItems = useMemo(() => {
    const q = norm(search);
    return (shoppingListItems || []).filter((it) => {
      if (q && !norm(it?.name).includes(q)) return false;

      const cat = getItemCategoryLabel(it);
      if (activeCategory === "All") return true;
      return cat === activeCategory;
    });
  }, [shoppingListItems, search, activeCategory, getItemCategoryLabel]);

  // ✅ NEW: sort filtered items (stable-ish)
  const sortedShoppingItems = useMemo(() => {
    const arr = [...filteredShoppingItems];
    arr.sort((a, b) => {
      let cmp = 0;

      switch (sortKey) {
        case "name":
          cmp = norm(a?.name).localeCompare(norm(b?.name));
          break;
        case "category":
          cmp = norm(getItemCategoryLabel(a)).localeCompare(norm(getItemCategoryLabel(b)));
          if (cmp === 0) cmp = norm(a?.name).localeCompare(norm(b?.name));
          break;
        case "added":
        default: {
          // if you have createdAt, use it. otherwise keep original order by id.
          const ams = a?.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bms = b?.createdAt ? new Date(b.createdAt).getTime() : 0;
          cmp = ams - bms;
          if (cmp === 0) cmp = String(a?.id || "").localeCompare(String(b?.id || ""));
          break;
        }
      }

      if (sortDir === "desc") cmp *= -1;
      if (cmp === 0) cmp = String(a?.id || "").localeCompare(String(b?.id || ""));
      return cmp;
    });

    return arr;
  }, [filteredShoppingItems, sortKey, sortDir, getItemCategoryLabel]);

  // ✅ sections now built from sorted+filtered list
  const sections = useMemo(() => {
    const byCat = new Map();

    sortedShoppingItems.forEach((it) => {
      const cat = getItemCategoryLabel(it);
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(it);
    });

    // keep section order aligned with pills order (minus All)
    const pillOrder = new Map(categoryPills.map((c, idx) => [c, idx]));
    const entries = Array.from(byCat.entries());

    entries.sort((a, b) => {
      const ai = pillOrder.has(a[0]) ? pillOrder.get(a[0]) : 9999;
      const bi = pillOrder.has(b[0]) ? pillOrder.get(b[0]) : 9999;
      if (ai !== bi) return ai - bi;
      return a[0].localeCompare(b[0]);
    });

    // If activeCategory != All we technically only have 1 section, but this works either way.
    return entries.map(([title, data]) => ({ title, data }));
  }, [sortedShoppingItems, getItemCategoryLabel, categoryPills]);

  // ---------------------------------------
  // ✅ Select All / Clear (respects current filtered/visible set)
  // ---------------------------------------
  const clearAllChecked = () => setCheckedItems({});

  const selectAllVisible = () => {
    const ids = [];
    for (const sec of sections) {
      for (const it of sec.data || []) {
        if (it?.id) ids.push(it.id);
      }
    }
    if (ids.length === 0) return;

    setCheckedItems((prev) => {
      const next = { ...prev };
      ids.forEach((id) => {
        next[id] = true;
      });
      return next;
    });
  };

  // ---------------------------------------
  // ✅ Header
  // ---------------------------------------
  useLayoutEffect(() => {
    const leftButtonLabel = editMode
      ? hasCheckedItems
        ? "Delete"
        : "Select All"
      : hasCheckedItems
      ? "Clear"
      : "Select All";

    const onLeftPress = editMode
      ? hasCheckedItems
        ? deleteSelectedItems
        : selectAllVisible
      : hasCheckedItems
      ? clearAllChecked
      : selectAllVisible;

    navigation.setOptions({
      header: () => (
        <HeaderWithButton
          title="🛒 Shopping List"
          buttonLabel={editMode ? "Done" : "Edit"}
          onPress={toggleEditMode}
          showLeftButton={true}
          leftButtonLabel={leftButtonLabel}
          onLeftPress={onLeftPress}
        />
      ),
    });
  }, [navigation, editMode, hasCheckedItems, sections, theme, checkedItems]);

  // -----------------------------
  // ✅ open modal + prefill category
  // -----------------------------
  const openItemMenu = (item) => {
    setActiveItem(item);
    setEditName(String(item?.name ?? ""));
    setEditQty(String(item?.quantity ?? ""));
    setEditCategory(getItemCategoryLabel(item));
    setItemMenuVisible(true);
  };

  const closeItemMenu = () => {
    setItemMenuVisible(false);
    setActiveItem(null);
    setEditName("");
    setEditQty("");
    setEditCategory("");
    setCategoryDropdownOpen(false);
  };

  const saveItemEdits = () => {
    if (!activeItem?.id) return;
    const name = editName.trim();
    const quantity = editQty.trim();
    if (!name || !quantity) return;

    const categories = editCategory && editCategory !== "Uncategorized" ? [editCategory] : [];
    editShoppingListItem(activeItem.id, { name, quantity, categories });
    closeItemMenu();
  };

  const deleteActiveItem = () => {
    if (!activeItem?.id) return;
    removeFromShoppingList(activeItem.id);
    closeItemMenu();
  };

  // -----------------------------
  // ✅ Row
  // -----------------------------
  const renderRow = ({ item }) => {
    const qty = String(item?.quantity ?? "");
    const isChecked = !!checkedItems[item.id];

    const onRightActionPress = () => {
      if (editMode) removeFromShoppingList(item.id);
      else openItemMenu(item);
    };

    return (
      <View style={styles.itemRow}>
        <TouchableOpacity
          style={[styles.item, { backgroundColor: theme.shoppingItemBackground }]}
          onPress={() => toggleCheck(item.id)}
          disabled={false}
        >
          <Ionicons
            name={isChecked ? "checkbox" : "square-outline"}
            size={fontSize}
            color={isChecked ? theme.actionButton : theme.textSecondary}
          />

          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text
              style={[
                styles.itemTitle,
                { fontSize: fontSize * 1.02, color: theme.text },
                isChecked && { textDecorationLine: "line-through", color: theme.shoppingCheckedText },
              ]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {item.name}
            </Text>
          </View>

          {!!qty && (
            <View style={[styles.qtyPill, { borderColor: theme.border, backgroundColor: theme.inputBackground }]}>
              <Text
                style={[
                  styles.qtyText,
                  { fontSize: Math.max(12, fontSize * 0.85), color: theme.textSecondary },
                  isChecked && { color: theme.shoppingCheckedText },
                ]}
                numberOfLines={1}
              >
                {qty}
              </Text>
            </View>
          )}

          <TouchableOpacity
            onPress={onRightActionPress}
            activeOpacity={0.7}
            style={[
              styles.rightActionButton,
              {
                borderColor: editMode ? "transparent" : theme.border,
                backgroundColor: editMode ? theme.danger : "transparent",
              },
            ]}
          >
            <Ionicons
              name={editMode ? "trash" : "ellipsis-horizontal"}
              size={fontSize * 1.1}
              color={editMode ? "#fff" : theme.textSecondary}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </View>
    );
  };

  const categoryOptions = useMemo(() => {
    const preset = FOOD_TYPE_TAGS.map((t) => t.label).filter(Boolean);

    const raw =
      (tags?.shoppingCategories && Array.isArray(tags.shoppingCategories) && tags.shoppingCategories) ||
      (tags?.shopping && Array.isArray(tags.shopping) && tags.shopping) ||
      (tags?.categories && Array.isArray(tags.categories) && tags.categories) ||
      [];

    const cleaned = raw
      .map((t) => (typeof t === "string" ? t.trim() : t?.label || t?.name || ""))
      .filter(Boolean);

    return Array.from(new Set([...preset, ...cleaned]));
  }, [FOOD_TYPE_TAGS, tags]);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : insets.bottom}
    >
      <View
        style={[
          styles.container,
          {
            paddingBottom: keyboardVisible ? insets.bottom : 0,
            backgroundColor: theme.background,
          },
        ]}
      >
        {/* ✅ NEW: Search + Sort (like FridgeScreen) */}
        <View style={styles.topBlock}>
          <SearchAndSortBar
            search={search}
            onChangeSearch={setSearch}
            onPressSort={() => setSortSheetVisible(true)}
            theme={theme}
            fontSize={fontSize}
            placeholder="Search items..."
          />

          <View style={{ marginTop: 10 }}>
            <FilterTabsRow
              tabs={categoryTabs}
              activeKey={activeCategory}
              onChange={setActiveCategory}
              theme={theme}
              fontSize={fontSize}
            />
          </View>
        </View>

        {/* List */}
        {sortedShoppingItems.length === 0 ? (
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
              <Text style={[styles.empty, { fontSize, color: theme.textSecondary }]}>
                {shoppingListItems.length === 0 ? "Your shopping list is empty! Add something below 👇" : "No matches. Try a different search or tab."}
              </Text>
            </View>
          </TouchableWithoutFeedback>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            renderItem={renderRow}
            renderSectionHeader={({ section }) => (
              <View style={[styles.sectionHeaderWrap, { backgroundColor: theme.background }]}>
                <Text
                  style={[
                    styles.sectionHeader,
                    { color: theme.textSecondary, fontSize: Math.max(12, fontSize * 0.8) },
                  ]}
                >
                  {section.title.toUpperCase()}
                </Text>
              </View>
            )}
            stickySectionHeadersEnabled
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {/* Input Row */}
        <View style={styles.inputRow}>
          <TextInput
            style={[
              styles.input,
              { fontSize, borderColor: theme.border, backgroundColor: theme.inputBackground, color: theme.inputText },
            ]}
            placeholder="Item Name"
            placeholderTextColor={theme.textPlaceholder}
            value={newItemName}
            onChangeText={setNewItemName}
            returnKeyType="next"
            onSubmitEditing={() => quantityInputRef.current?.focus()}
          />

          <TextInput
            ref={quantityInputRef}
            style={[
              styles.input,
              { fontSize, borderColor: theme.border, backgroundColor: theme.inputBackground, color: theme.inputText },
            ]}
            placeholder="Quantity"
            placeholderTextColor={theme.textPlaceholder}
            value={newItemQuantity}
            onChangeText={setNewItemQuantity}
            returnKeyType="done"
            onSubmitEditing={handleAdd}
          />

          <TouchableOpacity style={[styles.addButton, { backgroundColor: theme.actionButton }]} onPress={handleAdd}>
            <Ionicons name="add" size={fontSize * 1.5} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* ✅ Done Shopping Button (DISABLED in edit mode) */}
        {hasCheckedItems && !editMode && (
          <TouchableOpacity style={[styles.doneButton, { backgroundColor: theme.accent }]} onPress={handleDoneShopping}>
            <Text style={[styles.doneButtonText, { fontSize }]}>✅ Done Shopping</Text>
          </TouchableOpacity>
        )}

        {/* ✅ Item menu modal (edit/delete + category) */}
        <Modal visible={itemMenuVisible} transparent animationType="fade" onRequestClose={closeItemMenu}>
          <TouchableWithoutFeedback onPress={closeItemMenu}>
            <View style={[styles.modalBackdrop, { backgroundColor: theme.modalBackground || "rgba(0,0,0,0.6)" }]}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View style={[styles.modalCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
                  <View style={styles.modalHeader}>
                    <Text style={[styles.modalTitle, { color: theme.text, fontSize: fontSize * 1.05 }]}>Edit item</Text>
                    <TouchableOpacity onPress={closeItemMenu} style={styles.modalCloseBtn}>
                      <Ionicons name="close" size={fontSize * 1.4} color={theme.textSecondary} />
                    </TouchableOpacity>
                  </View>

                  <Text style={[styles.modalLabel, { color: theme.textSecondary, fontSize: Math.max(12, fontSize * 0.85) }]}>
                    Name
                  </Text>
                  <TextInput
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="Item name"
                    placeholderTextColor={theme.textPlaceholder}
                    style={[
                      styles.modalInput,
                      { fontSize, borderColor: theme.border, backgroundColor: theme.inputBackground, color: theme.inputText },
                    ]}
                    returnKeyType="next"
                  />

                  <Text style={[styles.modalLabel, { color: theme.textSecondary, fontSize: Math.max(12, fontSize * 0.85) }]}>
                    Quantity
                  </Text>
                  <TextInput
                    value={editQty}
                    onChangeText={setEditQty}
                    placeholder="Quantity"
                    placeholderTextColor={theme.textPlaceholder}
                    style={[
                      styles.modalInput,
                      { fontSize, borderColor: theme.border, backgroundColor: theme.inputBackground, color: theme.inputText },
                    ]}
                    returnKeyType="done"
                  />

                  <Text style={[styles.modalLabel, { color: theme.textSecondary, fontSize: Math.max(12, fontSize * 0.85) }]}>
                    Category
                  </Text>

                  <TouchableOpacity
                    onPress={() => setCategoryDropdownOpen((v) => !v)}
                    style={[styles.categorySelect, { borderColor: theme.border, backgroundColor: theme.inputBackground }]}
                    activeOpacity={0.8}
                  >
                    <Text style={{ flex: 1, fontSize, color: theme.inputText }} numberOfLines={1}>
                      {editCategory || "Uncategorized"}
                    </Text>
                    <Ionicons
                      name={categoryDropdownOpen ? "chevron-up" : "chevron-down"}
                      size={fontSize * 1.1}
                      color={theme.textSecondary}
                    />
                  </TouchableOpacity>

                  {categoryDropdownOpen && (
                    <View style={[styles.categoryMenu, { borderColor: theme.border, backgroundColor: theme.card }]}>
                      <TouchableOpacity
                        onPress={() => {
                          setEditCategory("Uncategorized");
                          setCategoryDropdownOpen(false);
                        }}
                        style={styles.categoryOption}
                      >
                        <Text style={{ fontSize, color: theme.text }}>Uncategorized</Text>
                      </TouchableOpacity>

                      {categoryOptions.map((c) => (
                        <TouchableOpacity
                          key={c}
                          onPress={() => {
                            setEditCategory(c);
                            setCategoryDropdownOpen(false);
                          }}
                          style={styles.categoryOption}
                        >
                          <Text style={{ fontSize, color: theme.text }}>{c}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  <View style={styles.modalActions}>
                    <TouchableOpacity onPress={deleteActiveItem} style={[styles.modalBtn, { backgroundColor: theme.danger }]}>
                      <Ionicons name="trash" size={fontSize * 1.1} color="#fff" />
                      <Text style={[styles.modalBtnText, { fontSize, color: "#fff" }]}>Delete</Text>
                    </TouchableOpacity>

                    <View style={{ flex: 1 }} />

                    <TouchableOpacity onPress={closeItemMenu} style={[styles.modalBtnOutline, { borderColor: theme.border }]}>
                      <Text style={[styles.modalBtnText, { fontSize, color: theme.text }]}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity onPress={saveItemEdits} style={[styles.modalBtn, { backgroundColor: theme.actionButton }]}>
                      <Text style={[styles.modalBtnText, { fontSize, color: "#fff" }]}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* ✅ NEW: Sort sheet (optional but matches your FridgeScreen) */}
        <SortSheetModal
          visible={sortSheetVisible}
          onClose={() => setSortSheetVisible(false)}
          options={SORT_ITEMS}
          sortKey={sortKey}
          setSortKey={setSortKey}
          sortDir={sortDir}
          setSortDir={setSortDir}
          theme={theme}
          fontSize={fontSize}
          title="Sort by"
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: 14 },

  // ✅ NEW: like FridgeScreen "topBlock"
  topBlock: { paddingTop: 10, paddingBottom: 8 },

  empty: { textAlign: "center", marginTop: 20 },

  list: { paddingTop: 10, paddingBottom: 18 },

  sectionHeaderWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 8,
    paddingBottom: 8,
  },
  sectionHeader: { letterSpacing: 1, fontWeight: "800" },

  itemRow: { flexDirection: "row", alignItems: "center", marginBottom: 10, columnGap: 10 },
  item: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 14,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },

  itemTitle: { fontWeight: "700" },

  qtyPill: {
    marginLeft: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 120,
  },
  qtyText: { fontWeight: "700" },

  rightActionButton: {
    marginLeft: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 1,
  },

  inputRow: { flexDirection: "row", alignItems: "center", padding: 5 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 10, marginRight: 10 },
  addButton: { padding: 10, borderRadius: 12 },

  doneButton: { padding: 15, borderRadius: 12, marginTop: 14, alignItems: "center" },
  doneButtonText: { color: "#fff", fontWeight: "bold" },

  modalBackdrop: { flex: 1, justifyContent: "center", paddingHorizontal: 18 },
  modalCard: { borderWidth: 1, borderRadius: 16, padding: 14 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  modalTitle: { fontWeight: "800" },
  modalCloseBtn: { padding: 6, borderRadius: 10 },
  modalLabel: { marginTop: 8, marginBottom: 6, fontWeight: "700" },
  modalInput: { borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },

  categorySelect: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  categoryMenu: { borderWidth: 1, borderRadius: 12, marginTop: 8, overflow: "hidden" },
  categoryOption: { paddingVertical: 10, paddingHorizontal: 12 },

  modalActions: { flexDirection: "row", alignItems: "center", marginTop: 14, columnGap: 10 },
  modalBtn: { flexDirection: "row", alignItems: "center", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, columnGap: 8 },
  modalBtnOutline: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1 },
  modalBtnText: { fontWeight: "800" },
});
