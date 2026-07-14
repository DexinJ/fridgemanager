import { useContext, useEffect, useMemo, useState } from "react";
import {
  Image,
  Linking,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import ImageViewing from "react-native-image-viewing";
import { getLinkPreview } from "link-preview-js";
import { GlobalContext } from "../context/GlobalContext";

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export default function MessageBubble({ text, imageUri, isUser }) {
  const { settings, theme } = useContext(GlobalContext);
  const fontSize = settings?.ux?.fontSize || 16;

  const [previewVisible, setPreviewVisible] = useState(false);
  const [linkMetas, setLinkMetas] = useState([]); // ✅ array now

  const openPreview = () => {
    if (imageUri) setPreviewVisible(true);
  };
  const closePreview = () => setPreviewVisible(false);

  // --- Extract URLs (dedupe, keep order) ---
  const urls = useMemo(() => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const found = text?.match(urlRegex) || [];

    const seen = new Set();
    const deduped = [];

    for (const raw of found) {
      // trim trailing punctuation that often sticks to URLs in sentences
      const clean = raw.replace(/[),.?!:;"']+$/g, "");
      if (!seen.has(clean)) {
        seen.add(clean);
        deduped.push(clean);
      }
    }
    return deduped;
  }, [text]);

  // --- Fetch previews for all URLs ---
  useEffect(() => {
    let cancelled = false;

    if (!urls.length) {
      setLinkMetas([]);
      return;
    }

    (async () => {
      try {
        const results = await Promise.all(
          urls.map(async (url) => {
            try {
              const data = await getLinkPreview(url, {
                headers: {
                  "user-agent": "Twitterbot/1.0",
                  "accept-language": "en-US",
                },
                timeout: 4000,
                imagesPropertyType: "og",
              });

              return {
                url,
                title: data?.title ?? null,
                description: data?.description ?? null,
                images: Array.isArray(data?.images) ? data.images : [],
              };
            } catch {
              return null;
            }
          })
        );

        if (cancelled) return;

        // keep only successful previews, preserve order
        setLinkMetas(results.filter(Boolean));
      } catch {
        if (!cancelled) setLinkMetas([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [urls.join("|")]);

  // --- Case 1: image only (unchanged behavior) ---
  if (imageUri) {
    return (
      <View
        style={[
          styles.imageContainer,
          isUser ? styles.userAlign : styles.aiAlign,
        ]}
      >
        <TouchableOpacity onPress={openPreview}>
          <Image
            source={{ uri: imageUri }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        </TouchableOpacity>

        <ImageViewing
          images={[{ uri: imageUri }]}
          imageIndex={0}
          visible={previewVisible}
          onRequestClose={closePreview}
          backgroundColor={theme.modalBackground}
        />
      </View>
    );
  }

  // --- Case 2: text + link previews (Google-ish cards OUTSIDE bubble) ---
  return (
    <View style={[styles.messageGroup, isUser ? styles.userAlign : styles.aiAlign]}>
      {/* --- Bubble (text only) --- */}
      <View
        style={[
          styles.bubble,
          { backgroundColor: isUser ? theme.userBubble : theme.aiBubble },
          isUser ? styles.userBubble : styles.aiBubble,
        ]}
      >
        {text ? (
          <Text selectable style={[styles.text, { fontSize, color: theme.textPrimary }]}>
            {text}
          </Text>
        ) : null}
      </View>

      {/* --- Link preview cards OUTSIDE the bubble --- */}
      {!!linkMetas.length && (
        <View style={[styles.linkList, isUser ? styles.userAlign : styles.aiAlign]}>
          {linkMetas.map((m) => (
            <TouchableOpacity
              key={m.url}
              style={[
                styles.linkCard,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.border ?? "rgba(0,0,0,0.12)",
                },
              ]}
              onPress={() => Linking.openURL(m.url)}
              activeOpacity={0.9}
            >
                <View
                  style={[
                    styles.linkHero,
                    { backgroundColor: theme.modalBackground ?? "#eee" },
                  ]}
                />

              <View style={styles.linkBody}>
                {!!m.title && (
                  <Text
                    selectable
                    style={[styles.linkTitle, { color: theme.textPrimary }]}
                    numberOfLines={2}
                  >
                    {m.title}
                  </Text>
                )}

                {!!m.description && (
                  <Text
                    selectable
                    style={[styles.linkDesc, { color: theme.textSecondary }]}
                    numberOfLines={3}
                  >
                    {m.description}
                  </Text>
                )}

                <Text
                  selectable
                  style={[styles.linkDomain, { color: theme.textSecondary }]}
                  numberOfLines={1}
                >
                  {getDomain(m.url)}
                </Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  messageGroup: {
    marginVertical: 5,
    maxWidth: "90%",
  },

  bubble: {
    maxWidth: "75%",
    padding: 10,
    borderRadius: 15,
    marginVertical: 5,
    flexShrink: 1,
  },
  userBubble: {
    alignSelf: "flex-end",
    borderBottomRightRadius: 0,
  },
  aiBubble: {
    alignSelf: "flex-start",
    borderBottomLeftRadius: 0,
  },
  text: {
    flexShrink: 1,
  },

  thumbnail: {
    width: 200,
    height: 200,
    borderRadius: 12,
    marginTop: 6,
  },

  userAlign: { alignSelf: "flex-end" },
  aiAlign: { alignSelf: "flex-start" },

  // --- Link list container ---
  linkList: {
    marginTop: 6,
    maxWidth: "90%",
    gap: 10, // if unsupported in your RN version, remove and add marginBottom to linkCard
  },

  // --- Google-ish large card ---
  linkCard: {
    width: "85%",
    maxWidth: 360,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,

    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3, 
  },

  linkHero: {
    width: "100%",
  },

  linkBody: {
    padding: 12,
  },

  linkTitle: {
    fontWeight: "700",
    fontSize: 15,
    lineHeight: 20,
    marginBottom: 6,
  },

  linkDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 10,
  },

  linkDomain: {
    fontSize: 12,
    opacity: 0.85,
  },
});
