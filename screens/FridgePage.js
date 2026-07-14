import React from "react";
import { StyleSheet, View } from "react-native";
import FridgeList from "../components/FridgeList";
import Header from "../components/Header";

export default function FridgePage() {
  const mockItems = ["Milk", "Eggs", "Carrots", "Cheese"];

  return (
    <View style={styles.container}>
      <Header />
      <FridgeList items={mockItems} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#fff" },
});
