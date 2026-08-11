const DEFAULT_API_BASE_URL = "http://localhost:3000";
const CONFIGURED_APP_ENV = String(
  process.env.EXPO_PUBLIC_APP_ENV || ""
).trim().toLowerCase();
const IS_DEVELOPMENT_BUILD =
  CONFIGURED_APP_ENV === "production"
    ? false
    : CONFIGURED_APP_ENV === "development" || CONFIGURED_APP_ENV === "test"
      ? true
      : typeof __DEV__ !== "undefined"
        ? __DEV__
        : process.env.NODE_ENV !== "production";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function withoutTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

export function validateBackendUrl(
  value,
  { name, protocols, allowLoopback = true }
) {
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

  if (!allowLoopback && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(`${name} must not use a loopback host in production.`);
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
  process.env.EXPO_PUBLIC_API_BASE_URL ||
    (IS_DEVELOPMENT_BUILD ? DEFAULT_API_BASE_URL : ""),
  {
    name: "EXPO_PUBLIC_API_BASE_URL",
    protocols: IS_DEVELOPMENT_BUILD ? ["http:", "https:"] : ["https:"],
    allowLoopback: IS_DEVELOPMENT_BUILD,
  }
);

export const BACKEND_WS_URL = validateBackendUrl(
  process.env.EXPO_PUBLIC_WS_URL || websocketUrlFromApiBase(API_BASE_URL),
  {
    name: "EXPO_PUBLIC_WS_URL",
    protocols: IS_DEVELOPMENT_BUILD ? ["ws:", "wss:"] : ["wss:"],
    allowLoopback: IS_DEVELOPMENT_BUILD,
  }
);
