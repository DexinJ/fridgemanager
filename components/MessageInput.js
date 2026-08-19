import { Ionicons } from "@expo/vector-icons";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as FileSystem from "expo-file-system/legacy";
import { useContext, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
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
import {
  COMPOSER_BORDER_WIDTH,
  calculateComposerLayout,
} from "../utils/composerLayout";
import {
  buildVoiceUploadFormData,
  mergeTranscriptIntoComposer,
  normalizeComposerText,
  shouldShowSendButton,
} from "../utils/voiceInput";
import PlusMenu from "./PlusMenu";

const MAX_RECORDING_SECONDS = 60;
const TRANSCRIPTION_TIMEOUT_MS = 90_000;
const VOICE_RECORDING_PRESET = {
  ...RecordingPresets.LOW_QUALITY,
  extension: ".m4a",
  sampleRate: 16_000,
  numberOfChannels: 1,
  bitRate: 32_000,
};

async function releaseRecordingFile(uri) {
  const normalizedUri = typeof uri === "string" ? uri.trim() : "";
  if (!normalizedUri) return;

  await FileSystem.deleteAsync(normalizedUri, { idempotent: true }).catch(
    () => {}
  );
}

export default function MessageInput({ value, onChangeText, onSend }) {
  const { settings, theme } = useContext(GlobalContext);
  const { receiving } = useContext(ChatContext);
  const { updateQuota } = useAccountSession();
  const { height: viewportHeight } = useWindowDimensions();

  const fontSize = settings?.ux?.fontSize || 16;
  const chatgptStyle = Boolean(settings?.chat?.chatgptStyle);

  const [composerContentHeight, setComposerContentHeight] = useState(0);
  const [voiceMode, setVoiceMode] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [recordingStarting, setRecordingStarting] = useState(false);
  const [recordingActive, setRecordingActive] = useState(false);
  const composerInputRef = useRef(null);
  const recordingSessionRef = useRef(false);
  const recordingPressIntentRef = useRef(false);
  const recordingStartPendingRef = useRef(false);
  const recordingLimitTimeoutRef = useRef(null);
  const transcriptionControllerRef = useRef(null);
  const mountedRef = useRef(false);
  const lifecycleGenerationRef = useRef(0);
  const recordingAttemptRef = useRef(0);

  const audioRecorder = useAudioRecorder(VOICE_RECORDING_PRESET);
  const recorderState = useAudioRecorderState(audioRecorder);
  const composerLayout = calculateComposerLayout({
    contentHeight:
      typeof value === "string" && value.length > 0
        ? composerContentHeight
        : 0,
    fontSize,
    viewportHeight,
  });

  useEffect(() => {
    mountedRef.current = true;
    lifecycleGenerationRef.current += 1;

    return () => {
      mountedRef.current = false;
      lifecycleGenerationRef.current += 1;
      recordingAttemptRef.current += 1;
      recordingStartPendingRef.current = false;
      clearTimeout(recordingLimitTimeoutRef.current);
      recordingLimitTimeoutRef.current = null;
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
        await releaseRecordingFile(audioRecorder.uri);
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
    recordingStarting ||
    recordingActive ||
    recorderState.isRecording;

  const isCurrentLifecycle = (generation) =>
    mountedRef.current && lifecycleGenerationRef.current === generation;

  const isCurrentRecordingAttempt = (generation, attempt) =>
    isCurrentLifecycle(generation) && recordingAttemptRef.current === attempt;

  const sendMessageSafely = (
    payload,
    generation = lifecycleGenerationRef.current
  ) => {
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

    const trimmedValue = normalizeComposerText(value);

    if (!trimmedValue) return;

    const sent = sendMessageSafely({
      text: trimmedValue,
      imageUri: null,
      isUser: true,
    });

    if (sent) onChangeText?.("");
  };

  const handleComposerTextChange = (nextValue) => {
    if (!nextValue) {
      setComposerContentHeight(0);
    }

    onChangeText?.(nextValue);
  };

  const handleSendImage = (imageData) => {
    if (receiving || transcribing) return;
    sendMessageSafely(imageData);
  };

  const startRecording = async (attempt) => {
    if (
      receiving ||
      transcribing ||
      recorderState.isRecording ||
      recordingStartPendingRef.current
    ) {
      return;
    }

    const generation = lifecycleGenerationRef.current;
    recordingStartPendingRef.current = true;
    setRecordingStarting(true);

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
      setRecordingActive(true);
      audioRecorder.record();
      clearTimeout(recordingLimitTimeoutRef.current);
      recordingLimitTimeoutRef.current = setTimeout(() => {
        recordingLimitTimeoutRef.current = null;
        if (isCurrentLifecycle(generation) && recordingSessionRef.current) {
          recordingAttemptRef.current += 1;
          void stopRecordingAndTranscribe();
        }
      }, MAX_RECORDING_SECONDS * 1_000);
    } catch (error) {
      if (isCurrentRecordingAttempt(generation, attempt)) {
        recordingPressIntentRef.current = false;
        recordingSessionRef.current = false;
        setRecordingActive(false);
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
    } finally {
      recordingStartPendingRef.current = false;
      if (isCurrentLifecycle(generation)) {
        setRecordingStarting(false);
      }
    }
  };

  const stopRecordingAndTranscribe = async () => {
    const generation = lifecycleGenerationRef.current;
    clearTimeout(recordingLimitTimeoutRef.current);
    recordingLimitTimeoutRef.current = null;
    recordingPressIntentRef.current = false;
    if (!recordingSessionRef.current && !audioRecorder.isRecording) {
      return;
    }

    recordingSessionRef.current = false;
    setRecordingActive(false);
    let recordingUri = null;

    try {
      if (audioRecorder.isRecording) {
        await audioRecorder.stop();
      }

      if (!isCurrentLifecycle(generation)) return;

      recordingUri = audioRecorder.uri;

      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      if (!isCurrentLifecycle(generation)) return;

      if (!recordingUri) {
        throw new Error("The recording did not produce a file.");
      }

      await transcribeAudio(recordingUri, generation);
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
    } finally {
      await releaseRecordingFile(recordingUri || audioRecorder.uri);
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
      const formData = await buildVoiceUploadFormData(uri);
  
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
  
      onChangeText?.(mergeTranscriptIntoComposer(value, transcript));
      setVoiceMode(false);
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

  const beginRecording = async () => {
    const attempt = recordingAttemptRef.current + 1;
    recordingAttemptRef.current = attempt;
    recordingPressIntentRef.current = true;
    await startRecording(attempt);
  };

  const enterVoiceMode = () => {
    setVoiceMode(true);
  };

  const leaveVoiceMode = async () => {
    const generation = lifecycleGenerationRef.current;
    recordingAttemptRef.current += 1;
    recordingStartPendingRef.current = false;
    recordingPressIntentRef.current = false;
    recordingSessionRef.current = false;
    setRecordingActive(false);
    clearTimeout(recordingLimitTimeoutRef.current);
    recordingLimitTimeoutRef.current = null;
    let recordingUri = audioRecorder.uri;

    try {
      if (audioRecorder.isRecording) {
        await audioRecorder.stop();
      }
      recordingUri = audioRecorder.uri || recordingUri;
    } catch (error) {
      console.error("Failed to cancel recording:", error);
    } finally {
      await releaseRecordingFile(recordingUri || audioRecorder.uri);
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      }).catch(() => {});
    }

    if (isCurrentLifecycle(generation)) setVoiceMode(false);
  };

  const voiceButtonText = transcribing
    ? "Transcribing..."
    : recordingStarting
      ? "Starting..."
      : recorderState.isRecording || recordingActive
        ? "Release to Transcribe"
        : receiving
          ? "Waiting..."
          : "Hold to Talk";
  const showSendButton = shouldShowSendButton(value);

  return (
    <View
      style={[
        styles.container,
        chatgptStyle ? styles.containerChatgpt : null,
        {
          borderColor: theme.border,
          backgroundColor: chatgptStyle ? theme.inputBackground : theme.card,
        },
      ]}
    >
      <PlusMenu onSend={handleSendImage} />

      {!voiceMode ? (
        <>
          <TextInput
            ref={composerInputRef}
            editable={!receiving && !transcribing}
            multiline
            scrollEnabled={composerLayout.scrollEnabled}
            style={[
              styles.input,
              chatgptStyle ? styles.inputChatgpt : null,
              {
                fontSize,
                lineHeight: composerLayout.lineHeight,
                maxHeight: composerLayout.maximumHeight,
                minHeight: composerLayout.minimumHeight,
                paddingVertical: composerLayout.paddingVertical,
                color: theme.inputText,
                backgroundColor: chatgptStyle
                  ? "transparent"
                  : theme.inputBackground,
                borderColor: theme.border,
              },
            ]}
            value={value}
            onChangeText={handleComposerTextChange}
            onContentSizeChange={({ nativeEvent }) => {
              setComposerContentHeight(nativeEvent.contentSize.height);
            }}
            placeholder={
              receiving
                ? "Waiting for response..."
                : transcribing
                  ? "Transcribing..."
                  : chatgptStyle
                    ? "Message Pantrio AI…"
                    : "Type a message..."
            }
            placeholderTextColor={theme.textPlaceholder}
            submitBehavior="newline"
            textAlignVertical="top"
            accessibilityLabel="Chat message"
            accessibilityHint="Type a message, then tap Send. Press Enter for a new line."
          />

          <TouchableOpacity
            style={[
              styles.micButton,
              {
                backgroundColor: theme.actionButton,
                opacity: receiving || transcribing ? 0.5 : 1,
              },
            ]}
            onPress={showSendButton ? handleSendText : enterVoiceMode}
            disabled={receiving || transcribing}
            accessibilityRole="button"
            accessibilityLabel={
              showSendButton ? "Send message" : "Use voice input"
            }
            accessibilityHint={
              showSendButton
                ? "Send the text in the chat message field."
                : "Open voice transcription controls."
            }
            accessibilityState={{ disabled: receiving || transcribing }}
          >
            <Ionicons
              name={showSendButton ? "send" : "mic"}
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
                borderColor:
                  recorderState.isRecording || recordingActive
                    ? theme.actionButton
                    : theme.border,
                opacity: receiving || recordingStarting ? 0.5 : 1,
              },
            ]}
            onPressIn={beginRecording}
            onPressOut={stopRecordingAndTranscribe}
            disabled={receiving || transcribing}
            accessibilityRole="button"
            accessibilityLabel={voiceButtonText}
            accessibilityHint="Press and hold to record, then release to place the transcript in the message field."
            accessibilityState={{
              disabled: receiving || transcribing,
              busy: transcribing || recordingStarting,
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
    alignItems: "flex-end",
    borderTopWidth: 1,
  },
  containerChatgpt: {
    borderTopWidth: 0,
    borderRadius: 24,
    marginHorizontal: 10,
    marginBottom: 8,
    paddingVertical: 6,
  },
  input: {
    flex: 1,
    borderWidth: COMPOSER_BORDER_WIDTH,
    borderRadius: 20,
    paddingHorizontal: 15,
    marginHorizontal: 5,
  },
  inputChatgpt: {
    borderWidth: 0,
    marginHorizontal: 2,
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
