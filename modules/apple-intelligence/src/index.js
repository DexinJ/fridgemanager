import { requireNativeModule } from "expo-modules-core";
import { Platform } from "react-native";

let nativeModule;

function getNativeModule() {
  if (Platform.OS !== "ios") return null;
  nativeModule ??= requireNativeModule("AppleIntelligence");
  return nativeModule;
}

export async function getAppleIntelligenceAvailability() {
  if (Platform.OS !== "ios") {
    return {
      status: "unsupported_platform",
      available: false,
      reason: "Apple Intelligence is only available on supported Apple devices.",
    };
  }

  try {
    return await getNativeModule().getAvailability();
  } catch {
    return {
      status: "development_build_required",
      available: false,
      reason: "Apple Intelligence requires an iOS development or App Store build; it is not available in Expo Go.",
    };
  }
}

export async function openAppleIntelligenceSettings() {
  return !!(await getNativeModule()?.openSettings());
}

export async function generateWithAppleIntelligence(instructions, prompt) {
  const module = getNativeModule();
  if (!module) throw new Error("Apple Intelligence is only available on iOS.");
  return module.generate(instructions, prompt);
}
