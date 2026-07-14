import { Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  findNodeHandle,
} from "react-native";
import DropDownPicker from "react-native-dropdown-picker";
import Popover from "react-native-popover-view";

import {
  formatYYYYMMDDLocal,
  isoFromLocalDateOnly,
  parseDateInputToIso,
  startOfDayLocal,
} from "../utils/dateInput";

export default function ItemFormModal({
  visible,
  mode = "add",
  theme,
  fontSize = 16,

  tags = [],
  initialItem = null,

  labelsFromTagIds,
  labelToTagId,

  onCancel,
  onSubmit,

  titleAdd = "Add New Item",
  titleEdit = "Edit Item",
  submitLabelAdd = "Add",
  submitLabelEdit = "Save",
}) {
  const isEdit = mode === "edit";

  const scrollRef = useRef(null);

  const nameRef = useRef(null);
  const quantityRef = useRef(null);
  const expDaysRef = useRef(null);
  const expDateRef = useRef(null);

  const focusedRef = useRef(null);

  const scrollToRef = (ref) => {
    const sv = scrollRef.current;
    const node = ref?.current;
    if (!sv || !node) return;

    const scrollHandle = findNodeHandle(sv);
    if (!scrollHandle) return;

    node.measureLayout(
      scrollHandle,
      (_x, y) => {
        const targetY = Math.max(0, y - 16);
        sv.scrollTo({ y: targetY, animated: true });
      },
      () => {}
    );
  };

  const focusAndScroll = (ref) => {
    focusedRef.current = ref;

    // close popovers/menus so layout is stable before scrolling
    closeAll();

    requestAnimationFrame(() => scrollToRef(ref));
    setTimeout(() => scrollToRef(ref), 60);
  };

  // When keyboard opens, ensure focused input is visible (NO keyboard avoidance; just scroll)
  useEffect(() => {
    if (!visible) return;

    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const subShow = Keyboard.addListener(showEvt, () => {
      if (focusedRef.current) {
        requestAnimationFrame(() => scrollToRef(focusedRef.current));
        setTimeout(() => scrollToRef(focusedRef.current), 80);
      }
    });

    const subHide = Keyboard.addListener(hideEvt, () => {});

    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, [visible]);

  const { storageItems, urgencyItems, foodTypeItems, stateItems } = useMemo(() => {
    const byType = (type) => (Array.isArray(tags) ? tags : []).filter((t) => t?.type === type);

    const toItems = (arr, addNone = false) => {
      const items = arr.map((t) => ({ label: t.label, value: t.label }));
      if (addNone) items.unshift({ label: "None", value: "" });
      return items;
    };

    return {
      storageItems: toItems(byType("storage")),
      urgencyItems: toItems(byType("urgency")),
      foodTypeItems: toItems(byType("food_type")),
      stateItems: toItems(byType("state"), true),
    };
  }, [tags]);

  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");

  const [storage, setStorage] = useState("Fridge");
  const [urgency, setUrgency] = useState("Use soon");
  const [foodType, setFoodType] = useState("Produce");
  const [stateTag, setStateTag] = useState("");

  const [openStorage, setOpenStorage] = useState(false);
  const [openUrgency, setOpenUrgency] = useState(false);
  const [openFoodType, setOpenFoodType] = useState(false);
  const [openState, setOpenState] = useState(false);

  const openOnly = (which) => {
    Keyboard.dismiss();
    focusedRef.current = null;

    setOpenStorage(which === "storage");
    setOpenUrgency(which === "urgency");
    setOpenFoodType(which === "foodType");
    setOpenState(which === "state");
  };

  const [expMode, setExpMode] = useState("days");
  const [expDaysText, setExpDaysText] = useState("");
  const [expDateText, setExpDateText] = useState("");
  const [expPickedDate, setExpPickedDate] = useState(() => startOfDayLocal(new Date()));

  const pickBtnRef = useRef(null);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerFromRect, setPickerFromRect] = useState(null);

  const closeAll = () => {
    setOpenStorage(false);
    setOpenUrgency(false);
    setOpenFoodType(false);
    setOpenState(false);
    setPickerVisible(false);
    setPickerFromRect(null);
  };

  useEffect(() => {
    if (!visible) return;

    const it = initialItem;

    if (isEdit && it) {
      setName(String(it.name ?? ""));
      setQuantity(String(it.quantity ?? ""));

      const labels = labelsFromTagIds ? labelsFromTagIds(it.tagIds || []) : {};
      setStorage(labels?.storage || "Fridge");
      setUrgency(labels?.urgency || "Use soon");
      setFoodType(labels?.food_type || "Produce");
      setStateTag(labels?.state || "");

      if (it.expiresAt) {
        setExpMode("date");
        const local = startOfDayLocal(new Date(it.expiresAt));
        setExpPickedDate(local);
        setExpDateText(formatYYYYMMDDLocal(local));
      } else {
        setExpMode("days");
        setExpPickedDate(startOfDayLocal(new Date()));
        setExpDateText("");
      }
      setExpDaysText("");
    } else {
      setName("");
      setQuantity("");
      setStorage("Fridge");
      setUrgency("Use soon");
      setFoodType("Produce");
      setStateTag("");

      setExpMode("days");
      setExpDaysText("");
      setExpDateText("");
      setExpPickedDate(startOfDayLocal(new Date()));
    }

    focusedRef.current = null;
    closeAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const buildExpiresAt = () => {
    let expiresAt = null;

    if (expMode === "days") {
      const raw = String(expDaysText || "").trim();
      if (raw) {
        const days = Number(raw);
        if (!Number.isFinite(days) || days <= 0) {
          Alert.alert("Days until expire", "Enter a valid number of days (e.g., 3, 7, 14).");
          return { ok: false, expiresAt: null };
        }
        const d = startOfDayLocal(new Date());
        d.setDate(d.getDate() + Math.round(days));
        expiresAt = isoFromLocalDateOnly(d);
      } else {
        expiresAt = null;
      }
    }

    if (expMode === "date") {
      const iso = parseDateInputToIso(expDateText) || isoFromLocalDateOnly(expPickedDate);
      if (!expDateText?.trim() && !expPickedDate) {
        Alert.alert("Expiration date", "Pick a date or enter one (YYYY-MM-DD or MM/DD/YYYY).");
        return { ok: false, expiresAt: null };
      }
      if (!iso) {
        Alert.alert("Expiration date", "Enter a valid date (YYYY-MM-DD or MM/DD/YYYY).");
        return { ok: false, expiresAt: null };
      }
      expiresAt = iso;
    }

    if (expMode === "machine") {
      expiresAt = null;
    }

    return { ok: true, expiresAt };
  };

  const handleSubmit = () => {
    const n = String(name || "").trim();
    const q = String(quantity || "").trim();

    if (!n || !q) {
      Alert.alert(isEdit ? "Edit item" : "Add item", "Name and quantity are required.");
      return;
    }

    const selectedLabels = [storage, urgency, foodType].filter(Boolean);
    if (stateTag) selectedLabels.push(stateTag);

    const tagIds = selectedLabels.map(labelToTagId).filter(Boolean);

    const { ok, expiresAt } = buildExpiresAt();
    if (!ok) return;

    onSubmit?.({
      ...(isEdit && initialItem?.id ? { id: initialItem.id } : {}),
      name: n,
      quantity: q,
      tagIds,
      expiresAt,
      expMode,
    });

    closeAll();
    focusedRef.current = null;
    Keyboard.dismiss();
  };

  return (
    <Modal
      transparent
      animationType="fade"
      visible={!!visible}
      onRequestClose={() => {
        closeAll();
        focusedRef.current = null;
        Keyboard.dismiss();
        onCancel?.();
      }}
    >
      <Pressable
        style={styles.overlay}
        onPress={() => {
          closeAll();
          focusedRef.current = null;
          Keyboard.dismiss();
          onCancel?.();
        }}
      >
        <Pressable style={[styles.sheet, { backgroundColor: theme?.card }]} onPress={() => {}}>
          <View style={{ flex: 1 }}>
            <ScrollView
              ref={scrollRef}
              style={{ flex: 1 }}
              showsVerticalScrollIndicator
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === "ios" ? "on-drag" : "none"}
              contentContainerStyle={{ paddingBottom: 12 }}
            >
              <Text style={[styles.title, { fontSize: fontSize * 1.2, color: theme?.textPrimary }]}>
                {isEdit ? titleEdit : titleAdd}
              </Text>

              <TextInput
                ref={nameRef}
                style={[
                  styles.input,
                  {
                    fontSize,
                    color: theme?.inputText,
                    borderColor: theme?.border,
                    backgroundColor: theme?.inputBackground,
                  },
                ]}
                placeholder="Item Name"
                placeholderTextColor={theme?.textPlaceholder}
                value={name}
                onChangeText={setName}
                returnKeyType="next"
                onFocus={() => focusAndScroll(nameRef)}
                onSubmitEditing={() => quantityRef.current?.focus()}
              />

              <TextInput
                ref={quantityRef}
                style={[
                  styles.input,
                  {
                    fontSize,
                    color: theme?.inputText,
                    borderColor: theme?.border,
                    backgroundColor: theme?.inputBackground,
                  },
                ]}
                placeholder="Quantity"
                placeholderTextColor={theme?.textPlaceholder}
                value={quantity}
                onChangeText={setQuantity}
                returnKeyType="done"
                onFocus={() => focusAndScroll(quantityRef)}
              />

              <Text style={[styles.label, { color: theme?.textSecondary, fontSize: fontSize * 0.9 }]}>
                Expiration
              </Text>

              <View style={[styles.segment, { borderColor: theme?.border }]}>
                {[
                  { key: "days", label: "Days" },
                  { key: "date", label: "Date" },
                  { key: "machine", label: "Machine" },
                ].map((opt, i, arr) => {
                  const selected = expMode === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      activeOpacity={0.85}
                      onPress={() => {
                        Keyboard.dismiss();
                        focusedRef.current = null;
                        setExpMode(opt.key);
                        setPickerVisible(false);
                        setPickerFromRect(null);
                      }}
                      style={[
                        styles.segmentBtn,
                        {
                          backgroundColor: selected ? theme?.card : "transparent",
                          borderColor: theme?.border,
                        },
                        i === arr.length - 1 && { borderRightWidth: 0 },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: fontSize * 0.9,
                          fontWeight: selected ? "800" : "700",
                          color: selected ? theme?.textPrimary : theme?.textSecondary,
                        }}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {expMode === "days" && (
                <TextInput
                  ref={expDaysRef}
                  style={[
                    styles.input,
                    {
                      fontSize,
                      color: theme?.inputText,
                      borderColor: theme?.border,
                      backgroundColor: theme?.inputBackground,
                    },
                  ]}
                  placeholder={isEdit ? "Days until expire (leave blank to clear)" : "Days until expire (e.g., 7)"}
                  placeholderTextColor={theme?.textPlaceholder}
                  value={expDaysText}
                  onChangeText={(t) => setExpDaysText(t.replace(/[^\d]/g, ""))}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  onFocus={() => focusAndScroll(expDaysRef)}
                />
              )}

              {expMode === "date" && (
                <>
                  <TextInput
                    ref={expDateRef}
                    style={[
                      styles.input,
                      {
                        fontSize,
                        color: theme?.inputText,
                        borderColor: theme?.border,
                        backgroundColor: theme?.inputBackground,
                      },
                    ]}
                    placeholder="Expiration date (YYYY-MM-DD or MM/DD/YYYY)"
                    placeholderTextColor={theme?.textPlaceholder}
                    value={expDateText}
                    onChangeText={setExpDateText}
                    returnKeyType="done"
                    onFocus={() => focusAndScroll(expDateRef)}
                  />

                  <View collapsable={false} ref={pickBtnRef}>
                    <TouchableOpacity
                      style={[
                        styles.pickerBtn,
                        { borderColor: theme?.border, backgroundColor: theme?.inputBackground },
                      ]}
                      activeOpacity={0.85}
                      onPress={() => {
                        Keyboard.dismiss();
                        focusedRef.current = null;

                        if (!pickBtnRef.current?.measureInWindow) return;
                        pickBtnRef.current.measureInWindow((x, y, width, height) => {
                          setPickerFromRect({ x, y, width, height });
                          setPickerVisible(true);
                        });
                      }}
                    >
                      <Ionicons name="calendar" size={18} color={theme?.textPrimary} />
                      <Text style={{ marginLeft: 8, fontSize, fontWeight: "800", color: theme?.textPrimary }}>
                        Pick a date
                      </Text>
                      <View style={{ flex: 1 }} />
                      <Text style={{ fontSize: fontSize * 0.9, color: theme?.textSecondary, fontWeight: "700" }}>
                        {formatYYYYMMDDLocal(expPickedDate)}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <Popover
                    isVisible={pickerVisible && !!pickerFromRect}
                    from={pickerFromRect}
                    placement="bottom"
                    backgroundStyle={{ backgroundColor: "transparent" }}
                    popoverStyle={{ borderRadius: 16, backgroundColor: "transparent" }}
                    onRequestClose={() => setPickerVisible(false)}
                  >
                    <View style={[styles.popover, { backgroundColor: theme?.background, borderColor: theme?.border }]}>
                      <DateTimePicker
                        value={expPickedDate}
                        mode="date"
                        display={Platform.OS === "ios" ? "inline" : "default"}
                        onChange={(event, date) => {
                          if (Platform.OS !== "ios") setPickerVisible(false);
                          if (date) {
                            const local = startOfDayLocal(date);
                            setExpPickedDate(local);
                            setExpDateText(formatYYYYMMDDLocal(local));
                          }
                        }}
                      />

                      {Platform.OS === "ios" && (
                        <TouchableOpacity
                          style={[styles.doneBtn, { backgroundColor: theme?.actionButton }]}
                          activeOpacity={0.85}
                          onPress={() => setPickerVisible(false)}
                        >
                          <Text style={{ color: "#fff", fontWeight: "900", fontSize }}>Done</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </Popover>
                </>
              )}

              {expMode === "machine" && (
                <View style={[styles.disclaimer, { borderColor: theme?.border, backgroundColor: theme?.inputBackground }]}>
                  <Ionicons name="information-circle" size={18} color={theme?.textSecondary} />
                  <Text
                    style={{
                      flex: 1,
                      marginLeft: 8,
                      color: theme?.textSecondary,
                      fontSize: fontSize * 0.82,
                      fontWeight: "600",
                      lineHeight: fontSize * 1.15,
                    }}
                  >
                    Machine estimation will be filled automatically. This is a best-effort guess and may be inaccurate—always
                    use your senses and safe-handling guidelines.
                  </Text>
                </View>
              )}

              <Text style={[styles.label, { color: theme?.textSecondary, fontSize: fontSize * 0.9 }]}>
                Storage (required)
              </Text>

              <DropDownPicker
                open={openStorage}
                value={storage}
                items={storageItems}
                setOpen={setOpenStorage}
                setValue={setStorage}
                onOpen={() => openOnly("storage")}
                listMode="SCROLLVIEW"
                zIndex={4000}
                zIndexInverse={1000}
                style={[styles.dd, { backgroundColor: theme?.inputBackground, borderColor: theme?.border }]}
                dropDownContainerStyle={[
                  styles.ddContainer,
                  { backgroundColor: theme?.inputBackground, borderColor: theme?.border },
                ]}
                textStyle={{ color: theme?.inputText, fontSize }}
                searchTextInputStyle={[styles.searchInput, { borderColor: theme?.border, color: theme?.inputText }]}
                searchContainerStyle={{ borderBottomColor: theme?.border }}
              />

              <Text style={[styles.label, { color: theme?.textSecondary, fontSize: fontSize * 0.9 }]}>
                Urgency (required)
              </Text>

              <DropDownPicker
                open={openUrgency}
                value={urgency}
                items={urgencyItems}
                setOpen={setOpenUrgency}
                setValue={setUrgency}
                onOpen={() => openOnly("urgency")}
                listMode="SCROLLVIEW"
                zIndex={3000}
                zIndexInverse={2000}
                style={[styles.dd, { backgroundColor: theme?.inputBackground, borderColor: theme?.border }]}
                dropDownContainerStyle={[
                  styles.ddContainer,
                  { backgroundColor: theme?.inputBackground, borderColor: theme?.border },
                ]}
                textStyle={{ color: theme?.inputText, fontSize }}
                searchTextInputStyle={[styles.searchInput, { borderColor: theme?.border, color: theme?.inputText }]}
                searchContainerStyle={{ borderBottomColor: theme?.border }}
              />

              <Text style={[styles.label, { color: theme?.textSecondary, fontSize: fontSize * 0.9 }]}>
                Food type (required)
              </Text>

              <DropDownPicker
                open={openFoodType}
                value={foodType}
                items={foodTypeItems}
                setOpen={setOpenFoodType}
                setValue={setFoodType}
                onOpen={() => openOnly("foodType")}
                dropDownDirection="TOP"
                listMode="SCROLLVIEW"
                zIndex={2000}
                zIndexInverse={5000}
                style={[styles.dd, { backgroundColor: theme?.inputBackground, borderColor: theme?.border }]}
                dropDownContainerStyle={[
                  styles.ddContainer,
                  { backgroundColor: theme?.inputBackground, borderColor: theme?.border },
                ]}
                textStyle={{ color: theme?.inputText, fontSize }}
                searchTextInputStyle={[styles.searchInput, { borderColor: theme?.border, color: theme?.inputText }]}
                searchContainerStyle={{ borderBottomColor: theme?.border }}
              />

              <Text style={[styles.label, { color: theme?.textSecondary, fontSize: fontSize * 0.9 }]}>
                State (optional)
              </Text>

              <DropDownPicker
                open={openState}
                value={stateTag}
                items={stateItems}
                setOpen={setOpenState}
                setValue={setStateTag}
                onOpen={() => openOnly("state")}
                dropDownDirection="TOP"
                listMode="SCROLLVIEW"
                zIndex={1000}
                zIndexInverse={4000}
                style={[styles.dd, { backgroundColor: theme?.inputBackground, borderColor: theme?.border }]}
                dropDownContainerStyle={[
                  styles.ddContainer,
                  { backgroundColor: theme?.inputBackground, borderColor: theme?.border },
                ]}
                textStyle={{ color: theme?.inputText, fontSize }}
                searchTextInputStyle={[styles.searchInput, { borderColor: theme?.border, color: theme?.inputText }]}
                searchContainerStyle={{ borderBottomColor: theme?.border }}
              />
            </ScrollView>

            <View style={styles.buttons}>
              <TouchableOpacity
                style={[styles.btn, { backgroundColor: theme?.cancelButton }]}
                onPress={() => {
                  closeAll();
                  focusedRef.current = null;
                  Keyboard.dismiss();
                  onCancel?.();
                }}
              >
                <Text style={{ fontSize, color: theme?.textPrimary }}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.btn, { backgroundColor: theme?.actionButton }]}
                onPress={handleSubmit}
              >
                <Text style={{ fontSize, color: "#fff" }}>{isEdit ? submitLabelEdit : submitLabelAdd}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  sheet: { padding: 20, borderRadius: 16, width: "90%", maxHeight: "85%", flex: 1 },
  title: { fontWeight: "bold", marginBottom: 15, textAlign: "center" },

  input: { borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 12 },
  label: { marginTop: 4, marginBottom: 6 },

  dd: { borderWidth: 1, borderRadius: 8, marginBottom: 12, minHeight: 44 },
  ddContainer: { borderWidth: 1, borderRadius: 8 },
  searchInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10 },

  buttons: { flexDirection: "row", justifyContent: "space-between" },
  btn: {
    flex: 1,
    padding: 12,
    marginHorizontal: 5,
    borderRadius: 8,
    alignItems: "center",
  },

  segment: {
    flexDirection: "row",
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 12,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: StyleSheet.hairlineWidth,
  },

  pickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: -2,
    marginBottom: 12,
  },

  popover: {
    width: 340,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  doneBtn: {
    margin: 8,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
  },

  disclaimer: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: -2,
    marginBottom: 12,
  },
});
