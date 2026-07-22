import { router, useNavigation } from "expo-router";
import React, { useCallback, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Alert, SectionList, StyleSheet, Text, View } from "react-native";
import { useGpt } from "../../api/gpt";
import ActionGridPopover from "../../components/ActionGridPopover";
import FilterTabsRow from "../../components/FilterTabsRow";
import FloatingAddButton from "../../components/FloatingAddButton";
import { HeaderWithButton } from "../../components/Header";
import InventoryListItem from "../../components/InventoryListItem";
import ItemFormModal from "../../components/ItemFormModal";
import SearchAndSortBar from "../../components/SearchAndSortBar";
import SectionHeaderPill from "../../components/SectionHeaderPill";
import SelectionActionBar from "../../components/SelectionActionBar";
import SortSheetModal from "../../components/SortSheetModal";
import { GlobalContext } from "../../context/GlobalContext";
import { buildTagMaps, makeGetTagLabelByType, makeLabelToTagId, makeLabelsFromTagIds } from "../../utils/itemTagLabels";

const SORT_ITEMS = [
  { label: "Added", value: "added" },
  { label: "Name", value: "name" },
  { label: "Urgency", value: "urgency" },
  { label: "Storage", value: "storage" },
  { label: "Food type", value: "food_type" },
];

const norm = (s) => String(s || "").trim().toLowerCase();

export default function FridgeScreen() {
  const {
    fridgeItems,
    addToFridge,
    addToShoppingList,
    removeFromFridge,
    editFridgeItem,
    theme,
    settings,
    tags,

    // global expiration helpers
    ALMOST_EXPIRE_DAYS,
    getExpiryMeta,
  } = useContext(GlobalContext);

  const fontSize = settings?.ux?.fontSize || 16;
  const navigation = useNavigation();
  const { streamMessage } = useGpt();

  // UI state
  const [editMode, setEditMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("All");

  const [sortSheetVisible, setSortSheetVisible] = useState(false);
  const [sortKey, setSortKey] = useState("added");
  const [sortDir, setSortDir] = useState("desc");

  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editItem, setEditItem] = useState(null);

  // context menu (long press)
  const [contextItem, setContextItem] = useState(null);
  const [contextMenuVisible, setContextMenuVisible] = useState(false);
  const [contextFromRect, setContextFromRect] = useState(null);
  const pendingEditRef = useRef(null);

  // ---- Tag helpers (from utils) ----
  const { tagById, tagIdByKey } = useMemo(() => buildTagMaps(tags || []), [tags]);
  const labelToTagId = useMemo(() => makeLabelToTagId(tagIdByKey), [tagIdByKey]);
  const labelsFromTagIds = useMemo(() => makeLabelsFromTagIds(tagById), [tagById]);
  const getTagLabelByType = useMemo(() => makeGetTagLabelByType(tagById), [tagById]);

  // Header
  const toggleEditMode = useCallback(() => {
    setEditMode((prev) => {
      const next = !prev;
      if (next) {
        setContextMenuVisible(false);
        setContextFromRect(null);
        setContextItem(null);
      } else {
        setSelectedIds(new Set());
      }
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      header: () => (
        <HeaderWithButton
          title="🧊 My Fridge"
          buttonLabel={editMode ? "Done" : "Edit"}
          onPress={toggleEditMode}
        />
      ),
    });
  }, [navigation, editMode, toggleEditMode]);

  // Decorate items once
  const decoratedItems = useMemo(() => {
    return (fridgeItems || []).map((it) => {
      const createdAtMs = it?.createdAt ? new Date(it.createdAt).getTime() : 0;

      const meta = getExpiryMeta
        ? getExpiryMeta(it?.expiresAt, ALMOST_EXPIRE_DAYS)
        : {
            expired: false,
            almostExpired: false,
            daysUntilExpire: null,
            expiresAtMs: it?.expiresAt ? new Date(it.expiresAt).getTime() : null,
          };

      const storageLabel = getTagLabelByType(it, "storage");
      const urgencyLabel = getTagLabelByType(it, "urgency");
      const foodTypeLabel = getTagLabelByType(it, "food_type");
      const stateLabel = getTagLabelByType(it, "state");

      return {
        ...it,
        _createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,

        _expiresAtMs: Number.isFinite(meta?.expiresAtMs) ? meta.expiresAtMs : null,
        _expired: !!meta?.expired,
        _almostExpired: !!meta?.almostExpired,
        _daysUntilExpire: typeof meta?.daysUntilExpire === "number" ? meta.daysUntilExpire : null,

        _storageLabel: storageLabel,
        _urgencyLabel: urgencyLabel,
        _foodTypeLabel: foodTypeLabel,
        _stateLabel: stateLabel,
        _nameNorm: norm(it?.name),
      };
    });
  }, [fridgeItems, getExpiryMeta, ALMOST_EXPIRE_DAYS, getTagLabelByType]);

  // Tabs + counts
  const tabDefs = useMemo(() => {
    const counts = { All: decoratedItems.length, Fridge: 0, Freezer: 0, Pantry: 0 };
    for (const it of decoratedItems) {
      const s = it._storageLabel;
      if (counts[s] !== undefined) counts[s] += 1;
    }
    return [
      { key: "All", label: "All", count: counts.All },
      { key: "Fridge", label: "Fridge", count: counts.Fridge },
      { key: "Freezer", label: "Freezer", count: counts.Freezer },
      { key: "Pantry", label: "Pantry", count: counts.Pantry },
    ];
  }, [decoratedItems]);

  // Filter by search + tab
  const filteredItems = useMemo(() => {
    const q = norm(search);
    return decoratedItems.filter((it) => {
      if (q && !it._nameNorm.includes(q)) return false;
      if (activeTab === "All") return true;
      return norm(it._storageLabel) === norm(activeTab);
    });
  }, [decoratedItems, search, activeTab]);

  const expiredItems = useMemo(() => filteredItems.filter((it) => it._expired), [filteredItems]);
  const almostExpiredItems = useMemo(
    () => filteredItems.filter((it) => !it._expired && it._almostExpired),
    [filteredItems]
  );
  const nonExpiredItems = useMemo(
    () => filteredItems.filter((it) => !it._expired && !it._almostExpired),
    [filteredItems]
  );

  const urgencyRank = useCallback((label) => {
    switch (norm(label)) {
      case "eat first":
        return 0;
      case "use soon":
        return 1;
      case "lasts a while":
        return 2;
      case "long keeper":
        return 3;
      default:
        return 99;
    }
  }, []);

  const storageRank = useCallback((label) => {
    switch (norm(label)) {
      case "fridge":
        return 0;
      case "freezer":
        return 1;
      case "pantry":
        return 2;
      default:
        return 99;
    }
  }, []);

  // Sort (non-expired)
  const sortedItems = useMemo(() => {
    const arr = [...nonExpiredItems];
    arr.sort((a, b) => {
      let cmp = 0;

      switch (sortKey) {
        case "name":
          cmp = a._nameNorm.localeCompare(b._nameNorm);
          break;
        case "urgency":
          cmp = urgencyRank(a._urgencyLabel) - urgencyRank(b._urgencyLabel);
          break;
        case "storage":
          cmp = storageRank(a._storageLabel) - storageRank(b._storageLabel);
          break;
        case "food_type":
          cmp = norm(a._foodTypeLabel).localeCompare(norm(b._foodTypeLabel));
          break;
        case "added":
        default:
          cmp = a._createdAtMs - b._createdAtMs;
          if (cmp === 0) cmp = String(a?.id || "").localeCompare(String(b?.id || ""));
          break;
      }

      if (sortDir === "desc") cmp *= -1;

      if (cmp === 0) cmp = a._nameNorm.localeCompare(b._nameNorm);
      if (cmp === 0) cmp = String(a?.id || "").localeCompare(String(b?.id || ""));
      return cmp;
    });

    return arr;
  }, [nonExpiredItems, sortKey, sortDir, urgencyRank, storageRank]);

  // Sections (expired + expiring soon + items)
  const fridgeSections = useMemo(() => {
    const out = [];
    const hasAlerts = expiredItems.length > 0 || almostExpiredItems.length > 0;

    if (expiredItems.length > 0) out.push({ title: "EXPIRED", data: expiredItems });
    if (almostExpiredItems.length > 0) out.push({ title: "EXPIRING SOON", data: almostExpiredItems });
    if (sortedItems.length > 0) out.push({ title: hasAlerts ? "ITEMS" : "", data: sortedItems });

    return out;
  }, [expiredItems, almostExpiredItems, sortedItems]);

  // Selection helpers
  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedCount = selectedIds.size;

  const visibleIds = useMemo(() => filteredItems.map((it) => it.id), [filteredItems]);

  const selectAllVisible = useCallback(() => {
    setSelectedIds(new Set(visibleIds));
  }, [visibleIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const selectedItems = useMemo(() => {
    if (selectedIds.size === 0) return [];
    const byId = new Map((sortedItems || []).map((it) => [it.id, it]));
    for (const it of expiredItems) byId.set(it.id, it);
    for (const it of almostExpiredItems) byId.set(it.id, it);

    return Array.from(selectedIds)
      .map((id) => byId.get(id))
      .filter(Boolean);
  }, [selectedIds, sortedItems, expiredItems, almostExpiredItems]);

  // Recipes / ShopList / Delete / Edit
  const openRecipesForItems = useCallback(
    async (items) => {
      if (!items || items.length === 0) return;

      const ingredientLines = items
        .map((it) => {
          const qty = String(it.quantity || "").trim();
          const name = String(it.name || "").trim();
          return `- ${qty ? `${qty} ` : ""}${name}`.trim();
        })
        .filter(Boolean)
        .join("\n");

      const prompt = `
Suggest 5 quick recipe ideas using these items:
${ingredientLines}

For each recipe:
- Title
- 2–4 short steps
- 1–2 optional add-ins (common staples)
`.trim();

      try {
        router.push("/chat");
        await streamMessage({ text: prompt, language: "en" });
      } catch (e) {
        Alert.alert("Recipes", e?.message || "Failed to generate recipes.");
      }
    },
    [streamMessage]
  );

  const addItemsToShopList = useCallback(
    (items) => {
      if (!items || items.length === 0) return;
      for (const it of items) addToShoppingList(it.name, it.quantity, it.tagIds || []);
      Alert.alert("Shop list", `Added ${items.length} item(s) to shopping list.`);
    },
    [addToShoppingList]
  );

  const confirmDeleteItems = useCallback(
    (items) => {
      if (!items || items.length === 0) return;

      Alert.alert("Delete items", `Delete ${items.length} item(s)?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            for (const it of items) removeFromFridge(it.id);
            setSelectedIds(new Set());
            setContextMenuVisible(false);
            setContextFromRect(null);
            setContextItem(null);
          },
        },
      ]);
    },
    [removeFromFridge]
  );

  const openEditForItem = useCallback((item) => {
    if (!item) return;
    setEditItem(item);
    setEditModalVisible(true);
  }, []);

  // Context menu actions
  const contextActions = useMemo(
    () => [
      {
        key: "recipes",
        icon: "search",
        label: "Recipes",
        onPress: () => {
          setContextMenuVisible(false);
          openRecipesForItems(contextItem ? [contextItem] : []);
        },
      },
      {
        key: "shop",
        icon: "cart",
        label: "Shop list",
        onPress: () => {
          setContextMenuVisible(false);
          addItemsToShopList(contextItem ? [contextItem] : []);
        },
      },
      {
        key: "edit",
        icon: "pencil",
        label: "Edit",
        onPress: () => {
          // open edit AFTER popover closes (prevents “double overlay” weirdness)
          pendingEditRef.current = contextItem;
          setContextMenuVisible(false);
        },
      },
      {
        key: "delete",
        icon: "trash",
        label: "Delete",
        danger: true,
        onPress: () => confirmDeleteItems(contextItem ? [contextItem] : []),
      },
    ],
    [contextItem, openRecipesForItems, addItemsToShopList, confirmDeleteItems]
  );

  // Bottom bar actions (edit mode)
  const bottomActions = useMemo(
    () => [
      {
        key: "recipes",
        icon: "search",
        label: "Recipes",
        onPress: () => openRecipesForItems(selectedItems),
      },
      {
        key: "shop",
        icon: "cart",
        label: "Shop list",
        onPress: () => addItemsToShopList(selectedItems),
      },
      {
        key: "edit",
        icon: "pencil",
        label: "Edit",
        onPress: () => {
          if (selectedItems.length !== 1) {
            Alert.alert("Edit", "Select exactly 1 item to edit.");
            return;
          }
          openEditForItem(selectedItems[0]);
        },
      },
      {
        key: "delete",
        icon: "trash",
        label: "Delete",
        danger: true,
        onPress: () => confirmDeleteItems(selectedItems),
      },
    ],
    [selectedItems, openRecipesForItems, addItemsToShopList, openEditForItem, confirmDeleteItems]
  );

  // render item with extracted component
  const renderItem = useCallback(
    ({ item }) => (
      <InventoryListItem
        item={item}
        theme={theme}
        fontSize={fontSize}
        editMode={editMode}
        selected={selectedIds.has(item.id)}
        onToggleSelect={toggleSelect}
        onMeasuredLongPress={(rect, it) => {
          if (editMode) return;
          setContextItem(it);
          setContextFromRect(rect);
          setContextMenuVisible(true);
        }}
      />
    ),
    [theme, fontSize, editMode, selectedIds, toggleSelect]
  );

  const emptyText =
    fridgeItems.length === 0
      ? "👇 Your fridge is empty. Add some items!"
      : "No matches. Try a different search or tab.";

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Top controls */}
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
            tabs={tabDefs}
            activeKey={activeTab}
            onChange={setActiveTab}
            theme={theme}
            fontSize={fontSize}
          />
        </View>
      </View>

      {/* List */}
      {fridgeSections.length === 0 ? (
        <Text style={[styles.empty, { fontSize, color: theme.textSecondary }]}>{emptyText}</Text>
      ) : (
        <SectionList
          sections={fridgeSections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          stickySectionHeadersEnabled
          renderSectionHeader={({ section }) => {
            if (!section.title) return null;
            const isExpired = section.title === "EXPIRED";
            const isAlmost = section.title === "EXPIRING SOON";
            const count = isExpired ? expiredItems.length : isAlmost ? almostExpiredItems.length : undefined;

            return (
              <SectionHeaderPill
                title={section.title}
                count={typeof count === "number" ? count : undefined}
                tone={isExpired ? "danger" : isAlmost ? "warning" : "neutral"}
                theme={theme}
                fontSize={fontSize}
              />
            );
          }}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: editMode ? 170 : 110, backgroundColor: theme.background },
          ]}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          windowSize={7}
          removeClippedSubviews={false}
          maxToRenderPerBatch={12}
          updateCellsBatchingPeriod={50}
          extraData={{ editMode, selectedCount }}
        />
      )}

      {/* FAB */}
      <FloatingAddButton
        theme={theme}
        disabled={editMode}
        onPress={() => {
          if (editMode) return;
          setAddModalVisible(true);
        }}
      />

      {/* Sort sheet */}
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

      {/* Add modal (merged form) */}
      <ItemFormModal
        visible={addModalVisible}
        mode="add"
        theme={theme}
        fontSize={fontSize}
        tags={tags || []}
        initialItem={null}
        labelsFromTagIds={labelsFromTagIds}
        labelToTagId={labelToTagId}
        onCancel={() => setAddModalVisible(false)}
        onSubmit={(payload) => {
          addToFridge(payload.name, payload.quantity, payload.tagIds, payload.expiresAt);
          setAddModalVisible(false);
        }}
      />

      {/* Edit modal (merged form) */}
      <ItemFormModal
        visible={editModalVisible}
        mode="edit"
        theme={theme}
        fontSize={fontSize}
        tags={tags || []}
        initialItem={
          editItem
            ? {
                id: editItem.id,
                name: editItem.name,
                quantity: editItem.quantity,
                tagIds: editItem.tagIds || [],
                expiresAt: editItem.expiresAt || null,
              }
            : null
        }
        labelsFromTagIds={labelsFromTagIds}
        labelToTagId={labelToTagId}
        onCancel={() => {
          setEditModalVisible(false);
          setEditItem(null);
        }}
        onSubmit={(payload) => {
          if (!payload?.id) return;
          editFridgeItem(payload.id, {
            name: payload.name,
            quantity: payload.quantity,
            tagIds: payload.tagIds,
            expiresAt: payload.expiresAt,
          });
          setEditModalVisible(false);
          setEditItem(null);
        }}
      />

      {/* Context menu */}
      <ActionGridPopover
        visible={!editMode && contextMenuVisible && !!contextFromRect}
        fromRect={contextFromRect}
        theme={theme}
        actions={contextActions}
        placement="top"
        onRequestClose={() => setContextMenuVisible(false)}
        onCloseComplete={() => {
          setContextFromRect(null);
          setContextItem(null);

          const pending = pendingEditRef.current;
          pendingEditRef.current = null;
          if (pending) openEditForItem(pending);
        }}
      />

      {/* Edit-mode bottom bar */}
      <SelectionActionBar
        visible={editMode}
        selectedCount={selectedCount}
        canSelectAll={visibleIds.length > 0}
        onSelectAll={selectAllVisible}
        onClear={clearSelection}
        actions={bottomActions}
        theme={theme}
        fontSize={fontSize}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBlock: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8 },
  empty: { textAlign: "center", marginTop: 20 },
  list: { paddingHorizontal: 14, paddingTop: 6 },
});
