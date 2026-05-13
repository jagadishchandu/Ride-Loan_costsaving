# LendSplit — Product Requirements Document (PRD)

## Overview
LendSplit is a mobile-first app for tracking personal loans between individuals with automatic interest calculation, repayment tracking, and reminders. Supports two modes:
- **Private mode**: loans stored locally on-device (AsyncStorage). Only visible to the device owner.
- **Public mode**: loans stored in MongoDB and shared/linked with counterparties (when registered).

## Tech Stack
- **Frontend**: Expo React Native (SDK 54), Expo Router, lucide-react-native icons, Manrope + Work Sans + IBM Plex Mono fonts
- **Backend**: FastAPI, MongoDB (motor), JWT (PyJWT) + bcrypt password hashing
- **Auth**: JWT email/password + Emergent-managed Google Auth (dual support; single user model)
- **Storage**:
  - Private mode → AsyncStorage on device
  - Public mode → MongoDB cloud
- **Notifications**: expo-notifications (local) + Expo Push API for counterparty pushes
- **Crypto**: AES-256-GCM with PBKDF2 (100k iter) for encrypted private backups

## MVP Scope (Phase 1)
1. Dual auth (JWT email/password + Emergent Google Auth)
2. Mode toggle (Public/Private) on Home — accent recolors Forest Green ↔ Terracotta
3. Dashboard: total outstanding, lent, borrowed, monthly interest, active/overdue loans, recent loans
4. Loans list with filters (All / Active / Settled / Closed)
5. Add loan modal (counterparty, direction, principal, rate, dates, reminder, notes)
6. Loan detail (full metrics + settle/close/delete)
7. Reminders tab with expo-notifications permission flow
8. Subscription screen (MOCKED) — Free / Private Pro ₹10/mo / Public Pro ₹90/mo with PhonePe/Google Play/PayPal payment methods
9. Profile + logout

## Phase 2 Scope (Implemented)
1. **Partial repayments**
   - `payments` collection
   - `POST /api/loans/{id}/payments` records a payment (auto-settles loan when total_due hits 0)
   - `GET /api/loans/{id}/payments` returns history
   - All loan queries return `total_paid` and updated `total_due`
   - Dashboard summary subtracts payments
2. **Borrower acknowledgment**
   - LoanIn supports `request_acceptance: bool`
   - Loans created with `request_acceptance=true` and a registered counterparty start as `pending_acceptance`
   - `POST /api/loans/{id}/accept` (counterparty only) → status `active`
   - `POST /api/loans/{id}/reject` (counterparty only) → status `rejected`
   - `GET /api/loans/incoming` returns inbox for the logged-in counterparty
3. **Push notifications**
   - `POST /api/users/me/push-token` stores `expo_push_token` on user
   - Frontend auto-registers token on login (via expo-notifications)
   - Backend sends pushes to counterparty on: loan creation, payment recorded, accept/reject
4. **Encrypted private backup/export**
   - Client-side AES-256-GCM with PBKDF2-derived key from user passphrase
   - Export as base64 blob (`lendsplit-v1:<salt>:<iv>:<ct>`)
   - Restore overwrites local private loans
   - Wrong passphrase → "Wrong passphrase or corrupted backup" error

## Local Dev with Docker
- `docker-compose.yml` orchestrates `mongodb` + `backend` + `frontend`
- Run `docker compose up --build`, then open http://localhost:3000 (Expo web) or scan QR with Expo Go
- See `DOCKER.md` for full instructions

## Interest Calculation
Simple monthly interest only:
- `monthly_interest = principal × annual_rate / 1200`
- `accrued_interest = monthly_interest × months_elapsed`
- `total_due = principal + accrued_interest − total_paid`

## API Endpoints (all prefixed with /api)
### Auth
- `POST /auth/signup`, `POST /auth/login`, `POST /auth/google`, `GET /auth/me`, `POST /auth/logout`
### Contacts
- `POST /contacts`, `GET /contacts`, `GET /contacts/search?q=...`
### Loans
- `POST /loans` (public only; supports `request_acceptance` for pending status)
- `GET /loans?status=...`
- `GET /loans/incoming` — pending acknowledgment inbox
- `GET /loans/{id}`, `PATCH /loans/{id}`, `DELETE /loans/{id}`
- `POST /loans/{id}/accept`, `POST /loans/{id}/reject`
### Payments
- `POST /loans/{id}/payments`, `GET /loans/{id}/payments`
### Users
- `POST /users/me/push-token`
### Dashboard
- `GET /dashboard/summary`
### Subscription (MOCKED)
- `GET /subscription/plans`, `GET /subscription/status`, `POST /subscription/subscribe`

## Out of Scope (Future)
- Real payment integration (PhonePe / Google Play Billing / PayPal)
- Compound interest
- Multi-currency
- Web admin
- iOS/Android EAS production builds (handled by Emergent Publish button)

## Design Theme
Organic & Earthy (light mode). Forest Green for Public, Terracotta for Private, off-white background.
