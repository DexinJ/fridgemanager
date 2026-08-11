import { Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";

export default function ImageViewer({
  images = [],
  imageIndex = 0,
  visible,
  onRequestClose,
  backgroundColor = "rgba(0,0,0,0.9)",
}) {
  const uri = images[imageIndex]?.uri;
  return (
    <Modal
      transparent
      visible={Boolean(visible)}
      animationType="fade"
      onRequestClose={onRequestClose}
      accessibilityViewIsModal
    >
      <View style={[styles.overlay, { backgroundColor }]}>
        <Pressable
          onPress={onRequestClose}
          accessibilityRole="button"
          accessibilityLabel="Close image viewer"
          style={styles.close}
        >
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
        {uri ? (
          <Image
            source={{ uri }}
            resizeMode="contain"
            style={styles.image}
            accessibilityLabel="Attached image"
          />
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  image: {
    width: "100%",
    height: "85%",
  },
  close: {
    alignSelf: "flex-end",
    padding: 12,
  },
  closeText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
