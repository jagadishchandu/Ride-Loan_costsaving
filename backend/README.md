# LendSplit — Backend (FastAPI + MongoDB)

The LendSplit API server. Handles authentication, loans, contacts, payments, acknowledgments, push notifications, and subscriptions.

- **Framework**: FastAPI (async)
- **Database**: MongoDB via [Motor](https://motor.readthedocs.io)
- **Auth**: JWT (PyJWT, HS256) + Emergent-managed Google Auth
- **Password hashing**: bcrypt via passlib
- **HTTP client**: httpx (for Google session lookup + Expo Push API)

---

## Prerequisites

- Python **3.11+**
- MongoDB **7.x** (local or remote)

---

## Local setup (without Docker)

### 1. Create a `.env`

```bash
cp .env.example .env
```

Edit it if your Mongo lives somewhere else:

```env
MONGO_URL=mongodb://localhost:27017
DB_NAME=lendsplit_db
JWT_SECRET=change-me-to-a-long-random-string-min-32-chars
```

Generate a strong secret with:
```bash
openssl rand -hex 32
```

### 2. Install dependencies

We recommend a virtualenv:

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Run

```bash
uvicorn server:app --reload --host 0.0.0.0 --port 8001
```

The API is now live at **http://localhost:8001/api/**.

Sanity check:
```bash
curl http://localhost:8001/api/
# {"status":"ok","app":"LendSplit"}
```

### 4. Smoke test (signup → login → loan → payment)

```bash
BASE=http://localhost:8001/api

# Signup
TOKEN=$(curl -s -X POST $BASE/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"secret123","name":"You"}' \
  | python3 -c "import sys,json;print(json.loads(sys.stdin.read())['access_token'])")

# Create a public loan
LOAN_ID=$(curl -s -X POST $BASE/loans \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"mode":"public","counterparty_name":"Friend","direction":"lent","principal_amount":5000,"interest_rate":12,"start_date":"2025-01-01","reminder_enabled":true,"reminder_day":1}' \
  | python3 -c "import sys,json;print(json.loads(sys.stdin.read())['loan_id'])")

# Record a ₹1500 payment
curl -s -X POST $BASE/loans/$LOAN_ID/payments \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"amount":1500,"note":"first installment"}'
```

---

## Running with Docker

From the **project root** (one level up):

```bash
docker compose up --build backend mongodb
```

Or just `docker compose up --build` to start everything (mongo + backend + frontend).

When running under Compose, the backend reads `backend/.env.docker` (Mongo URL points to the `mongodb` service name).

---

## Project layout

```
backend/
├── server.py          ← single-file FastAPI app (routes + models + helpers)
├── requirements.txt
├── .env               ← local env (not in git)
├── .env.example       ← template
└── .env.docker        ← used by docker compose
```

> **Heads-up**: `server.py` is ~700 lines. If/when you scale features further, split into routers (`routers/auth.py`, `routers/loans.py`, …).

---

## API surface

| Group | Endpoint | Auth | Notes |
| --- | --- | :-: | --- |
| Health | `GET /api/` | – | sanity ping |
| Auth | `POST /api/auth/signup` | – | `{email, password, name, phone?}` |
| Auth | `POST /api/auth/login` | – | `{email, password}` |
| Auth | `POST /api/auth/google` | – | `{session_id}` from Emergent OAuth |
| Auth | `GET /api/auth/me` | ✓ | accepts JWT **or** Emergent session token |
| Auth | `POST /api/auth/logout` | ✓ | |
| Contacts | `POST /api/contacts` | ✓ | auto-links if email matches a registered user |
| Contacts | `GET /api/contacts` | ✓ | |
| Contacts | `GET /api/contacts/search?q=…` | ✓ | by email or phone |
| Loans | `POST /api/loans` | ✓ | public-mode only; supports `request_acceptance: bool` |
| Loans | `GET /api/loans?status=…` | ✓ | filters: active / settled / closed / pending_acceptance / rejected |
| Loans | `GET /api/loans/incoming` | ✓ | inbox of loans awaiting your acknowledgment |
| Loans | `GET /api/loans/{id}` | ✓ | owner or counterparty |
| Loans | `PATCH /api/loans/{id}` | ✓ | owner only |
| Loans | `DELETE /api/loans/{id}` | ✓ | owner only; cascades payments |
| Loans | `POST /api/loans/{id}/accept` | ✓ | counterparty only; status → active |
| Loans | `POST /api/loans/{id}/reject` | ✓ | counterparty only; status → rejected |
| Payments | `POST /api/loans/{id}/payments` | ✓ | owner or counterparty; auto-settles when fully paid |
| Payments | `GET /api/loans/{id}/payments` | ✓ | |
| Users | `POST /api/users/me/push-token` | ✓ | `{expo_push_token}` |
| Dashboard | `GET /api/dashboard/summary` | ✓ | aggregates over public loans of current user |
| Subscription | `GET /api/subscription/plans` | – | |
| Subscription | `GET /api/subscription/status` | ✓ | |
| Subscription | `POST /api/subscription/subscribe` | ✓ | **MOCKED** — accepts phonepe / google_play / paypal |

### Interest formula
```
monthly_interest  = principal × annual_rate / 1200
accrued_interest  = monthly_interest × months_elapsed
total_due         = principal + accrued_interest − total_paid
```

---

## Running tests

```bash
cd backend
pytest -v
```

Or with Docker:
```bash
docker compose exec backend pytest /app/tests -v
```

---

## Common pitfalls

- **`pymongo.errors.ServerSelectionTimeoutError`** → Mongo isn't reachable. Check `MONGO_URL` in `.env`. Under Docker, must be `mongodb://mongodb:27017` (service name), **not** `localhost`.
- **`Email already registered`** on signup → user exists; use `POST /auth/login` instead.
- **`bcrypt __about__` warning on startup** → cosmetic, can be silenced by pinning `bcrypt<4`. Doesn't affect functionality.
- **Push notifications "succeed" but phone doesn't ring** → expected with fake/test tokens. Real delivery needs a real Expo push token from Expo Go on a phone.

---

## ⚠️ MOCKED endpoints (highlighted)

- `POST /api/subscription/subscribe` — payment activation is **MOCKED**. Replace with the real PhonePe / Google Play Billing / PayPal SDK before going live.
