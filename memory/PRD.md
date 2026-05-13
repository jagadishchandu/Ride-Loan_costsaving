# LendSplit — Product Requirements Document (PRD)

## Overview
LendSplit is a mobile-first app for tracking personal loans between individuals with automatic interest calculation and reminders. Supports two modes:
- **Private mode**: loans stored locally on-device (AsyncStorage). Only visible to the device owner.
- **Public mode**: loans stored in MongoDB and shared/linked with counterparties (when registered).

## Tech Stack
- Frontend: Expo React Native (SDK 54), Expo Router, lucide-react-native icons, Manrope + Work Sans + IBM Plex Mono fonts
- Backend: FastAPI, MongoDB (motor), JWT (PyJWT) + bcrypt password hashing
- Auth: JWT email/password + Emergent-managed Google Auth (dual support; single user model)
- Storage:
  - Private mode → AsyncStorage on device
  - Public mode → MongoDB cloud
- Notifications: expo-notifications (local device notifications)

## MVP Scope (Implemented)
1. **Auth**
   - JWT email/password (signup, login, /me, logout)
   - Emergent-managed Google Auth (web + native)
2. **Mode toggle**: prominent Public/Private switch on Home — accent color changes (Forest Green ↔ Terracotta)
3. **Dashboard**: total outstanding, lent, borrowed, monthly interest, active loans, overdue loans, recent loans list
4. **Loans list**: filter All/Active/Settled/Closed
5. **Add loan**: counterparty (name + email/phone), direction (lent/borrowed), amount, annual interest %, start date, due date, monthly reminder + day, notes
6. **Loan detail**: full breakdown (principal, monthly interest, accrued interest, total due, months elapsed), Settle/Close/Delete actions
7. **Reminders**: device permission toggle, list of active loans with monthly reminders
8. **Subscription (MOCKED)**: Free / Private Pro ₹10/mo / Public Pro ₹90/mo. Payment methods listed: PhonePe, Google Play, PayPal — UI activates subscription but payment is mocked.
9. **Profile**: user card, subscription status, logout

## Interest Calculation
Simple monthly interest only:
- `monthly_interest = principal × annual_rate / 1200`
- `accrued_interest = monthly_interest × months_elapsed`
- `total_due = principal + accrued_interest`

## API Endpoints (all prefixed with /api)
- `POST /auth/signup` — body: `{email, password, name, phone?}`
- `POST /auth/login` — body: `{email, password}`
- `POST /auth/google` — body: `{session_id}`
- `GET /auth/me` — Bearer token
- `POST /auth/logout`
- `POST /contacts` — `{name, email?, phone?}`
- `GET /contacts`
- `GET /contacts/search?q=...`
- `POST /loans` — public mode only (private kept on device)
- `GET /loans?status=...`
- `GET /loans/{id}`
- `PATCH /loans/{id}`
- `DELETE /loans/{id}`
- `GET /dashboard/summary`
- `GET /subscription/plans`
- `GET /subscription/status`
- `POST /subscription/subscribe` — `{tier, payment_method}` (MOCKED)

## Out of Scope (Future)
- Real payment integration (PhonePe / Google Play Billing / PayPal)
- Push notifications to counterparty
- Partial repayments & payment history
- Borrower acknowledgment workflow
- Encrypted private mode backup/export
- Compound interest, multi-currency

## Design Theme
Organic & Earthy (light mode). Forest Green for Public, Terracotta for Private, off-white background.
