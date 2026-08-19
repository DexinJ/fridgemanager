const { loadProjectEnv } = require("@expo/env");

loadProjectEnv(process.cwd(), { silent: true });

const GOOGLE_SIGN_IN_PLUGIN = "@react-native-google-signin/google-signin";
const BUILD_PROPERTIES_PLUGIN = "expo-build-properties";
const GOOGLE_CLIENT_ID_SUFFIX = ".apps.googleusercontent.com";
const REQUIRED_EAS_ENV = [
  "EXPO_PUBLIC_API_BASE_URL",
  "EXPO_PUBLIC_WS_URL",
  "EXPO_PUBLIC_FIREBASE_API_KEY",
  "EXPO_PUBLIC_FIREBASE_APP_ID",
  "EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN",
  "EXPO_PUBLIC_FIREBASE_PROJECT_ID",
  "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID",
  "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID",
];

function envValue(name) {
  return String(process.env[name] || "").trim();
}

function googleIosUrlScheme(clientId) {
  if (!clientId.endsWith(GOOGLE_CLIENT_ID_SUFFIX)) {
    throw new Error(
      "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID must be an iOS OAuth client ID ending in .apps.googleusercontent.com."
    );
  }

  const clientIdPrefix = clientId.slice(0, -GOOGLE_CLIENT_ID_SUFFIX.length);
  return `com.googleusercontent.apps.${clientIdPrefix}`;
}

function pluginName(plugin) {
  return Array.isArray(plugin) ? plugin[0] : plugin;
}

function validateExpoProject(config) {
  const projectId = String(config.extra?.eas?.projectId || "").trim();
  const updatesUrl = String(config.updates?.url || "").replace(/\/$/, "");
  const expectedUpdatesUrl = `https://u.expo.dev/${projectId}`;

  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(projectId)) {
    throw new Error("expo.extra.eas.projectId must be a valid EAS project UUID.");
  }
  if (updatesUrl !== expectedUpdatesUrl) {
    throw new Error(
      `expo.updates.url must match expo.extra.eas.projectId (${expectedUpdatesUrl}).`
    );
  }
}

function oauthProjectNumber(clientId, name) {
  const match = clientId.match(/^(\d+)-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/);
  if (!match) {
    throw new Error(`${name} is not a valid Google OAuth client ID.`);
  }
  return match[1];
}

function validateFirebaseGoogleProject() {
  const firebaseAppId = envValue("EXPO_PUBLIC_FIREBASE_APP_ID");
  const firebaseMatch = firebaseAppId.match(/^1:(\d+):(web|ios|android):/);
  if (!firebaseMatch) {
    throw new Error("EXPO_PUBLIC_FIREBASE_APP_ID is not a valid Firebase app ID.");
  }

  const firebaseProjectNumber = firebaseMatch[1];
  for (const name of [
    "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID",
    "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID",
  ]) {
    if (oauthProjectNumber(envValue(name), name) !== firebaseProjectNumber) {
      throw new Error(
        `${name} and EXPO_PUBLIC_FIREBASE_APP_ID must belong to the same Firebase/Google Cloud project.`
      );
    }
  }
}

function validateProductionUrl(name, protocol, { allowPathQuery = false } = {}) {
  const value = envValue(name);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }

  if (parsed.protocol !== protocol) {
    throw new Error(`${name} must use ${protocol} in production.`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${name} must not contain credentials.`);
  }
  const hostname = parsed.hostname.toLowerCase();
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(hostname)) {
    throw new Error(`${name} must not use a loopback host in production.`);
  }
  if (!allowPathQuery && (parsed.search || parsed.hash)) {
    throw new Error(`${name} must not contain a query string or fragment.`);
  }
}

function validateBuildEnvironment(productionBuild) {
  const requiredNames = productionBuild
    ? [
        ...REQUIRED_EAS_ENV,
        "EXPO_PUBLIC_APPLE_SUBSCRIPTION_PRODUCT_IDS",
        "EXPO_PUBLIC_PRIVACY_POLICY_URL",
      ]
    : REQUIRED_EAS_ENV;
  const missing = requiredNames.filter((name) => !envValue(name));
  if (missing.length) {
    throw new Error(
      `Missing required variables in the selected build environment: ${missing.join(", ")}.`
    );
  }

  validateFirebaseGoogleProject();
  if (!productionBuild) return;

  validateProductionUrl("EXPO_PUBLIC_API_BASE_URL", "https:");
  validateProductionUrl("EXPO_PUBLIC_WS_URL", "wss:");
  validateProductionUrl("EXPO_PUBLIC_PRIVACY_POLICY_URL", "https:", {
    allowPathQuery: true,
  });
  if (envValue("EXPO_PUBLIC_TERMS_OF_USE_URL")) {
    validateProductionUrl("EXPO_PUBLIC_TERMS_OF_USE_URL", "https:", {
      allowPathQuery: true,
    });
  }
}

function hardenBuildProperties(plugins, productionBuild) {
  if (!productionBuild) return plugins;
  return plugins.map((plugin) => {
    if (pluginName(plugin) !== BUILD_PROPERTIES_PLUGIN) return plugin;
    const options = Array.isArray(plugin) ? plugin[1] || {} : {};
    return [
      BUILD_PROPERTIES_PLUGIN,
      {
        ...options,
      },
    ];
  });
}

module.exports = ({ config }) => {
  const easBuild = process.env.EAS_BUILD === "true";
  const buildProfile = String(process.env.EAS_BUILD_PROFILE || "")
    .trim()
    .toLowerCase();
  const appEnvironment = envValue("EXPO_PUBLIC_APP_ENV").toLowerCase();
  if (
    appEnvironment &&
    !["production", "development", "test"].includes(appEnvironment)
  ) {
    throw new Error(
      "EXPO_PUBLIC_APP_ENV must be production, development, or test."
    );
  }
  const productionBuild = appEnvironment
    ? appEnvironment === "production"
    : buildProfile
      ? buildProfile === "production"
      : process.env.NODE_ENV === "production";
  const configuredBuild = easBuild || productionBuild;
  const googleIosClientId = envValue("EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID");

  validateExpoProject(config);
  if (configuredBuild) validateBuildEnvironment(productionBuild);

  let plugins = (config.plugins || []).filter(
    (plugin) => pluginName(plugin) !== GOOGLE_SIGN_IN_PLUGIN
  );
  const applePluginIndex = plugins.findIndex(
    (plugin) => pluginName(plugin) === "expo-apple-authentication"
  );
  if (googleIosClientId) {
    plugins.splice(applePluginIndex + 1, 0, [
      GOOGLE_SIGN_IN_PLUGIN,
      { iosUrlScheme: googleIosUrlScheme(googleIosClientId) },
    ]);
  } else if (configuredBuild) {
    throw new Error(
      "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is required for app builds. Configure it in the selected build environment."
    );
  }
  plugins = hardenBuildProperties(plugins, productionBuild);

  const ios = {
    ...(config.ios || {}),
    infoPlist: {
      ...(config.ios?.infoPlist || {}),
      ...(productionBuild
        ? {
            NSAppTransportSecurity: {
              NSAllowsArbitraryLoads: false,
              NSAllowsArbitraryLoadsForMedia: false,
              NSAllowsArbitraryLoadsInWebContent: false,
            },
          }
        : {}),
    },
  };
  return {
    ...config,
    ios,
    plugins,
  };
};
