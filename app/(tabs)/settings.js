// SettingsScreen.js (FULL paste-in replacement)
// - Adds urgencyDays controls (from GlobalContext) under Expiration Reminder
// - Urgency sliders update LIVE while sliding
// - Updates username locally (settings.user.name) AND on backend
// - Adds Logout and permanent Delete Account buttons
// Assumes:
//   1) you have useAuth() that exposes { user, signOut } + user.getIdToken()
//   2) your backend has PATCH /api/users/me { name }
//   3) your backend has DELETE /api/users/:uid
//   4) you have API_BASE_URL set (env or constants)

import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { useNavigation } from "@react-navigation/native";
import { useRouter } from "expo-router";
import React, {
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Modal,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { clearChatData } from "../../api/memoryManager";
import { useAuth } from "../../auth/useAuth";
import { HeaderWithHiddenButton } from "../../components/Header";
import { GlobalContext } from "../../context/GlobalContext";

const { width } = Dimensions.get("window");

// Put your API base URL somewhere central; adjust as needed.
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || "http://192.168.0.163:3000";

export default function SettingsScreen() {
  const {
    settings,
    updateSetting,
    theme,
    clearAllData,
    setMessages,
    setSummary,

    // Urgency thresholds from GlobalContext
    urgencyDays,
    setUrgencyDays,
  } = useContext(GlobalContext);

  const { user, signOut, loggedIn } = useAuth();

  const [currentSubMenu, setCurrentSubMenu] = useState(null);
  const anim = useRef(new Animated.Value(0)).current;
  const navigation = useNavigation();
  const [opened, setOpened] = useState(false);

  const [remindDays, setRemindDays] = useState(
    settings?.expiration?.remindDays ?? 5
  );

  const [modalVisible, setModalVisible] = useState(false);
  const [tempName, setTempName] = useState(
    settings?.user?.name ?? "freeUser"
  );
  const [savingName, setSavingName] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const router = useRouter();
  const fontSize = settings?.ux?.fontSize ?? 16;

  const stylesWithFont = useMemo(
    () => dynamicStyles(theme, fontSize),
    [theme, fontSize]
  );

  const categories = [
    { key: "user", title: "Account", icon: "person-outline" },
    { key: "ux", title: "Appearance", icon: "color-palette-outline" },
    {
      key: "notifications",
      title: "Notifications",
      icon: "notifications-outline",
    },
    {
      key: "fridge",
      title: "Expiration Reminder",
      icon: "time-outline",
    },
    {
      key: "privacy",
      title: "Privacy",
      icon: "shield-checkmark-outline",
    },
    {
      key: "advanced",
      title: "Advanced",
      icon: "construct-outline",
    },
  ];

  async function updateUsernameOnBackend(name) {
    if (!user) {
      throw new Error("Not logged in");
    }

    const token = await user.getIdToken();

    const resp = await fetch(`${API_BASE_URL}/api/users/me`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(text || `Failed to update name (${resp.status})`);
    }

    return resp.json().catch(() => ({}));
  }

  const saveName = async () => {
    const next = String(tempName || "").trim();

    if (!next) {
      Alert.alert("Name required", "Please enter a username.");
      return;
    }

    setSavingName(true);

    // Update locally immediately.
    const prev = settings?.user?.name ?? "freeUser";
    updateSetting("user", "name", next);

    try {
      // Update backend.
      await updateUsernameOnBackend(next);
      setModalVisible(false);
    } catch (e) {
      // Roll back local username if backend update fails.
      updateSetting("user", "name", prev);

      Alert.alert(
        "Update failed",
        e?.message || "Could not update username on server."
      );
    } finally {
      setSavingName(false);
    }
  };

  const handleLogout = () => {
    Alert.alert("Log out", "Are you sure you want to log out?", [
      {
        text: "Cancel",
        style: "cancel",
      },
      {
        text: "Log out",
        style: "destructive",
        onPress: async () => {
          try {
            await signOut?.();
          } catch (e) {
            Alert.alert(
              "Logout failed",
              e?.message || "Could not log out."
            );
          }
        },
      },
    ]);
  };

  /**
   * Sends an authenticated request to the backend.
   *
   * The backend should:
   * 1. Verify the Firebase bearer token.
   * 2. Ensure the route UID matches the token UID.
   * 3. Delete the user's database rows.
   * 4. Delete the Firebase Authentication account.
   */
  const deleteAccountFromBackend = async () => {
    if (!user) {
      throw new Error(
        "You must be logged in to delete your account."
      );
    }

    // Force-refresh the ID token before making this destructive request.
    const token = await user.getIdToken(true);

    const resp = await fetch(
      `${API_BASE_URL}/api/users/${encodeURIComponent(user.uid)}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok) {
      throw new Error(
        data?.error || `Failed to delete account (${resp.status})`
      );
    }

    return data;
  };

  const handleDeleteAccount = () => {
    if (!user || deletingAccount) {
      return;
    }

    Alert.alert(
      "Delete account?",
      "This permanently deletes your account and clears your fridge items, shopping list, chat history, and settings from this device. This cannot be undone.",
      [
        {
          text: "Cancel",
          style: "cancel",
        },
        {
          text: "Delete Account",
          style: "destructive",
          onPress: async () => {
            setDeletingAccount(true);

            try {
              // Delete the server profile and Firebase Auth user first.
              await deleteAccountFromBackend();

              // Clear all app data stored locally.
              await Promise.resolve(clearAllData?.());

              // Clear chat-specific storage and context state.
              await Promise.resolve(
                clearChatData(setMessages, setSummary)
              );

              /*
               * The Firebase account was already deleted by the backend.
               * Calling signOut clears any remaining local Firebase session.
               */
              try {
                await signOut?.();
              } catch (signOutError) {
                console.warn(
                  "[delete account] local sign-out warning",
                  signOutError
                );
              }

              // Return to the authentication screen.
              router.replace("/(auth)/AuthScreen");
            } catch (e) {
              console.error("[delete account]", e);

              Alert.alert(
                "Delete failed",
                e?.message || "Could not delete your account."
              );
            } finally {
              setDeletingAccount(false);
            }
          },
        },
      ]
    );
  };

  const openSubMenu = (key) => {
    setCurrentSubMenu(key);
    setOpened(true);

    Animated.timing(anim, {
      toValue: -width,
      duration: 300,
      useNativeDriver: true,
    }).start();
  };

  const goBack = () => {
    setOpened(false);

    Animated.timing(anim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
    }).start(() => setCurrentSubMenu(null));
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      header: () => (
        <HeaderWithHiddenButton
          title="Settings"
          hideButton={!opened}
          onPress={goBack}
        />
      ),
    });
  }, [navigation, opened, theme]);

  const CustomButton = ({
    title,
    onPress,
    fontSize: buttonFontSize,
    color,
  }) => (
    <TouchableOpacity
      onPress={onPress}
      style={{
        borderRadius: 6,
        marginVertical: 5,
        alignItems: "center",
      }}
      disabled={!onPress}
    >
      <Text
        style={{
          fontSize: buttonFontSize,
          color: color || theme.accent,
          fontWeight: "600",
          opacity: onPress ? 1 : 0.6,
        }}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );

  const renderMainMenu = () => (
    <View style={{ width }}>
      {categories.map((cat) => (
        <TouchableOpacity
          key={cat.key}
          style={stylesWithFont.sectionHeader}
          onPress={() => openSubMenu(cat.key)}
        >
          <Ionicons
            name={cat.icon}
            size={fontSize * 1.25}
            color={theme.accent}
          />

          <Text style={stylesWithFont.sectionTitle}>
            {cat.title}
          </Text>

          <Ionicons
            name="chevron-forward"
            size={fontSize * 1.25}
            color={theme.textSecondary}
          />
        </TouchableOpacity>
      ))}
    </View>
  );

  // Urgency sliders: live update during sliding and monotonic clamp on release.
  const renderUrgencySliders = () => {
    const fallback = {
      expired: 0,
      eat_first: 2,
      use_soon: 7,
      lasts_a_while: 30,
      long_keeper: 180,
    };

    const U = urgencyDays || fallback;

    // Live updates during drag.
    const setLive = (key, val) => {
      const v = Number(val);

      setUrgencyDays((prev) => ({
        ...(prev || U || fallback),
        expired: 0,
        [key]: v,
      }));
    };

    // Clamp and enforce monotonic ordering after release.
    const setMonotonic = (patchFn) => {
      setUrgencyDays((prev) => {
        const cur = prev || U || fallback;
        const next = patchFn(cur);

        const eat_first = Math.max(
          1,
          Number(next.eat_first ?? cur.eat_first ?? 2)
        );

        const use_soon = Math.max(
          eat_first,
          Number(next.use_soon ?? cur.use_soon ?? 7)
        );

        const lasts_a_while = Math.max(
          use_soon,
          Number(
            next.lasts_a_while ?? cur.lasts_a_while ?? 30
          )
        );

        const long_keeper = Math.max(
          lasts_a_while,
          Number(next.long_keeper ?? cur.long_keeper ?? 180)
        );

        return {
          expired: 0,
          eat_first,
          use_soon,
          lasts_a_while,
          long_keeper,
        };
      });
    };

    return (
      <View style={stylesWithFont.settingColumn}>
        <Text
          style={[
            stylesWithFont.label,
            {
              fontWeight: "700",
              marginBottom: 10,
            },
          ]}
        >
          Urgency thresholds (days remaining)
        </Text>

        <View style={{ marginBottom: 12 }}>
          <Text style={stylesWithFont.label}>
            Expired: 0 days
          </Text>

          <Text
            style={[
              stylesWithFont.value,
              {
                marginTop: 4,
              },
            ]}
          >
            (Automatically when expiration date is in the past)
          </Text>
        </View>

        <View style={{ marginBottom: 12 }}>
          <Text style={stylesWithFont.label}>
            Eat first: {U.eat_first} days
          </Text>

          <Slider
            style={{ width: "100%" }}
            value={U.eat_first}
            onValueChange={(val) => setLive("eat_first", val)}
            onSlidingComplete={(val) =>
              setMonotonic((cur) => ({
                ...cur,
                eat_first: val,
              }))
            }
            minimumValue={1}
            maximumValue={14}
            step={1}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
          />
        </View>

        <View style={{ marginBottom: 12 }}>
          <Text style={stylesWithFont.label}>
            Use soon: {U.use_soon} days
          </Text>

          <Slider
            style={{ width: "100%" }}
            value={U.use_soon}
            onValueChange={(val) => setLive("use_soon", val)}
            onSlidingComplete={(val) =>
              setMonotonic((cur) => ({
                ...cur,
                use_soon: val,
              }))
            }
            minimumValue={2}
            maximumValue={30}
            step={1}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
          />
        </View>

        <View style={{ marginBottom: 12 }}>
          <Text style={stylesWithFont.label}>
            Lasts a while: {U.lasts_a_while} days
          </Text>

          <Slider
            style={{ width: "100%" }}
            value={U.lasts_a_while}
            onValueChange={(val) =>
              setLive("lasts_a_while", val)
            }
            onSlidingComplete={(val) =>
              setMonotonic((cur) => ({
                ...cur,
                lasts_a_while: val,
              }))
            }
            minimumValue={7}
            maximumValue={90}
            step={1}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
          />
        </View>

        <View style={{ marginBottom: 4 }}>
          <Text style={stylesWithFont.label}>
            Long keeper: {U.long_keeper} days
          </Text>

          <Slider
            style={{ width: "100%" }}
            value={U.long_keeper}
            onValueChange={(val) => setLive("long_keeper", val)}
            onSlidingComplete={(val) =>
              setMonotonic((cur) => ({
                ...cur,
                long_keeper: val,
              }))
            }
            minimumValue={30}
            maximumValue={365}
            step={5}
            minimumTrackTintColor={theme.accent}
            maximumTrackTintColor={theme.border}
          />
        </View>
      </View>
    );
  };

  const renderSubMenu = (key) => {
    switch (key) {
      case "user":
        return (
          <View style={stylesWithFont.subMenu}>
            <View style={stylesWithFont.settingColumn}>
              <Text style={stylesWithFont.label}>
                User Name:{" "}
                {settings?.user?.name ?? "freeUser"}
              </Text>

              {loggedIn ? (
                <>
                  <CustomButton
                    title="Log out"
                    onPress={
                      deletingAccount ? null : handleLogout
                    }
                    fontSize={fontSize}
                    color={theme.danger}
                  />

                  <CustomButton
                    title={
                      deletingAccount
                        ? "Deleting Account..."
                        : "Delete Account"
                    }
                    onPress={
                      deletingAccount
                        ? null
                        : handleDeleteAccount
                    }
                    fontSize={fontSize}
                    color={theme.danger}
                  />

                  {deletingAccount ? (
                    <View style={{ paddingVertical: 8 }}>
                      <ActivityIndicator />
                    </View>
                  ) : null}
                </>
              ) : (
                <CustomButton
                  title="Log In/Sign Up"
                  onPress={() =>
                    router.push("/(auth)/AuthScreen")
                  }
                  fontSize={fontSize}
                  color={theme.danger}
                />
              )}

              <Modal
                visible={modalVisible}
                animationType="fade"
                transparent={true}
                onRequestClose={() => {
                  if (!savingName) {
                    setModalVisible(false);
                  }
                }}
              >
                <View style={stylesWithFont.modalBackground}>
                  <View style={stylesWithFont.modalContainer}>
                    <Text style={stylesWithFont.label}>
                      Enter new name:
                    </Text>

                    <TextInput
                      style={stylesWithFont.input}
                      value={tempName}
                      onChangeText={setTempName}
                      placeholder="Your name"
                      placeholderTextColor={theme.textPlaceholder}
                      returnKeyType="done"
                      onSubmitEditing={saveName}
                      editable={!savingName}
                    />

                    {savingName ? (
                      <View style={{ paddingVertical: 8 }}>
                        <ActivityIndicator />
                      </View>
                    ) : null}

                    <CustomButton
                      title={
                        savingName ? "Saving..." : "Save"
                      }
                      onPress={savingName ? null : saveName}
                      fontSize={fontSize}
                    />

                    <CustomButton
                      title="Cancel"
                      onPress={
                        savingName
                          ? null
                          : () => setModalVisible(false)
                      }
                      fontSize={fontSize}
                    />
                  </View>
                </View>
              </Modal>
            </View>
          </View>
        );

      case "ux":
        return (
          <View style={stylesWithFont.subMenu}>
            <View style={stylesWithFont.settingRow}>
              <Text style={stylesWithFont.label}>
                Use System Theme
              </Text>

              <Switch
                value={!!settings?.ux?.systemTheme}
                onValueChange={(val) =>
                  updateSetting("ux", "systemTheme", val)
                }
                trackColor={{
                  true: theme.actionButton,
                  false: theme.border,
                }}
              />
            </View>

            <View style={stylesWithFont.settingRow}>
              <Text style={stylesWithFont.label}>
                Dark Mode
              </Text>

              <Switch
                value={!!settings?.ux?.darkMode}
                disabled={!!settings?.ux?.systemTheme}
                onValueChange={(val) =>
                  updateSetting("ux", "darkMode", val)
                }
                trackColor={{
                  true: theme.actionButton,
                  false: theme.border,
                }}
              />
            </View>

            <View style={stylesWithFont.settingRow}>
              <Text style={stylesWithFont.label}>
                Font Size: {settings?.ux?.fontSize ?? 16}
              </Text>

              <Slider
                style={{ flex: 1 }}
                value={settings?.ux?.fontSize ?? 16}
                onValueChange={(val) =>
                  updateSetting("ux", "fontSize", val)
                }
                minimumValue={12}
                maximumValue={24}
                step={1}
                minimumTrackTintColor={theme.accent}
                maximumTrackTintColor={theme.border}
              />
            </View>
          </View>
        );

      case "notifications":
        return (
          <View style={stylesWithFont.subMenu}>
            <View style={stylesWithFont.settingRow}>
              <Text style={stylesWithFont.label}>
                Daily Reminders
              </Text>

              <Switch
                value={
                  !!settings?.notifications?.dailyReminders
                }
                onValueChange={(val) =>
                  updateSetting(
                    "notifications",
                    "dailyReminders",
                    val
                  )
                }
                trackColor={{
                  true: theme.actionButton,
                  false: theme.border,
                }}
              />
            </View>
          </View>
        );

      case "fridge":
        return (
          <View style={stylesWithFont.subMenu}>
            <View style={stylesWithFont.settingRow}>
              <Text style={stylesWithFont.label}>
                Expiration Alerts
              </Text>

              <Switch
                value={
                  !!settings?.expiration?.expirationAlerts
                }
                onValueChange={(val) =>
                  updateSetting(
                    "expiration",
                    "expirationAlerts",
                    val
                  )
                }
                trackColor={{
                  true: theme.accent,
                  false: theme.border,
                }}
              />
            </View>

            <View style={stylesWithFont.settingRow}>
              <Text style={stylesWithFont.label}>
                Alert Time: {remindDays} days
              </Text>

              <Slider
                style={{ flex: 1 }}
                value={
                  settings?.expiration?.remindDays ?? 5
                }
                onSlidingComplete={(val) =>
                  updateSetting(
                    "expiration",
                    "remindDays",
                    val
                  )
                }
                onValueChange={(val) =>
                  setRemindDays(val)
                }
                minimumValue={1}
                maximumValue={31}
                step={1}
                minimumTrackTintColor={theme.accent}
                maximumTrackTintColor={theme.border}
              />
            </View>

            {renderUrgencySliders()}
          </View>
        );

      case "privacy":
        return (
          <View style={stylesWithFont.subMenu}>
            <View style={stylesWithFont.settingRow}>
              <Text style={stylesWithFont.label}>
                Incognito Mode
              </Text>

              <Switch
                value={!!settings?.privacy?.incognito}
                onValueChange={(val) =>
                  updateSetting(
                    "privacy",
                    "incognito",
                    val
                  )
                }
                trackColor={{
                  true: theme.actionButton,
                  false: theme.border,
                }}
              />
            </View>

            <View style={stylesWithFont.settingColumn}>
              <CustomButton
                title="Clear All Data"
                onPress={() => {
                  Alert.alert(
                    "Confirm Reset",
                    "Are you sure you want to clear all data? This cannot be undone.",
                    [
                      {
                        text: "Cancel",
                        style: "cancel",
                      },
                      {
                        text: "Clear",
                        style: "destructive",
                        onPress: () => clearAllData(),
                      },
                    ]
                  );
                }}
                fontSize={fontSize}
                color={theme.danger}
              />

              <CustomButton
                title="Clear Chat Messages"
                onPress={() => {
                  Alert.alert(
                    "Confirm Reset",
                    "Are you sure you want to clear all chat messages? This cannot be undone.",
                    [
                      {
                        text: "Cancel",
                        style: "cancel",
                      },
                      {
                        text: "Clear",
                        style: "destructive",
                        onPress: () =>
                          clearChatData(
                            setMessages,
                            setSummary
                          ),
                      },
                    ]
                  );
                }}
                fontSize={fontSize}
                color={theme.danger}
              />
            </View>
          </View>
        );

      case "advanced":
        return (
          <View style={stylesWithFont.subMenu}>
            <View style={stylesWithFont.settingRow}>
              <Text style={stylesWithFont.label}>
                Model Choice
              </Text>

              <Text style={stylesWithFont.value}>
                {settings?.advanced?.modelChoice ??
                  "default"}
              </Text>
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <View
      style={{
        flex: 1,
        overflow: "hidden",
        backgroundColor: theme.background,
      }}
    >
      <Animated.View
        style={{
          flexDirection: "row",
          width: width * 2,
          transform: [{ translateX: anim }],
        }}
      >
        {renderMainMenu()}

        {currentSubMenu && (
          <View style={{ width }}>
            {renderSubMenu(currentSubMenu)}
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const dynamicStyles = (theme, fontSize) =>
  StyleSheet.create({
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      paddingVertical: 15,
      paddingHorizontal: 15,
      backgroundColor: theme.card,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },

    sectionTitle: {
      flex: 1,
      fontSize,
      fontWeight: "600",
      marginLeft: 10,
      color: theme.textPrimary,
    },

    settingRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 15,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },

    settingColumn: {
      paddingHorizontal: 15,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },

    label: {
      fontSize,
      color: theme.textPrimary,
    },

    value: {
      fontSize,
      color: theme.textSecondary,
    },

    subMenu: {
      flex: 1,
      paddingTop: 20,
    },

    modalBackground: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: theme.modalBackground,
    },

    modalContainer: {
      width: 300,
      padding: 20,
      backgroundColor: theme.card,
      borderRadius: 10,
      flexDirection: "column",
      justifyContent: "space-around",
    },

    input: {
      borderBottomWidth: 1,
      borderBottomColor: theme.border,
      marginBottom: 10,
      fontSize,
      color: theme.textPrimary,
    },
  });