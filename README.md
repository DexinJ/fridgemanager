# Pantrio Client

Pantrio is a React Native mobile application built with Expo for managing fridge inventory, expiration dates, shopping lists, and AI-assisted food planning.

The client application provides the mobile interface, local data storage, Firebase authentication, backend API communication, image input, and AI chat features.

## Features

* Fridge, freezer, and pantry inventory management
* Expiration-date tracking
* Food urgency categories
* Shopping-list management
* AI-powered food and recipe assistant
* Image selection and food recognition support
* Firebase Authentication
* Light and dark themes
* Configurable notifications and expiration reminders
* Account profile management
* Account-linked Apple subscriptions with server-verified StoreKit transactions
* Permanent account deletion
* Local offline data storage
* Chat history and memory management

## Technology Stack

* React Native
* Expo
* Expo Router
* JavaScript
* Firebase Authentication
* AsyncStorage
* WebSocket
* REST APIs
* OpenAI-powered backend services

## Requirements

Before running the app, install:

* Node.js 22.13.0 (the EAS profiles pin this version; other supported ranges
  are declared in `package.json`)
* npm
* Expo CLI or Expo Go
* Android Studio for Android emulation
* Xcode for iOS simulation on macOS
* A Firebase project
* A running Pantrio backend server

## Installation

Clone the repository:

```bash
git clone <your-client-repository-url>
cd <your-client-folder>
```

Install dependencies:

```bash
npm install
```

Start the Expo development server:

```bash
npx expo start
```

You can then open the application using:

* Expo Go
* An Android emulator
* An iOS simulator
* A development build

## Environment Variables

Create a `.env` file in the project root:

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.0.163:3000
EXPO_PUBLIC_WS_URL=ws://192.168.0.163:3000/chat
```

For production, replace the local addresses with your deployed HTTPS and secure WebSocket URLs:

```env
EXPO_PUBLIC_API_BASE_URL=https://api.example.com
EXPO_PUBLIC_WS_URL=wss://api.example.com/chat
```

Do not include a trailing slash in `EXPO_PUBLIC_API_BASE_URL`.

### Apple Subscriptions

The backend session catalog is the source of truth for purchasable plans. It
returns each App Store product ID with its internal `planId`; the iOS client
then asks StoreKit for localized name, description, price, currency, and
renewal period. Adding a plan therefore requires a backend catalog entry and
the matching App Store Connect product, rather than a new hard-coded screen.

An optional comma-separated product list can be used as a development fallback
before an authenticated backend session is available:

```env
EXPO_PUBLIC_APPLE_SUBSCRIPTION_PRODUCT_IDS=com.chilltech.pantrio.subscription.monthly,com.chilltech.pantrio.subscription.yearly
EXPO_PUBLIC_TERMS_OF_USE_URL=https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
EXPO_PUBLIC_PRIVACY_POLICY_URL=https://example.com/privacy
```

`EXPO_PUBLIC_PRIVACY_POLICY_URL` must be set to Pantrio's real, public privacy
policy before a production build. The app does not invent or default that URL.
If `EXPO_PUBLIC_TERMS_OF_USE_URL` is omitted, the UI links to Apple's standard
EULA.

The backend creates one stable anonymous `appAccountToken` UUID for every
Firebase user and returns it from `GET /api/session`. Every purchase includes
that UUID. The app sends Apple's signed transaction evidence to
`POST /api/subscriptions/apple/verify`, finishes only the transaction IDs the
backend accepts, and refreshes the authoritative session. Unfinished
transactions are retried at startup and on foreground; live StoreKit updates
use the same idempotent verification path. Restore Purchases is explicit and
cannot move a transaction between Pantrio accounts.

The Account settings screen renders backend catalog plans with StoreKit's
localized price and renewal period, plus Subscribe, Restore, Manage, Terms,
and Privacy actions. Paid access is based only on the backend-verified
entitlement, quota, and effective model returned in the session.

This feature detects only in-app subscriptions that belong to Pantrio; it
cannot inspect Apple Music, iCloud+, or subscriptions from other apps. It uses
a local native Expo module, so test it in an iOS development, TestFlight, or
App Store build rather than Expo Go. For authoritative updates while the app is
terminated, configure App Store Server Notifications V2 and verify signed
transactions in the backend.

Apple purchases made by development and TestFlight builds are Sandbox
transactions. The `preview` EAS environment must therefore point to a staging
backend that accepts Sandbox verification. The production backend remains
Production-only unless `APPLE_ALLOW_SANDBOX_IN_PRODUCTION=true` is enabled for
controlled testing; disable that override before public launch.

### Local Network Development

When testing on a physical phone, `localhost` refers to the phone itself, not your development computer.

Use your computer’s local network IP address:

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.x.x:3000
```

The phone and computer must be connected to the same network.

## Firebase Setup

Create a Firebase project and enable the authentication providers used by the app.

Common providers include:

* Email and password
* Google
* Apple

The app uses the Firebase JavaScript SDK. Copy `.env.example` to `.env` and
provide the Firebase Web app configuration used by `auth/firebaseClient.js`:

```env
EXPO_PUBLIC_FIREBASE_API_KEY=your_api_key
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
EXPO_PUBLIC_FIREBASE_APP_ID=your_app_id
```

For native Google Sign-In on iOS, register an iOS app in the same Firebase
project with bundle ID `com.chilltech.pantrio`. Copy its iOS OAuth `CLIENT_ID`
to `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, and keep the project's Web OAuth client
in `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. `app.config.js` derives the required
reversed iOS URL scheme from the iOS client ID, so these values cannot drift.

This project deliberately uses the Google Sign-In config plugin's explicit
OAuth mode and does not bundle `GoogleService-Info.plist`; Firebase
Authentication receives the native Google ID token through the JavaScript SDK.
The Expo config fails early if any required Firebase or Google value is absent.

Set both Google client IDs in the EAS `preview` and `production` environments.
The `preview` profile intentionally selects the EAS `preview` environment so it
can use staging endpoints without changing the production build.

All three EAS profiles select a matching environment and update channel:
`development`, `preview`, and `production`. Every EAS build requires the API,
WebSocket, Firebase, and Google values listed in `.env.example`. Production also
requires the Apple subscription product list and a public privacy-policy URL,
and rejects non-HTTPS API/legal URLs, non-WSS sockets, loopback hosts,
mismatched Firebase/Google project numbers, or an updates URL that does not
match the configured EAS project ID.

Run `npm run config:check` after pulling the target EAS environment and before
publishing an EAS Update. EAS does not expose a stable config-time "update in
progress" signal, so this explicit preflight applies the same production checks
without relying on an undocumented environment variable.

The runtime-version policy is `fingerprint`, so an update is delivered only to
binaries with the same native/config fingerprint. Publish updates to the
profile's channel and build a new binary whenever native dependencies or Expo
config change.

### Sentry builds

Store `SENTRY_AUTH_TOKEN` as an EAS **Secret** in every environment whose builds
should upload source maps. It is a build-only credential: never prefix it with
`EXPO_PUBLIC_`, put it in `app.json`, or commit its value. Give the token only
the organization/project release permissions required by Sentry. If a build is
intentionally run without source-map upload, set Sentry's documented disable
flag for that build rather than adding a placeholder token. The existing Sentry
Expo config plugin reads the real token from the build environment.

The EAS profiles pin a supported Node version. The iOS image/Xcode identifier is
left unpinned until the exact Expo SDK 57 image used by the project is confirmed
in EAS; do not guess an image name, because the custom Apple Intelligence module
requires an Xcode toolchain that includes Foundation Models.

Do not place Firebase Admin credentials or service-account JSON files in the client application.

## Project Structure

The exact structure may vary, but the client is organized similarly to:

```text
app/
├── (auth)/
│   └── AuthScreen.js
├── (tabs)/
│   ├── index.js
│   ├── chat.js
│   ├── fridge.js
│   ├── shopping.js
│   └── settings.js
└── _layout.js

api/
├── memoryManager.js
└── client.js

auth/
├── firebase.js
└── useAuth.js

components/
├── Header.js
├── MessageBubble.js
├── MessageInput.js
└── PlusMenu.js

context/
└── GlobalContext.js

assets/
├── images/
└── icons/
```

## Main Screens

### Home

The home screen displays general inventory information, expiration summaries, and shortcuts to important app features.

### Fridge

The fridge screen allows users to:

* Add food items
* Edit food items
* Delete food items
* Assign storage locations
* Assign food categories
* Add expiration dates
* Search and sort inventory
* Select multiple items
* Move items to the shopping list

Supported storage locations include:

* Fridge
* Freezer
* Pantry

### Shopping List

The shopping-list screen allows users to:

* Add shopping items
* Edit item names and quantities
* Categorize items
* Mark items as purchased
* Move purchased items into fridge inventory
* Delete items

### Chat

The chat screen communicates with the backend AI service.

It can use context from:

* Fridge inventory
* Shopping-list items
* User preferences
* Recent conversation history

Depending on backend support, the assistant may:

* Recommend recipes
* Find missing ingredients
* Add items to the fridge
* Add items to the shopping list
* Remove items
* Analyze uploaded food images

### Settings

The settings screen includes:

* Account information
* Login and logout
* Account deletion
* Theme settings
* Font-size settings
* Notification settings
* Expiration reminder settings
* Privacy controls
* Local data clearing
* Chat-history clearing
* AI model preferences

## Authentication

The client uses Firebase Authentication.

The authenticated Firebase user is available through the application’s authentication hook:

```js
const { user, loggedIn, signOut } = useAuth();
```

Authenticated backend requests send the Firebase ID token as a bearer token:

```js
const token = await user.getIdToken();

const response = await fetch(`${API_BASE_URL}/me`, {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});
```

For sensitive operations, force-refresh the token:

```js
const token = await user.getIdToken(true);
```

## Backend API

The client expects a separate backend service.

Common API routes include:

```text
GET    /health
GET    /me
POST   /api/users
GET    /api/users/:uid
PATCH  /api/users/me
DELETE /api/users/:uid
POST   /summarize
WS     /chat
```

### Create or Update User

```js
const token = await user.getIdToken();

await fetch(`${API_BASE_URL}/api/users`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    username: "Tony",
  }),
});
```

### Load User Profile

```js
const token = await user.getIdToken();

const response = await fetch(
  `${API_BASE_URL}/api/users/${user.uid}`,
  {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }
);
```

### Delete Account

Account deletion is available from:

```text
Settings → Account → Delete Account
```

The client sends an authenticated request:

```js
const token = await user.getIdToken(true);

const response = await fetch(
  `${API_BASE_URL}/api/users/${encodeURIComponent(user.uid)}`,
  {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }
);
```

After a successful response, the client:

1. Clears local application data
2. Clears chat history
3. Clears the local Firebase session
4. Redirects the user to the authentication screen

The backend is responsible for deleting:

* The user profile
* Associated server-side data
* The Firebase Authentication account

## Local Data Storage

The app uses UID-scoped AsyncStorage keys for fridge items, shopping items,
settings, chat messages, and chat summaries. Custom-provider credentials are
also UID-scoped in SecureStore. Use `getUserStorageKeys(uid)` rather than
hard-coded global keys when reading, writing, or clearing account data.

On upgrade, the first authenticated user claims any legacy unscoped local
data. Existing scoped values win, the old keys are removed after migration,
and another account cannot claim interrupted migration data.

The application’s `GlobalContext` centralizes most shared state and persistence behavior.

## WebSocket Chat

The AI chat can communicate with the backend through WebSocket.

Example connection:

```js
const socket = new WebSocket(
  process.env.EXPO_PUBLIC_WS_URL
);
```

A chat request may look like:

```js
socket.send(
  JSON.stringify({
    type: "start",
    requestId,
    token,
    model: "gpt-4o-mini",
    language: "en",
    messages,
  })
);
```

Possible server events include:

```text
hello
started
delta
tool_progress
tool
done
error
```

The client should close or cancel active requests when leaving the screen or starting a replacement request.

## Image Input

The app may use Expo Image Picker to select images from the camera or photo library.

Install the dependency if needed:

```bash
npx expo install expo-image-picker
```

For image manipulation:

```bash
npx expo install expo-image-manipulator
```

Images should be resized and compressed before being sent to the backend to reduce request size and latency.

## Themes

The app supports light, dark, and system-controlled themes.

Theme values are provided through `GlobalContext`.

Example:

```js
const { theme } = useContext(GlobalContext);
```

Common theme properties include:

```js
theme.background
theme.card
theme.border
theme.textPrimary
theme.textSecondary
theme.accent
theme.actionButton
theme.warning
theme.danger
theme.modalBackground
```

Avoid hardcoded colors when an equivalent theme value exists.

## Running on Android

Start Expo:

```bash
npx expo start
```

Run an Android development build:

```bash
npx expo run:android
```

Make sure the Android emulator or physical device can reach the backend server.

For Android emulators, the host machine may be available through:

```text
http://10.0.2.2:3000
```

For physical devices, use the computer’s local network IP address.

## Running on iOS

Start Expo:

```bash
npx expo start
```

Run an iOS development build:

```bash
npx expo run:ios
```

An iOS simulator requires macOS and Xcode.

## Development Builds

Some native features may not work inside Expo Go.

Create a development build with EAS:

```bash
npm install -g eas-cli
eas login
eas build:configure
```

Build for Android:

```bash
eas build --profile development --platform android
```

Build for iOS:

```bash
eas build --profile development --platform ios
```

## Production Builds

Build Android:

```bash
eas build --platform android
```

Build iOS:

```bash
eas build --platform ios
```

Submit builds:

```bash
eas submit --platform android
```

```bash
eas submit --platform ios
```

## Useful Commands

Start Expo:

```bash
npx expo start
```

Clear the Metro cache:

```bash
npx expo start --clear
```

Run Android:

```bash
npx expo run:android
```

Run iOS:

```bash
npx expo run:ios
```

Check the Expo project:

```bash
npx expo-doctor
```

Install an Expo-compatible dependency:

```bash
npx expo install <package-name>
```

## Troubleshooting

### The app cannot reach the backend

Check that:

* The backend server is running
* The API URL is correct
* The phone and computer are on the same network
* The backend is listening on an externally accessible interface
* The firewall allows the backend port
* The `.env` file has been loaded
* Expo has been restarted after changing environment variables

### Environment variable changes are not applied

Restart Expo and clear the cache:

```bash
npx expo start --clear
```

### Authentication requests return 401

Check that:

* The user is logged in
* The Firebase token is included
* The header begins with `Bearer `
* The backend uses the same Firebase project
* The token has not expired
* The backend Firebase Admin configuration is valid

### Delete account returns 403

The UID in the request URL must match the UID contained in the Firebase token.

Correct:

```text
DELETE /api/users/current-user-firebase-uid
```

The backend should never accept an arbitrary UID supplied by another user.

### The account is deleted but the app still appears logged in

After the backend deletes the account, clear the local Firebase session:

```js
await signOut();
```

Then reset local state and redirect:

```js
router.replace("/(auth)/AuthScreen");
```

### Expo does not detect `.env` changes

Stop the Expo process and restart it:

```bash
npx expo start --clear
```

## Security

* Never include OpenAI API keys in the mobile client.
* Never include Firebase Admin credentials in the mobile client.
* Never trust a UID provided by the client without verifying its Firebase token.
* Use HTTPS and secure WebSockets in production.
* Validate backend request bodies.
* Require authentication for account and user-data routes.
* Perform permanent account deletion on the backend.
* Do not log authentication tokens.
* Avoid committing `.env` files.

## Git Ignore

Your `.gitignore` should include:

```gitignore
node_modules/
.expo/
dist/
web-build/
.env
.env.*
!.env.example
*.jks
*.p8
*.p12
*.key
*.mobileprovision
GoogleService-Info.plist
google-services.json
```

Private signing credentials and server credentials must never be committed.

## Example Environment File

The tracked `.env.example` lists every required public build value. Copy it to
`.env` for local development and create matching EAS environment variables for
cloud builds. Never put a secret in an `EXPO_PUBLIC_*` variable because Expo
embeds those values in the client bundle.

## Privacy and Account Deletion

Users can permanently delete their account from within the app.

Account deletion should remove or initiate removal of:

* User profile information
* Server-side data associated with the account
* Firebase Authentication credentials
* Locally stored inventory
* Locally stored shopping-list data
* Chat history
* User settings

The app’s privacy policy should explain:

* What information is collected
* Why the information is collected
* How users can request deletion
* Which information may be retained
* Any legally required retention periods
* How users can contact the developer

## Contributing

1. Create a feature branch:

```bash
git checkout -b feature/feature-name
```

2. Make your changes.

3. Run the project and test the affected screens.

4. Commit the changes:

```bash
git add .
git commit -m "Add feature description"
```

5. Push the branch:

```bash
git push origin feature/feature-name
```

6. Open a pull request.

## Pantrio Support

Email: jindexin6@gmail.com

For bug reports, questions, or feedback, contact me by email or open a GitHub issue.

## License

```text
Copyright © 2026. All rights reserved.
```
