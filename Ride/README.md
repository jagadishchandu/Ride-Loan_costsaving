# Ride

A ride-hailing mobile app that flips Uber's commission model on its head: drivers pay a flat **daily / weekly / monthly subscription** and keep **100% of every fare**.

> **Originally requested:** Clone Uber with a daily-subscription model for drivers (Kivy + ASP.NET + Docker).
> **Built on Emergent stack:** Expo (React Native) + FastAPI + MongoDB. Payments via PayPal, maps via Azure Maps, identity via JWT + Google/Facebook/Microsoft.
> The architecture, payment flow, and DB schema are agnostic — you could re-implement the UI in Kivy or the API in ASP.NET against the same MongoDB schema if you ever need to.

---

## Tech Stack

| Layer        | Tech                                                              |
|--------------|-------------------------------------------------------------------|
| Mobile app   | Expo SDK 54 (React Native) + Expo Router (file-based routing)     |
| Backend API  | FastAPI (Python 3.11) + Motor (async MongoDB driver)              |
| Database     | MongoDB                                                           |
| Auth         | JWT (Bearer) + bcrypt + Google (Emergent) + Facebook + **Microsoft (Azure AD)** |
| Payments     | **PayPal v2 REST** (sandbox / live, MXN by default)                |
| Maps         | **Azure Maps** (search + routing) — falls back to OpenStreetMap (Nominatim) + OSRM. Native app deep-links to **user's local maps app** (Apple Maps / Google Maps) for navigation — no embedded MapView, no Google Maps API key required. |
| Realtime     | WebSockets (`/api/ws/rides?token=…`) — ride lifecycle + driver GPS streaming |
| Storage      | `expo-secure-store` (iOS/Android), `localStorage` (web)            |

---

## Features

### Rider
- Email/password signup & login + Google / Facebook / Microsoft sign-in
- Map-style **pickup & dropoff picker** (search via Azure Maps, country-biased to MX, with "Use my location" GPS shortcut)
- **Auto-fare estimate** (real road distance + traffic-aware duration via Azure Maps Routing → OSRM → haversine fallback). Shows distance · ETA · suggested fare with one-tap "Use suggested" button.
- Live ride status (`requested → accepted → completed → paid`) over WebSocket
- See driver name + vehicle when accepted
- Active-ride card with pickup/dropoff/driver waypoints + **"Open in Maps"** button (deep-links to user's installed maps app)
- After driver completes the ride → pay driver via PayPal Checkout
- Rate driver (1-5 stars + comment)
- Trip history with paid / rating badges

### Driver
- Email/password signup & login (with vehicle info) + social logins
- **Subscription tiers** via PayPal Checkout — Daily $30 / Weekly $180 (Save $30) / Monthly $600 (Save $300) MXN. Drivers keep 100% of fares.
- Available-ride list (real-time WebSocket; 5 s polling fallback)
- Live location streaming (`expo-location`, ~10 s → `POST /api/driver/location` → broadcast to rider)
- Accept → Complete flow with **"Open in Maps"** turn-by-turn handoff to local maps app
- Earnings dashboard: total / paid / pending + per-trip breakdown
- Rate rider after completing a trip

### Payments (PayPal)
- Server-side amount lock (frontend cannot manipulate price)
- Idempotent — each `session_id` activates the subscription / ride payout exactly once
- **Two redundant activation paths**: synchronous capture endpoint called by the frontend after PayPal redirect + asynchronous webhook (`POST /api/webhook/paypal`)
- Sandbox / live mode swappable via env (`PAYPAL_MODE=sandbox|live`) with no code changes

### Configurable Fare Engine
All rates are read from `backend/.env` and applied globally at runtime:
```
FARE_BASE=10           # Flagdrop / base fare
FARE_PER_KM=6          # Per kilometer
FARE_PER_MIN=1.5       # Per minute
FARE_SERVICE=3         # Service fee
FARE_MIN=30            # Minimum fare
FARE_CURRENCY=MXN
```
Formula: `max(BASE + PER_KM·km + PER_MIN·min + SERVICE, MIN)`

---

## Project Structure

```
.
├── backend/                       # FastAPI server
│   ├── server.py                  # All routes + helpers (PayPal, Azure Maps, Auth, Rides, WS)
│   ├── requirements.txt
│   ├── Dockerfile
│   └── .env                       # Configured locally with sandbox keys
├── frontend/                      # Expo mobile app
│   ├── app/                       # Expo Router file-based routes
│   │   ├── index.tsx              # Welcome
│   │   ├── login.tsx
│   │   ├── register.tsx
│   │   ├── payment-success.tsx    # Captures PayPal order then polls status
│   │   ├── auth/
│   │   │   ├── callback.tsx       # Google
│   │   │   └── microsoft-callback.tsx
│   │   ├── rider/                 # Rider tabs (home / history / profile)
│   │   └── driver/                # Driver tabs (home / earnings / profile)
│   ├── src/
│   │   ├── api.ts                 # Axios client + token storage
│   │   ├── auth.tsx               # Auth context
│   │   ├── socialAuth.ts          # Google / Facebook / Microsoft helpers
│   │   ├── geocode.ts             # Backend-proxied search + reverse geocoding
│   │   ├── LocationPicker.tsx     # Search-only picker (no embedded map)
│   │   ├── MapPanel.tsx           # Trip waypoints + "Open in Maps" CTA
│   │   ├── navigate.ts            # Deep-link to user's local maps app
│   │   ├── useRideSocket.ts       # WebSocket client w/ exponential backoff
│   │   ├── theme.ts
│   │   └── notifications.ts
│   ├── app.json                   # Expo config + iOS LSApplicationQueriesSchemes
│   ├── eas.json                   # EAS Build profiles
│   └── package.json
├── docker-compose.yml             # 3-service stack (mongo, backend, frontend)
└── README.md
```

---

## Run on Emergent (zero setup)

The app is already running on Emergent's preview environment. Use the **preview URL** shown in the Emergent UI (web) or scan the QR code with **Expo Go** (mobile). Click **"Save to GitHub"** in the dashboard to push the codebase to your account.

---

## Run Locally with Docker

The whole stack (MongoDB + FastAPI backend + Expo frontend) boots from one command.

### 1. Prerequisites
- Docker Desktop (or Docker Engine + Compose v2) — `docker --version` and `docker compose version` must work
- Free TCP ports `27017`, `8001`, `8081`, `19000-19002` on the host

### 2. Configure secrets

Copy the template, then fill in whatever keys you have (everything is optional **except** `JWT_SECRET`):

```bash
cp .env.example .env        # if .env doesn't already exist
# then edit .env
```

Minimum to run:
```bash
JWT_SECRET=<run: openssl rand -hex 32>
DB_NAME=ride_db
EXPO_PUBLIC_BACKEND_URL=http://localhost:8001
```

Add the rest (`PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `AZURE_MAPS_KEY`, `AZURE_AD_*`, etc.) as you obtain them. Missing keys only disable the corresponding feature — the app still boots.

### 3. Build + run

```bash
docker compose up --build
```

| Service  | Port              | What it is                          |
|----------|-------------------|-------------------------------------|
| mongo    | 27017             | MongoDB 7 with persistent volume    |
| backend  | 8001              | FastAPI (`/api/...`)                |
| frontend | 8081, 19000-19002 | Expo Metro dev server               |

### 4. Open the app

- **Web**: http://localhost:8081 → press `w` in the Metro terminal, or just open the URL.
- **Backend health check**: http://localhost:8001/api/ should return `{"message":"Ride API is running","version":"2.0"}`.
- **Phone (Expo Go)**: set `REACT_NATIVE_PACKAGER_HOSTNAME` and `EXPO_PUBLIC_BACKEND_URL` in `.env` to your laptop's LAN IP, then rerun:
  ```bash
  # find your IP (macOS / Linux)
  ipconfig getifaddr en0    # or:  hostname -I | awk '{print $1}'
  # in .env:
  REACT_NATIVE_PACKAGER_HOSTNAME=192.168.1.42
  EXPO_PUBLIC_BACKEND_URL=http://192.168.1.42:8001
  docker compose up --build frontend
  ```
  Scan the QR code printed in the `ride_frontend` container logs with Expo Go.

### 5. Common ops

```bash
docker compose logs -f backend         # tail backend logs
docker compose logs -f frontend        # tail Metro logs
docker compose restart backend         # restart one service
docker compose down                    # stop everything (keeps data)
docker compose down -v                 # stop + wipe mongo data
```

Code changes:
- **Backend**: edit `backend/*.py` then `docker compose restart backend` (or rebuild with `--build` if `requirements.txt` changed).
- **Frontend**: `frontend/` is bind-mounted into the container, so Metro picks up changes live. Reload the browser / shake the device.

---

## Local Dev (without Docker)

```bash
# Backend (terminal 1)
cd backend
pip install -r requirements.txt
uvicorn server:app --reload --port 8001

# Frontend (terminal 2)
cd frontend
yarn install && yarn start
```

MongoDB needs to be running on `mongodb://localhost:27017`. Quick one-liner:

```bash
docker run -d --name ride-mongo -p 27017:27017 -v ride_mongo_data:/data/db mongo:7
```



---

## Required env vars (`backend/.env`)

```bash
# Core
MONGO_URL="mongodb://localhost:27017"
DB_NAME="ride_db"
JWT_SECRET="<random 64-char hex>"
DAILY_SUBSCRIPTION_AMOUNT=30.00

# PayPal — primary payment provider
PAYPAL_CLIENT_ID="<from developer.paypal.com>"
PAYPAL_SECRET="<from developer.paypal.com>"
PAYPAL_MODE="sandbox"            # or "live"
PAYPAL_CURRENCY="MXN"

# Fare engine (Mexico City defaults — tweak any value)
FARE_BASE=10
FARE_PER_KM=6
FARE_PER_MIN=1.5
FARE_SERVICE=3
FARE_MIN=30
FARE_CURRENCY="MXN"
OSRM_URL="https://router.project-osrm.org"

# Azure Maps — fast geocoding + traffic-aware routing
AZURE_MAPS_KEY="<from portal.azure.com → Azure Maps Account, Gen2 S0>"

# Microsoft (Azure AD) sign-in
AZURE_AD_CLIENT_ID="<from entra.microsoft.com → App registrations>"
AZURE_AD_TENANT_ID="<your tenant id>"
AZURE_AD_CLIENT_SECRET="<from Certificates & secrets — Value, not Id>"

# Optional Facebook login
FACEBOOK_APP_ID=""
FACEBOOK_APP_SECRET=""
```

## Required env vars (`frontend/.env`)

```bash
EXPO_PUBLIC_BACKEND_URL=https://<your-backend-host>

# Microsoft sign-in (matches AZURE_AD_* on the backend)
EXPO_PUBLIC_MS_CLIENT_ID=<same as AZURE_AD_CLIENT_ID>
EXPO_PUBLIC_MS_TENANT_ID=<same as AZURE_AD_TENANT_ID>
```

---

## API Reference

All routes are prefixed `/api`. Authenticated routes need `Authorization: Bearer <token>`.

### Auth
| Method | Path                       | Body                                                        |
|--------|----------------------------|-------------------------------------------------------------|
| POST   | `/auth/register`           | `{ email, password, name, role: "rider"|"driver", phone?, vehicle? }` |
| POST   | `/auth/login`              | `{ email, password }`                                       |
| GET    | `/auth/me`                 | —                                                           |
| GET    | `/auth/google?role=…`      | Emergent-managed Google OAuth                               |
| POST   | `/auth/facebook/login`     | `{ access_token, role }`                                    |
| POST   | `/auth/microsoft/login`    | `{ code, redirect_uri, role }` (OAuth Authorization Code)   |

### Rides
| Method | Path                       | Role   | Body / Notes                                                  |
|--------|----------------------------|--------|---------------------------------------------------------------|
| POST   | `/rides/estimate-fare`     | any    | `{ pickup_lat, pickup_lng, dropoff_lat, dropoff_lng }` → fare |
| POST   | `/rides`                   | rider  | `{ pickup_address, dropoff_address, estimated_fare, … }`      |
| GET    | `/rides/my`                | both   | Rider's or driver's history                                   |
| GET    | `/rides/available`         | driver | Requires active subscription                                   |
| POST   | `/rides/{id}/accept`       | driver | Requires active subscription                                   |
| POST   | `/rides/{id}/complete`     | driver |                                                                |
| POST   | `/rides/{id}/cancel`       | both   |                                                                |
| POST   | `/rides/{id}/rate`         | both   | `{ rating: 1-5, comment? }`                                   |
| WS     | `/ws/rides?token=<jwt>`    | both   | `ride.*` + `ride.location` events                             |

### Maps (proxied — backend keeps the Azure key)
| Method | Path                                | Notes                                       |
|--------|-------------------------------------|---------------------------------------------|
| GET    | `/maps/search?q=&country=MX&lat=&lng=` | Azure Search Fuzzy → Nominatim fallback   |
| GET    | `/maps/reverse?lat=&lng=`           | Azure → Nominatim fallback                  |

### Driver / Payments
| Method | Path                                       | Notes                                            |
|--------|--------------------------------------------|--------------------------------------------------|
| GET    | `/driver/subscription`                     | Current status + plans                           |
| POST   | `/driver/subscribe`                        | `{ plan_id: daily|weekly|monthly, origin_url }` → PayPal approve URL |
| POST   | `/rides/{id}/pay`                          | Rider pays driver via PayPal                     |
| POST   | `/paypal/capture/{session_id}`             | Idempotent capture (called from payment-success) |
| POST   | `/webhook/paypal`                          | PayPal webhook (idempotent backup)                |
| GET    | `/payments/checkout/status/{session_id}`   | Read txn status (paid / pending / failed)         |
| GET    | `/driver/earnings`                         | Total + completed rides                           |
| POST   | `/driver/location`                         | `{ lat, lng }` — driver GPS heartbeat             |

---

## Mobile build (EAS)

```bash
cd frontend
eas build --profile preview --platform ios     # internal distribution
eas build --profile production --platform all  # store-bound builds
```

The iOS build declares `LSApplicationQueriesSchemes` for `comgooglemaps`, `googlemaps`, `maps` so that **"Open in Maps"** can probe the user's installed maps app and pick the best one (Google Maps if installed, else Apple Maps).

---

## Going Live

1. **PayPal**: switch to a verified business account, create a Live App at https://developer.paypal.com → swap `PAYPAL_CLIENT_ID`/`PAYPAL_SECRET` and set `PAYPAL_MODE=live`. Optionally register the production webhook URL `<host>/api/webhook/paypal` and subscribe to `CHECKOUT.ORDER.APPROVED` + `PAYMENT.CAPTURE.COMPLETED`.
2. **Microsoft**: in your App registration → Authentication → add the **production redirect URI** `https://<your-host>/auth/microsoft-callback`.
3. **Azure Maps**: lock the key by allowed referrer / IP in the Azure portal.
4. **EAS**: run `eas build --profile production` for both platforms, then submit via `eas submit`.

---

## License
MIT
