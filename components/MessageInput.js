import { Ionicons } from "@expo/vector-icons";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
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
import { ChatContext, GlobalContext } from "../context/GlobalContext";
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
  const { settings, theme } = useContext(GlobalContext);
  const { receiving } = useContext(ChatContext);
  const { updateQuota } = useAccountSession();

  const fontSize = settings?.ux?.fontSize || 16;

  const [voiceMode, setVoiceMode] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recordingSessionRef = useRef(false);
  const recordingPressIntentRef = useRef(false);
  const transcriptionControllerRef = useRef(null);
  const mountedRef = useRef(false);
  const lifecycleGenerationRef = useRef(0);
  const recordingAttemptRef = useRef(0);

  const audioRecorder = useAudioRecorder(VOICE_RECORDING_PRESET);
  const recorderState = useAudioRecorderState(audioRecorder);

  useEffect(() => {
    mountedRef.current = true;
    lifecycleGenerationRef.current += 1;

    return () => {
      mountedRef.current = false;
      lifecycleGenerationRef.current += 1;
      recordingAttemptRef.current += 1;
      transcriptionControllerRef.current?.abort();
    };
  }, []);

  useEffect(
    () => () => {
      recordingPressIntentRef.current = false;
      recordingSessionRef.current = false;
      void (async () => {
        if (audioRecorder.isRecording) {
          await audioRecorder.stop().catch(() => {});
        }
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        }).catch(() => {});
      })();
    },
    [audioRecorder]
  );

  const isBusy =
    receiving ||
    transcribing ||
    recorderState.isRecording;

  const isCurrentLifecycle = (generation) =>
    mountedRef.current && lifecycleGenerationRef.current === generation;

  const isCurrentRecordingAttempt = (generation, attempt) =>
    isCurrentLifecycle(generation) && recordingAttemptRef.current === attempt;

  const sendMessageSafely = (payload, generation = lifecycleGenerationRef.current) => {
    if (!isCurrentLifecycle(generation)) return false;

    try {
      const result = onSend?.(payload);
      Promise.resolve(result).catch((error) => {
        if (isCurrentLifecycle(generation)) {
          console.error("Failed to send message:", error);
        }
      });
      return true;
    } catch (error) {
      console.error("Failed to send message:", error);
      return false;
    }
  };

  const handleSendText = () => {
    if (receiving || transcribing) return;

    const trimmedValue = typeof value === "string" ? value.trim() : "";

    if (!trimmedValue) return;

    const sent = sendMessageSafely({
      text: trimmedValue,
      imageUri: null,
      isUser: true,
    });

    if (sent) onChangeText?.("");
  };

  const handleSendImage = (imageData) => {
    if (receiving || transcribing) return;
    sendMessageSafely(imageData);
  };

  const startRecording = async (attempt) => {
    if (receiving || transcribing || recorderState.isRecording) {
      return;
    }

    const generation = lifecycleGenerationRef.current;

    try {
      const permission =
        await AudioModule.requestRecordingPermissionsAsync();

      if (!isCurrentRecordingAttempt(generation, attempt)) return;

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

      if (!isCurrentRecordingAttempt(generation, attempt)) {
        if (isCurrentLifecycle(generation) && !recordingPressIntentRef.current) {
          await setAudioModeAsync({
            allowsRecording: false,
            playsInSilentMode: true,
          }).catch(() => {});
        }
        return;
      }

      await audioRecorder.prepareToRecordAsync();
      if (
        !isCurrentRecordingAttempt(generation, attempt) ||
        !recordingPressIntentRef.current
      ) {
        if (isCurrentLifecycle(generation) && !recordingPressIntentRef.current) {
          await setAudioModeAsync({
            allowsRecording: false,
            playsInSilentMode: true,
          }).catch(() => {});
        }
        return;
      }
      recordingSessionRef.current = true;
      audioRecorder.record({ forDuration: MAX_RECORDING_SECONDS });
    } catch (error) {
      if (isCurrentRecordingAttempt(generation, attempt)) {
        recordingPressIntentRef.current = false;
        recordingSessionRef.current = false;
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        }).catch(() => {});
      }
      console.error("Failed to start recording:", error);

      if (isCurrentRecordingAttempt(generation, attempt)) {
        Alert.alert(
          "Recording error",
          "Pantrio could not start recording. Please try again."
        );
      }
    }
  };

  const stopRecordingAndTranscribe = async () => {
    const generation = lifecycleGenerationRef.current;
    recordingPressIntentRef.current = false;
    if (!recordingSessionRef.current && !audioRecorder.isRecording) {
      return;
    }

    recordingSessionRef.current = false;

    try {
      if (audioRecorder.isRecording) {
        await audioRecorder.stop();
      }

      if (!isCurrentLifecycle(generation)) return;

      const uri = audioRecorder.uri;

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      if (!isCurrentLifecycle(generation)) return;

      if (!uri) {
        throw new Error("The recording did not produce a file.");
      }

      await transcribeAudio(uri, generation);
    } catch (error) {
      if (isCurrentLifecycle(generation)) {
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
        }).catch(() => {});
      }
      console.error("Failed to stop or transcribe recording:", error);

      if (isCurrentLifecycle(generation)) {
        Alert.alert(
          "Voice message error",
          error instanceof Error
            ? error.message
            : "The recording could not be processed."
        );
      }
    }
  };

  const transcribeAudio = async (
    uri,
    generation = lifecycleGenerationRef.current
  ) => {
    if (!isCurrentLifecycle(generation)) return;
    setTranscribing(true);
    transcriptionControllerRef.current?.abort();
    const controller = new AbortController();
    transcriptionControllerRef.current = controller;
    let timedOut = false;
    const timeoutId = setTimeout(
      () => {
        timedOut = true;
        controller.abort();
      },
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

      if (
        !isCurrentLifecycle(generation) ||
        transcriptionControllerRef.current !== controller
      ) {
        return;
      }
  
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

      if (
        !isCurrentLifecycle(generation) ||
        transcriptionControllerRef.current !== controller
      ) {
        return;
      }

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
  
      sendMessageSafely({
        text: transcript,
        imageUri: null,
        isUser: true,
      }, generation);
    } catch (error) {
      const isCurrentRequest =
        isCurrentLifecycle(generation) &&
        transcriptionControllerRef.current === controller;
      if (!isCurrentRequest) return;

      console.error("Transcription failed:", error);

      if (error?.quota) {
        updateQuota(error.quota);
      }

      if (error?.name !== "AbortError" || timedOut) {
        Alert.alert(
          "Voice Transcription",
          timedOut
            ? "The transcription request timed out. Please try again."
            : error?.message || String(error || "Failed to transcribe recording.")
        );
      }
    } finally {
      clearTimeout(timeoutId);
      const ownsController = transcriptionControllerRef.current === controller;
      if (ownsController) {
        transcriptionControllerRef.current = null;
      }
      if (ownsController && isCurrentLifecycle(generation)) {
        setTranscribing(false);
      }
    }
  };

  const handlePressIn = async () => {
    const attempt = recordingAttemptRef.current + 1;
    recordingAttemptRef.current = attempt;
    recordingPressIntentRef.current = true;
    await startRecording(attempt);
  };

  const handlePressOut = async () => {
    recordingAttemptRef.current += 1;
    await stopRecordingAndTranscribe();
  };

  const leaveVoiceMode = async () => {
    const generation = lifecycleGenerationRef.current;
    recordingAttemptRef.current += 1;
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

    if (isCurrentLifecycle(generation)) setVoiceMode(false);
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
            accessibilityLabel="Chat message"
            accessibilityHint="Type a message, then use the keyboard send action."
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
            accessibilityRole="button"
            accessibilityLabel="Use voice input"
            accessibilityState={{ disabled: receiving || transcribing }}
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
            accessibilityRole="button"
            accessibilityLabel={voiceButtonText}
            accessibilityHint="Press and hold to record, then release to transcribe and send."
            accessibilityState={{
              disabled: receiving || transcribing,
              busy: transcribing,
            }}
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
            accessibilityRole="button"
            accessibilityLabel="Close voice input"
            accessibilityState={{ disabled: isBusy, busy: transcribing }}
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
