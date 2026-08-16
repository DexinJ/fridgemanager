const AI_PROVIDER_VALUES = new Set(["pantrio", "apple", "custom"]);

export function resolveAiProvider(aiProvider, useCustomAi = false) {
  if (AI_PROVIDER_VALUES.has(aiProvider)) return aiProvider;
  return useCustomAi ? "custom" : "pantrio";
}
