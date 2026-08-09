import { Ionicons } from "@expo/vector-icons";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { onAuthStateChanged } from "firebase/auth";
import { useContext, useEffect, useRef, useState } from "react";
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
import { API_BASE_URL } from "../api/backendConfig";
import {
  createBackendResponseError,
  parseBackendResponseText,
} from "../api/backendErrors";
import { GlobalContext } from "../context/GlobalContext";
import { useAccountSession } from "../context/AccountSessionContext";
import PlusMenu from "./PlusMenu";

const MAX_RECORDING_SECONDS = 60;
const TRANSCRIPTION_TIMEOUT_MS = 90_000;
const VOICE_RECORDING_PRESET = {
  ...RecordingPresets.LOW_QUALITY,
  extension: ".m4a",
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 32_000,
  android: RecordingPresets.HIGH_QUALITY.android,
  web: {
    ...RecordingPresets.LOW_QUALITY.web,
    bitsPerSecond: 32_000,
  },
};

export default function MessageInput({ value, onChangeText, onSend }) {
  const { settings, theme, receiving } = useContext(GlobalContext);
  const { updateQuota } = useAccountSession();

  const fontSize = settings?.ux?.fontSize || 16;

  const [voiceMode, setVoiceMode] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recordingSessionRef = useRef(false);
  const recordingPressIntentRef = useRef(false);
  const transcriptionControllerRef = useRef(null);
  const mountedRef = useRef(true);

  const audioRecorder = useAudioRecorder(VOICE_RECORDING_PRESET);
  const recorderState = useAudioRecorderState(audioRecorder);

  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, () => {
      transcriptionControllerRef.current?.abort();
    });

    return () => {
      mountedRef.current = false;
      transcriptionControllerRef.current?.abort();
      unsubscribeAuth();
    };
  }, []);

  useEffect(
    () => () => {
      recordingPressIntentRef.current = false;
      recordingSessionRef.current = false;
      if (audioRecorder.isRecording) {
        void audioRecorder.stop().catch(() => {});
      }
      void setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      }).catch(() => {});
    },
    [audioRecorder]
  );

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
        recordingPressIntentRef.current = false;
        Alert.alert(
          "Microphone permission required",
          "Please allow microphone access to use voice messages."
        );
        return;
      }

      if (!recordingPressIntentRef.current) return;

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });

      await audioRecorder.prepareToRecordAsync();
      if (!recordingPressIntentRef.current) {
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        });
        return;
      }
      recordingSessionRef.current = true;
      audioRecorder.record({ forDuration: MAX_RECORDING_SECONDS });
    } catch (error) {
      recordingPressIntentRef.current = false;
      recordingSessionRef.current = false;
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      }).catch(() => {});
      console.error("Failed to start recording:", error);

      Alert.alert(
        "Recording error",
        "Pantrio could not start recording. Please try again."
      );
    }
  };

  const stopRecordingAndTranscribe = async () => {
    recordingPressIntentRef.current = false;
    if (!recordingSessionRef.current && !audioRecorder.isRecording) {
      return;
    }

    recordingSessionRef.current = false;

    try {
      if (audioRecorder.isRecording) {
        await audioRecorder.stop();
      }

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
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      }).catch(() => {});
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
    setTranscribing(true);
    transcriptionControllerRef.current?.abort();
    const controller = new AbortController();
    transcriptionControllerRef.current = controller;
    const timeoutId = setTimeout(
      () => controller.abort(),
      TRANSCRIPTION_TIMEOUT_MS
    );

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
        `${API_BASE_URL}/api/transcriptions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
          body: formData,
          signal: controller.signal,
        }
      );
  
      const responseText = await response.text();
      const data = parseBackendResponseText(responseText);

      if (data?.quota) {
        updateQuota(data.quota);
      }
  
      if (!response.ok) {
        throw createBackendResponseError(data, {
          status: response.status,
          fallbackMessage: `Transcription failed with status ${response.status}.`,
        });
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

      if (error?.quota) {
        updateQuota(error.quota);
      }

      if (mountedRef.current) {
        Alert.alert(
          "Voice Transcription",
          error?.name === "AbortError"
            ? "The transcription request timed out. Please try again."
            : error.message || "Failed to transcribe recording."
        );
      }
    } finally {
      clearTimeout(timeoutId);
      if (transcriptionControllerRef.current === controller) {
        transcriptionControllerRef.current = null;
      }
      if (mountedRef.current) setTranscribing(false);
    }
  };

  const handlePressIn = async () => {
    recordingPressIntentRef.current = true;
    await startRecording();
  };

  const handlePressOut = async () => {
    await stopRecordingAndTranscribe();
  };

  const leaveVoiceMode = async () => {
    recordingPressIntentRef.current = false;
    recordingSessionRef.current = false;

    try {
      if (audioRecorder.isRecording) {
        await audioRecorder.stop();
      }
    } catch (error) {
      console.error("Failed to cancel recording:", error);
    } finally {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      }).catch(() => {});
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
