from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import json
import logging
import uuid
import asyncio
import bcrypt
import jwt
import httpx
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Literal, Set

from fastapi import (
    FastAPI, APIRouter, HTTPException, Depends, Request,
    WebSocket, WebSocketDisconnect, Query,
)
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

# ----------------- DB -----------------
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# ----------------- App -----------------
app = FastAPI(title="Ride API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

JWT_ALGORITHM = "HS256"
JWT_SECRET = os.environ["JWT_SECRET"]
MP_ACCESS_TOKEN = ""  # legacy — payments migrated to PayPal
DAILY_SUB_AMOUNT = float(os.environ.get("DAILY_SUBSCRIPTION_AMOUNT", "30.00"))

FB_APP_ID = os.environ.get("FACEBOOK_APP_ID", "")
FB_APP_SECRET = os.environ.get("FACEBOOK_APP_SECRET", "")
GMAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY", "")
EMERGENT_AUTH_SESSION_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"

# Microsoft / Azure AD sign-in
AZURE_AD_CLIENT_ID = os.environ.get("AZURE_AD_CLIENT_ID", "").strip()
AZURE_AD_TENANT_ID = os.environ.get("AZURE_AD_TENANT_ID", "common").strip() or "common"
AZURE_AD_CLIENT_SECRET = os.environ.get("AZURE_AD_CLIENT_SECRET", "").strip()

# PayPal — primary payment provider
PAYPAL_CLIENT_ID = os.environ.get("PAYPAL_CLIENT_ID", "").strip()
PAYPAL_SECRET = os.environ.get("PAYPAL_SECRET", "").strip()
PAYPAL_MODE = os.environ.get("PAYPAL_MODE", "sandbox").strip().lower()
PAYPAL_CURRENCY = os.environ.get("PAYPAL_CURRENCY", "MXN").strip().upper()
PAYPAL_BASE = (
    "https://api-m.sandbox.paypal.com" if PAYPAL_MODE == "sandbox" else "https://api-m.paypal.com"
)

# Admin configuration for payment fallback
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "jagadishchandu789@gmail.com").strip()
ADMIN_PAYPAL_EMAIL = os.environ.get("ADMIN_PAYPAL_EMAIL", "jagadishchandu789@gmail.com").strip()

# SMTP configuration for email notifications
SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com").strip()
SMTP_PORT = int(os.environ.get("SMTP_PORT", "587"))
SMTP_USER = os.environ.get("SMTP_USER", "").strip()
SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "").strip()
SMTP_FROM_EMAIL = os.environ.get("SMTP_FROM_EMAIL", SMTP_USER).strip()


async def _paypal_token() -> str:
    """OAuth2 client credentials grant — fetches a fresh PayPal access token."""
    if not PAYPAL_CLIENT_ID or not PAYPAL_SECRET:
        raise HTTPException(
            status_code=503,
            detail="PayPal not configured. Set PAYPAL_CLIENT_ID and PAYPAL_SECRET in backend/.env",
        )
    async with httpx.AsyncClient(timeout=10) as cx:
        r = await cx.post(
            f"{PAYPAL_BASE}/v1/oauth2/token",
            data={"grant_type": "client_credentials"},
            auth=(PAYPAL_CLIENT_ID, PAYPAL_SECRET),
            headers={"Accept": "application/json", "Accept-Language": "en_US"},
        )
    if r.status_code != 200:
        logger.error("PayPal token error %s: %s", r.status_code, r.text)
        raise HTTPException(status_code=502, detail="PayPal auth failed")
    return r.json()["access_token"]


async def _paypal_create_order(
    amount: float,
    description: str,
    return_url: str,
    cancel_url: str,
    custom_id: str,
    currency: str = None,
    payee_email: Optional[str] = None,
) -> dict:
    """
    Creates a PayPal Order (v2). Returns {id, approve_url}.

    When `payee_email` is provided, funds are deposited directly into that
    PayPal account (third-party payee flow) instead of the platform's account.
    Used for ride payments so each driver gets paid directly.
    """
    token = await _paypal_token()
    purchase_unit: dict = {
        "amount": {
            "currency_code": (currency or PAYPAL_CURRENCY),
            "value": f"{float(amount):.2f}",
        },
        "description": description[:127],
        "custom_id": custom_id[:127],
    }
    if payee_email:
        purchase_unit["payee"] = {"email_address": payee_email}
    body = {
        "intent": "CAPTURE",
        "purchase_units": [purchase_unit],
        "application_context": {
            "brand_name": "Ride",
            "user_action": "PAY_NOW",
            "return_url": return_url,
            "cancel_url": cancel_url,
            "shipping_preference": "NO_SHIPPING",
        },
    }
    async with httpx.AsyncClient(timeout=15) as cx:
        r = await cx.post(
            f"{PAYPAL_BASE}/v2/checkout/orders",
            json=body,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
    if r.status_code not in (200, 201):
        logger.error("PayPal create-order error %s: %s", r.status_code, r.text)
        raise HTTPException(status_code=502, detail="PayPal order creation failed")
    data = r.json()
    approve_url = next(
        (link["href"] for link in data.get("links", []) if link.get("rel") in ("approve", "payer-action")),
        None,
    )
    if not approve_url:
        raise HTTPException(status_code=502, detail="PayPal did not return approval URL")
    return {"id": data["id"], "approve_url": approve_url}


async def _paypal_capture(order_id: str) -> dict:
    """Captures an approved PayPal Order (called after user approves on PayPal)."""
    token = await _paypal_token()
    async with httpx.AsyncClient(timeout=15) as cx:
        r = await cx.post(
            f"{PAYPAL_BASE}/v2/checkout/orders/{order_id}/capture",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
    if r.status_code not in (200, 201):
        logger.warning("PayPal capture error %s: %s", r.status_code, r.text)
        raise HTTPException(status_code=502, detail="PayPal capture failed")
    return r.json()

# MercadoPago SDK (legacy — payments migrated to PayPal; kept as no-op stub)
# def mp_sdk(): ...  removed


# ----------------- Mercado Pago helpers (per-driver, direct-to-driver) -----------------
# We use the driver's *own* MP access token so the funds land directly in
# their MP account. No platform-wide MP credentials are needed.
MP_API = "https://api.mercadopago.com"


def _mp_is_sandbox_token(access_token: str) -> bool:
    return (access_token or "").strip().upper().startswith("TEST-")


async def _mp_create_preference(
    *,
    driver_access_token: str,
    amount: float,
    description: str,
    external_reference: str,
    return_url: str,
    cancel_url: str,
    notification_url: Optional[str] = None,
    currency: str = "MXN",
) -> dict:
    """
    Creates a Mercado Pago Checkout Preference using the DRIVER's access
    token, so the buyer pays the driver directly. Returns:
        {id, init_point, sandbox_init_point, is_sandbox}
    """
    if not driver_access_token:
        raise HTTPException(
            status_code=503,
            detail="Driver has not connected a Mercado Pago account yet.",
        )
    body = {
        "items": [{
            "title": description[:255],
            "quantity": 1,
            "currency_id": currency,
            "unit_price": round(float(amount), 2),
        }],
        "external_reference": external_reference,
        "back_urls": {
            "success": return_url,
            "failure": cancel_url,
            "pending": return_url,
        },
        # auto_return only kicks in after a *successful* payment.
        "auto_return": "approved",
        "statement_descriptor": "Ride",
        "binary_mode": True,
    }
    if notification_url:
        body["notification_url"] = notification_url

    async with httpx.AsyncClient(timeout=15) as cx:
        r = await cx.post(
            f"{MP_API}/checkout/preferences",
            json=body,
            headers={
                "Authorization": f"Bearer {driver_access_token}",
                "Content-Type": "application/json",
            },
        )
    if r.status_code not in (200, 201):
        logger.error("MercadoPago create-preference error %s: %s", r.status_code, r.text)
        # Surface MP's own error message (helpful while devs onboard accounts)
        try:
            detail = r.json().get("message") or r.json().get("error") or r.text
        except Exception:
            detail = r.text
        raise HTTPException(status_code=502, detail=f"Mercado Pago preference failed: {detail}")
    data = r.json()
    return {
        "id": data.get("id"),
        "init_point": data.get("init_point"),
        "sandbox_init_point": data.get("sandbox_init_point"),
        "is_sandbox": _mp_is_sandbox_token(driver_access_token),
    }


async def _mp_get_payment(driver_access_token: str, payment_id: str) -> dict:
    """Fetches a payment record by id, using the driver's MP token."""
    async with httpx.AsyncClient(timeout=10) as cx:
        r = await cx.get(
            f"{MP_API}/v1/payments/{payment_id}",
            headers={"Authorization": f"Bearer {driver_access_token}"},
        )
    if r.status_code != 200:
        logger.warning("MercadoPago get-payment error %s: %s", r.status_code, r.text)
        raise HTTPException(status_code=502, detail="Mercado Pago payment lookup failed")
    return r.json()


async def _mp_search_payment_by_reference(
    driver_access_token: str,
    external_reference: str,
) -> Optional[dict]:
    """
    Returns the most recent payment record matching `external_reference`
    (which we set to our session_id when creating the preference).
    Used as a fallback when MP redirects back without a payment_id.
    """
    async with httpx.AsyncClient(timeout=10) as cx:
        r = await cx.get(
            f"{MP_API}/v1/payments/search",
            params={"external_reference": external_reference, "sort": "date_created", "criteria": "desc"},
            headers={"Authorization": f"Bearer {driver_access_token}"},
        )
    if r.status_code != 200:
        logger.warning("MercadoPago search error %s: %s", r.status_code, r.text)
        return None
    results = (r.json() or {}).get("results") or []
    return results[0] if results else None


# ----------------- PhonePe helpers (per-driver, India-only) -----------------
# PhonePe Pay Page integration:
#   - Driver onboards via PhonePe Business and provides merchant_id, salt_key, salt_index.
#   - We POST to /pg/v1/pay with X-VERIFY = SHA256(base64payload + "/pg/v1/pay" + salt_key) + "###" + salt_index
#   - We redirect the rider to the returned `instrumentResponse.redirectInfo.url`
#   - We check status via /pg/v1/status/{merchant_id}/{merchant_txn_id}
#
# CURRENCY NOTE: PhonePe accepts only INR (paise). This app's fares are MXN.
# We pass the numeric fare value as INR — that's clearly wrong for a real
# Indian rollout. Production needs per-currency fares or a conversion layer.
PHONEPE_SANDBOX = "https://api-preprod.phonepe.com/apis/pg-sandbox"
PHONEPE_LIVE = "https://api.phonepe.com/apis/hermes"


def _phonepe_base(merchant_id: str) -> str:
    # Convention: PhonePe issues UAT merchant ids starting with "PGTESTPAYUAT"
    # and "MERCHANTUAT". We use the sandbox host for any merchant id matching
    # those patterns, otherwise production. Drivers can override by saving
    # the merchant id with the literal "TEST:" prefix (we strip it before use).
    mid = (merchant_id or "").upper()
    if mid.startswith("PGTESTPAYUAT") or mid.startswith("MERCHANTUAT") or mid.startswith("UAT"):
        return PHONEPE_SANDBOX
    return PHONEPE_LIVE


def _phonepe_x_verify(payload_b64_or_path: str, salt_key: str, salt_index: str) -> str:
    """Computes the X-VERIFY header that PhonePe requires on every request."""
    import hashlib as _hashlib
    raw = (payload_b64_or_path + salt_key).encode("utf-8")
    return _hashlib.sha256(raw).hexdigest() + "###" + str(salt_index or "1")


async def _phonepe_create_payment(
    *,
    merchant_id: str,
    salt_key: str,
    salt_index: str,
    amount: float,
    external_reference: str,
    redirect_url: str,
    callback_url: Optional[str] = None,
) -> dict:
    """Creates a PhonePe Pay Page transaction. Returns {url, merchant_transaction_id}."""
    if not (merchant_id and salt_key):
        raise HTTPException(
            status_code=503,
            detail="Driver has not connected a PhonePe account yet.",
        )
    import base64 as _b64
    import json as _json
    # PhonePe requires the merchantTransactionId to be ≤ 35 chars.
    merchant_txn_id = external_reference[-35:]
    payload = {
        "merchantId": merchant_id.strip(),
        "merchantTransactionId": merchant_txn_id,
        "amount": int(round(float(amount) * 100)),  # in paise
        "redirectUrl": redirect_url,
        "redirectMode": "REDIRECT",
        "paymentInstrument": {"type": "PAY_PAGE"},
    }
    if callback_url:
        payload["callbackUrl"] = callback_url
    payload_b64 = _b64.b64encode(_json.dumps(payload).encode("utf-8")).decode("ascii")
    x_verify = _phonepe_x_verify(payload_b64 + "/pg/v1/pay", salt_key, salt_index or "1")
    base = _phonepe_base(merchant_id)
    async with httpx.AsyncClient(timeout=15) as cx:
        r = await cx.post(
            f"{base}/pg/v1/pay",
            json={"request": payload_b64},
            headers={"Content-Type": "application/json", "X-VERIFY": x_verify, "accept": "application/json"},
        )
    if r.status_code not in (200, 201):
        logger.error("PhonePe pay error %s: %s", r.status_code, r.text)
        try:
            detail = r.json().get("message") or r.text
        except Exception:
            detail = r.text
        raise HTTPException(status_code=502, detail=f"PhonePe payment failed: {detail}")
    body = r.json() or {}
    redirect = ((body.get("data") or {}).get("instrumentResponse") or {}).get("redirectInfo") or {}
    url = redirect.get("url")
    if not url:
        raise HTTPException(status_code=502, detail="PhonePe did not return a redirect URL")
    return {"url": url, "merchant_transaction_id": merchant_txn_id}


async def _phonepe_check_status(
    *,
    merchant_id: str,
    salt_key: str,
    salt_index: str,
    merchant_txn_id: str,
) -> dict:
    path = f"/pg/v1/status/{merchant_id.strip()}/{merchant_txn_id}"
    x_verify = _phonepe_x_verify(path, salt_key, salt_index or "1")
    base = _phonepe_base(merchant_id)
    async with httpx.AsyncClient(timeout=10) as cx:
        r = await cx.get(
            f"{base}{path}",
            headers={
                "Content-Type": "application/json",
                "X-VERIFY": x_verify,
                "X-MERCHANT-ID": merchant_id.strip(),
                "accept": "application/json",
            },
        )
    if r.status_code != 200:
        logger.warning("PhonePe status error %s: %s", r.status_code, r.text)
        return {"status": "UNKNOWN", "raw": r.text}
    return r.json() or {}


SUB_PLANS = {
    "daily":   {"id": "daily",   "name": "Daily Pass",   "amount": 30.00,  "hours": 24,   "label": "$30 / day",      "savings": None},
    "weekly":  {"id": "weekly",  "name": "Weekly Pass",  "amount": 180.00, "hours": 168,  "label": "$180 / 7 days",  "savings": "Save $30"},
    "monthly": {"id": "monthly", "name": "Monthly Pass", "amount": 600.00, "hours": 720,  "label": "$600 / 30 days", "savings": "Save $300"},
}

# ----------------- Fare estimation (Mexico City defaults, MXN) -----------------
# Tweak these constants to change pricing globally.
FARE_BASE       = float(os.environ.get("FARE_BASE", "10"))     # Flagdrop / base fare
FARE_PER_KM     = float(os.environ.get("FARE_PER_KM", "6"))    # Per kilometer
FARE_PER_MIN    = float(os.environ.get("FARE_PER_MIN", "1.5")) # Per minute of trip
FARE_SERVICE    = float(os.environ.get("FARE_SERVICE", "3"))   # Booking / service fee
FARE_MIN        = float(os.environ.get("FARE_MIN", "30"))      # Minimum fare
FARE_CURRENCY   = os.environ.get("FARE_CURRENCY", "MXN").upper()
OSRM_URL        = os.environ.get("OSRM_URL", "https://router.project-osrm.org")
AZURE_MAPS_KEY  = os.environ.get("AZURE_MAPS_KEY", "").strip()

# ----------------- Currency Conversion -----------------
# Fallback exchange rates (updated periodically — in production, use a live API)
# All rates are relative to USD as base
EXCHANGE_RATES_USD_BASE = {
    "USD": 1.0,
    "MXN": 17.5,   # Mexican Peso
    "INR": 83.5,   # Indian Rupee
    "EUR": 0.92,   # Euro
    "GBP": 0.79,   # British Pound
    "BRL": 5.1,    # Brazilian Real
    "ARS": 870.0,  # Argentine Peso
    "COP": 4000.0, # Colombian Peso
    "CLP": 950.0,  # Chilean Peso
    "PEN": 3.8,    # Peruvian Sol
    "CAD": 1.37,   # Canadian Dollar
    "AUD": 1.53,   # Australian Dollar
    "JPY": 157.0,  # Japanese Yen
    "CNY": 7.25,   # Chinese Yuan
    "SGD": 1.35,   # Singapore Dollar
    "AED": 3.67,   # UAE Dirham
}


def convert_currency(amount: float, from_currency: str, to_currency: str) -> float:
    """
    Convert an amount from one currency to another using fallback rates.
    For production, integrate with a live exchange rate API (e.g., exchangerate-api.com).
    """
    from_c = from_currency.upper()
    to_c = to_currency.upper()
    if from_c == to_c:
        return amount
    
    from_rate = EXCHANGE_RATES_USD_BASE.get(from_c, 1.0)
    to_rate = EXCHANGE_RATES_USD_BASE.get(to_c, 1.0)
    
    # Convert from source to USD, then from USD to target
    usd_amount = amount / from_rate
    converted = usd_amount * to_rate
    return round(converted, 2)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("ride")


# ----------------- Helpers -----------------
def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": now_utc() + timedelta(days=7),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])


async def fetch_user(user_id: str) -> Optional[dict]:
    return await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})


def _user_public(user: Optional[dict]) -> Optional[dict]:
    """Strip sensitive fields and add derived public fields before returning a
    user object to the client. Secrets that MUST NEVER leave the backend:
      - mp_access_token: charges cards on the driver's MP account
      - phonepe_salt_key: signs PhonePe requests
    The merchant_id and salt_index are non-secret identifiers, fine to return.
    """
    if not user:
        return user
    SECRET = ("password_hash", "_id", "mp_access_token", "phonepe_salt_key")
    out = {k: v for k, v in user.items() if k not in SECRET}

    raw_mp = (user.get("mp_access_token") or "").strip()
    out["has_mp_token"] = bool(raw_mp)
    out["mp_token_kind"] = (
        "sandbox" if raw_mp.upper().startswith("TEST-")
        else ("live" if raw_mp else None)
    )

    out["has_phonepe"] = bool(
        (user.get("phonepe_merchant_id") or "").strip()
        and (user.get("phonepe_salt_key") or "").strip()
    )
    out["accepts_cash"] = bool(user.get("accepts_cash"))
    return out


async def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    token = None
    if creds and creds.scheme.lower() == "bearer":
        token = creds.credentials
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user = await fetch_user(payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


def require_role(role: str):
    async def _checker(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") != role:
            raise HTTPException(status_code=403, detail=f"{role} role required")
        return user
    return _checker


# ----------------- Push Notifications -----------------
async def send_push(user_ids: List[str], title: str, body: str, data: Optional[dict] = None):
    """Send a push notification to one or more users via Expo Push API.
    Silent no-op if no tokens are registered."""
    if not user_ids:
        return
    tokens_cursor = db.push_tokens.find({"user_id": {"$in": user_ids}}, {"_id": 0, "token": 1})
    tokens = [t["token"] async for t in tokens_cursor]
    if not tokens:
        return
    messages = [
        {"to": t, "title": title, "body": body, "data": data or {}, "sound": "default"}
        for t in tokens
    ]
    try:
        async with httpx.AsyncClient(timeout=10) as ac:
            await ac.post(EXPO_PUSH_URL, json=messages, headers={"Accept": "application/json"})
    except Exception as e:
        logger.warning("Expo push send failed: %s", e)


# ----------------- Email Notifications -----------------
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart


async def send_admin_email(subject: str, body_html: str, body_text: str = None):
    """
    Send an email notification to the admin.
    Uses SMTP configuration from environment variables.
    Falls back to logging if SMTP is not configured.
    """
    if not SMTP_USER or not SMTP_PASSWORD:
        logger.warning(f"SMTP not configured. Would send email to {ADMIN_EMAIL}: {subject}")
        logger.info(f"Email body: {body_text or body_html}")
        return False
    
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = SMTP_FROM_EMAIL or SMTP_USER
        msg["To"] = ADMIN_EMAIL
        
        # Attach both plain text and HTML versions
        if body_text:
            msg.attach(MIMEText(body_text, "plain"))
        msg.attach(MIMEText(body_html, "html"))
        
        # Send via SMTP (run in thread pool to avoid blocking)
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _send_smtp_email, msg)
        
        logger.info(f"Admin email sent: {subject}")
        return True
    except Exception as e:
        logger.error(f"Failed to send admin email: {e}")
        return False


def _send_smtp_email(msg: MIMEMultipart):
    """Synchronous SMTP send - run in thread pool."""
    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.send_message(msg)


# ----------------- WebSockets -----------------
class WSManager:
    def __init__(self):
        self.connections: Dict[str, Set[WebSocket]] = {}
        self.lock = asyncio.Lock()

    async def connect(self, user_id: str, ws: WebSocket):
        await ws.accept()
        async with self.lock:
            self.connections.setdefault(user_id, set()).add(ws)

    async def disconnect(self, user_id: str, ws: WebSocket):
        async with self.lock:
            if user_id in self.connections:
                self.connections[user_id].discard(ws)
                if not self.connections[user_id]:
                    del self.connections[user_id]

    async def send_to_users(self, user_ids: List[str], event: str, payload: dict):
        msg = json.dumps({"event": event, "payload": payload})
        targets: List[WebSocket] = []
        async with self.lock:
            for uid in user_ids:
                for ws in self.connections.get(uid, set()):
                    targets.append(ws)
        for ws in targets:
            try:
                await ws.send_text(msg)
            except Exception:
                # ignore - connection will be cleaned up on next disconnect
                pass


ws_manager = WSManager()


async def notify_ride(ride: dict, event: str):
    """Notify both rider and driver (if assigned) about a ride change via WS + push."""
    user_ids = [uid for uid in [ride.get("rider_id"), ride.get("driver_id")] if uid]
    await ws_manager.send_to_users(user_ids, event, ride)


# ----------------- Models -----------------
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str
    role: Literal["rider", "driver"]
    phone: Optional[str] = None
    vehicle: Optional[str] = None
    country_code: Optional[str] = None  # ISO 3166-1 alpha-2 (e.g., "IN", "MX", "US")
    currency: Optional[str] = None       # User's preferred currency (e.g., "INR", "MXN", "USD")


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class RideCreateRequest(BaseModel):
    pickup_address: str
    dropoff_address: str
    pickup_lat: Optional[float] = None
    pickup_lng: Optional[float] = None
    dropoff_lat: Optional[float] = None
    dropoff_lng: Optional[float] = None
    estimated_fare: float
    distance_km: Optional[float] = None      # Distance in kilometers
    duration_min: Optional[float] = None     # Estimated duration in minutes


class CheckoutRequest(BaseModel):
    origin_url: str
    plan_id: Literal["daily", "weekly", "monthly"] = "daily"


class RidePaymentRequest(BaseModel):
    origin_url: str
    # paypal/googlepay/applepay all route through PayPal's hosted checkout —
    # the user just gets the matching funding-source label/icon on our side.
    # mercadopago / phonepe use the driver's own provider account.
    # cash is settled in person and confirmed by the driver afterwards.
    provider: Literal[
        "paypal",
        "googlepay",
        "applepay",
        "mercadopago",
        "phonepe",
        "cash",
    ] = "paypal"


class PayoutAccountsRequest(BaseModel):
    """Driver-supplied payment destination accounts.
    Send empty string to clear any field.
    """
    paypal_email: Optional[str] = None          # also receives googlepay/applepay
    mp_access_token: Optional[str] = None        # Mercado Pago access token (TEST-* for sandbox)
    phonepe_merchant_id: Optional[str] = None    # India-only — PhonePe Business merchant id
    phonepe_salt_key: Optional[str] = None       # PhonePe salt key (secret)
    phonepe_salt_index: Optional[str] = None     # PhonePe salt index, usually "1"
    accepts_cash: Optional[bool] = None          # Toggle to allow cash payments


class LocationUpdate(BaseModel):
    lat: float
    lng: float


class PushTokenRequest(BaseModel):
    token: str
    platform: Optional[str] = None


class RatingRequest(BaseModel):
    score: int = Field(ge=1, le=5)
    comment: Optional[str] = None


# ----------------- Auth -----------------
@api_router.post("/auth/register", response_model=TokenResponse)
async def register(payload: RegisterRequest):
    email = payload.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": email,
        "name": payload.name,
        "role": payload.role,
        "phone": payload.phone,
        "vehicle": payload.vehicle if payload.role == "driver" else None,
        "password_hash": hash_password(payload.password),
        "rating_avg": None,
        "rating_count": 0,
        "country_code": (payload.country_code or "MX").upper(),  # Default to Mexico
        "currency": (payload.currency or "MXN").upper(),         # Default currency
        "created_at": now_utc().isoformat(),
    }
    await db.users.insert_one(user_doc)
    token = create_access_token(user_id, email, payload.role)
    return TokenResponse(access_token=token, user=_user_public(user_doc))


@api_router.post("/auth/login", response_model=TokenResponse)
async def login(payload: LoginRequest):
    email = payload.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], user["email"], user["role"])
    return TokenResponse(access_token=token, user=_user_public(user))


@api_router.get("/auth/me")
async def me(user: dict = Depends(get_current_user)):
    return _user_public(user)


# ----------------- Push Token Registration -----------------
@api_router.post("/push/register")
async def register_push_token(body: PushTokenRequest, user: dict = Depends(get_current_user)):
    await db.push_tokens.update_one(
        {"token": body.token},
        {"$set": {
            "user_id": user["id"],
            "token": body.token,
            "platform": body.platform,
            "updated_at": now_utc().isoformat(),
        }},
        upsert=True,
    )
    return {"ok": True}


@api_router.delete("/push/register")
async def remove_push_token(token: str = Query(...), user: dict = Depends(get_current_user)):
    await db.push_tokens.delete_one({"token": token, "user_id": user["id"]})
    return {"ok": True}


# ----------------- Driver Subscription -----------------
async def _get_active_subscription(driver_id: str) -> Optional[dict]:
    sub = await db.driver_subscriptions.find_one(
        {"driver_id": driver_id, "expires_at": {"$gt": now_utc().isoformat()}},
        {"_id": 0},
        sort=[("expires_at", -1)],
    )
    return sub


@api_router.get("/driver/subscription")
async def get_subscription(user: dict = Depends(require_role("driver"))):
    sub = await _get_active_subscription(user["id"])
    return {
        "active": sub is not None,
        "subscription": sub,
        "amount": DAILY_SUB_AMOUNT,
        "currency": PAYPAL_CURRENCY,
        "plans": list(SUB_PLANS.values()),
    }


@api_router.post("/driver/subscribe")
async def create_subscription_checkout(
    body: CheckoutRequest,
    request: Request,
    user: dict = Depends(require_role("driver")),
):
    plan = SUB_PLANS.get(body.plan_id)
    if not plan:
        raise HTTPException(status_code=400, detail="Invalid plan")
    origin = body.origin_url.rstrip("/")
    external_reference = f"sub_{user['id']}_{plan['id']}_{uuid.uuid4().hex[:8]}"

    return_url = f"{origin}/payment-success?session_id={external_reference}"
    cancel_url = f"{origin}/driver/home?cancelled=1"

    order = await _paypal_create_order(
        amount=float(plan["amount"]),
        description=f"Ride · {plan['name']}",
        return_url=return_url,
        cancel_url=cancel_url,
        custom_id=external_reference,
        currency=PAYPAL_CURRENCY,
    )

    await db.payment_transactions.insert_one({
        "id": str(uuid.uuid4()),
        "session_id": external_reference,
        "preference_id": order["id"],
        "provider": "paypal",
        "user_id": user["id"],
        "email": user["email"],
        "amount": plan["amount"],
        "currency": PAYPAL_CURRENCY,
        "purpose": "driver_subscription",
        "plan_id": plan["id"],
        "hours": plan["hours"],
        "metadata": {
            "user_id": user["id"],
            "purpose": "driver_subscription",
            "plan_id": plan["id"],
            "hours": plan["hours"],
        },
        "payment_status": "pending",
        "status": "initiated",
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    })
    return {"url": order["approve_url"], "session_id": external_reference, "plan": plan, "order_id": order["id"]}


# (duplicate function removed - see complete implementation below)


# ----------------- Driver payout accounts -----------------
@api_router.get("/driver/payout-accounts")
async def get_payout_accounts(user: dict = Depends(require_role("driver"))):
    fresh = await db.users.find_one({"id": user["id"]}) or {}
    raw_token = (fresh.get("mp_access_token") or "").strip()
    pp_mid = (fresh.get("phonepe_merchant_id") or "").strip()
    pp_salt = (fresh.get("phonepe_salt_key") or "").strip()
    return {
        "paypal_email": fresh.get("paypal_email") or None,
        "has_mp_token": bool(raw_token),
        "mp_token_kind": (
            "sandbox" if raw_token.upper().startswith("TEST-")
            else ("live" if raw_token else None)
        ),
        "mp_token_hint": (("…" + raw_token[-4:]) if raw_token else None),
        # PhonePe — merchant_id is identifier (safe to return), salt_key is secret.
        "phonepe_merchant_id": pp_mid or None,
        "has_phonepe_salt": bool(pp_salt),
        "phonepe_salt_hint": (("…" + pp_salt[-4:]) if pp_salt else None),
        "phonepe_salt_index": fresh.get("phonepe_salt_index") or None,
        "accepts_cash": bool(fresh.get("accepts_cash")),
    }


@api_router.patch("/driver/payout-accounts")
async def update_payout_accounts(
    body: PayoutAccountsRequest,
    user: dict = Depends(require_role("driver")),
):
    """Driver sets the destination accounts where ride payments should land.
    Any field passed is updated independently; pass empty string to clear.
    """
    set_fields: dict = {"updated_at": now_utc().isoformat()}

    if body.paypal_email is not None:
        set_fields["paypal_email"] = (str(body.paypal_email) or "").strip().lower() or None

    if body.mp_access_token is not None:
        token = body.mp_access_token.strip()
        if token:
            try:
                async with httpx.AsyncClient(timeout=8) as cx:
                    r = await cx.get(
                        f"{MP_API}/users/me",
                        headers={"Authorization": f"Bearer {token}"},
                    )
                if r.status_code != 200:
                    raise HTTPException(
                        status_code=400,
                        detail="That Mercado Pago access token was rejected by Mercado Pago. Double-check that you copied the Access Token (not the public key) from your MP app.",
                    )
            except HTTPException:
                raise
            except Exception as e:
                logger.warning("MP token validation network error: %s", e)
        set_fields["mp_access_token"] = token or None

    # PhonePe: validation is shape-only — PhonePe doesn't expose a credentials
    # check endpoint, and the real validation happens when we try to create
    # a payment. We just sanity-check both fields are reasonable.
    if body.phonepe_merchant_id is not None:
        mid = body.phonepe_merchant_id.strip()
        if mid and (len(mid) < 4 or len(mid) > 64):
            raise HTTPException(status_code=400, detail="PhonePe merchant_id looks invalid")
        set_fields["phonepe_merchant_id"] = mid or None
    if body.phonepe_salt_key is not None:
        sk = body.phonepe_salt_key.strip()
        if sk and len(sk) < 8:
            raise HTTPException(status_code=400, detail="PhonePe salt_key looks too short")
        set_fields["phonepe_salt_key"] = sk or None
    if body.phonepe_salt_index is not None:
        si = body.phonepe_salt_index.strip()
        if si and not si.isdigit():
            raise HTTPException(status_code=400, detail="PhonePe salt_index must be a number (usually 1)")
        set_fields["phonepe_salt_index"] = si or "1"

    if body.accepts_cash is not None:
        set_fields["accepts_cash"] = bool(body.accepts_cash)

    await db.users.update_one({"id": user["id"]}, {"$set": set_fields})
    return await get_payout_accounts(user)


# ----------------- Public lookup: which providers does this driver accept? -----------------
@api_router.get("/rides/{ride_id}/payment-options")
async def ride_payment_options(
    ride_id: str,
    user: dict = Depends(require_role("rider")),
):
    """Rider asks: which payment methods can I use for this ride?
    Returns one entry per available provider. The frontend uses this to
    show/hide buttons in the payment-provider sheet so we never offer a
    method the driver can't actually receive.
    """
    ride = await db.rides.find_one({"id": ride_id, "rider_id": user["id"]}, {"_id": 0})
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    if not ride.get("driver_id"):
        return {"providers": []}

    driver = await db.users.find_one({"id": ride["driver_id"]}) or {}
    paypal_ready = bool((driver.get("paypal_email") or "").strip())
    mp_ready = bool((driver.get("mp_access_token") or "").strip())
    phonepe_ready = bool(
        (driver.get("phonepe_merchant_id") or "").strip()
        and (driver.get("phonepe_salt_key") or "").strip()
    )
    cash_ready = bool(driver.get("accepts_cash"))

    # PayPal-hosted checkout shows Google Pay / Apple Pay as funding sources
    # natively. We only need to surface them when the driver has PayPal.
    providers = []
    if paypal_ready:
        providers.append({"id": "paypal", "label": "PayPal", "via": "paypal"})
        providers.append({"id": "googlepay", "label": "Google Pay", "via": "paypal"})
        providers.append({"id": "applepay", "label": "Apple Pay", "via": "paypal"})
    if mp_ready:
        providers.append({"id": "mercadopago", "label": "Mercado Pago", "via": "mercadopago"})
    if phonepe_ready:
        providers.append({"id": "phonepe", "label": "PhonePe", "via": "phonepe"})
    if cash_ready:
        providers.append({"id": "cash", "label": "Cash", "via": "cash"})
    return {"providers": providers}


# ----------------- Ride Payment (Rider pays driver — direct-to-driver) -----------------
# Customer's money flows directly into the driver's account. The platform
# never holds the funds. For Google Pay / Apple Pay we route through PayPal's
# hosted checkout — which natively shows GPay (Chrome) and Apple Pay
# (Safari/iOS) as funding sources — using the same `payee.email_address`
# direct-deposit mechanism as the plain PayPal flow.
@api_router.post("/rides/{ride_id}/pay")
async def create_ride_payment(
    ride_id: str,
    body: RidePaymentRequest,
    request: Request,
    user: dict = Depends(require_role("rider")),
):
    ride = await db.rides.find_one({"id": ride_id, "rider_id": user["id"]}, {"_id": 0})
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    if ride.get("status") != "completed":
        raise HTTPException(status_code=400, detail="Ride not yet completed")
    if ride.get("paid"):
        raise HTTPException(status_code=400, detail="Ride already paid")
    if ride.get("cash_pending_at"):
        raise HTTPException(status_code=409, detail="A cash payment is already awaiting driver confirmation")
    if not ride.get("driver_id"):
        raise HTTPException(status_code=400, detail="Ride has no driver")

    driver = await db.users.find_one({"id": ride["driver_id"]})
    if not driver:
        raise HTTPException(status_code=404, detail="Driver not found")

    amount = float(ride["estimated_fare"])
    origin = body.origin_url.rstrip("/")
    external_reference = f"ride_{ride_id}_{uuid.uuid4().hex[:8]}"

    return_url = f"{origin}/payment-success?session_id={external_reference}&provider={body.provider}"
    cancel_url = f"{origin}/rider/history?cancelled=1"

    txn_base = {
        "id": str(uuid.uuid4()),
        "session_id": external_reference,
        "user_id": user["id"],
        "email": user["email"],
        "amount": amount,
        "currency": PAYPAL_CURRENCY,
        "purpose": "ride_payment",
        "ride_id": ride_id,
        "driver_id": ride["driver_id"],
        "metadata": {
            "user_id": user["id"],
            "purpose": "ride_payment",
            "ride_id": ride_id,
            "driver_id": ride["driver_id"],
            "rider_id": user["id"],
        },
        "payment_status": "pending",
        "status": "initiated",
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }

    # ---- PayPal / Google Pay / Apple Pay (all via PayPal hosted checkout) ----
    if body.provider in ("paypal", "googlepay", "applepay"):
        driver_paypal = (driver.get("paypal_email") or "").strip()
        if not driver_paypal:
            raise HTTPException(
                status_code=409,
                detail="Driver has not connected a PayPal account yet. Try another method.",
            )
        order = await _paypal_create_order(
            amount=amount,
            description=f"Ride · Trip {ride_id[:8]}",
            return_url=return_url,
            cancel_url=cancel_url,
            custom_id=external_reference,
            currency=PAYPAL_CURRENCY,
            payee_email=driver_paypal,
        )
        await db.payment_transactions.insert_one({
            **txn_base,
            "provider": body.provider,  # paypal | googlepay | applepay
            "via": "paypal",
            "preference_id": order["id"],
            "driver_paypal_email": driver_paypal,
        })
        return {
            "provider": body.provider,
            "via": "paypal",
            "url": order["approve_url"],
            "session_id": external_reference,
            "amount": amount,
            "order_id": order["id"],
        }

    # ---- Mercado Pago ----
    if body.provider == "mercadopago":
        driver_mp_token = (driver.get("mp_access_token") or "").strip()
        if not driver_mp_token:
            raise HTTPException(
                status_code=409,
                detail="Driver has not connected a Mercado Pago account yet. Try another method.",
            )
        pref = await _mp_create_preference(
            driver_access_token=driver_mp_token,
            amount=amount,
            description=f"Ride · Trip {ride_id[:8]}",
            external_reference=external_reference,
            return_url=return_url,
            cancel_url=cancel_url,
            notification_url=f"{(os.environ.get('PUBLIC_BACKEND_URL') or origin).rstrip('/')}/api/webhook/mercadopago",
            currency=PAYPAL_CURRENCY,
        )
        init_point = pref["sandbox_init_point"] if pref["is_sandbox"] else pref["init_point"]
        await db.payment_transactions.insert_one({
            **txn_base,
            "provider": "mercadopago",
            "via": "mercadopago",
            "preference_id": pref["id"],
            "mp_driver_token": driver_mp_token,
            "mp_is_sandbox": pref["is_sandbox"],
        })
        return {
            "provider": "mercadopago",
            "via": "mercadopago",
            "url": init_point,
            "session_id": external_reference,
            "amount": amount,
            "preference_id": pref["id"],
        }

    # ---- PhonePe ----
    if body.provider == "phonepe":
        merchant_id = (driver.get("phonepe_merchant_id") or "").strip()
        salt_key = (driver.get("phonepe_salt_key") or "").strip()
        salt_index = (driver.get("phonepe_salt_index") or "1").strip()
        if not (merchant_id and salt_key):
            raise HTTPException(
                status_code=409,
                detail="Driver has not connected a PhonePe account yet. Try another method.",
            )
        
        # PhonePe only accepts INR. Convert from the ride's currency if needed.
        ride_currency = ride.get("currency") or PAYPAL_CURRENCY
        amount_inr = convert_currency(amount, ride_currency, "INR")
        
        callback = f"{(os.environ.get('PUBLIC_BACKEND_URL') or origin).rstrip('/')}/api/webhook/phonepe"
        pp = await _phonepe_create_payment(
            merchant_id=merchant_id,
            salt_key=salt_key,
            salt_index=salt_index,
            amount=amount_inr,  # Use converted INR amount
            external_reference=external_reference,
            redirect_url=return_url,
            callback_url=callback,
        )
        await db.payment_transactions.insert_one({
            **txn_base,
            "provider": "phonepe",
            "via": "phonepe",
            "original_amount": amount,
            "original_currency": ride_currency,
            "converted_amount": amount_inr,
            "converted_currency": "INR",
            "phonepe_merchant_id": merchant_id,
            "phonepe_salt_key": salt_key,
            "phonepe_salt_index": salt_index,
            "phonepe_merchant_txn_id": pp["merchant_transaction_id"],
        })
        return {
            "provider": "phonepe",
            "via": "phonepe",
            "url": pp["url"],
            "session_id": external_reference,
            "amount": amount,
            "amount_inr": amount_inr,  # Show converted amount to user
            "currency": "INR",
            "merchant_transaction_id": pp["merchant_transaction_id"],
        }

    # ---- Cash ----
    if body.provider == "cash":
        if not driver.get("accepts_cash"):
            raise HTTPException(
                status_code=409,
                detail="Driver does not accept cash for this trip.",
            )
        await db.payment_transactions.insert_one({
            **txn_base,
            "provider": "cash",
            "via": "cash",
            "payment_status": "pending_confirmation",
        })
        # Flag the ride as awaiting driver confirmation so the driver sees a
        # "Confirm cash" button in their UI. We DON'T mark it paid yet.
        await db.rides.update_one(
            {"id": ride_id},
            {"$set": {
                "cash_pending_at": now_utc().isoformat(),
                "cash_session_id": external_reference,
                "updated_at": now_utc().isoformat(),
            }},
        )
        # Best-effort live ping to the driver
        try:
            await ws_manager.send_to_users(
                [ride["driver_id"]],
                "cash_pending",
                {
                    "ride_id": ride_id,
                    "session_id": external_reference,
                    "amount": amount,
                },
            )
        except Exception:
            pass
        return {
            "provider": "cash",
            "via": "cash",
            "url": None,
            "session_id": external_reference,
            "amount": amount,
            "requires_driver_confirmation": True,
            "message": "Hand the cash to your driver. They will confirm receipt in their app.",
        }

    raise HTTPException(status_code=400, detail=f"Unknown payment provider: {body.provider}")


# ----------------- Driver confirms cash receipt -----------------
@api_router.post("/rides/{ride_id}/confirm-cash")
async def confirm_cash(
    ride_id: str,
    user: dict = Depends(require_role("driver")),
):
    """Driver confirms they received cash from the rider.
    Activates the pending cash transaction and marks the ride paid.
    """
    ride = await db.rides.find_one({"id": ride_id, "driver_id": user["id"]}, {"_id": 0})
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found or not yours")
    if ride.get("paid"):
        return {"already_paid": True}
    session_id = ride.get("cash_session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="No pending cash payment on this ride")
    await _activate_paid_txn(session_id)
    # Drop the pending markers
    await db.rides.update_one(
        {"id": ride_id},
        {"$unset": {"cash_pending_at": "", "cash_session_id": ""}},
    )
    return {"confirmed": True}


@api_router.post("/rides/{ride_id}/reject-cash")
async def reject_cash(
    ride_id: str,
    user: dict = Depends(require_role("driver")),
):
    """Driver rejects a pending cash claim (rider did not actually pay).
    Marks the txn failed and clears the ride flag so the rider must pay
    again via another method.
    """
    ride = await db.rides.find_one({"id": ride_id, "driver_id": user["id"]}, {"_id": 0})
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found or not yours")
    session_id = ride.get("cash_session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="No pending cash payment on this ride")
    await db.payment_transactions.update_one(
        {"session_id": session_id},
        {"$set": {
            "payment_status": "failed",
            "status": "rejected_by_driver",
            "updated_at": now_utc().isoformat(),
        }},
    )
    await db.rides.update_one(
        {"id": ride_id},
        {"$unset": {"cash_pending_at": "", "cash_session_id": ""}},
    )
    return {"rejected": True}


# ----------------- Payment Failure Fallback to Admin -----------------
class PaymentFailureFallbackRequest(BaseModel):
    reason: str = "Payment failed"


@api_router.post("/rides/{ride_id}/payment-fallback")
async def payment_fallback_to_admin(
    ride_id: str,
    body: PaymentFailureFallbackRequest,
    user: dict = Depends(get_current_user),
):
    """
    When payment to driver fails, rider can trigger a fallback payment to admin.
    This creates a PayPal order with admin's PayPal email as the payee.
    Admin is notified via email about the issue.
    """
    ride = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    
    # Can be called by either rider or driver
    if ride.get("rider_id") != user["id"] and ride.get("driver_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Not your ride")
    
    if ride.get("paid"):
        raise HTTPException(status_code=400, detail="Ride already paid")
    
    if not ADMIN_PAYPAL_EMAIL:
        raise HTTPException(status_code=503, detail="Admin payment not configured")
    
    amount = float(ride.get("estimated_fare", 0))
    driver_id = ride.get("driver_id")
    rider_id = ride.get("rider_id")
    
    # Get driver and rider info for the email
    driver = await db.users.find_one({"id": driver_id}) if driver_id else None
    rider = await db.users.find_one({"id": rider_id}) if rider_id else None
    
    external_reference = f"fallback_ride_{ride_id}_{uuid.uuid4().hex[:8]}"
    
    # Determine origin from request or use a default
    origin = os.environ.get("PUBLIC_FRONTEND_URL", "https://localhost:3000")
    return_url = f"{origin}/payment-success?session_id={external_reference}&provider=paypal&fallback=1"
    cancel_url = f"{origin}/rider/history?cancelled=1"
    
    # Create PayPal order with admin as payee
    order = await _paypal_create_order(
        amount=amount,
        description=f"Ride Payment (Fallback) · Trip {ride_id[:8]}",
        return_url=return_url,
        cancel_url=cancel_url,
        custom_id=external_reference,
        currency=PAYPAL_CURRENCY,
        payee_email=ADMIN_PAYPAL_EMAIL,  # Payment goes to admin
    )
    
    # Store transaction
    txn = {
        "id": str(uuid.uuid4()),
        "session_id": external_reference,
        "user_id": user["id"],
        "email": user.get("email"),
        "amount": amount,
        "currency": PAYPAL_CURRENCY,
        "purpose": "ride_payment_fallback",
        "ride_id": ride_id,
        "driver_id": driver_id,
        "rider_id": rider_id,
        "fallback_reason": body.reason,
        "admin_payee": ADMIN_PAYPAL_EMAIL,
        "provider": "paypal",
        "preference_id": order["id"],
        "payment_status": "pending",
        "status": "fallback_initiated",
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.payment_transactions.insert_one(txn)
    
    # Update ride to mark it as fallback payment
    await db.rides.update_one(
        {"id": ride_id},
        {"$set": {
            "fallback_payment": True,
            "fallback_session_id": external_reference,
            "fallback_reason": body.reason,
            "updated_at": now_utc().isoformat(),
        }}
    )
    
    # Send email notification to admin
    driver_name = driver.get("name", "Unknown") if driver else "Unknown"
    driver_email = driver.get("email", "N/A") if driver else "N/A"
    rider_name = rider.get("name", "Unknown") if rider else "Unknown"
    rider_email = rider.get("email", "N/A") if rider else "N/A"
    
    email_subject = f"⚠️ Payment Fallback Alert - Ride {ride_id[:8]}"
    email_html = f"""
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6;">
        <h2 style="color: #dc3545;">⚠️ Payment Fallback Triggered</h2>
        <p>A payment to the driver has failed and the rider is paying to the admin account instead.</p>
        
        <h3>Ride Details:</h3>
        <table style="border-collapse: collapse; width: 100%; max-width: 500px;">
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Ride ID:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{ride_id}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Amount:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">${amount:.2f} {PAYPAL_CURRENCY}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Pickup:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{ride.get('pickup_address', 'N/A')}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Dropoff:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{ride.get('dropoff_address', 'N/A')}</td></tr>
        </table>
        
        <h3>Driver Information:</h3>
        <table style="border-collapse: collapse; width: 100%; max-width: 500px;">
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Name:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{driver_name}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Email:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{driver_email}</td></tr>
        </table>
        
        <h3>Rider Information:</h3>
        <table style="border-collapse: collapse; width: 100%; max-width: 500px;">
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Name:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{rider_name}</td></tr>
            <tr><td style="padding: 8px; border: 1px solid #ddd;"><strong>Email:</strong></td><td style="padding: 8px; border: 1px solid #ddd;">{rider_email}</td></tr>
        </table>
        
        <h3>Failure Reason:</h3>
        <p style="background: #f8f9fa; padding: 10px; border-radius: 5px;">{body.reason}</p>
        
        <p style="color: #666; font-size: 12px; margin-top: 30px;">
            Action Required: Once payment is received in your PayPal account, please manually transfer ${amount:.2f} {PAYPAL_CURRENCY} to the driver ({driver_email}).
        </p>
    </body>
    </html>
    """
    
    email_text = f"""
    Payment Fallback Alert - Ride {ride_id[:8]}
    
    A payment to the driver has failed.
    
    Ride ID: {ride_id}
    Amount: ${amount:.2f} {PAYPAL_CURRENCY}
    
    Driver: {driver_name} ({driver_email})
    Rider: {rider_name} ({rider_email})
    
    Reason: {body.reason}
    
    Please transfer the amount to the driver once received.
    """
    
    # Send email asynchronously (don't block the response)
    asyncio.create_task(send_admin_email(email_subject, email_html, email_text))
    
    return {
        "provider": "paypal",
        "url": order["approve_url"],
        "session_id": external_reference,
        "amount": amount,
        "fallback": True,
        "admin_payee": ADMIN_PAYPAL_EMAIL,
        "message": "Payment will be sent to admin due to driver payment issue. Admin will forward to driver.",
    }


# ----------------- PayPal capture (called by frontend after user approves) -----------------
@api_router.post("/paypal/capture/{session_id}")
async def paypal_capture(session_id: str):
    """
    Captures a previously-approved PayPal order. The frontend's payment-success
    page calls this once after PayPal redirects back. Idempotent.
    """
    txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if txn.get("provider") not in (None, "paypal", "googlepay", "applepay"):
        raise HTTPException(status_code=400, detail=f"Transaction is {txn.get('provider')}, not paypal")
    if txn.get("payment_status") == "paid":
        return {"already_paid": True}
    order_id = txn.get("preference_id")
    if not order_id:
        raise HTTPException(status_code=400, detail="No PayPal order id on transaction")
    try:
        capture = await _paypal_capture(order_id)
    except HTTPException as e:
        # If PayPal returns 422 ORDER_ALREADY_CAPTURED treat as success
        if e.status_code == 502 and "ORDER_ALREADY_CAPTURED" in (e.detail or ""):
            await _activate_paid_txn(session_id)
            return {"already_paid": True}
        raise
    status = (capture or {}).get("status")
    if status == "COMPLETED":
        await _activate_paid_txn(session_id)
        return {"captured": True, "status": status}
    return {"captured": False, "status": status}


# ----------------- Mercado Pago capture (verify after redirect) -----------------
@api_router.post("/mercadopago/capture/{session_id}")
async def mercadopago_capture(session_id: str):
    """
    Verifies a Mercado Pago payment after the buyer is redirected back to our
    return_url. MP usually appends `payment_id` and `status` query params on
    the redirect — but to be robust we also search by external_reference.
    Idempotent.
    """
    txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if txn.get("provider") != "mercadopago":
        raise HTTPException(status_code=400, detail=f"Transaction is {txn.get('provider')}, not mercadopago")
    if txn.get("payment_status") == "paid":
        return {"already_paid": True}

    driver_token = txn.get("mp_driver_token")
    if not driver_token:
        raise HTTPException(status_code=400, detail="Missing MP driver token on transaction")

    payment = await _mp_search_payment_by_reference(driver_token, session_id)
    if not payment:
        return {"captured": False, "status": "no_payment_yet"}

    mp_status = (payment.get("status") or "").lower()
    if mp_status == "approved":
        await _activate_paid_txn(session_id)
        return {"captured": True, "status": "approved", "payment_id": payment.get("id")}
    return {"captured": False, "status": mp_status, "payment_id": payment.get("id")}


# ----------------- Payment Activation (idempotent, provider-agnostic) -----------------
async def _activate_paid_txn(session_id: str) -> dict:
    """
    Idempotent activation for both subscription and ride_payment transactions.
    Marks the txn paid (if not already) and runs the side-effects:
      - driver_subscription → creates a driver_subscriptions row, extends expiry
      - ride_payment        → marks ride paid + records payout, push-notifies driver
    Caller is expected to have already confirmed the payment with the provider
    (e.g. the PayPal capture endpoint). Safe to call multiple times.
    """
    txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")

    purpose = txn.get("purpose", "driver_subscription")

    # Already fully processed → no-op
    if txn.get("payment_status") == "paid" and (txn.get("subscription_id") or txn.get("activated")):
        return {"payment_status": "paid", "status": "completed", "already_processed": True, "purpose": purpose}

    update = {
        "payment_status": "paid",
        "status": "completed",
        "updated_at": now_utc().isoformat(),
    }

    if purpose == "driver_subscription" and not txn.get("subscription_id"):
        driver_id = txn["user_id"]
        hours = int(txn.get("hours", 24))
        existing = await _get_active_subscription(driver_id)
        base = datetime.fromisoformat(existing["expires_at"]) if existing else now_utc()
        new_expiry = base + timedelta(hours=hours)
        sub_id = str(uuid.uuid4())
        await db.driver_subscriptions.insert_one({
            "id": sub_id,
            "driver_id": driver_id,
            "amount": txn["amount"],
            "currency": txn["currency"],
            "plan_id": txn.get("plan_id", "daily"),
            "hours": hours,
            "session_id": session_id,
            "started_at": now_utc().isoformat(),
            "expires_at": new_expiry.isoformat(),
            "created_at": now_utc().isoformat(),
        })
        update["subscription_id"] = sub_id

    elif purpose == "ride_payment" and not txn.get("activated"):
        ride_id = txn["ride_id"]
        driver_id = txn["driver_id"]
        amount = float(txn["amount"])
        await db.rides.update_one(
            {"id": ride_id},
            {"$set": {
                "paid": True,
                "paid_at": now_utc().isoformat(),
                "payment_session_id": session_id,
                "updated_at": now_utc().isoformat(),
            }},
        )
        await db.driver_payouts.insert_one({
            "id": str(uuid.uuid4()),
            "driver_id": driver_id,
            "ride_id": ride_id,
            "amount": amount,
            "currency": txn["currency"],
            "session_id": session_id,
            "created_at": now_utc().isoformat(),
        })
        update["activated"] = True
        ride = await db.rides.find_one({"id": ride_id}, {"_id": 0})
        if ride:
            await notify_ride(ride, "ride.paid")
            await send_push(
                [driver_id],
                "Payment received",
                f"+${amount:.2f} {txn.get('currency', PAYPAL_CURRENCY)} paid for your trip.",
                {"ride_id": ride_id, "type": "ride.paid"},
            )

    await db.payment_transactions.update_one({"session_id": session_id}, {"$set": update})
    return {"payment_status": "paid", "status": "completed", "purpose": purpose}


@api_router.get("/payments/checkout/status/{session_id}")
async def get_checkout_status(session_id: str, user: dict = Depends(get_current_user)):
    """Returns current status of a payment transaction (read-only).
    Activation is performed by the PayPal capture endpoint."""
    txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not txn or txn["user_id"] != user["id"]:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {
        "payment_status": txn.get("payment_status", "pending"),
        "status": txn.get("status", "initiated"),
        "purpose": txn.get("purpose"),
        "provider": txn.get("provider"),
        "amount": txn.get("amount"),
        "currency": txn.get("currency"),
    }


# ----------------- PayPal webhook (idempotent backup to capture endpoint) -----------------
@api_router.post("/webhook/paypal")
async def paypal_webhook(request: Request):
    """
    Optional PayPal webhook receiver. The frontend's capture endpoint already
    activates payments synchronously, but configuring this webhook in the PayPal
    dashboard adds a safety net for cases where the user closes the browser
    after approving on PayPal but before our capture call lands.

    Subscribe to `CHECKOUT.ORDER.APPROVED` and `PAYMENT.CAPTURE.COMPLETED` in
    your PayPal app webhook settings, with URL:
      https://<your-host>/api/webhook/paypal
    """
    try:
        body = await request.json()
    except Exception:
        body = {}
    event_type = body.get("event_type", "")
    resource = body.get("resource", {}) or {}

    try:
        # PAYMENT.CAPTURE.COMPLETED carries custom_id at resource.custom_id
        custom_id = resource.get("custom_id")
        # CHECKOUT.ORDER.APPROVED puts purchase_units[0].custom_id
        if not custom_id:
            pus = resource.get("purchase_units") or []
            if pus:
                custom_id = pus[0].get("custom_id")
        if event_type in ("PAYMENT.CAPTURE.COMPLETED", "CHECKOUT.ORDER.APPROVED") and custom_id:
            order_id = resource.get("supplementary_data", {}).get("related_ids", {}).get("order_id") \
                or resource.get("id")
            # Make sure it's captured (idempotent — PayPal returns 422 ORDER_ALREADY_CAPTURED safely)
            if event_type == "CHECKOUT.ORDER.APPROVED" and order_id:
                try:
                    await _paypal_capture(order_id)
                except Exception as e:
                    logger.info("Webhook capture skipped for %s: %s", order_id, e)
            try:
                await _activate_paid_txn(custom_id)
            except HTTPException as e:
                # Unknown txn (e.g. test webhook). 200 ack — nothing to do.
                logger.info("Webhook activate skipped (%s): %s", custom_id, e.detail)
    except Exception as e:
        logger.exception("PayPal webhook error: %s", e)
    return {"received": True}


# ----------------- Mercado Pago webhook (idempotent backup to capture endpoint) -----------------
@api_router.post("/webhook/mercadopago")
async def mercadopago_webhook(request: Request):
    """
    Server-to-server notification from Mercado Pago. We treat it as a safety
    net — the frontend's mercadopago_capture endpoint already activates the
    payment synchronously on return.

    MP sends two relevant shapes:
      - Webhooks v2:  { "type": "payment", "data": { "id": "<payment_id>" } }
      - Legacy IPN:   ?topic=payment&id=<payment_id>  (no body)

    Configure your "Notifications URL" in the MP app to:
      https://<your-host>/api/webhook/mercadopago
    """
    try:
        body = {}
        try:
            body = await request.json()
        except Exception:
            body = {}
        qp = dict(request.query_params)
        payment_id = (
            (body.get("data") or {}).get("id")
            or body.get("id")
            or qp.get("id")
            or qp.get("data.id")
        )
        topic = body.get("type") or body.get("topic") or qp.get("topic") or qp.get("type")
        if not payment_id or topic not in ("payment", None):
            return {"received": True, "ignored": True}

        # We don't know which driver token owns this payment yet, but the
        # payment id is unique. Find the matching transaction by looking up
        # MP via every txn token (cheap for our scale; an optimization would
        # be to persist payment_id back into the txn on success).
        # First pass: scan only initiated MP transactions to avoid hammering MP.
        cursor = db.payment_transactions.find(
            {"provider": "mercadopago", "payment_status": {"$ne": "paid"}},
            {"_id": 0, "session_id": 1, "mp_driver_token": 1},
        )
        async for txn in cursor:
            token = txn.get("mp_driver_token")
            sid = txn.get("session_id")
            if not token or not sid:
                continue
            try:
                payment = await _mp_get_payment(token, str(payment_id))
            except HTTPException:
                continue
            if (payment.get("external_reference") or "") != sid:
                continue
            if (payment.get("status") or "").lower() == "approved":
                try:
                    await _activate_paid_txn(sid)
                except HTTPException as e:
                    logger.info("MP webhook activate skipped (%s): %s", sid, e.detail)
            break
    except Exception as e:
        logger.exception("Mercado Pago webhook error: %s", e)
    return {"received": True}


# ----------------- PhonePe capture (verify after redirect) -----------------
@api_router.post("/phonepe/capture/{session_id}")
async def phonepe_capture(session_id: str):
    """Verifies a PhonePe payment after the rider is redirected back to our
    payment-success page. Idempotent."""
    txn = await db.payment_transactions.find_one({"session_id": session_id}, {"_id": 0})
    if not txn:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if txn.get("provider") != "phonepe":
        raise HTTPException(status_code=400, detail=f"Transaction is {txn.get('provider')}, not phonepe")
    if txn.get("payment_status") == "paid":
        return {"already_paid": True}

    merchant_id = txn.get("phonepe_merchant_id")
    salt_key = txn.get("phonepe_salt_key")
    salt_index = txn.get("phonepe_salt_index") or "1"
    merchant_txn_id = txn.get("phonepe_merchant_txn_id")
    if not (merchant_id and salt_key and merchant_txn_id):
        raise HTTPException(status_code=400, detail="Missing PhonePe params on transaction")

    status = await _phonepe_check_status(
        merchant_id=merchant_id,
        salt_key=salt_key,
        salt_index=salt_index,
        merchant_txn_id=merchant_txn_id,
    )
    code = (status.get("code") or status.get("data", {}).get("state") or "").upper()
    # PhonePe returns code="PAYMENT_SUCCESS" or data.state="COMPLETED" on success.
    if code in ("PAYMENT_SUCCESS",) or (status.get("data") or {}).get("state") == "COMPLETED":
        await _activate_paid_txn(session_id)
        return {"captured": True, "status": "approved"}
    return {"captured": False, "status": code or "pending", "raw": status}


# ----------------- PhonePe webhook (S2S callback) -----------------
@api_router.post("/webhook/phonepe")
async def phonepe_webhook(request: Request):
    """Server-to-server notification from PhonePe. Safety net on top of the
    synchronous capture endpoint. PhonePe sends a base64 payload and an
    X-VERIFY header signed with the merchant's salt_key. Since we hold a
    different salt_key per driver, we identify the matching transaction by
    merchantTransactionId from the decoded payload, then verify the signature
    against that driver's salt."""
    try:
        import base64 as _b64
        import json as _json
        import hashlib as _hashlib

        body = {}
        try:
            body = await request.json()
        except Exception:
            body = {}
        payload_b64 = body.get("response") or body.get("request") or ""
        x_verify = request.headers.get("x-verify") or request.headers.get("X-VERIFY") or ""
        if not payload_b64:
            return {"received": True, "ignored": "no_payload"}

        try:
            decoded = _json.loads(_b64.b64decode(payload_b64).decode("utf-8"))
        except Exception:
            return {"received": True, "ignored": "bad_payload"}

        merchant_txn_id = (
            (decoded.get("data") or {}).get("merchantTransactionId")
            or decoded.get("merchantTransactionId")
        )
        if not merchant_txn_id:
            return {"received": True, "ignored": "no_txn_id"}

        txn = await db.payment_transactions.find_one(
            {"phonepe_merchant_txn_id": merchant_txn_id, "provider": "phonepe"},
            {"_id": 0},
        )
        if not txn:
            return {"received": True, "ignored": "unknown_txn"}

        # Verify signature with the matching driver's salt key
        salt_key = txn.get("phonepe_salt_key") or ""
        salt_index = txn.get("phonepe_salt_index") or "1"
        expected = _hashlib.sha256((payload_b64 + salt_key).encode("utf-8")).hexdigest() + "###" + str(salt_index)
        if x_verify and x_verify != expected:
            logger.warning("PhonePe webhook X-VERIFY mismatch for %s", merchant_txn_id)
            return {"received": True, "ignored": "bad_signature"}

        state = (
            (decoded.get("data") or {}).get("state")
            or decoded.get("code")
            or ""
        ).upper()
        if state in ("COMPLETED", "PAYMENT_SUCCESS"):
            try:
                await _activate_paid_txn(txn["session_id"])
            except HTTPException as e:
                logger.info("PhonePe webhook activate skipped (%s): %s", txn["session_id"], e.detail)
    except Exception as e:
        logger.exception("PhonePe webhook error: %s", e)
    return {"received": True}


# ----------------- Rides -----------------
class FareEstimateRequest(BaseModel):
    pickup_lat: float
    pickup_lng: float
    dropoff_lat: float
    dropoff_lng: float


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    import math
    R = 6371.0
    p1 = math.radians(lat1)
    p2 = math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _calc_fare(distance_km: float, duration_min: float) -> float:
    raw = FARE_BASE + (FARE_PER_KM * distance_km) + (FARE_PER_MIN * duration_min) + FARE_SERVICE
    return round(max(raw, FARE_MIN), 2)


@api_router.post("/rides/estimate-fare")
async def estimate_fare(payload: FareEstimateRequest, user: dict = Depends(get_current_user)):
    """
    Returns suggested fare. Tries Azure Maps Routing (traffic-aware) first,
    then falls back to OSRM, then to haversine + 30 km/h.
    """
    distance_km: Optional[float] = None
    duration_min: Optional[float] = None
    source = "haversine"

    # 1) Azure Maps Routing (best — traffic-aware)
    if AZURE_MAPS_KEY:
        az_url = "https://atlas.microsoft.com/route/directions/json"
        az_params = {
            "api-version": "1.0",
            "subscription-key": AZURE_MAPS_KEY,
            "query": f"{payload.pickup_lat},{payload.pickup_lng}:{payload.dropoff_lat},{payload.dropoff_lng}",
            "travelMode": "car",
            "traffic": "true",
            "routeType": "fastest",
        }
        try:
            async with httpx.AsyncClient(timeout=8.0) as cx:
                r = await cx.get(az_url, params=az_params)
                r.raise_for_status()
                data = r.json()
                routes = data.get("routes") or []
                if routes:
                    summary = routes[0].get("summary", {})
                    distance_km = (summary.get("lengthInMeters") or 0) / 1000.0
                    duration_min = (summary.get("travelTimeInSeconds") or 0) / 60.0
                    source = "azure"
        except Exception as e:
            logger.warning("Azure Maps routing failed: %s", e)

    # 2) OSRM fallback
    if distance_km is None:
        url = (
            f"{OSRM_URL}/route/v1/driving/"
            f"{payload.pickup_lng},{payload.pickup_lat};"
            f"{payload.dropoff_lng},{payload.dropoff_lat}"
            f"?overview=false&alternatives=false&steps=false"
        )
        try:
            async with httpx.AsyncClient(timeout=8.0) as cx:
                r = await cx.get(url)
                r.raise_for_status()
                data = r.json()
                if not data.get("routes"):
                    raise ValueError("no route")
                route = data["routes"][0]
                distance_km = route["distance"] / 1000.0
                duration_min = route["duration"] / 60.0
                source = "osrm"
        except Exception as e:
            logger.warning("OSRM fallback failed: %s", e)

    # 3) Haversine fallback
    if distance_km is None:
        distance_km = _haversine_km(
            payload.pickup_lat, payload.pickup_lng,
            payload.dropoff_lat, payload.dropoff_lng,
        )
        duration_min = (distance_km / 30.0) * 60.0
        source = "haversine"

    fare = _calc_fare(distance_km, duration_min or 0)
    return {
        "distance_km": round(distance_km, 2),
        "duration_min": round(duration_min or 0, 1),
        "fare": fare,
        "currency": FARE_CURRENCY,
        "source": source,
        "breakdown": {
            "base": FARE_BASE,
            "per_km": FARE_PER_KM,
            "per_min": FARE_PER_MIN,
            "service_fee": FARE_SERVICE,
            "minimum": FARE_MIN,
        },
    }


# ----------------- Geocoding (Azure Maps preferred, Nominatim fallback) -----------------
@api_router.get("/maps/search")
async def maps_search(
    q: str = Query(..., min_length=2),
    lat: Optional[float] = Query(None),
    lng: Optional[float] = Query(None),
    country: str = Query("MX"),
):
    """
    Forward geocoding / address autocomplete.
    Uses Azure Maps Search Fuzzy when AZURE_MAPS_KEY is set; falls back to Nominatim.
    Biased to `country` (default MX). If `lat`/`lng` is given, also biases by proximity.
    Returns a uniform shape: [{address, lat, lng}].
    """
    if AZURE_MAPS_KEY:
        try:
            url = "https://atlas.microsoft.com/search/fuzzy/json"
            params = {
                "api-version": "1.0",
                "subscription-key": AZURE_MAPS_KEY,
                "query": q,
                "limit": 6,
                "typeahead": "true",
                "language": "en-US",
                "countrySet": country,
            }
            if lat is not None and lng is not None:
                params["lat"] = lat
                params["lon"] = lng
                params["radius"] = 50000  # 50km bias radius
            async with httpx.AsyncClient(timeout=6.0) as cx:
                r = await cx.get(url, params=params)
                r.raise_for_status()
                data = r.json()
            results = []
            for it in data.get("results", []):
                pos = it.get("position") or {}
                addr = (it.get("address") or {}).get("freeformAddress")
                if pos.get("lat") is not None and pos.get("lon") is not None and addr:
                    results.append({"address": addr, "lat": pos["lat"], "lng": pos["lon"]})
            if results:
                return {"results": results, "source": "azure"}
        except Exception as e:
            logger.warning("Azure Maps search failed: %s", e)

    # Fallback: Nominatim (with country bias)
    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": "RideApp/1.0"}) as cx:
            r = await cx.get(
                "https://nominatim.openstreetmap.org/search",
                params={
                    "format": "json",
                    "q": q,
                    "limit": 6,
                    "addressdetails": 0,
                    "countrycodes": country.lower(),
                },
            )
            r.raise_for_status()
            data = r.json()
        results = [
            {
                "address": it.get("display_name", ""),
                "lat": float(it["lat"]),
                "lng": float(it["lon"]),
            }
            for it in data
            if it.get("lat") and it.get("lon")
        ]
        return {"results": results, "source": "nominatim"}
    except Exception as e:
        logger.warning("Nominatim fallback failed: %s", e)
        return {"results": [], "source": "none"}


@api_router.get("/maps/reverse")
async def maps_reverse(lat: float, lng: float):
    """
    Reverse geocoding (coords → address). Azure first, Nominatim fallback.
    """
    if AZURE_MAPS_KEY:
        try:
            url = "https://atlas.microsoft.com/search/address/reverse/json"
            params = {
                "api-version": "1.0",
                "subscription-key": AZURE_MAPS_KEY,
                "query": f"{lat},{lng}",
                "language": "en-US",
            }
            async with httpx.AsyncClient(timeout=6.0) as cx:
                r = await cx.get(url, params=params)
                r.raise_for_status()
                data = r.json()
            addrs = data.get("addresses") or []
            if addrs:
                a = addrs[0].get("address", {})
                return {"address": a.get("freeformAddress") or "", "source": "azure"}
        except Exception as e:
            logger.warning("Azure reverse geocode failed: %s", e)

    try:
        async with httpx.AsyncClient(timeout=8.0, headers={"User-Agent": "RideApp/1.0"}) as cx:
            r = await cx.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={"format": "json", "lat": lat, "lon": lng},
            )
            r.raise_for_status()
            data = r.json()
        return {"address": data.get("display_name", ""), "source": "nominatim"}
    except Exception as e:
        logger.warning("Nominatim reverse fallback failed: %s", e)
        return {"address": f"{lat:.5f}, {lng:.5f}", "source": "none"}


@api_router.post("/rides")
async def create_ride(payload: RideCreateRequest, user: dict = Depends(require_role("rider"))):
    ride_id = str(uuid.uuid4())
    # Use rider's currency or default to FARE_CURRENCY
    rider_currency = user.get("currency") or FARE_CURRENCY
    ride = {
        "id": ride_id,
        "rider_id": user["id"],
        "rider_name": user["name"],
        "driver_id": None,
        "driver_name": None,
        "pickup_address": payload.pickup_address,
        "dropoff_address": payload.dropoff_address,
        "pickup_lat": payload.pickup_lat,
        "pickup_lng": payload.pickup_lng,
        "dropoff_lat": payload.dropoff_lat,
        "dropoff_lng": payload.dropoff_lng,
        "estimated_fare": payload.estimated_fare,
        "distance_km": payload.distance_km,
        "duration_min": payload.duration_min,
        "currency": rider_currency,  # Store the rider's currency
        "status": "requested",
        "paid": False,
        "rider_rating": None,
        "driver_rating": None,
        "created_at": now_utc().isoformat(),
        "updated_at": now_utc().isoformat(),
    }
    await db.rides.insert_one(ride)
    out = {k: v for k, v in ride.items() if k != "_id"}
    await notify_ride(out, "ride.created")
    
    # Send push notification to all drivers with active subscriptions
    await _notify_available_drivers_of_new_ride(out, rider_currency)
    
    return out


async def _notify_available_drivers_of_new_ride(ride: dict, currency: str):
    """
    Send push notification to NEARBY drivers with active subscriptions about a new ride request.
    Only drivers within NEARBY_DRIVER_RADIUS_KM of the pickup location are notified.
    Includes pickup/dropoff locations, distance, duration, and fare.
    """
    import math
    
    NEARBY_DRIVER_RADIUS_KM = float(os.environ.get("NEARBY_DRIVER_RADIUS_KM", "10"))  # 10 km default
    
    pickup_lat = ride.get("pickup_lat")
    pickup_lng = ride.get("pickup_lng")
    
    if not pickup_lat or not pickup_lng:
        logger.warning(f"Ride {ride['id']} has no pickup coordinates, skipping driver notification")
        return
    
    now = now_utc()
    
    # Find all drivers with active subscriptions
    active_sub_cursor = db.subscriptions.find(
        {"expires_at": {"$gt": now.isoformat()}},
        {"_id": 0, "user_id": 1}
    )
    subscribed_driver_ids = [sub["user_id"] async for sub in active_sub_cursor]
    
    if not subscribed_driver_ids:
        logger.info("No drivers with active subscriptions to notify")
        return
    
    # Find drivers with recent location updates (within last 30 minutes)
    location_cutoff = (now - timedelta(minutes=30)).isoformat()
    
    drivers_cursor = db.users.find(
        {
            "id": {"$in": subscribed_driver_ids},
            "role": "driver",
            "current_lat": {"$ne": None},
            "current_lng": {"$ne": None},
            "location_updated_at": {"$gte": location_cutoff},
        },
        {"_id": 0, "id": 1, "current_lat": 1, "current_lng": 1, "name": 1}
    )
    
    # Filter by distance - Haversine formula
    def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        """Calculate the great-circle distance between two points in kilometers."""
        R = 6371  # Earth's radius in km
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
        return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    nearby_driver_ids = []
    async for driver in drivers_cursor:
        driver_lat = driver.get("current_lat")
        driver_lng = driver.get("current_lng")
        if driver_lat and driver_lng:
            distance = haversine_km(pickup_lat, pickup_lng, driver_lat, driver_lng)
            if distance <= NEARBY_DRIVER_RADIUS_KM:
                nearby_driver_ids.append(driver["id"])
                logger.debug(f"Driver {driver.get('name', driver['id'])} is {distance:.2f} km away - NOTIFYING")
            else:
                logger.debug(f"Driver {driver.get('name', driver['id'])} is {distance:.2f} km away - TOO FAR")
    
    if not nearby_driver_ids:
        logger.info(f"No nearby drivers found within {NEARBY_DRIVER_RADIUS_KM} km of pickup for ride {ride['id']}")
        return
    
    # Build notification content
    pickup = ride.get("pickup_address", "Unknown pickup")
    dropoff = ride.get("dropoff_address", "Unknown dropoff")
    fare = ride.get("estimated_fare", 0)
    distance = ride.get("distance_km")
    duration = ride.get("duration_min")
    
    # Truncate addresses for notification
    pickup_short = pickup[:30] + "..." if len(pickup) > 30 else pickup
    dropoff_short = dropoff[:30] + "..." if len(dropoff) > 30 else dropoff
    
    # Build notification body
    body_parts = [f"📍 {pickup_short} → {dropoff_short}"]
    
    if distance:
        body_parts.append(f"📏 {distance:.1f} km")
    if duration:
        body_parts.append(f"⏱ {duration:.0f} min")
    
    body_parts.append(f"💰 ${fare:.2f} {currency}")
    
    notification_body = " • ".join(body_parts)
    
    # Send push notification to nearby drivers only
    await send_push(
        nearby_driver_ids,
        "🚗 New Ride Request!",
        notification_body,
        {
            "ride_id": ride["id"],
            "type": "ride.new_request",
            "pickup_address": pickup,
            "dropoff_address": dropoff,
            "pickup_lat": ride.get("pickup_lat"),
            "pickup_lng": ride.get("pickup_lng"),
            "dropoff_lat": ride.get("dropoff_lat"),
            "dropoff_lng": ride.get("dropoff_lng"),
            "estimated_fare": fare,
            "distance_km": distance,
            "duration_min": duration,
            "currency": currency,
            "rider_name": ride.get("rider_name", "Rider"),
        }
    )
    
    # Also notify via WebSocket
    await ws_manager.send_to_users(
        nearby_driver_ids,
        "ride.new_request",
        {
            "ride_id": ride["id"],
            "pickup_address": pickup,
            "dropoff_address": dropoff,
            "pickup_lat": ride.get("pickup_lat"),
            "pickup_lng": ride.get("pickup_lng"),
            "dropoff_lat": ride.get("dropoff_lat"),
            "dropoff_lng": ride.get("dropoff_lng"),
            "estimated_fare": fare,
            "distance_km": distance,
            "duration_min": duration,
            "currency": currency,
            "rider_name": ride.get("rider_name", "Rider"),
        }
    )
    
    logger.info(f"Notified {len(nearby_driver_ids)} nearby drivers (within {NEARBY_DRIVER_RADIUS_KM} km) about new ride {ride['id']}")


@api_router.get("/rides/my")
async def my_rides(user: dict = Depends(get_current_user)):
    if user["role"] == "rider":
        cursor = db.rides.find({"rider_id": user["id"]}, {"_id": 0}).sort("created_at", -1)
    else:
        cursor = db.rides.find({"driver_id": user["id"]}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=200)


@api_router.get("/rides/available")
async def available_rides(user: dict = Depends(require_role("driver"))):
    sub = await _get_active_subscription(user["id"])
    if not sub:
        raise HTTPException(status_code=403, detail="Active subscription required")
    cursor = db.rides.find({"status": "requested", "driver_id": None}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(length=100)


@api_router.post("/rides/{ride_id}/accept")
async def accept_ride(ride_id: str, user: dict = Depends(require_role("driver"))):
    sub = await _get_active_subscription(user["id"])
    if not sub:
        raise HTTPException(status_code=403, detail="Active subscription required")
    result = await db.rides.find_one_and_update(
        {"id": ride_id, "status": "requested", "driver_id": None},
        {"$set": {
            "driver_id": user["id"],
            "driver_name": user["name"],
            "driver_vehicle": user.get("vehicle"),
            "status": "accepted",
            "accepted_at": now_utc().isoformat(),
            "updated_at": now_utc().isoformat(),
        }},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=400, detail="Ride no longer available")
    result.pop("_id", None)
    await notify_ride(result, "ride.accepted")
    await send_push(
        [result["rider_id"]],
        "Driver accepted!",
        f"{user['name']} is on the way.",
        {"ride_id": ride_id, "type": "ride.accepted"},
    )
    return result


@api_router.post("/rides/{ride_id}/complete")
async def complete_ride(ride_id: str, user: dict = Depends(require_role("driver"))):
    result = await db.rides.find_one_and_update(
        {"id": ride_id, "driver_id": user["id"], "status": "accepted"},
        {"$set": {
            "status": "completed",
            "completed_at": now_utc().isoformat(),
            "updated_at": now_utc().isoformat(),
        }},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=400, detail="Cannot complete this ride")
    result.pop("_id", None)
    await notify_ride(result, "ride.completed")
    await send_push(
        [result["rider_id"]],
        "Trip completed",
        f"Please pay ${result['estimated_fare']:.2f} {PAYPAL_CURRENCY} to {result.get('driver_name', 'your driver')}.",
        {"ride_id": ride_id, "type": "ride.completed"},
    )
    return result


@api_router.post("/rides/{ride_id}/cancel")
async def cancel_ride(ride_id: str, user: dict = Depends(get_current_user)):
    query = {"id": ride_id, "status": {"$in": ["requested", "accepted"]}}
    if user["role"] == "rider":
        query["rider_id"] = user["id"]
    else:
        query["driver_id"] = user["id"]
    result = await db.rides.find_one_and_update(
        query,
        {"$set": {"status": "cancelled", "updated_at": now_utc().isoformat()}},
        return_document=True,
    )
    if not result:
        raise HTTPException(status_code=400, detail="Cannot cancel this ride")
    result.pop("_id", None)
    await notify_ride(result, "ride.cancelled")
    return result


# ----------------- Ratings -----------------
async def _update_user_rating(user_id: str):
    pipeline = [
        {"$match": {"user_id": user_id}},
        {"$group": {"_id": None, "avg": {"$avg": "$score"}, "count": {"$sum": 1}}},
    ]
    cursor = db.ratings.aggregate(pipeline)
    docs = await cursor.to_list(length=1)
    if not docs:
        return
    await db.users.update_one(
        {"id": user_id},
        {"$set": {
            "rating_avg": round(docs[0]["avg"], 2),
            "rating_count": docs[0]["count"],
        }},
    )


@api_router.post("/rides/{ride_id}/rate")
async def rate_ride(ride_id: str, body: RatingRequest, user: dict = Depends(get_current_user)):
    ride = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    if ride.get("status") != "completed":
        raise HTTPException(status_code=400, detail="Ride must be completed")

    if user["role"] == "rider":
        if ride.get("rider_id") != user["id"]:
            raise HTTPException(status_code=403, detail="Not your ride")
        if ride.get("rider_rating") is not None:
            raise HTTPException(status_code=400, detail="Already rated")
        rated_user_id = ride["driver_id"]
        rating_field = "rider_rating"
    else:
        if ride.get("driver_id") != user["id"]:
            raise HTTPException(status_code=403, detail="Not your ride")
        if ride.get("driver_rating") is not None:
            raise HTTPException(status_code=400, detail="Already rated")
        rated_user_id = ride["rider_id"]
        rating_field = "driver_rating"

    if not rated_user_id:
        raise HTTPException(status_code=400, detail="No counterparty to rate")

    rating_id = str(uuid.uuid4())
    rating_doc = {
        "id": rating_id,
        "ride_id": ride_id,
        "user_id": rated_user_id,           # the one being rated
        "by_user_id": user["id"],
        "by_role": user["role"],
        "score": body.score,
        "comment": body.comment,
        "created_at": now_utc().isoformat(),
    }
    await db.ratings.insert_one(rating_doc)
    await db.rides.update_one(
        {"id": ride_id},
        {"$set": {rating_field: body.score, "updated_at": now_utc().isoformat()}},
    )
    await _update_user_rating(rated_user_id)
    return {"ok": True, "rating": {k: v for k, v in rating_doc.items() if k != "_id"}}


# ----------------- Driver Location -----------------
@api_router.post("/driver/location")
async def update_driver_location(body: LocationUpdate, user: dict = Depends(require_role("driver"))):
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "current_lat": body.lat,
            "current_lng": body.lng,
            "location_updated_at": now_utc().isoformat(),
        }},
    )
    res = await db.rides.find_one_and_update(
        {"driver_id": user["id"], "status": "accepted"},
        {"$set": {
            "driver_lat": body.lat,
            "driver_lng": body.lng,
            "updated_at": now_utc().isoformat(),
        }},
        return_document=True,
    )
    if res:
        res.pop("_id", None)
        await notify_ride(res, "ride.location")
    return {"ok": True}


@api_router.get("/rides/{ride_id}")
async def get_ride(ride_id: str, user: dict = Depends(get_current_user)):
    ride = await db.rides.find_one({"id": ride_id}, {"_id": 0})
    if not ride:
        raise HTTPException(status_code=404, detail="Ride not found")
    if ride.get("rider_id") != user["id"] and ride.get("driver_id") != user["id"]:
        raise HTTPException(status_code=403, detail="Not your ride")
    if ride.get("driver_id"):
        driver = await db.users.find_one({"id": ride["driver_id"]}, {"_id": 0})
        if driver:
            ride["driver_lat"] = ride.get("driver_lat") or driver.get("current_lat")
            ride["driver_lng"] = ride.get("driver_lng") or driver.get("current_lng")
            ride["driver_rating_avg"] = driver.get("rating_avg")
            ride["driver_rating_count"] = driver.get("rating_count", 0)
    return ride


# ----------------- Driver Earnings -----------------
@api_router.get("/driver/earnings")
async def driver_earnings(user: dict = Depends(require_role("driver"))):
    cursor = db.rides.find(
        {"driver_id": user["id"], "status": "completed"},
        {"_id": 0},
    ).sort("completed_at", -1)
    rides = await cursor.to_list(length=500)
    total = sum(r.get("estimated_fare", 0) for r in rides)
    paid_total = sum(r.get("estimated_fare", 0) for r in rides if r.get("paid"))
    pending_total = total - paid_total
    pending_cash = [r for r in rides if r.get("cash_pending_at") and not r.get("paid")]
    return {
        "total_earnings": round(total, 2),
        "paid_earnings": round(paid_total, 2),
        "pending_earnings": round(pending_total, 2),
        "completed_rides": len(rides),
        "rides": rides,
        # Rides awaiting cash confirmation by THIS driver — surfaced so the
        # frontend can render a "Confirm cash received" prompt.
        "pending_cash_rides": pending_cash,
    }


# ----------------- WebSocket -----------------
@app.websocket("/api/ws/rides")
async def ws_rides(ws: WebSocket, token: str = Query(...)):
    try:
        payload = decode_token(token)
        user_id = payload["sub"]
    except Exception:
        # Must accept the WS handshake before sending a close code, otherwise
        # Starlette responds with HTTP 403 and clients never see the 4401 code.
        await ws.accept()
        await ws.close(code=4401)
        return
    await ws_manager.connect(user_id, ws)
    try:
        while True:
            # Keep connection alive; ignore client messages
            await ws.receive_text()
    except WebSocketDisconnect:
        await ws_manager.disconnect(user_id, ws)
    except Exception:
        await ws_manager.disconnect(user_id, ws)


# ----------------- Social Auth + Maps -----------------
class GoogleAuthRequest(BaseModel):
    session_id: str
    role: Literal["rider", "driver"] = "rider"


class FacebookAuthRequest(BaseModel):
    access_token: str
    role: Literal["rider", "driver"] = "rider"


class MicrosoftAuthRequest(BaseModel):
    code: str
    redirect_uri: str
    role: Literal["rider", "driver"] = "rider"


class DirectionsRequest(BaseModel):
    origin_lat: float
    origin_lng: float
    dest_lat: float
    dest_lng: float


async def _login_or_create_oauth_user(
    email: str, name: str, role: str, provider: str, provider_id: str
) -> dict:
    """Find user by email or create one. Returns user_doc (no password_hash, no _id)."""
    email = email.lower()
    user = await db.users.find_one({"email": email})
    if user:
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {f"{provider}_id": provider_id, "updated_at": now_utc().isoformat()}},
        )
        return _user_public(user)

    user_id = str(uuid.uuid4())
    user_doc = {
        "id": user_id,
        "email": email,
        "name": name or email.split("@")[0],
        "role": role,
        "phone": None,
        "vehicle": None,
        "password_hash": "",  # OAuth user — cannot login via password
        "rating_avg": None,
        "rating_count": 0,
        f"{provider}_id": provider_id,
        "created_at": now_utc().isoformat(),
    }
    await db.users.insert_one(user_doc)
    return _user_public(user_doc)


@api_router.post("/auth/google/session", response_model=TokenResponse)
async def google_auth_session(payload: GoogleAuthRequest):
    """
    REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
    Exchange an Emergent Auth session_id for our own JWT.
    Frontend obtains the session_id from `#session_id=...` URL fragment after the
    user comes back from `https://auth.emergentagent.com/?redirect=<our-callback-url>`.
    """
    try:
        async with httpx.AsyncClient(timeout=10) as ac:
            r = await ac.get(
                EMERGENT_AUTH_SESSION_URL,
                headers={"X-Session-ID": payload.session_id},
            )
        if r.status_code != 200:
            raise HTTPException(status_code=401, detail="Invalid Google session")
        data = r.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Emergent auth call failed: %s", e)
        raise HTTPException(status_code=502, detail="Auth provider unavailable")

    user = await _login_or_create_oauth_user(
        email=data.get("email", ""),
        name=data.get("name", ""),
        role=payload.role,
        provider="google",
        provider_id=data.get("id", ""),
    )
    token = create_access_token(user["id"], user["email"], user["role"])
    return TokenResponse(access_token=token, user=user)


@api_router.post("/auth/facebook/login", response_model=TokenResponse)
async def facebook_auth_login(payload: FacebookAuthRequest):
    """Exchange a Facebook user-access-token for our JWT.
    Requires FACEBOOK_APP_ID + FACEBOOK_APP_SECRET in backend/.env."""
    if not FB_APP_ID or FB_APP_ID == "REPLACE_ME" or not FB_APP_SECRET or FB_APP_SECRET == "REPLACE_ME":
        raise HTTPException(
            status_code=503,
            detail="Facebook login not configured. Set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET in backend/.env",
        )
    try:
        async with httpx.AsyncClient(timeout=10) as ac:
            # Verify token belongs to this app
            verify = await ac.get(
                "https://graph.facebook.com/debug_token",
                params={
                    "input_token": payload.access_token,
                    "access_token": f"{FB_APP_ID}|{FB_APP_SECRET}",
                },
            )
            verify.raise_for_status()
            v = verify.json().get("data", {})
            if not v.get("is_valid") or str(v.get("app_id")) != str(FB_APP_ID):
                raise HTTPException(status_code=401, detail="Invalid Facebook token")
            # Fetch profile
            prof = await ac.get(
                "https://graph.facebook.com/me",
                params={"fields": "id,name,email", "access_token": payload.access_token},
            )
            prof.raise_for_status()
            data = prof.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Facebook verification failed: %s", e)
        raise HTTPException(status_code=502, detail="Auth provider unavailable")

    if not data.get("email"):
        raise HTTPException(status_code=400, detail="Facebook account has no email — cannot create user")
    user = await _login_or_create_oauth_user(
        email=data["email"],
        name=data.get("name", ""),
        role=payload.role,
        provider="facebook",
        provider_id=str(data.get("id", "")),
    )
    token = create_access_token(user["id"], user["email"], user["role"])
    return TokenResponse(access_token=token, user=user)


@api_router.post("/auth/microsoft/login", response_model=TokenResponse)
async def microsoft_auth_login(payload: MicrosoftAuthRequest):
    """
    Exchange a Microsoft authorization code for our JWT.
    The frontend opens https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize?...
    and after consent the user is redirected to `redirect_uri?code=...&state=...`.
    Frontend posts that code here together with the same redirect_uri it used.
    """
    if not AZURE_AD_CLIENT_ID or not AZURE_AD_CLIENT_SECRET:
        raise HTTPException(
            status_code=503,
            detail="Microsoft login not configured. Set AZURE_AD_CLIENT_ID, AZURE_AD_TENANT_ID and AZURE_AD_CLIENT_SECRET in backend/.env",
        )

    token_url = f"https://login.microsoftonline.com/{AZURE_AD_TENANT_ID}/oauth2/v2.0/token"
    try:
        async with httpx.AsyncClient(timeout=10) as ac:
            tr = await ac.post(
                token_url,
                data={
                    "client_id": AZURE_AD_CLIENT_ID,
                    "client_secret": AZURE_AD_CLIENT_SECRET,
                    "code": payload.code,
                    "redirect_uri": payload.redirect_uri,
                    "grant_type": "authorization_code",
                    "scope": "openid profile email User.Read",
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if tr.status_code != 200:
                logger.warning("Microsoft token exchange failed (%s): %s", tr.status_code, tr.text)
                raise HTTPException(status_code=401, detail="Microsoft token exchange failed")
            tok = tr.json()
            access_token = tok.get("access_token")
            if not access_token:
                raise HTTPException(status_code=401, detail="No access_token from Microsoft")

            # Fetch profile from Microsoft Graph
            prof = await ac.get(
                "https://graph.microsoft.com/v1.0/me",
                headers={"Authorization": f"Bearer {access_token}"},
            )
            prof.raise_for_status()
            data = prof.json()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Microsoft auth failed: %s", e)
        raise HTTPException(status_code=502, detail="Auth provider unavailable")

    email = (data.get("mail") or data.get("userPrincipalName") or "").lower()
    if not email:
        raise HTTPException(status_code=400, detail="Microsoft account has no email — cannot create user")

    name = data.get("displayName") or email.split("@")[0]
    user = await _login_or_create_oauth_user(
        email=email,
        name=name,
        role=payload.role,
        provider="microsoft",
        provider_id=str(data.get("id", "")),
    )
    token = create_access_token(user["id"], user["email"], user["role"])
    return TokenResponse(access_token=token, user=user)


@api_router.post("/maps/directions")
async def get_directions(body: DirectionsRequest, user: dict = Depends(get_current_user)):
    """Returns turn-by-turn route polyline + duration/distance from Google Directions API.
    Requires GOOGLE_MAPS_API_KEY in backend/.env. Frontend decodes the polyline to draw on the map."""
    if not GMAPS_API_KEY or GMAPS_API_KEY == "REPLACE_ME":
        raise HTTPException(
            status_code=503,
            detail="Google Maps not configured. Set GOOGLE_MAPS_API_KEY in backend/.env",
        )
    try:
        async with httpx.AsyncClient(timeout=10) as ac:
            r = await ac.get(
                "https://maps.googleapis.com/maps/api/directions/json",
                params={
                    "origin": f"{body.origin_lat},{body.origin_lng}",
                    "destination": f"{body.dest_lat},{body.dest_lng}",
                    "mode": "driving",
                    "key": GMAPS_API_KEY,
                },
            )
            data = r.json()
    except Exception as e:
        logger.exception("Directions error: %s", e)
        raise HTTPException(status_code=502, detail="Maps provider unavailable")

    if data.get("status") != "OK" or not data.get("routes"):
        raise HTTPException(status_code=400, detail=f"Route not found: {data.get('status')}")
    route = data["routes"][0]
    leg = route["legs"][0]
    return {
        "polyline": route["overview_polyline"]["points"],
        "distance_text": leg["distance"]["text"],
        "distance_meters": leg["distance"]["value"],
        "duration_text": leg["duration"]["text"],
        "duration_seconds": leg["duration"]["value"],
        "start_address": leg.get("start_address"),
        "end_address": leg.get("end_address"),
    }


# ----------------- Health -----------------
@api_router.get("/")
async def root():
    return {"message": "Ride API is running", "version": "2.0"}


# ----------------- Init -----------------
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def on_startup():
    await db.users.create_index("email", unique=True)
    await db.rides.create_index("status")
    await db.rides.create_index("rider_id")
    await db.rides.create_index("driver_id")
    await db.driver_subscriptions.create_index("driver_id")
    await db.driver_subscriptions.create_index("expires_at")
    await db.payment_transactions.create_index("session_id", unique=True)
    await db.push_tokens.create_index("token", unique=True)
    await db.ratings.create_index("ride_id")
    await db.ratings.create_index("user_id")
    await db.driver_payouts.create_index("driver_id")
    logger.info("Ride API started, indexes ensured.")


@app.on_event("shutdown")
async def shutdown():
    client.close()
