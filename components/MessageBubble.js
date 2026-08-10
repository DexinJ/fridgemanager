import { useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
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

const MAX_LINK_PREVIEWS = 3;

function toDisplayText(value) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function canFetchPreview(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
      return false;
    }

    const hostname = parsed.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, "")
      .replace(/\.$/, "");
    if (
      !hostname ||
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      (!hostname.includes(".") && !hostname.includes(":"))
    ) {
      return false;
    }

    const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const octets = ipv4.slice(1).map(Number);
      if (octets.some((octet) => octet > 255)) return false;
      const [a, b] = octets;
      return !(
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        a >= 224
      );
    }

    if (hostname.includes(":")) {
      if (
        hostname === "::" ||
        hostname === "::1" ||
        /^fe[89ab]/.test(hostname) ||
        /^f[cd]/.test(hostname)
      ) {
        return false;
      }

      const mappedIpv4 = hostname.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
      if (mappedIpv4) return canFetchPreview(`https://${mappedIpv4[1]}`);
    }

    return true;
  } catch {
    return false;
  }
}

export default function MessageBubble({ text, imageUri, isUser }) {
  const { settings, theme } = useContext(GlobalContext);
  const fontSize = settings?.ux?.fontSize || 16;

  const [previewVisible, setPreviewVisible] = useState(false);
  const mountedRef = useRef(false);
  const displayText = toDisplayText(text);
  const safeImageUri = typeof imageUri === "string" ? imageUri : "";
  const [linkMetas, setLinkMetas] = useState([]); // ✅ array now

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const openPreview = () => {
    if (safeImageUri) setPreviewVisible(true);
  };
  const closePreview = () => setPreviewVisible(false);

  // --- Extract URLs (dedupe, keep order) ---
  const urls = useMemo(() => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const found = displayText.match(urlRegex) || [];

    const seen = new Set();
    const deduped = [];

    for (const raw of found) {
      // trim trailing punctuation that often sticks to URLs in sentences
      const clean = raw.replace(/[),.?!:;"']+$/g, "");
      if (!seen.has(clean)) {
        seen.add(clean);
        deduped.push(clean);
        if (deduped.length >= MAX_LINK_PREVIEWS) break;
      }
    }
    return deduped;
  }, [displayText]);

  // --- Fetch previews for all URLs ---
  useEffect(() => {
    let cancelled = false;

    if (!urls.length) {
      return;
    }

    (async () => {
      try {
        const results = await Promise.all(
          urls.map(async (url) => {
            if (!canFetchPreview(url)) {
              return { url, title: null, description: null, images: [] };
            }

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
                title: toDisplayText(data?.title) || null,
                description: toDisplayText(data?.description) || null,
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
  }, [urls]);

  const visibleLinkMetas = linkMetas.filter((meta) => urls.includes(meta.url));

  const openLink = async (url) => {
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) throw new Error("This link is not supported on this device.");
      if (!mountedRef.current) return;
      await Linking.openURL(url);
    } catch (error) {
      if (mountedRef.current) {
        Alert.alert("Could not open link", error?.message || "Please try again.");
      }
    }
  };

  // --- Case 1: image only (unchanged behavior) ---
  if (safeImageUri) {
    return (
      <View
        style={[
          styles.imageContainer,
          isUser ? styles.userAlign : styles.aiAlign,
        ]}
      >
        <TouchableOpacity onPress={openPreview}>
          <Image
            source={{ uri: safeImageUri }}
            style={styles.thumbnail}
            resizeMode="cover"
          />
        </TouchableOpacity>

        <ImageViewing
          images={[{ uri: safeImageUri }]}
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
        {displayText ? (
          <Text selectable style={[styles.text, { fontSize, color: theme.textPrimary }]}>
            {displayText}
          </Text>
        ) : null}
      </View>

      {/* --- Link preview cards OUTSIDE the bubble --- */}
      {!!visibleLinkMetas.length && (
        <View style={[styles.linkList, isUser ? styles.userAlign : styles.aiAlign]}>
          {visibleLinkMetas.map((m) => (
            <TouchableOpacity
              key={m.url}
              style={[
                styles.linkCard,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.border ?? "rgba(0,0,0,0.12)",
                },
              ]}
              onPress={() => openLink(m.url)}
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
