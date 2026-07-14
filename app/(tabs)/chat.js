import { useContext, useEffect, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useGpt } from "../../api/gpt";
import MessageInput from "../../components/MessageInput";
import MessageList from "../../components/MessageList";
import { GlobalContext } from "../../context/GlobalContext";

export default function ChatScreen() {
  const [input, setInput] = useState("");
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const { streamMessage } = useGpt();
  const { theme, messages, setMessages, setReceiving, setWaiting, addToFridge } =
    useContext(GlobalContext);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardVisible(true)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardVisible(false)
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const handleSend = async (message) => {
    setInput("");
    setReceiving(true);
    setWaiting(true);

    if (message.text || message.imageUri) {
      try {
        await streamMessage({
          text: message.text || "",
          imageUri: message.imageUri || "",
        });
      } catch (error) {
        console.error("Error sending message to GPT:", error);

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: [{ type: "output_text", text: "Oops, something went wrong." }],
          },
        ]);
      } finally {
        setReceiving(false);
        setWaiting(false);
      }
    } else {
      setReceiving(false);
      setWaiting(false);
    }
  };

  // ✅ Works with your typed categories requirement in gptTools.js
  const handleUiAction = async (maybeAction) => {
    // Some components pass {kind,...}, others pass {action:{kind,...}}
    const action = maybeAction?.kind ? maybeAction : maybeAction?.action;
    if (action?.kind !== "add_all_to_fridge") return;
  
    const items = Array.isArray(action.items) ? action.items : [];
    if (items.length === 0) return;
  
    // For your current pipeline, categories should be an array like:
    // ["Fridge","Use soon","Dairy","Unopened"]
    // But we’ll still accept object form defensively.
    const DEFAULT_CATEGORIES_ARRAY = ["Fridge", "Use soon", "Prepared"];
  
    const clean = (v) => String(v ?? "").trim();
  
    const categoriesObjToArray = (catsObj) => {
      if (!catsObj || typeof catsObj !== "object" || Array.isArray(catsObj)) return null;
  
      const out = [
        clean(catsObj.storage),
        clean(catsObj.urgency),
        clean(catsObj.food_type),
        clean(catsObj.state),
      ].filter(Boolean);
  
      return out.length ? out : null;
    };
  
    const coerceCategories = (cats) => {
      // already-correct shape
      if (Array.isArray(cats)) {
        const out = cats.map(clean).filter(Boolean);
        return out.length ? out : DEFAULT_CATEGORIES_ARRAY;
      }
  
      // older shape: {storage, urgency, food_type, state}
      const fromObj = categoriesObjToArray(cats);
      return fromObj || DEFAULT_CATEGORIES_ARRAY;
    };
  
    let added = 0;
    const failed = [];
  
    for (const it of items) {
      const name = clean(it?.name);
      if (!name) continue;
  
      const quantity = clean(it?.quantity) || "1";
  
      const categories = coerceCategories(it?.categories);
  
      // ✅ pass through; addToFridge decides if valid, predictor fills if missing
      const expiresAt =
        it?.expiresAt ??
        it?.expires_at ??
        it?.expirationDate ??
        it?.expiration_date ??
        undefined;
  
      try {
        // ✅ your new signature:
        // addToFridge(name, quantity, categories, expiresAt)
        console.log({name, quantity, categories, expiresAt});
        addToFridge(name, quantity, categories, expiresAt);
        added += 1;
      } catch (e) {
        failed.push({ name, reason: String(e?.message || e) });
        console.log({ name, reason: String(e?.message || e) });
      }
    }
  
    // Optional summary message
    setMessages((prev) => [
      ...(Array.isArray(prev) ? prev : []),
      {
        role: "assistant",
        content: [
          {
            type: "output_text",
            text:
              `✅ Added ${added} item(s) to fridge.` +
              (failed.length ? `\n⚠️ Skipped: ${failed.map((x) => x.name).join(", ")}` : ""),
          },
        ],
      },
    ]);
  };
  

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? insets.top : insets.bottom}
    >
      <View
        style={[
          styles.container,
          {
            backgroundColor: theme.background,
            paddingBottom: keyboardVisible ? insets.bottom : 0,
          },
        ]}
      >
        <View style={{ flex: 1 }}>
          <MessageList messages={messages} onUiAction={handleUiAction} />

          <MessageInput value={input} onChangeText={setInput} onSend={handleSend} />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
