# Ride — Mobile App (Expo)

The rider + driver mobile app for **Ride**. Built with Expo SDK 54 and Expo Router (file-based routing).

See the [root README](../README.md) for the full project overview, API reference, and deployment guide.

---

## Quick start

```bash
yarn install
yarn start
```

Then press:
- `w` → open in web browser
- `a` → Android emulator
- `i` → iOS simulator
- or scan the QR with **Expo Go** on your phone

## Required env (`frontend/.env`)

```bash
EXPO_PUBLIC_BACKEND_URL=https://<your-backend-host>
EXPO_PUBLIC_MS_CLIENT_ID=<Azure AD client id>
EXPO_PUBLIC_MS_TENANT_ID=<Azure AD tenant id>
```

Other env vars (`EXPO_PACKAGER_PROXY_URL`, `EXPO_PACKAGER_HOSTNAME`) are managed by Emergent — **do not modify**.

---

## Project layout

```
frontend/
├── app/                        # Expo Router routes
│   ├── _layout.tsx             # Auth provider + nav stack
│   ├── index.tsx               # Welcome screen
│   ├── login.tsx
│   ├── register.tsx
│   ├── payment-success.tsx     # Captures PayPal order, then polls status
│   ├── auth/
│   │   ├── callback.tsx        # Google (Emergent) callback
│   │   └── microsoft-callback.tsx
│   ├── rider/                  # Rider tabs
│   │   ├── _layout.tsx
│   │   ├── home.tsx            # Request ride + active ride card + LocationPicker
│   │   ├── history.tsx
│   │   └── profile.tsx
│   └── driver/                 # Driver tabs
│       ├── _layout.tsx
│       ├── home.tsx            # Subscription tiers + available rides + active ride
│       ├── earnings.tsx
│       └── profile.tsx
└── src/                        # Shared (non-route) code
    ├── api.ts                  # Axios client + token storage abstraction
    ├── auth.tsx                # Auth context provider
    ├── socialAuth.ts           # Google / Facebook / Microsoft helpers
    ├── SocialButtons.tsx       # 3 social-login buttons
    ├── LocationPicker.tsx      # Search-only modal (Azure Maps via backend proxy)
    ├── MapPanel.tsx            # Waypoints card + "Open in Maps" deep-link
    ├── navigate.ts             # Platform-aware deep-link to local maps app
    ├── geocode.ts              # In-memory cache + backend proxy for search/reverse
    ├── useRideSocket.ts        # WebSocket client (auto-reconnect, exponential backoff)
    ├── notifications.ts        # Local + remote push helpers
    ├── RatingModal.tsx
    ├── theme.ts                # Design tokens (Uber-styled palette)
    └── origin.ts
```

---

## Key architectural choices

- **No embedded map** — `react-native-maps` is *not* used in the runtime UI. Pickup/dropoff are picked via a search modal (Azure Maps Fuzzy + 280 ms debounce + in-memory cache). Trip navigation hands off to the **user's local maps app** (Apple Maps / Google Maps) via deep links — no Google Maps Android API key needed.
- **Auth tokens** stored via `expo-secure-store` on iOS/Android, `localStorage` on web. Same `api.ts` works on all three.
- **WebSocket** at `/api/ws/rides?token=…` with exponential-backoff reconnect for live ride updates and driver GPS streaming.
- **PayPal flow**: button → backend creates order → browser redirects to PayPal sandbox/live → user approves → returns to `/payment-success?session_id=…&token=…&PayerID=…` → frontend calls `POST /api/paypal/capture/{session_id}` → polls status until paid.
- **Microsoft sign-in**: full OAuth Authorization Code flow with state CSRF protection. Frontend opens `login.microsoftonline.com` → MS redirects to `/auth/microsoft-callback` → callback page exchanges the code via the backend.

---

## EAS builds

```bash
eas build --profile preview --platform ios       # internal distribution (TestFlight)
eas build --profile production --platform all    # store-bound
```

`app.json` already declares the Mexican-Spanish iOS permission strings and `LSApplicationQueriesSchemes` so the build passes App Store review without extra config.

---

## Useful links
- Expo Router docs → https://docs.expo.dev/router/introduction
- Expo SDK reference → https://docs.expo.dev/versions/latest
- Project root README → ../README.md
