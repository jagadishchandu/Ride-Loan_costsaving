# LendSplit — Frontend (Expo React Native)

Mobile-first cross-platform app for tracking personal loans. Built with Expo SDK 54 and Expo Router.

- **Runs on**: iOS, Android, and Web (the same code)
- **Navigation**: file-based routing via `expo-router`
- **Storage**:
  - Private mode loans → `AsyncStorage` on device
  - Encrypted backups → AES-256-GCM via Web Crypto / RN crypto polyfill
- **Fonts**: Manrope + Work Sans + IBM Plex Mono via `@expo-google-fonts`
- **Icons**: `lucide-react-native`

---

## Prerequisites

- Node.js **20+**
- Yarn **1.22+** (Classic)
- A running LendSplit backend (see [`../backend/README.md`](../backend/README.md))
- Optional: **Expo Go** app on your phone to test on real iOS / Android

---

## Local setup (without Docker)

### 1. Create a `.env`

```bash
cp .env.example .env
```

Default value works for browser/web testing on the same machine:

```env
EXPO_PUBLIC_BACKEND_URL=http://localhost:8001
```

> ⚠️ If you plan to test on a **real phone via Expo Go**, replace `localhost` with your computer's **LAN IP** (e.g. `http://192.168.1.5:8001`) so the phone can reach the backend over Wi-Fi.

Find your LAN IP:
- macOS: `ipconfig getifaddr en0`
- Linux: `hostname -I | awk '{print $1}'`
- Windows: `ipconfig` → look for "IPv4 Address"

### 2. Install dependencies

```bash
yarn install
```

### 3. Start the dev server

```bash
yarn start
```

This launches Expo on port 3000. You'll see:
- A QR code for Expo Go (scan with your phone, same Wi-Fi)
- `w` to open the web preview at http://localhost:3000
- `a` / `i` to open Android emulator / iOS Simulator

Press **`w`** for the fastest first-look.

---

## Running with Docker

From the **project root**:
```bash
docker compose up --build frontend
```

Or to start the full stack (mongo + backend + frontend):
```bash
docker compose up --build
```

When running under Compose, the frontend reads `frontend/.env.docker`. Edit `EXPO_PUBLIC_BACKEND_URL` there to your LAN IP if you want phone testing.

---

## Project layout

```
frontend/
├── app/                          ← file-based routes (every .tsx becomes a screen)
│   ├── _layout.tsx               root layout, font + auth + mode providers
│   ├── index.tsx                 redirector → /(tabs)
│   ├── (auth)/
│   │   ├── login.tsx
│   │   └── signup.tsx
│   ├── (tabs)/
│   │   ├── _layout.tsx           bottom tab nav (Home, Loans, +, Reminders, Profile)
│   │   ├── index.tsx             dashboard
│   │   ├── loans.tsx
│   │   ├── add.tsx               redirects to /add-loan modal
│   │   ├── reminders.tsx
│   │   └── profile.tsx
│   ├── loan/[id].tsx             loan detail
│   ├── payments/[id].tsx         partial repayments modal
│   ├── add-loan.tsx              new loan modal
│   ├── inbox.tsx                 incoming-loan requests
│   ├── backup.tsx                encrypted export / restore
│   └── subscription.tsx          pricing screen (MOCKED payments)
├── lib/
│   ├── api.ts                    axios + token helpers
│   ├── AuthContext.tsx
│   ├── ModeContext.tsx
│   ├── privateStorage.ts         AsyncStorage CRUD for private loans
│   ├── push.ts                   Expo push token registration
│   └── backup.ts                 AES-GCM encrypted export / restore
├── constants/
│   └── theme.ts                  colors, spacing, fonts, formatINR
├── .env                          local (not in git)
├── .env.example                  template
└── .env.docker                   used by docker compose
```

> **File-based routing rule of thumb**: anything inside `app/` becomes a URL. Grouped folders like `(auth)` and `(tabs)` are layout-only — they don't appear in the URL.

---

## Common workflows

### Add a new screen
1. Create `app/my-screen.tsx` with a default-exported React component.
2. Navigate from anywhere: `router.push('/my-screen')`.

### Add a new tab
1. Create `app/(tabs)/something.tsx`.
2. Register it in `app/(tabs)/_layout.tsx` with `<Tabs.Screen name="something" … />`.

### Reach an authenticated endpoint
```ts
import { api } from '../lib/api';
const { data } = await api.get('/loans');   // Bearer token auto-attached
```

### Switch theme accent when mode changes
```ts
import { useMode } from '../lib/ModeContext';
const { mode } = useMode();   // 'public' | 'private'
const accent = mode === 'private' ? colors.brand.private : colors.brand.public;
```

---

## Test credentials

| Field    | Value                  |
| -------- | ---------------------- |
| Email    | `demo@lendsplit.app`   |
| Password | `demo1234`             |

(Or sign up fresh from the Login screen.)

---

## Common pitfalls

- **Network request failed / 401 on `/auth/me`** → backend is not reachable. Verify `EXPO_PUBLIC_BACKEND_URL` in `.env` matches your running backend.
- **Phone can't connect via Expo Go** → phone & computer must be on the same Wi-Fi *and* `EXPO_PUBLIC_BACKEND_URL` must be a LAN IP (not `localhost`).
- **Push notifications don't fire on web** → expected. They only work in Expo Go or native builds.
- **Encrypted backup unavailable on web** → it works on web (uses `window.crypto.subtle`) and on iOS/Android (`globalThis.crypto`). If you see "Crypto unavailable", check the platform.
- **Fonts flash unstyled** → the root layout already gates rendering on `useFonts` completion; if you skip this and import a custom font directly, you'll see FOUC.

---

## Useful commands

```bash
yarn start              # launch Expo on port 3000
yarn lint               # run ESLint (config in eslint.config.js)
yarn add <package>      # add a dependency
yarn expo install <pkg> # add an Expo-compatible dependency (preferred)
```

---

## ⚠️ MOCKED integrations (highlighted)

- **Subscription payments** (`/api/subscription/subscribe`) — the UI lets you pick PhonePe / Google Play / PayPal but the backend doesn't move money. Replace with real SDKs for production.
- **Push notifications** — backend uses the real Expo Push API, but only real Expo Go-registered devices receive deliveries.

---

## Build for production (iOS / Android)

Use the **Publish** button in Emergent (top-right of the IDE). It handles APK/IPA builds and app-store submission. Don't try to run `eas build` locally unless you have your own Expo account & certificates configured.
