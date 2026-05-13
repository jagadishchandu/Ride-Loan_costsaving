# LendSplit 💸

> Track personal loans privately or share them with the borrower — with automatic monthly interest, partial repayments, reminders, and encrypted backups.

LendSplit is a mobile-first app (Expo React Native + FastAPI + MongoDB) for managing informal loans between individuals. It combines Splitwise-style sharing with proper loan tracking: simple monthly interest, monthly reminders, settle/close lifecycle, and a subscription tier.

- **Private mode** — loans stored only on your device (AsyncStorage), with optional AES-256 encrypted backup.
- **Public mode** — loans stored in the cloud (MongoDB), shared with linked counterparties, with push notifications.
- **Currency**: INR (₹) by default.
- **Subscription**: Free / Private Pro ₹10/month / Public Pro ₹90/month (payments **MOCKED** in MVP — wire your provider later).

---

## 📦 What's in the box

```
.
├── backend/                 FastAPI + MongoDB API server
├── frontend/                Expo React Native app (web + iOS + Android)
├── tests/                   Backend pytest suite
├── docker-compose.yml       One-shot local dev stack
├── Dockerfile.backend
├── Dockerfile.frontend
├── DOCKER.md                Detailed Docker guide
└── README.md                You are here
```

## 🧰 Tech stack
- **Frontend**: Expo SDK 54, Expo Router, lucide-react-native, expo-notifications, expo-secure-store
- **Backend**: FastAPI, Motor (async MongoDB), PyJWT, bcrypt, httpx
- **Auth**: JWT email/password + Emergent-managed Google Auth (single user model)
- **Crypto**: AES-256-GCM with PBKDF2 (100k iterations) for private-mode encrypted backups
- **Push**: Expo Push API (real tokens deliver; fake tokens are silently no-op)

---

## 🚀 Quick start

You have two ways to run LendSplit locally.

### Option A — One command with Docker (recommended)

Prerequisites: Docker Desktop 4.x+ (or Docker Engine on Linux) with Compose v2.

```bash
git clone <your-repo-url> lendsplit
cd lendsplit
docker compose up --build
```

First build takes 3–5 minutes. Then open:
- Web preview → http://localhost:3000
- Backend API → http://localhost:8001/api/
- Phone (Expo Go) → scan the QR code that prints in the `frontend` container logs

📘 **Full Docker guide**: see [`DOCKER.md`](./DOCKER.md) — including LAN IP setup for testing on a real phone, reset commands, and troubleshooting.

### Option B — Without Docker (manual setup)

Prerequisites:
- Python **3.11+**
- Node.js **20+** and Yarn 1.x
- MongoDB **7.x** running locally (or a remote URI)

Follow the per-service guides:
- 📘 [`backend/README.md`](./backend/README.md)
- 📘 [`frontend/README.md`](./frontend/README.md)

In short:
```bash
# Terminal 1 — backend
cd backend
cp .env.example .env             # then edit if needed
pip install -r requirements.txt
uvicorn server:app --reload --host 0.0.0.0 --port 8001

# Terminal 2 — frontend
cd frontend
cp .env.example .env             # then edit if needed
yarn install
yarn start                       # opens Expo dev tools on :3000
```

---

## 🔑 Demo credentials

A working account is auto-created on first signup. You can either sign up fresh from the app or use:

| Field    | Value                  |
| -------- | ---------------------- |
| Email    | `demo@lendsplit.app`   |
| Password | `demo1234`             |

---

## ✨ Key features (already shipped)

### Phase 1 (MVP)
- JWT email/password auth + Emergent-managed Google sign-in
- Public/Private mode toggle on Home — accent recolors Forest Green ↔ Terracotta
- Dashboard: total outstanding, lent, borrowed, monthly interest, active/overdue counts
- Add loan modal (counterparty, direction, principal, rate, dates, reminder, notes)
- Loan list with filters (All / Active / Settled / Closed)
- Loan detail with settle/close/delete
- Reminders tab with expo-notifications permission flow
- Subscription screen (PhonePe / Google Play / PayPal — **MOCKED** payments)
- Profile + logout

### Phase 2
- **Partial repayments**: payment history per loan; `total_due` auto-decreases; loan auto-settles when fully paid
- **Borrower acknowledgment**: opt-in `request_acceptance` flag → loan starts as `pending_acceptance`; counterparty sees Inbox + Accept/Decline
- **Push notifications**: Expo push tokens registered per user; backend fires pushes on loan create / accept / reject / payment
- **Encrypted private backup/export**: client-side AES-256-GCM + PBKDF2; export an opaque `lendsplit-v1:…` blob, restore with passphrase

---

## 🧪 Running tests

```bash
# Backend pytest suite (Phase 1 + Phase 2)
cd backend
pytest -v

# Or, with Docker
docker compose exec backend pytest /app/tests -v
```

The Phase 2 suite alone covers payments, acceptance flow, push tokens, and dashboard math.

---

## 🌐 API reference (high level)

All routes are prefixed with `/api`.

| Group | Endpoint | Notes |
| --- | --- | --- |
| Auth | `POST /auth/signup`, `POST /auth/login`, `POST /auth/google`, `GET /auth/me`, `POST /auth/logout` | JWT + Emergent session tokens both accepted |
| Loans | `POST /loans`, `GET /loans?status=…`, `GET /loans/{id}`, `PATCH /loans/{id}`, `DELETE /loans/{id}` | Public-mode only on server; private lives on device |
| Loans | `GET /loans/incoming`, `POST /loans/{id}/accept`, `POST /loans/{id}/reject` | Acknowledgment flow |
| Payments | `POST /loans/{id}/payments`, `GET /loans/{id}/payments` | Partial repayments |
| Contacts | `POST /contacts`, `GET /contacts`, `GET /contacts/search?q=…` | |
| Users | `POST /users/me/push-token` | Expo push token registration |
| Dashboard | `GET /dashboard/summary` | |
| Subscription | `GET /subscription/plans`, `GET /subscription/status`, `POST /subscription/subscribe` | Payments **MOCKED** |

Full schemas live in [`backend/server.py`](./backend/server.py).

---

## ⚠️ MOCKED integrations

These work end-to-end in the UI but do **not** call real third parties:

- **`POST /api/subscription/subscribe`** — accepts `payment_method` ∈ {`phonepe`, `google_play`, `paypal`} but doesn't move money. Replace with your merchant SDK before going live.
- **Push notifications** — backend uses the real Expo Push endpoint, but fake tokens never deliver. Real tokens from Expo Go on a phone *will* deliver.

---

## 📅 Roadmap

- [ ] Real payments (PhonePe / Google Play Billing / PayPal)
- [ ] Compound interest option
- [ ] Multi-currency
- [ ] Web admin / analytics
- [ ] iOS / Android EAS production builds (use the **Publish** button in Emergent)

---

## 📄 License

Private MVP — all rights reserved.
