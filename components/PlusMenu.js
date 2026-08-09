import { Ionicons } from "@expo/vector-icons";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import React, { useContext, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { GlobalContext } from "../context/GlobalContext";

const MAX_IMAGE_DIMENSION = 1_600;
const MAX_IMAGE_DATA_URL_LENGTH = 6 * 1024 * 1024;

export default function PlusMenu({ onSend }) {
  const { settings, theme } = useContext(GlobalContext);
  const fontSize = settings?.ux?.fontSize || 16;
  const [menuOpen, setMenuOpen] = useState(false);

  async function toJpegBase64(asset) {
    const ctx = ImageManipulator.ImageManipulator.manipulate(asset.uri);
    const width = Number(asset.width) || 0;
    const height = Number(asset.height) || 0;
    const longestEdge = Math.max(width, height);

    if (longestEdge > MAX_IMAGE_DIMENSION) {
      const scale = MAX_IMAGE_DIMENSION / longestEdge;
      ctx.resize({
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
      });
    }

    const imageRef = await ctx.renderAsync();
    const result = await imageRef.saveAsync({
      format: ImageManipulator.SaveFormat.JPEG,
      compress: 0.65,
      base64: true,
    });
    if (!result.base64) throw new Error("Failed to create base64 image");
    const dataUrl = `data:image/jpeg;base64,${result.base64}`;
    if (dataUrl.length > MAX_IMAGE_DATA_URL_LENGTH) {
      throw new Error("The selected image is too large to send.");
    }
    return dataUrl;
  }

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") return alert("Camera permissions are required.");

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });

    try {
      if (!result.canceled) {
        const asset = result.assets[0];
        const dataUrl = await toJpegBase64(asset);
        onSend({ text: null, imageUri: dataUrl, isUser: true });
      }
    } catch (error) {
      Alert.alert("Image", error?.message || "The photo could not be prepared.");
    } finally {
      setMenuOpen(false);
    }
  };

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return alert("Media library permissions are required.");

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
    });

    try {
      if (!result.canceled) {
        const asset = result.assets[0];
        const dataUrl = await toJpegBase64(asset);
        onSend({ text: null, imageUri: dataUrl, isUser: true });
      }
    } catch (error) {
      Alert.alert("Image", error?.message || "The image could not be prepared.");
    } finally {
      setMenuOpen(false);
    }
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
