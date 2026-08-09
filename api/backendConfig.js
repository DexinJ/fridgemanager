const DEFAULT_API_BASE_URL = "http://localhost:3000";

function withoutTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

export function validateBackendUrl(value, { name, protocols }) {
  const configuredValue = String(value || "").trim();

  if (!configuredValue) {
    throw new Error(`${name} must not be empty.`);
  }

  let parsed;

  try {
    parsed = new URL(configuredValue);
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }

  if (!protocols.includes(parsed.protocol)) {
    throw new Error(
      `${name} must use one of these protocols: ${protocols.join(", ")}.`
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not contain credentials.`);
  }

  if (parsed.search || parsed.hash) {
    throw new Error(`${name} must not contain a query string or fragment.`);
  }

  return withoutTrailingSlash(parsed.toString());
}

export function websocketUrlFromApiBase(apiBaseUrl) {
  const parsed = new URL(apiBaseUrl);
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  parsed.pathname = `${withoutTrailingSlash(parsed.pathname)}/chat`;
  return parsed.toString();
}

export const API_BASE_URL = validateBackendUrl(
  process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_BASE_URL,
  {
    name: "EXPO_PUBLIC_API_BASE_URL",
    protocols: ["http:", "https:"],
  }
);

export const BACKEND_WS_URL = validateBackendUrl(
  process.env.EXPO_PUBLIC_WS_URL || websocketUrlFromApiBase(API_BASE_URL),
  {
    name: "EXPO_PUBLIC_WS_URL",
    protocols: ["ws:", "wss:"],
  }
);
