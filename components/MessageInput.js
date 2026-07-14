import { Ionicons } from "@expo/vector-icons";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { useContext, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { auth } from "../auth/firebaseClient";
import { GlobalContext } from "../context/GlobalContext";
import PlusMenu from "./PlusMenu";

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export default function MessageInput({ value, onChangeText, onSend }) {
  const { settings, theme, receiving } = useContext(GlobalContext);

  const fontSize = settings?.ux?.fontSize || 16;

  const [voiceMode, setVoiceMode] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);

  const isBusy =
    receiving ||
    transcribing ||
    recorderState.isRecording;

  const handleSendText = () => {
    if (receiving || transcribing) return;

    const trimmedValue = value.trim();

    if (!trimmedValue) return;

    onSend({
      text: trimmedValue,
      imageUri: null,
      isUser: true,
    });

    onChangeText("");
  };

  const handleSendImage = (imageData) => {
    if (receiving || transcribing) return;
    onSend(imageData);
  };

  const startRecording = async () => {
    if (receiving || transcribing || recorderState.isRecording) {
      return;
    }

    try {
      const permission =
        await AudioModule.requestRecordingPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          "Microphone permission required",
          "Please allow microphone access to use voice messages."
        );
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch (error) {
      console.error("Failed to start recording:", error);

      Alert.alert(
        "Recording error",
        "Pantrio could not start recording. Please try again."
      );
    }
  };

  const stopRecordingAndTranscribe = async () => {
    if (!recorderState.isRecording) {
      return;
    }

    try {
      await audioRecorder.stop();

      const uri = audioRecorder.uri;

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      if (!uri) {
        throw new Error("The recording did not produce a file.");
      }

      await transcribeAudio(uri);
    } catch (error) {
      console.error("Failed to stop or transcribe recording:", error);

      Alert.alert(
        "Voice message error",
        error instanceof Error
          ? error.message
          : "The recording could not be processed."
      );
    }
  };

  const transcribeAudio = async (uri) => {
    if (!API_URL) {
      throw new Error("EXPO_PUBLIC_API_URL is not configured.");
    }
  
    setTranscribing(true);
  
    try {
      const formData = new FormData();
  
      formData.append("file", {
        uri,
        type: Platform.OS === "web" ? "audio/webm" : "audio/m4a",
        name:
          Platform.OS === "web"
            ? "recording.webm"
            : "recording.m4a",
      });
  
      // Get the current Firebase user
      const user = auth.currentUser;
  
      if (!user) {
        throw new Error(
          "You must be signed in to use voice transcription."
        );
      }
  
      // Get a fresh Firebase ID token
      const token = await user.getIdToken();
  
      const response = await fetch(
        `${API_URL}/api/transcriptions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
        }
      );
  
      const responseText = await response.text();
  
      let data;
  
      try {
        data = JSON.parse(responseText);
      } catch {
        data = {
          error: responseText || "Invalid server response.",
        };
      }
  
      if (!response.ok) {
        throw new Error(
          data?.error ||
            data?.message ||
            `Transcription failed with status ${response.status}.`
        );
      }
  
      const transcript = data?.text?.trim();
  
      if (!transcript) {
        throw new Error(
          "No speech was detected in the recording."
        );
      }
  
      onSend({
        text: transcript,
        imageUri: null,
        isUser: true,
      });
    } catch (error) {
      console.error("Transcription failed:", error);
  
      Alert.alert(
        "Voice Transcription",
        error.message || "Failed to transcribe recording."
      );
    } finally {
      setTranscribing(false);
    }
  };

  const handlePressIn = async () => {
    await startRecording();
  };

  const handlePressOut = async () => {
    await stopRecordingAndTranscribe();
  };

  const leaveVoiceMode = async () => {
    if (recorderState.isRecording) {
      try {
        await audioRecorder.stop();
      } catch (error) {
        console.error("Failed to cancel recording:", error);
      }
    }

    setVoiceMode(false);
  };

  const voiceButtonText = transcribing
    ? "Transcribing..."
    : recorderState.isRecording
      ? "Release to Send"
      : receiving
        ? "Waiting..."
        : "Hold to Talk";

  return (
    <View
      style={[
        styles.container,
        {
          borderColor: theme.border,
          backgroundColor: theme.card,
        },
      ]}
    >
      <PlusMenu onSend={handleSendImage} />

      {!voiceMode ? (
        <>
          <TextInput
            editable={!receiving && !transcribing}
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
            placeholder={
              receiving
                ? "Waiting for response..."
                : transcribing
                  ? "Transcribing..."
                  : "Type a message..."
            }
            placeholderTextColor={theme.textPlaceholder}
            returnKeyType="send"
            onSubmitEditing={handleSendText}
          />

          <TouchableOpacity
            style={[
              styles.micButton,
              {
                backgroundColor: theme.actionButton,
                opacity: receiving || transcribing ? 0.5 : 1,
              },
            ]}
            onPress={() => setVoiceMode(true)}
            disabled={receiving || transcribing}
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
          <TouchableOpacity
            style={[
              styles.voiceButton,
              {
                backgroundColor: theme.inputBackground,
                borderColor: recorderState.isRecording
                  ? theme.actionButton
                  : theme.border,
                opacity: receiving ? 0.5 : 1,
              },
            ]}
            onPressIn={handlePressIn}
            onPressOut={handlePressOut}
            disabled={receiving || transcribing}
          >
            {transcribing ? (
              <ActivityIndicator />
            ) : (
              <Text
                style={[
                  styles.voiceText,
                  {
                    color:
                      theme.textPrimary ||
                      theme.text ||
                      theme.inputText,
                  },
                ]}
              >
                {voiceButtonText}
              </Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.micButton,
              {
                backgroundColor: theme.actionButton,
                opacity: isBusy ? 0.5 : 1,
              },
            ]}
            onPress={leaveVoiceMode}
            disabled={isBusy}
          >
            {transcribing ? (
              <ActivityIndicator color={theme.inputBackground} />
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
    borderWidth: 1,
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