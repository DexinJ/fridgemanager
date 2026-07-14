// useGpt.js (or whatever your filename is)
/*import { fetch } from "expo/fetch";
import OpenAI from "openai";
import { useContext, useRef } from "react";
import { GlobalContext } from "../context/GlobalContext";
import { buildSystemMessage } from "./buildSystemMessage";
import { useGPTTools } from "./gptTools";
import { addMessage, checkAndSummarize, getConversation } from "./memoryManager";

const DEFAULT_MODEL = "gpt-5";

export const useGpt = () => {
  const toolHandlers = useGPTTools();
  const { settings, fridgeItems, shoppingListItems, setMessages, summary, setSummary } =
    useContext(GlobalContext);

  // Avoid recreating client each render
  const openaiRef = useRef(null);
  if (!openaiRef.current) {
    openaiRef.current = new OpenAI({
      apiKey: process.env.EXPO_PUBLIC_OPENAI_KEY,
      fetch,
    });
  }
  const openai = openaiRef.current;

  const autoFollowUp = async (currentMessages) => {
    await checkAndSummarize(currentMessages, setSummary);

    const response = await openai.responses.create({
      model: DEFAULT_MODEL,
      input: getConversation(
        currentMessages,
        summary,
        buildSystemMessage({ settings, fridgeItems, shoppingListItems })
      ),
      text: {
        format: { type: "text" },
        verbosity: "medium",
      },
    });

    if (response.output_text) {
      addMessage(setMessages, {
        role: "assistant",
        text: `[fromTool] ${response.output_text}`,
      });
    }
  };

  const streamMessage = async ({ text, imageUri }) => {
    // 1) Add user message
    const updatedMessages = addMessage(setMessages, {
      role: "user",
      text,
      imageUri,
    });

    await checkAndSummarize(updatedMessages, setSummary);

    // 2) Start streaming from Responses API
    const stream = await openai.responses.create({
      model: DEFAULT_MODEL,
      input: getConversation(
        updatedMessages,
        summary,
        buildSystemMessage({ settings, fridgeItems, shoppingListItems })
      ),
      stream: true,
      text: { format: { type: "text" }, verbosity: "medium" },
      tools: [
        {
          type: "web_search",
          filters: null,
          search_context_size: "medium",
          user_location: {
            type: "approximate",
            city: null,
            country: null,
            region: null,
            timezone: null,
          },
        },
        {
          type: "function",
          name: "addFridgeItem",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "The name of the item (e.g., 'milk')." },
              quantity: { type: "string", description: "The amount or size (e.g., '2 cartons', '1L')." },
            },
            required: ["name"],
          },
        },
        {
          type: "function",
          name: "addShoppingItem",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "The name of the item (e.g., 'eggs')." },
              quantity: { type: "string", description: "The amount (e.g., 'dozen')." },
            },
            required: ["name"],
          },
        },
        {
          type: "function",
          name: "removeFridgeItem",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "The name of the item to remove." },
            },
            required: ["name"],
          },
        },
        {
          type: "function",
          name: "removeShoppingItem",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "The name of the item to remove." },
            },
            required: ["name"],
          },
        },
        {
          type: "function",
          name: "findInFridge",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "The name of the item to check." },
            },
            required: ["name"],
          },
        },
        {
          type: "function",
          name: "findInShoppingList",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "The name of the item to check." },
            },
            required: ["name"],
          },
        },
        {
          type: "function",
          name: "getFridgeContents",
          parameters: { type: "object", properties: {} },
        },
        {
          type: "function",
          name: "getShoppingListContents",
          parameters: { type: "object", properties: {} },
        },
      ],
      include: ["web_search_call.action.sources"],
    });

    let fullText = "";
    let currentAssistantMessage = null;

    // Buffer for tool calls: { callId: { name, args } }
    const toolCallBuffers = {};

    for await (const event of stream) {
      // console.log("STREAM EVENT:", event.type);

      // Assistant text deltas
      if (event.type === "response.output_text.delta") {
        const delta = event.delta || "";
        fullText += delta;

        setMessages((prev) => {
          const updated = [...prev];
          if (!currentAssistantMessage) {
            currentAssistantMessage = {
              role: "assistant",
              content: [{ type: "output_text", text: delta }],
            };
            updated.push(currentAssistantMessage);
          } else {
            currentAssistantMessage.content[0].text += delta;
          }
          return updated;
        });
      }

      // Function call item done
      if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
        const itemId = event.item.id;
        const { name, arguments: rawArgs } = event.item;

        if (!toolCallBuffers[itemId]) {
          toolCallBuffers[itemId] = { name, args: rawArgs };
        } else {
          // In case it appears multiple times, keep latest
          toolCallBuffers[itemId].name = name;
          toolCallBuffers[itemId].args = rawArgs;
        }
      }

      if (event.type === "response.completed") {
        // console.log("Stream finished ✅");
      }
    }

    let updatedMessagesAfterTools = null;

    // After stream ends, process all buffered tool calls
    for (const [callId, callData] of Object.entries(toolCallBuffers)) {
      if (!callData?.args) continue;

      let parsedArgs = {};
      try {
        parsedArgs = JSON.parse(callData.args);
        // console.log(`✅ Final function call for ${callData.name}:`, parsedArgs);
      } catch (err) {
        console.error("❌ Failed to parse function call args:", callData.args, err);
        continue;
      }

      const handler = toolHandlers?.[callData.name];
      if (!handler) {
        console.warn(`⚠️ No handler found for tool: ${callData.name}`);
        continue;
      }

      try {
        const result = await handler(parsedArgs);

        if (result?.__context) {
          // Store updated messages, but don't call autoFollowUp yet
          updatedMessagesAfterTools = addMessage(setMessages, {
            role: "assistant",
            text: `[Tool: ${callData.name}] ${JSON.stringify(result)}`,
          });
        } else {
          addMessage(setMessages, {
            role: "assistant",
            text: `[fromTool] ${result?.message || `[Tool: ${callData.name}] executed`}`,
          });
        }
      } catch (err) {
        console.error(`❌ Error executing tool ${callData.name}:`, err);
      }
    }

    // Call autoFollowUp ONCE if any tool produced context
    if (updatedMessagesAfterTools) {
      await autoFollowUp(updatedMessagesAfterTools);
    }

    return fullText;
  };

  const sendMessage = async ({ text, imageUri }) => {
    const updatedMessages = addMessage(setMessages, {
      role: "user",
      text,
      imageUri,
    });

    await checkAndSummarize(updatedMessages, setSummary);

    const response = await openai.responses.create({
      model: DEFAULT_MODEL,
      input: getConversation(
        updatedMessages,
        summary,
        buildSystemMessage({ settings, fridgeItems, shoppingListItems })
      ),
      text: {
        format: { type: "text" },
        verbosity: "medium",
      },
      tools: [
        {
          type: "web_search",
          filters: null,
          search_context_size: "medium",
          user_location: {
            type: "approximate",
            city: null,
            country: null,
            region: null,
            timezone: null,
          },
        },
        {
          type: "function",
          name: "addFridgeItem",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "The name of the item (e.g., 'milk')." },
              quantity: { type: "string", description: "The amount or size (e.g., '2 cartons', '1L')." },
            },
            required: ["name"],
          },
        },
        {
          type: "function",
          name: "addShoppingItem",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "The name of the item (e.g., 'eggs')." },
              quantity: { type: "string", description: "The amount (e.g., 'dozen')." },
            },
            required: ["name"],
          },
        },
        {
          type: "function",
          name: "removeFridgeItem",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "The name of the item to remove." },
            },
            required: ["name"],
          },
        },
        {
          type: "function",
          name: "removeShoppingItem",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "The name of the item to remove." },
            },
            required: ["name"],
          },
        },
        {
          type: "function",
          name: "findInFridge",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "The name of the item to check." },
            },
            required: ["name"],
          },
        },
        {
          type: "function",
          name: "findInShoppingList",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "The name of the item to check." },
            },
            required: ["name"],
          },
        },
        {
          type: "function",
          name: "getFridgeContents",
          parameters: { type: "object", properties: {} },
        },
        {
          type: "function",
          name: "getShoppingListContents",
          parameters: { type: "object", properties: {} },
        },
      ],
      include: ["web_search_call.action.sources"],
    });

    // FIX: return both (your old code returned only updatedMessages)
    return { response, updatedMessages };
  };

  return { streamMessage, sendMessage };
};
*/

<Pressable
style={[styles.modalSheet, { backgroundColor: theme.card }]}
onPress={() => {}}
>
<Text
  style={[
    styles.modalTitle,
    { fontSize: fontSize * 1.2, color: theme.textPrimary },
  ]}
>
  Edit Item
</Text>

<TextInput
  style={[
    styles.input,
    {
      fontSize,
      color: theme.inputText,
      borderColor: theme.border,
      backgroundColor: theme.inputBackground,
    },
  ]}
  placeholder="Item Name"
  placeholderTextColor={theme.textPlaceholder}
  value={editDraft?.name ?? ""}
  onChangeText={(t) => setEditDraft((p) => ({ ...(p || {}), name: t }))}
/>

<TextInput
  style={[
    styles.input,
    {
      fontSize,
      color: theme.inputText,
      borderColor: theme.border,
      backgroundColor: theme.inputBackground,
    },
  ]}
  placeholder="Quantity"
  placeholderTextColor={theme.textPlaceholder}
  value={editDraft?.quantity ?? ""}
  onChangeText={(t) =>
    setEditDraft((p) => ({ ...(p || {}), quantity: t }))
  }
/>

<Text
  style={[
    styles.label,
    { color: theme.textSecondary, fontSize: fontSize * 0.9 },
  ]}
>
  Storage (required)
</Text>
<DropDownPicker
  open={editOpenStorage}
  value={editStorage}
  items={storageItems}
  setOpen={setEditOpenStorage}
  setValue={setEditStorage}
  setItems={setStorageItems}
  onOpen={() => openOnlyEdit("storage")}
  searchable
  searchPlaceholder="Search storage..."
  listMode="SCROLLVIEW"
  zIndex={4000}
  zIndexInverse={1000}
  style={[
    styles.dd,
    {
      backgroundColor: theme.inputBackground,
      borderColor: theme.border,
    },
  ]}
  dropDownContainerStyle={[
    styles.ddContainer,
    {
      backgroundColor: theme.inputBackground,
      borderColor: theme.border,
    },
  ]}
  textStyle={{ color: theme.inputText, fontSize }}
  searchTextInputStyle={[
    styles.searchInput,
    { borderColor: theme.border, color: theme.inputText },
  ]}
  searchContainerStyle={{ borderBottomColor: theme.border }}
/>

<Text
  style={[
    styles.label,
    { color: theme.textSecondary, fontSize: fontSize * 0.9 },
  ]}
>
  Urgency (required)
</Text>
<DropDownPicker
  open={editOpenUrgency}
  value={editUrgency}
  items={urgencyItems}
  setOpen={setEditOpenUrgency}
  setValue={setEditUrgency}
  setItems={setUrgencyItems}
  onOpen={() => openOnlyEdit("urgency")}
  searchable
  searchPlaceholder="Search urgency..."
  listMode="SCROLLVIEW"
  zIndex={3000}
  zIndexInverse={2000}
  style={[
    styles.dd,
    {
      backgroundColor: theme.inputBackground,
      borderColor: theme.border,
    },
  ]}
  dropDownContainerStyle={[
    styles.ddContainer,
    {
      backgroundColor: theme.inputBackground,
      borderColor: theme.border,
    },
  ]}
  textStyle={{ color: theme.inputText, fontSize }}
  searchTextInputStyle={[
    styles.searchInput,
    { borderColor: theme.border, color: theme.inputText },
  ]}
  searchContainerStyle={{ borderBottomColor: theme.border }}
/>

<Text
  style={[
    styles.label,
    { color: theme.textSecondary, fontSize: fontSize * 0.9 },
  ]}
>
  Food type (required)
</Text>
<DropDownPicker
  open={editOpenFoodType}
  value={editFoodType}
  items={foodTypeItems}
  setOpen={setEditOpenFoodType}
  setValue={setEditFoodType}
  setItems={setFoodTypeItems}
  onOpen={() => openOnlyEdit("foodType")}
  searchable
  searchPlaceholder="Search food types..."
  listMode="SCROLLVIEW"
  zIndex={2000}
  zIndexInverse={3000}
  style={[
    styles.dd,
    {
      backgroundColor: theme.inputBackground,
      borderColor: theme.border,
    },
  ]}
  dropDownContainerStyle={[
    styles.ddContainer,
    {
      backgroundColor: theme.inputBackground,
      borderColor: theme.border,
    },
  ]}
  textStyle={{ color: theme.inputText, fontSize }}
  searchTextInputStyle={[
    styles.searchInput,
    { borderColor: theme.border, color: theme.inputText },
  ]}
  searchContainerStyle={{ borderBottomColor: theme.border }}
/>

<Text
  style={[
    styles.label,
    { color: theme.textSecondary, fontSize: fontSize * 0.9 },
  ]}
>
  State (optional)
</Text>
<DropDownPicker
  open={editOpenState}
  value={editStateTag}
  items={stateItems}
  setOpen={setEditOpenState}
  setValue={setEditStateTag}
  setItems={setStateItems}
  onOpen={() => openOnlyEdit("state")}
  searchable
  searchPlaceholder="Search state..."
  listMode="SCROLLVIEW"
  zIndex={1000}
  zIndexInverse={4000}
  style={[
    styles.dd,
    {
      backgroundColor: theme.inputBackground,
      borderColor: theme.border,
    },
  ]}
  dropDownContainerStyle={[
    styles.ddContainer,
    {
      backgroundColor: theme.inputBackground,
      borderColor: theme.border,
    },
  ]}
  textStyle={{ color: theme.inputText, fontSize }}
  searchTextInputStyle={[
    styles.searchInput,
    { borderColor: theme.border, color: theme.inputText },
  ]}
  searchContainerStyle={{ borderBottomColor: theme.border }}
/>

<View style={styles.modalButtons}>
  <TouchableOpacity
    style={[
      styles.modalButton,
      { backgroundColor: theme.cancelButton },
    ]}
    onPress={() => {
      setEditModalVisible(false);
      setEditDraft(null);
    }}
  >
    <Text style={{ fontSize, color: theme.textPrimary }}>
      Cancel
    </Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[
      styles.modalButton,
      { backgroundColor: theme.actionButton },
    ]}
    onPress={commitEdit}
  >
    <Text style={{ fontSize, color: "#fff" }}>Save</Text>
  </TouchableOpacity>
</View>
</Pressable>