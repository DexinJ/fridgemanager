import { Ionicons } from "@expo/vector-icons";
import { Audio } from "expo-av";
import { useContext, useState } from "react";
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { GlobalContext } from "../context/GlobalContext";
import PlusMenu from "./PlusMenu";

export default function MessageInput({ value, onChangeText, onSend }) {
  const { settings, theme, receiving } = useContext(GlobalContext);
  const fontSize = settings?.ux?.fontSize || 16;
  const [voiceMode, setVoiceMode] = useState(false);
  const [recording, setRecording] = useState(null);
  const handleSendText = () => {
    if (receiving) return;
    if (value.trim().length === 0) return;
    onSend({ text: value.trim(), imageUri: null, isUser: true });
    onChangeText("");
  };

  const handleSendImage = (imageData) => {
    if (receiving) return;
    onSend(imageData);
  };
  const startRecording = async () => {
    try {
      // Ask for mic permission
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        alert("Permission to access microphone is required!");
        return;
      }
  
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
  
      console.log("🎙️ Starting recording...");
      const newRecording = new Audio.Recording();
      await newRecording.prepareToRecordAsync(
        Audio.RECORDING_OPTIONS_PRESET_HIGH_QUALITY
      );
      await newRecording.startAsync();
  
      setRecording(newRecording);
    } catch (err) {
      console.error("Failed to start recording", err);
    }
  };
  
  const stopRecordingAndTranscribe = async (onSend) => {
    console.log("🛑 Stopping recording...");
    try {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
  
      console.log("Recorded file stored at:", uri);
  
      // Send to OpenAI Whisper API
      const formData = new FormData();
      formData.append("file", {
        uri,
        type: "audio/m4a",
        name: "recording.m4a",
      });
      formData.append("model", "whisper-1");
  
      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.EXPO_PUBLIC_OPENAI_KEY}`,
        },
        body: formData,
      });
  
      const data = await response.json();
      console.log("📝 Transcription result:", data);
  
      if (data.text) {
        onSend({ text: data.text, imageUri: null, isUser: true });
      }
    } catch (error) {
      console.error("Error stopping recording:", error);
    }
  };
  // Voice recording logic placeholder
  const handlePressIn = async () => {
    await startRecording();
  };
  
  const handlePressOut = async () => {
    await stopRecordingAndTranscribe(onSend);
  };

  return (
    <View
      style={[
        styles.container,
        { borderColor: theme.border, backgroundColor: theme.card },
      ]}
    >
      {/* Plus menu passes images */}
      <PlusMenu onSend={handleSendImage} />

      {!voiceMode ? (
        <>
          {/* Text input */}
          <TextInput
          editable={!receiving}
            style={[
              styles.input,
              {
                fontSize,
                paddingVertical: fontSize * 0.5,
                color: theme.inputText,
                backgroundColor: theme.inputBackground,
                borderColor: theme.border,
              },
            ]}
            value={value}
            onChangeText={onChangeText}
            placeholder={receiving ? "Waiting for response..." : "Type a message..."}
            placeholderTextColor={theme.textPlaceholder}
            returnKeyType="send"
            onSubmitEditing={handleSendText}
          />

          {/* Mic button to switch to voice mode */}
          <TouchableOpacity
            style={[styles.micButton, { backgroundColor: theme.actionButton }]}
            onPress={() => setVoiceMode(true)}
            disabled={receiving}
          >
            <Ionicons
              name="mic"
              size={fontSize * 1.2}
              color={theme.inputBackground}
            />
          </TouchableOpacity>
        </>
      ) : (
        <>
          {/* Hold to talk button */}
          <TouchableOpacity
            style={[
              styles.voiceButton,
              { backgroundColor: theme.inputBackground },
            ]}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            disabled={receiving}
          >
            <Text style={[styles.voiceText, { color: theme.text }]}>
            {receiving ? "Sending..." : "Hold to Talk"}
            </Text>
          </TouchableOpacity>

          {/* Button to go back to typing mode */}
          <TouchableOpacity
            style={[styles.micButton, { backgroundColor: theme.actionButton }]}
            onPress={() => setVoiceMode(false)}
            disabled={receiving}
          >
           {receiving?  (
            <ActivityIndicator />
           ) : (
            <Ionicons
              name="close-outline"
              size={fontSize * 1.2}
              color={theme.inputBackground}
            />
           )}
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    padding: 10,
    alignItems: "center",
    borderTopWidth: 1,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 15,
    marginHorizontal: 5,
  },
  micButton: {
    padding: 10,
    borderRadius: 20,
    marginLeft: 5,
    justifyContent: "center",
    alignItems: "center",
  },
  voiceButton: {
    flex: 1,
    borderRadius: 20,
    marginHorizontal: 5,
    paddingVertical: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  voiceText: {
    fontWeight: "bold",
    fontSize: 16,
  },
});
