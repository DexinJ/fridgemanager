// src/gpt/memoryManager.js
import AsyncStorage from "@react-native-async-storage/async-storage";


const MAX_HISTORY = 20;
const KEEP_RECENT = 6;

// --- Add message (text + optional image) ---
export function addMessage(setMessages, { role, text, imageUri }) {
  const content = [];
  if (role === "user" && text) content.push({ type: "input_text", text });
  if (role === "user" && imageUri) content.push({ type: "input_image", image_url: imageUri });
  if (role === "assistant" && text) content.push({ type: "output_text", text });

  if (content.length === 0) {
    console.warn("Skipping empty message:", { role, text, imageUri });
    return Promise.resolve(null);
  }

  const newMessage = { role, content };

  return new Promise((resolve) => {
    setMessages((prev) => {
      const updated = [...prev, newMessage];
      resolve(updated);
      return updated;
    });
  });
}


// --- Get conversation with system prompt and summary ---
export function getConversation(messages, summary, systemPrompt) {
  //console.log("Message @ getConversation", messages);
  const shortHistory = messages.slice(-KEEP_RECENT);
  return [
    {
      role: "system",
      content: [{ type: "input_text", text: systemPrompt }],
    },
    {
      role: "developer",
      content: [
        { type: "input_text", text: `Conversation summary: ${summary}` },
      ],
    },
    ...shortHistory,
  ];
}

// --- Save summary separately ---
export async function saveSummary(newSummary, setSummary) {
  setSummary(newSummary);
  await AsyncStorage.setItem("@chatSummary", newSummary);
}

// --- Load messages + summary on startup ---
export async function loadChatData(setMessages, setSummary) {
  try {
    const [msgData, summaryData] = await Promise.all([
      AsyncStorage.getItem("@chatMessages"),
      AsyncStorage.getItem("@chatSummary"),
    ]);

    if (msgData) setMessages(JSON.parse(msgData));
    if (summaryData) setSummary(summaryData);
  } catch (err) {
    console.warn("Error loading chat data:", err);
  }
}

// --- Clear all chat data ---
export async function clearChatData(setMessages, setSummary) {
  try {
    await AsyncStorage.multiRemove(["@chatMessages", "@chatSummary"]);
    setMessages([]);
    setSummary("");
  } catch (err) {
    console.warn("Error clearing chat data:", err);
  }
}

// memoryManager.js (only the summarize functions shown)
const BACKEND_HTTP_URL =process.env.EXPO_PUBLIC_API_BASE_URL || "https://oversanguinely-metabolous-maxine.ngrok-free.dev";
  // process.env.EXPO_PUBLIC_BACKEND_HTTP_URL || "http://192.168.0.163:3000";

export async function summarizeHistory(messages, setSummary, setMessages) {
  // Expect your stored messages are app-shaped (role/text/imageUri etc).
  // Convert to Chat Completions message shape for the server endpoint.
  const ccMessages = (messages || [])
    .map((m) => {
      if (m?.role === "user") {
        let content = m?.text ?? "";
        if (m?.imageUri) content += `\n\n[image_uri]: ${String(m.imageUri)}`;
        return { role: "user", content };
      }
      if (m?.role === "assistant") {
        if (typeof m?.text === "string") return { role: "assistant", content: m.text };
        if (Array.isArray(m?.content) && m.content[0]?.text) return { role: "assistant", content: m.content[0].text };
        return { role: "assistant", content: "" };
      }
      if (m?.role === "system") {
        return { role: "system", content: String(m?.content ?? "") };
      }
      return null;
    })
    .filter(Boolean);

  const resp = await fetch(`${BACKEND_HTTP_URL}/summarize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gpt-5-mini", // cheap summarizer
      messages: ccMessages,
      instructions:
        "Summarize the following chat for memory retention. Focus on fridge and shopping list details. Keep it short and structured.",
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Summarize failed: ${resp.status} ${text}`);
  }

  const data = await resp.json();
  const summaryText = data?.summary || "";

  setSummary(summaryText);

  // Trim local messages if you want (you referenced KEEP_RECENT before)
  // Keep this consistent with your existing constants.
  // Example:
  // setMessages(messages.slice(-KEEP_RECENT));
}

export async function checkAndSummarize(messages, setSummary, setMessages) {
  // keep your existing MAX_HISTORY logic
  console.log("Starting Check");
  if (messages.length > MAX_HISTORY) {
    await summarizeHistory(messages, setSummary, setMessages);
  }
}

