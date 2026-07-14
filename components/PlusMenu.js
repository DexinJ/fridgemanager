import { Ionicons } from "@expo/vector-icons";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import React, { useContext, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { GlobalContext } from "../context/GlobalContext";


export default function PlusMenu({ onSend }) {
  const { settings, theme } = useContext(GlobalContext);
  const fontSize = settings?.ux?.fontSize || 16;
  const [menuOpen, setMenuOpen] = useState(false);

  async function toJpegBase64(uri) {
    const ctx = ImageManipulator.ImageManipulator.manipulate(uri); // or ImageManipulator.manipulate(uri)
    console.log("ctx");
    const imageRef = await ctx.renderAsync();
    console.log("imageRef");
    const result = await imageRef.saveAsync({
      format: ImageManipulator.SaveFormat.JPEG,
      compress: 0.7,
      base64: true,
    });
    console.log("result: ");
    if (!result.base64) throw new Error("Failed to create base64 image");
    return `data:image/jpeg;base64,${result.base64}`;
  }

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") return alert("Camera permissions are required.");

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      const dataUrl = await toJpegBase64(asset.uri);
      onSend({ text: null, imageUri: dataUrl, isUser: true });
    }
    setMenuOpen(false);
  };

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return alert("Media library permissions are required.");

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });

    if (!result.canceled) {
      const asset = result.assets[0];
      const dataUrl = await toJpegBase64(asset.uri);
      onSend({ text: null, imageUri: dataUrl, isUser: true });
    }
    setMenuOpen(false);
  };

  return (
    <View>
      {/* Floating + button */}
        <TouchableOpacity
        style={[
            styles.plusButton,
            {
            padding: fontSize * 0.6,
            backgroundColor: theme.actionButton, // ✅ use from theme
            },
        ]}
        onPress={() => setMenuOpen(!menuOpen)}
        >
        <Ionicons
            name="add"
            size={fontSize * 1.2}
            color="#fff" // always white for contrast
        />
        </TouchableOpacity>

      {/* Dropdown menu */}
      {menuOpen && (
        <View
          style={[
            styles.menu,
            { backgroundColor: theme.card, minWidth: Math.max(fontSize * 10, 140) },
          ]}
        >
          <TouchableOpacity
            style={[
              styles.menuItem,
              {
                paddingVertical: fontSize * 0.6,
                paddingHorizontal: fontSize * 0.5,
                backgroundColor: theme.background,
              },
            ]}
            onPress={takePhoto}
          >
            <Ionicons name="camera" size={fontSize} color={theme.textPrimary} />
            <Text style={[styles.menuText, { fontSize, color: theme.textPrimary }]} numberOfLines={1}>
              Take a Photo
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.menuItem,
              {
                paddingVertical: fontSize * 0.6,
                paddingHorizontal: fontSize * 0.5,
                backgroundColor: theme.background,
              },
            ]}
            onPress={pickPhoto}
          >
            <Ionicons name="image" size={fontSize} color={theme.textPrimary} />
            <Text style={[styles.menuText, { fontSize, color: theme.textPrimary }]} numberOfLines={1}>
              Pick from Gallery
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  plusButton: {
    borderRadius: 20,
    marginRight: 5,
  },
  menu: {
    position: "absolute",
    bottom: 50,
    left: 10,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 5,
  },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 6,
  },
  menuText: {
    marginLeft: 12,
    flexGrow: 1,
    flexShrink: 0,
  },
});
