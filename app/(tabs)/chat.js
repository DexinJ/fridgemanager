import { Ionicons } from "@expo/vector-icons";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useGpt } from "../../api/gpt";
import ConversationListModal from "../../components/ConversationListModal";
import MessageInput from "../../components/MessageInput";
import MessageList from "../../components/MessageList";
import { ChatContext, GlobalContext } from "../../context/GlobalContext";
import {
  claimFridgeProposalAction,
  fridgeProposalCategoryLabels,
  markFridgeProposalActionConsumed,
  normalizeFridgeProposalQuantity,
  releaseFridgeProposalAction,
} from "../../utils/fridgeProposal";
import {
  applyRecipePreferenceProposal,
  formatRecipePreferencePatch,
  normalizeRecipePreferencePatch,
} from "../../utils/recipePreferences";

function getChatErrorMessage(error) {
  const messagesByCode = {
    QUOTA_EXHAUSTED: "You have used today’s Pantrio AI allowance.",
    REQUEST_TOO_LARGE: "This conversation is too large to send. Try starting a new chat.",
    RATE_LIMITED: "You’re sending requests too quickly. Please try again shortly.",
    AUTH_REQUIRED: "Your session expired. Please sign in again.",
    AUTH_INVALID: "Your session expired. Please sign in again.",
    ENTITLEMENT_STALE: "Your subscription status needs to be refreshed in Settings.",
    REQUEST_TIMEOUT: "The chat request timed out. Please try again.",
    UPSTREAM_ERROR: "Pantrio AI is temporarily unavailable. Please try again.",
    UPSTREAM_UNAVAILABLE: "Pantrio AI is temporarily unavailable. Please try again.",
  };

  if (messagesByCode[error?.code]) return messagesByCode[error.code];

  const message = String(error?.message || "").trim();
  if (message && message !== "Unknown error") return message;

  return "Pantrio AI could not complete that request.";
}

function ChatEmptyState({ theme, onNewChat }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons
        name="chatbubbles-outline"
        size={46}
        color={theme.textSecondary}
      />
      <Text style={[styles.emptyTitle, { color: theme.textPrimary }]}>
        Start a new chat
      </Text>
      <Text style={[styles.emptyBody, { color: theme.textSecondary }]}>
        Ask Pantrio about meals, your fridge, or your shopping list.
      </Text>
      <TouchableOpacity
        onPress={onNewChat}
        accessibilityRole="button"
        accessibilityLabel="Start a new chat"
        style={[
          styles.emptyButton,
          { backgroundColor: theme.actionButton },
        ]}
      >
        <Ionicons name="add" size={20} color={theme.actionButtonText} />
        <Text
          style={[styles.emptyButtonText, { color: theme.actionButtonText }]}
        >
          New chat
        </Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ChatScreen() {
  const [input, setInput] = useState("");
  const insets = useSafeAreaInsets();
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  const { streamMessage } = useGpt();
  const { theme, settings, addManyToFridge, updateRecipePreferences } =
    useContext(GlobalContext);
  const {
    messages,
    setMessages,
    setWaiting,
    waiting,
    conversations,
    activeConversationId,
    conversationsVisible,
    setConversationsVisible,
    selectConversation,
    createConversation,
  } = useContext(ChatContext);
  const mountedRef = useRef(false);
  const sendGenerationRef = useRef(0);
  const appliedUiActionsRef = useRef(new Set());
  const claimedFridgeProposalActionsRef = useRef(new Set());

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      sendGenerationRef.current += 1;
    };
  }, []);

  useFocusEffect(
    useCallback(() => {
      const showSub = Keyboard.addListener(
        "keyboardWillShow",
        () => setKeyboardVisible(true)
      );
      const hideSub = Keyboard.addListener(
        "keyboardWillHide",
        () => setKeyboardVisible(false)
      );
      return () => {
        showSub.remove();
        hideSub.remove();
        setKeyboardVisible(false);
      };
    }, [])
  );

  const handleSend = async (message) => {
    const generation = sendGenerationRef.current + 1;
    sendGenerationRef.current = generation;
    setInput("");
    setWaiting(true);

    if (message.text || message.imageUri) {
      try {
        await streamMessage({
          text: message.text || "",
          imageUri: message.imageUri || "",
          imageRequestUri: message.imageRequestUri || "",
        });
      } catch (error) {
        if (
          error?.code === "REQUEST_CANCELLED" ||
          !mountedRef.current ||
          sendGenerationRef.current !== generation
        ) {
          return;
        }
        console.error("Error sending message to GPT:", error);
        const errorMessage = getChatErrorMessage(error);

        setMessages((prev) => [
          ...(Array.isArray(prev) ? prev : []),
          {
            role: "assistant",
            content: [{ type: "output_text", text: errorMessage }],
          },
        ]);
      } finally {
        if (mountedRef.current && sendGenerationRef.current === generation) {
          setWaiting(false);
        }
      }
    } else {
      if (mountedRef.current && sendGenerationRef.current === generation) {
        setWaiting(false);
      }
    }
  };

  // ✅ Works with your typed categories requirement in gptTools.js
  const handleUiAction = async (maybeAction) => {
    if (!mountedRef.current) return;
    // Some components pass {kind,...}, others pass {action:{kind,...}}
    const action = maybeAction?.kind ? maybeAction : maybeAction?.action;
    if (action?.kind === "recipe_preference_update") {
      const patch = normalizeRecipePreferencePatch(action.patch);
      if (Object.keys(patch).length === 0) return;
      const operation = ["merge", "remove", "replace"].includes(
        action.operation
      )
        ? action.operation
        : "merge";
      const actionKey = JSON.stringify({ operation, patch });
      if (appliedUiActionsRef.current.has(actionKey)) return;
      appliedUiActionsRef.current.add(actionKey);
      const appliedPatch = applyRecipePreferenceProposal(
        settings?.recipePreferences?.explicit,
        patch,
        operation
      );
      updateRecipePreferences({ explicit: appliedPatch });
      if (!mountedRef.current) return;
      const summary = formatRecipePreferencePatch(appliedPatch);
      setMessages((previous) => [
        ...(Array.isArray(previous) ? previous : []),
        {
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: summary
                ? `Saved your recipe preferences:\n${summary}`
                : "Saved your recipe preferences.",
            },
          ],
        },
      ]);
      return;
    }
    if (action?.kind !== "add_all_to_fridge") return;
  
    const items = Array.isArray(action.items) ? action.items : [];
    if (items.length === 0) return;
  
    // For your current pipeline, categories should be an array like:
    // ["Fridge","Use soon","Dairy","Unopened"]
    // But we’ll still accept object form defensively.
    const clean = (v) => String(v ?? "").trim();
  
    let added = 0;
    const failed = [];
    const additions = [];
  
    for (const it of items) {
      const name = clean(it?.name);
      if (!name) continue;
  
      const quantity = normalizeFridgeProposalQuantity(it?.quantity);
      const categories = fridgeProposalCategoryLabels(it?.categories);
  
      // Pass through; the context normalizes tags and predicts missing expiry.
      const expiresAt =
        it?.expiresAt ??
        it?.expires_at ??
        it?.expirationDate ??
        it?.expiration_date ??
        undefined;
  
      additions.push({ name, quantity, categories, expiresAt });
    }

    if (additions.length === 0) return;
    if (
      !claimFridgeProposalAction(
        claimedFridgeProposalActionsRef.current,
        action
      )
    ) {
      return;
    }

    try {
      added = addManyToFridge(additions).length;
    } catch (error) {
      releaseFridgeProposalAction(
        claimedFridgeProposalActionsRef.current,
        action
      );
      const reason = String(error?.message || error);
      failed.push(...additions.map(({ name }) => ({ name, reason })));
      if (__DEV__) console.log({ names: additions.map(({ name }) => name), reason });
    }
  
    // Optional summary message
    if (!mountedRef.current) return;
    setMessages((prev) => [
      ...(failed.length === 0
        ? markFridgeProposalActionConsumed(prev, action)
        : Array.isArray(prev)
          ? prev
          : []),
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
      behavior="padding"
      keyboardVerticalOffset={insets.top}
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
          {messages.length === 0 && !waiting ? (
            <ChatEmptyState theme={theme} onNewChat={createConversation} />
          ) : (
            <MessageList messages={messages} onUiAction={handleUiAction} />
          )}

          <MessageInput value={input} onChangeText={setInput} onSend={handleSend} />
        </View>

        <ConversationListModal
          visible={conversationsVisible}
          onClose={() => setConversationsVisible(false)}
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelect={(id) => {
            selectConversation(id);
            setConversationsVisible(false);
          }}
          onNewChat={() => {
            createConversation();
            setConversationsVisible(false);
          }}
        />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginTop: 4,
  },
  emptyBody: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  emptyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
  emptyButtonText: {
    fontSize: 15,
    fontWeight: "700",
  },
});
