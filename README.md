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

* Node.js 18 or newer
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

Add the Firebase client configuration to your authentication configuration file.

Example:

```js
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
```

Firebase client configuration values may be placed in `.env`:

```env
EXPO_PUBLIC_FIREBASE_API_KEY=your_api_key
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
EXPO_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
EXPO_PUBLIC_FIREBASE_APP_ID=your_app_id
```

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

The app uses AsyncStorage for local persistence.

Common keys include:

```text
@fridgeItems
@shoppingListItems
@appSettings
@tags
@chatMessages
```

Example:

```js
await AsyncStorage.multiRemove([
  "@fridgeItems",
  "@shoppingListItems",
  "@appSettings",
  "@tags",
  "@chatMessages",
]);
```

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

Some Firebase client configuration files may be intentionally included depending on your project setup, but private signing credentials and server credentials must never be committed.

## Example Environment File

Create `.env.example`:

```env
EXPO_PUBLIC_API_BASE_URL=http://192.168.0.100:3000
EXPO_PUBLIC_WS_URL=ws://192.168.0.100:3000/chat

EXPO_PUBLIC_FIREBASE_API_KEY=
EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=
EXPO_PUBLIC_FIREBASE_PROJECT_ID=
EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET=
EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=
EXPO_PUBLIC_FIREBASE_APP_ID=
```

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

## License

```text
Copyright © 2026. All rights reserved.
```
