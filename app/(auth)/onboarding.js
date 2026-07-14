import { router } from "expo-router";
import React, { useContext, useMemo, useRef, useState } from "react";
import {
  Animated,
  Dimensions,
  Easing,
  Platform,
  Pressable,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from "react-native";
import { GlobalContext } from "../../context/GlobalContext";

const { width } = Dimensions.get("window");

// ✅ Set these to match your real auth routes
const ROUTE_SIGN_UP = "/(auth)/sign-up";
const ROUTE_SIGN_IN = "/(auth)/sign-in";

const PAGES = [
  {
    emoji: "🧊",
    title: "Welcome to Fridge Manager",
    body: "Track what you own, avoid waste, and plan meals smarter.",
  },
  {
    emoji: "🥗",
    title: "Your fridge, organized",
    body: "Add items, track expiration, and see what to eat first.",
  },
  {
    emoji: "🛒",
    title: "Shopping list, synced",
    body: "Move items from shopping → fridge in one tap.",
  },
  {
    emoji: "⚡️",
    title: "Smart tags & warnings",
    body: "We suggest storage, urgency, and food type so nothing goes bad unnoticed.",
  },
  {
    emoji: "🔐",
    title: "Create your account",
    body: "Sync your lists and settings across devices.",
    isAuth: true,
  },
];

export default function OnboardingScreen() {
  const {theme} = useContext(GlobalContext);
  const fontSize = 16;
  const listRef = useRef(null);
  const scrollX = useRef(new Animated.Value(0)).current;

  const [index, setIndex] = useState(0);
  const [isAdvancing, setIsAdvancing] = useState(false);

  const isLast = index === PAGES.length - 1;
  const progress = useMemo(() => (index + 1) / PAGES.length, [index]);

  // Optional: a subtle "float" animation you can reuse for an image later
  const floatY = useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatY, {
          toValue: -6,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(floatY, {
          toValue: 0,
          duration: 1200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [floatY]);

  async function goToAuth(path) {
    router.replace(path);
  }

  function back() {
    if (index === 0 || isAdvancing) return;
    const prevIndex = index - 1;
    listRef.current?.scrollToOffset({ offset: prevIndex * width, animated: true });
    setIndex(prevIndex);
  }

  function next() {
    if (isLast || isAdvancing) return;

    // ✅ “Duolingo-ish” pacing: slight delay before moving to next page
    setIsAdvancing(true);
    const nextIndex = index + 1;

    setTimeout(() => {
      listRef.current?.scrollToOffset({ offset: nextIndex * width, animated: true });
      setIndex(nextIndex);

      // small cooldown to prevent double taps
      setTimeout(() => setIsAdvancing(false), 250);
    }, 220);
  }

  const topPad = Platform.OS === "android" ? 6 : 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]}>
      <StatusBar
        barStyle={theme.background === "#FFFFFF" ? "dark-content" : "light-content"}
      />

      <View style={[styles.container, { backgroundColor: theme.background, paddingTop: topPad }]}>
        {/* Header: Back + progress (NO SKIP) */}
        <View style={styles.headerRow}>
          <Pressable
            onPress={back}
            disabled={index === 0 || isAdvancing}
            hitSlop={10}
            style={({ pressed }) => [
              styles.headerBtn,
              { opacity: index === 0 ? 0 : pressed ? 0.65 : 1 },
            ]}
          >
            <Text style={[styles.headerBtnText, { color: theme.actionButton }]}>Back</Text>
          </Pressable>

          <View
            style={[
              styles.progressTrack,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <View
              style={[
                styles.progressFill,
                { backgroundColor: theme.actionButton, width: `${Math.round(progress * 100)}%` },
              ]}
            />
          </View>

          {/* right spacer to balance layout */}
          <View style={{ width: 54 }} />
        </View>

        {/* Animated pages */}
        <Animated.FlatList
          ref={listRef}
          data={PAGES}
          keyExtractor={(_, i) => String(i)}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: true }
          )}
          onMomentumScrollEnd={(e) => {
            const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
            setIndex(newIndex);
          }}
          renderItem={({ item, index: i }) => {
            const inputRange = [(i - 1) * width, i * width, (i + 1) * width];

            // Card animation: scale + fade + slight lift
            const cardScale = scrollX.interpolate({
              inputRange,
              outputRange: [0.92, 1, 0.92],
              extrapolate: "clamp",
            });

            const cardOpacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.35, 1, 0.35],
              extrapolate: "clamp",
            });

            const cardTranslateY = scrollX.interpolate({
              inputRange,
              outputRange: [16, 0, 16],
              extrapolate: "clamp",
            });

            // Mascot/emoji animation: float a bit more on the active page
            const emojiScale = scrollX.interpolate({
              inputRange,
              outputRange: [0.9, 1, 0.9],
              extrapolate: "clamp",
            });

            return (
              <View style={[styles.page, { width }]}>
                {/* Mascot circle */}
                <Animated.View
                  style={[
                    styles.emojiWrap,
                    {
                      backgroundColor: theme.card,
                      borderColor: theme.border,
                      transform: [{ scale: emojiScale }, { translateY: floatY }],
                    },
                  ]}
                >
                  <Text style={styles.emojiText}>{item.emoji}</Text>

                  {/*
                    ✅ HOW TO ADD AN ANIMATED IMAGE LATER:
                    1) Put an asset in /assets (e.g. assets/mascot.png)
                    2) Uncomment this and tweak sizes:

                    <Animated.Image
                      source={require("../assets/mascot.png")}
                      style={{
                        width: 64,
                        height: 64,
                        transform: [{ translateY: floatY }, { scale: emojiScale }],
                      }}
                      resizeMode="contain"
                    />

                    You can also animate opacity/rotation with interpolate just like the card.
                  */}
                </Animated.View>

                {/* Card */}
                <Animated.View
                  style={[
                    styles.card,
                    {
                      backgroundColor: theme.card,
                      borderColor: theme.border,
                      opacity: cardOpacity,
                      transform: [{ translateY: cardTranslateY }, { scale: cardScale }],
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.title,
                      { color: theme.textPrimary, fontSize: Math.max(22, fontSize + 10) },
                    ]}
                  >
                    {item.title}
                  </Text>

                  <Text
                    style={[
                      styles.body,
                      { color: theme.textSecondary, fontSize: Math.max(15, fontSize) },
                    ]}
                  >
                    {item.body}
                  </Text>

                  <View style={[styles.tipRow, { borderTopColor: theme.border }]}>
                    <Text style={[styles.tipText, { color: theme.textPlaceholder }]}>
                      Tip: You can change settings anytime.
                    </Text>
                  </View>
                </Animated.View>
              </View>
            );
          }}
        />

        {/* Footer */}
        <View style={styles.footer}>
          {!isLast ? (
            <TouchableOpacity
              style={[
                styles.primaryBtn,
                { backgroundColor: theme.actionButton, opacity: isAdvancing ? 0.75 : 1 },
              ]}
              onPress={next}
              activeOpacity={0.85}
              disabled={isAdvancing}
            >
              <Text style={[styles.primaryBtnText, { color: theme.background }]}>
                {isAdvancing ? "..." : "Continue"}
              </Text>
            </TouchableOpacity>
          ) : (
            <>
              {/* Create account + Login only (no guest, no skip) */}
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: theme.actionButton }]}
                onPress={() => goToAuth(ROUTE_SIGN_UP)}
                activeOpacity={0.85}
              >
                <Text style={[styles.primaryBtnText, { color: theme.background }]}>
                  Create account
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.secondaryBtnFull,
                  { borderColor: theme.border, backgroundColor: theme.background },
                ]}
                onPress={() => goToAuth(ROUTE_SIGN_IN)}
                activeOpacity={0.85}
              >
                <Text style={[styles.secondaryBtnText, { color: theme.textPrimary }]}>
                  Log in
                </Text>
              </TouchableOpacity>

              {/* If you want: allow “Later” by sending them to tabs,
                  BUT you asked no skipping, so leaving it out. */}
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const CARD_MAX_WIDTH = 520;

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flex: 1 },

  headerRow: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerBtn: {
    minWidth: 54,
    paddingVertical: 6,
  },
  headerBtnText: {
    fontSize: 15,
    fontWeight: "900",
  },

  progressTrack: {
    flex: 1,
    height: 10,
    borderRadius: 999,
    borderWidth: 1,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: 999,
  },

  page: {
    flex: 1,
    paddingHorizontal: 18,
    justifyContent: "center",
    alignItems: "center",
    paddingBottom: 10,
  },

  emojiWrap: {
    width: 96,
    height: 96,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emojiText: {
    fontSize: 44,
  },

  card: {
    width: "100%",
    maxWidth: CARD_MAX_WIDTH,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 12,
  },

  title: {
    fontWeight: "900",
    lineHeight: 30,
    marginBottom: 10,
  },
  body: {
    lineHeight: 22,
  },

  tipRow: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
  },
  tipText: {
    fontSize: 12,
    fontWeight: "800",
  },

  footer: {
    paddingHorizontal: 18,
    paddingBottom: 18,
    paddingTop: 10,
    gap: 10,
  },

  primaryBtn: {
    height: 54,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 0.2,
  },

  secondaryBtnFull: {
    height: 50,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnText: {
    fontSize: 15,
    fontWeight: "900",
  },
});