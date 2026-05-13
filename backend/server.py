"""LendSplit Backend - FastAPI + MongoDB
JWT email/password auth + Emergent Google Auth + Loans + Contacts + Subscription (mocked)
"""
from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Request, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Literal
from pathlib import Path
from dotenv import load_dotenv
import os
import uuid
import jwt
import httpx
import logging

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# ============ Config ============
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ.get('DB_NAME', 'lendsplit_db')
JWT_SECRET = os.environ.get('JWT_SECRET', 'lendsplit-dev-secret-change-in-prod-min-32-chars-long-12345')
JWT_ALGORITHM = 'HS256'
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days

EMERGENT_SESSION_DATA_URL = "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data"
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============ DB ============
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

# ============ Security ============
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(p: str) -> str:
    return pwd_context.hash(p)

def verify_password(p: str, h: str) -> bool:
    try:
        return pwd_context.verify(p, h)
    except Exception:
        return False

def create_access_token(user_id: str, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    return jwt.encode({"sub": email, "user_id": user_id, "exp": expire}, JWT_SECRET, algorithm=JWT_ALGORITHM)

async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    token = authorization.split(" ", 1)[1].strip()
    # Try JWT first
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = payload.get("user_id")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "hashed_password": 0})
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return user
    except jwt.InvalidTokenError:
        pass
    # Try Emergent session token
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid token")
    expires_at = session.get("expires_at")
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at and datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0, "hashed_password": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user

# ============ Models ============
class SignupIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    phone: Optional[str] = None

class LoginIn(BaseModel):
    email: EmailStr
    password: str

class GoogleSessionIn(BaseModel):
    session_id: str

class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict

class UserOut(BaseModel):
    user_id: str
    email: str
    name: str
    phone: Optional[str] = None
    picture: Optional[str] = None
    subscription_tier: str = "free"  # free | private | public

class ContactIn(BaseModel):
    name: str
    email: Optional[EmailStr] = None
    phone: Optional[str] = None

class LoanIn(BaseModel):
    mode: Literal["private", "public"]
    counterparty_name: str
    counterparty_email: Optional[str] = None
    counterparty_phone: Optional[str] = None
    direction: Literal["lent", "borrowed"] = "lent"  # I lent to them, or I borrowed from them
    principal_amount: float = Field(gt=0)
    interest_rate: float = Field(ge=0, le=100)  # annual %
    start_date: str  # ISO
    due_date: Optional[str] = None
    reminder_enabled: bool = True
    reminder_day: int = Field(default=1, ge=1, le=28)
    notes: Optional[str] = None
    request_acceptance: bool = False  # if true and counterparty is linked, status starts as pending_acceptance

class LoanUpdate(BaseModel):
    principal_amount: Optional[float] = None
    interest_rate: Optional[float] = None
    due_date: Optional[str] = None
    reminder_enabled: Optional[bool] = None
    reminder_day: Optional[int] = None
    notes: Optional[str] = None
    status: Optional[Literal["active", "settled", "closed", "overdue", "pending_acceptance", "rejected"]] = None

class SubscribeIn(BaseModel):
    tier: Literal["private", "public"]
    payment_method: Literal["phonepe", "google_play", "paypal"]

class PaymentIn(BaseModel):
    amount: float = Field(gt=0)
    note: Optional[str] = None
    paid_at: Optional[str] = None  # ISO date; defaults to today

class PushTokenIn(BaseModel):
    expo_push_token: str

# ============ Helpers ============
def calc_loan_metrics(loan: dict, total_paid: float = 0.0) -> dict:
    """Compute monthly interest, accrued interest, total due (after payments)."""
    principal = float(loan.get("principal_amount", 0))
    rate = float(loan.get("interest_rate", 0))
    start_date_str = loan.get("start_date")
    try:
        start = datetime.fromisoformat(start_date_str.replace("Z", "+00:00"))
    except Exception:
        start = datetime.now(timezone.utc)
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    now = datetime.now(timezone.utc)
    months_elapsed = max(0, (now.year - start.year) * 12 + (now.month - start.month))
    monthly_interest = round(principal * rate / 1200, 2)
    accrued_interest = round(monthly_interest * months_elapsed, 2)
    gross_due = principal + accrued_interest
    total_due = round(max(0.0, gross_due - total_paid), 2)
    return {
        "monthly_interest": monthly_interest,
        "accrued_interest": accrued_interest,
        "total_paid": round(total_paid, 2),
        "total_due": total_due,
        "months_elapsed": months_elapsed,
    }


async def sum_payments(loan_id: str) -> float:
    cur = db.payments.find({"loan_id": loan_id}, {"_id": 0, "amount": 1})
    total = 0.0
    async for p in cur:
        total += float(p.get("amount", 0))
    return total


async def send_push(user_id: str, title: str, body: str, data: dict | None = None) -> None:
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "expo_push_token": 1})
    if not user:
        return
    token = user.get("expo_push_token")
    if not token:
        return
    message = {
        "to": token,
        "sound": "default",
        "title": title,
        "body": body,
        "data": data or {},
    }
    try:
        async with httpx.AsyncClient(timeout=10.0) as http:
            await http.post(EXPO_PUSH_URL, json=message, headers={"Content-Type": "application/json"})
    except Exception as e:
        logger.warning(f"Push send failed: {e}")


def serialize_loan(loan: dict, total_paid: float = 0.0) -> dict:
    metrics = calc_loan_metrics(loan, total_paid=total_paid)
    out = {k: v for k, v in loan.items() if k != "_id"}
    out.update(metrics)
    # Determine overdue
    due_date_str = out.get("due_date")
    if due_date_str and out.get("status") == "active":
        try:
            due = datetime.fromisoformat(due_date_str.replace("Z", "+00:00"))
            if due.tzinfo is None:
                due = due.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) > due:
                out["is_overdue"] = True
            else:
                out["is_overdue"] = False
        except Exception:
            out["is_overdue"] = False
    else:
        out["is_overdue"] = False
    return out

# ============ App setup ============
app = FastAPI(title="LendSplit API")
api = APIRouter(prefix="/api")

@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.loans.create_index("owner_user_id")
    await db.contacts.create_index([("owner_user_id", 1), ("email", 1)])
    await db.payments.create_index("loan_id")
    logger.info("LendSplit backend started")

@app.on_event("shutdown")
async def shutdown():
    client.close()

# ============ Health ============
@api.get("/")
async def root():
    return {"status": "ok", "app": "LendSplit"}

# ============ Auth ============
@api.post("/auth/signup", response_model=TokenOut)
async def signup(data: SignupIn):
    existing = await db.users.find_one({"email": data.email.lower()})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user = {
        "user_id": user_id,
        "email": data.email.lower(),
        "name": data.name,
        "phone": data.phone,
        "picture": None,
        "hashed_password": hash_password(data.password),
        "auth_providers": ["password"],
        "subscription_tier": "free",
        "subscription_expires_at": None,
        "created_at": datetime.now(timezone.utc),
    }
    await db.users.insert_one(user)
    token = create_access_token(user_id, data.email.lower())
    user.pop("_id", None)
    user.pop("hashed_password", None)
    return TokenOut(access_token=token, user=user)

@api.post("/auth/login", response_model=TokenOut)
async def login(data: LoginIn):
    user = await db.users.find_one({"email": data.email.lower()})
    if not user or not user.get("hashed_password"):
        # Dummy verify to prevent timing attacks
        verify_password(data.password, hash_password("dummy"))
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(data.password, user["hashed_password"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["user_id"], user["email"])
    user.pop("_id", None)
    user.pop("hashed_password", None)
    return TokenOut(access_token=token, user=user)

@api.post("/auth/google", response_model=TokenOut)
async def google_auth(data: GoogleSessionIn):
    """Exchange Emergent session_id for app token. Upserts user by email."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as http:
            r = await http.get(
                EMERGENT_SESSION_DATA_URL,
                headers={"X-Session-ID": data.session_id},
            )
            if r.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid Google session")
            sd = r.json()
    except httpx.HTTPError as e:
        logger.error(f"Google auth http error: {e}")
        raise HTTPException(status_code=502, detail="Auth provider unavailable")

    email = sd.get("email", "").lower()
    name = sd.get("name") or email.split("@")[0]
    picture = sd.get("picture")
    session_token = sd.get("session_token")

    if not email or not session_token:
        raise HTTPException(status_code=400, detail="Invalid session data")

    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        providers = set(existing.get("auth_providers", []))
        providers.add("google")
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"picture": picture or existing.get("picture"), "auth_providers": list(providers), "name": existing.get("name") or name}},
        )
        user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "hashed_password": 0})
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        user = {
            "user_id": user_id,
            "email": email,
            "name": name,
            "phone": None,
            "picture": picture,
            "auth_providers": ["google"],
            "subscription_tier": "free",
            "subscription_expires_at": None,
            "created_at": datetime.now(timezone.utc),
        }
        await db.users.insert_one(user.copy())

    # Store session token
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    await db.user_sessions.update_one(
        {"session_token": session_token},
        {"$set": {"session_token": session_token, "user_id": user_id, "expires_at": expires_at, "created_at": datetime.now(timezone.utc)}},
        upsert=True,
    )

    if isinstance(user, dict):
        user.pop("_id", None)
        user.pop("hashed_password", None)
    return TokenOut(access_token=session_token, user=user)

@api.get("/auth/me")
async def me(current_user: dict = Depends(get_current_user)):
    return current_user

@api.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1]
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}

# ============ Contacts ============
@api.post("/contacts")
async def create_contact(data: ContactIn, current_user: dict = Depends(get_current_user)):
    if not data.email and not data.phone:
        raise HTTPException(status_code=400, detail="Email or phone required")
    contact_id = f"contact_{uuid.uuid4().hex[:12]}"
    # Lookup if linked user exists
    linked_user = None
    if data.email:
        linked = await db.users.find_one({"email": data.email.lower()}, {"_id": 0, "user_id": 1, "name": 1, "picture": 1})
        if linked:
            linked_user = linked
    contact = {
        "contact_id": contact_id,
        "owner_user_id": current_user["user_id"],
        "name": data.name,
        "email": data.email.lower() if data.email else None,
        "phone": data.phone,
        "linked_user_id": linked_user["user_id"] if linked_user else None,
        "is_registered": bool(linked_user),
        "created_at": datetime.now(timezone.utc),
    }
    await db.contacts.insert_one(contact.copy())
    contact.pop("_id", None)
    return contact

@api.get("/contacts")
async def list_contacts(current_user: dict = Depends(get_current_user)):
    cursor = db.contacts.find({"owner_user_id": current_user["user_id"]}, {"_id": 0}).sort("created_at", -1)
    return await cursor.to_list(500)

@api.get("/contacts/search")
async def search_user(q: str, current_user: dict = Depends(get_current_user)):
    """Search if an Emergent app user exists by email or phone."""
    q = q.strip().lower()
    if "@" in q:
        user = await db.users.find_one({"email": q}, {"_id": 0, "user_id": 1, "name": 1, "email": 1, "picture": 1})
    else:
        user = await db.users.find_one({"phone": q}, {"_id": 0, "user_id": 1, "name": 1, "phone": 1, "picture": 1})
    if user:
        return {"found": True, "user": user}
    return {"found": False}

# ============ Loans (PUBLIC mode only on server) ============
@api.post("/loans")
async def create_loan(data: LoanIn, current_user: dict = Depends(get_current_user)):
    if data.mode == "private":
        raise HTTPException(status_code=400, detail="Private loans must be stored on device")
    loan_id = f"loan_{uuid.uuid4().hex[:12]}"
    # Try to link counterparty
    linked_user_id = None
    if data.counterparty_email:
        linked = await db.users.find_one({"email": data.counterparty_email.lower()}, {"_id": 0, "user_id": 1})
        if linked:
            linked_user_id = linked["user_id"]
    initial_status = "pending_acceptance" if (data.request_acceptance and linked_user_id) else "active"
    loan = {
        "loan_id": loan_id,
        "mode": "public",
        "owner_user_id": current_user["user_id"],
        "owner_name": current_user.get("name"),
        "counterparty_name": data.counterparty_name,
        "counterparty_email": data.counterparty_email.lower() if data.counterparty_email else None,
        "counterparty_phone": data.counterparty_phone,
        "counterparty_user_id": linked_user_id,
        "direction": data.direction,
        "principal_amount": data.principal_amount,
        "interest_rate": data.interest_rate,
        "interest_type": "simple_monthly",
        "start_date": data.start_date,
        "due_date": data.due_date,
        "reminder_enabled": data.reminder_enabled,
        "reminder_day": data.reminder_day,
        "notes": data.notes,
        "status": initial_status,
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    await db.loans.insert_one(loan.copy())
    # Notify linked counterparty about new loan
    if linked_user_id:
        title = "New loan request" if initial_status == "pending_acceptance" else "New shared loan"
        body = f"{current_user.get('name')} added a loan of \u20B9{data.principal_amount}"
        await send_push(linked_user_id, title, body, {"loan_id": loan_id})
    return serialize_loan(loan, total_paid=0.0)

@api.get("/loans")
async def list_loans(
    current_user: dict = Depends(get_current_user),
    status: Optional[str] = None,
):
    query = {
        "$or": [
            {"owner_user_id": current_user["user_id"]},
            {"counterparty_user_id": current_user["user_id"]},
        ]
    }
    if status:
        query["status"] = status
    cursor = db.loans.find(query, {"_id": 0}).sort("created_at", -1)
    items = await cursor.to_list(500)
    result = []
    for l in items:
        paid = await sum_payments(l["loan_id"])
        result.append(serialize_loan(l, total_paid=paid))
    return result

@api.get("/loans/incoming")
async def incoming_loans(current_user: dict = Depends(get_current_user)):
    """Loans where I am the counterparty awaiting acceptance."""
    cursor = db.loans.find(
        {"counterparty_user_id": current_user["user_id"], "status": "pending_acceptance"},
        {"_id": 0},
    ).sort("created_at", -1)
    items = await cursor.to_list(200)
    return [serialize_loan(l, total_paid=0.0) for l in items]

@api.get("/loans/{loan_id}")
async def get_loan(loan_id: str, current_user: dict = Depends(get_current_user)):
    loan = await db.loans.find_one({"loan_id": loan_id}, {"_id": 0})
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    if loan["owner_user_id"] != current_user["user_id"] and loan.get("counterparty_user_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    paid = await sum_payments(loan_id)
    return serialize_loan(loan, total_paid=paid)

@api.patch("/loans/{loan_id}")
async def update_loan(loan_id: str, data: LoanUpdate, current_user: dict = Depends(get_current_user)):
    loan = await db.loans.find_one({"loan_id": loan_id}, {"_id": 0})
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    if loan["owner_user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Only owner can edit")
    update = {k: v for k, v in data.dict().items() if v is not None}
    update["updated_at"] = datetime.now(timezone.utc)
    await db.loans.update_one({"loan_id": loan_id}, {"$set": update})
    updated = await db.loans.find_one({"loan_id": loan_id}, {"_id": 0})
    paid = await sum_payments(loan_id)
    return serialize_loan(updated, total_paid=paid)

@api.delete("/loans/{loan_id}")
async def delete_loan(loan_id: str, current_user: dict = Depends(get_current_user)):
    loan = await db.loans.find_one({"loan_id": loan_id}, {"_id": 0})
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    if loan["owner_user_id"] != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Only owner can delete")
    await db.loans.delete_one({"loan_id": loan_id})
    await db.payments.delete_many({"loan_id": loan_id})
    return {"ok": True}

# ============ Payments (partial repayments) ============
@api.post("/loans/{loan_id}/payments")
async def add_payment(loan_id: str, data: PaymentIn, current_user: dict = Depends(get_current_user)):
    loan = await db.loans.find_one({"loan_id": loan_id}, {"_id": 0})
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    if loan["owner_user_id"] != current_user["user_id"] and loan.get("counterparty_user_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    payment_id = f"pay_{uuid.uuid4().hex[:12]}"
    paid_at = datetime.now(timezone.utc)
    if data.paid_at:
        try:
            parsed = datetime.fromisoformat(data.paid_at.replace("Z", "+00:00"))
            paid_at = parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except Exception:
            pass
    payment = {
        "payment_id": payment_id,
        "loan_id": loan_id,
        "by_user_id": current_user["user_id"],
        "amount": float(data.amount),
        "note": data.note,
        "paid_at": paid_at,
        "created_at": datetime.now(timezone.utc),
    }
    await db.payments.insert_one(payment.copy())
    # Auto-settle if fully paid
    total_paid = await sum_payments(loan_id)
    metrics = calc_loan_metrics(loan, total_paid=total_paid)
    if metrics["total_due"] <= 0 and loan.get("status") == "active":
        await db.loans.update_one({"loan_id": loan_id}, {"$set": {"status": "settled", "updated_at": datetime.now(timezone.utc)}})
    # Notify the other party
    other_id = loan["owner_user_id"] if current_user["user_id"] == loan.get("counterparty_user_id") else loan.get("counterparty_user_id")
    if other_id:
        await send_push(other_id, "Payment recorded", f"₹{data.amount} payment on loan with {current_user.get('name')}", {"loan_id": loan_id})
    payment.pop("_id", None)
    payment["paid_at"] = payment["paid_at"].isoformat()
    payment["created_at"] = payment["created_at"].isoformat()
    return payment

@api.get("/loans/{loan_id}/payments")
async def list_payments(loan_id: str, current_user: dict = Depends(get_current_user)):
    loan = await db.loans.find_one({"loan_id": loan_id}, {"_id": 0})
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    if loan["owner_user_id"] != current_user["user_id"] and loan.get("counterparty_user_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Not authorized")
    cur = db.payments.find({"loan_id": loan_id}, {"_id": 0}).sort("paid_at", -1)
    items = await cur.to_list(500)
    for p in items:
        for k in ("paid_at", "created_at"):
            v = p.get(k)
            if isinstance(v, datetime):
                p[k] = v.isoformat()
    return items

# ============ Acceptance flow ============
@api.post("/loans/{loan_id}/accept")
async def accept_loan(loan_id: str, current_user: dict = Depends(get_current_user)):
    loan = await db.loans.find_one({"loan_id": loan_id}, {"_id": 0})
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    if loan.get("counterparty_user_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Only the counterparty can accept")
    if loan.get("status") != "pending_acceptance":
        raise HTTPException(status_code=400, detail="Loan is not pending acceptance")
    await db.loans.update_one(
        {"loan_id": loan_id},
        {"$set": {"status": "active", "accepted_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}},
    )
    await send_push(loan["owner_user_id"], "Loan accepted", f"{current_user.get('name')} accepted your loan", {"loan_id": loan_id})
    updated = await db.loans.find_one({"loan_id": loan_id}, {"_id": 0})
    return serialize_loan(updated, total_paid=await sum_payments(loan_id))

@api.post("/loans/{loan_id}/reject")
async def reject_loan(loan_id: str, current_user: dict = Depends(get_current_user)):
    loan = await db.loans.find_one({"loan_id": loan_id}, {"_id": 0})
    if not loan:
        raise HTTPException(status_code=404, detail="Loan not found")
    if loan.get("counterparty_user_id") != current_user["user_id"]:
        raise HTTPException(status_code=403, detail="Only the counterparty can reject")
    if loan.get("status") != "pending_acceptance":
        raise HTTPException(status_code=400, detail="Loan is not pending acceptance")
    await db.loans.update_one(
        {"loan_id": loan_id},
        {"$set": {"status": "rejected", "rejected_at": datetime.now(timezone.utc), "updated_at": datetime.now(timezone.utc)}},
    )
    await send_push(loan["owner_user_id"], "Loan declined", f"{current_user.get('name')} declined the loan", {"loan_id": loan_id})
    updated = await db.loans.find_one({"loan_id": loan_id}, {"_id": 0})
    return serialize_loan(updated, total_paid=0.0)

# ============ Push token registration ============
@api.post("/users/me/push-token")
async def register_push_token(data: PushTokenIn, current_user: dict = Depends(get_current_user)):
    await db.users.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {"expo_push_token": data.expo_push_token, "push_token_updated_at": datetime.now(timezone.utc)}},
    )
    return {"ok": True}

# ============ Dashboard ============
@api.get("/dashboard/summary")
async def dashboard(current_user: dict = Depends(get_current_user)):
    cursor = db.loans.find(
        {"owner_user_id": current_user["user_id"]},
        {"_id": 0},
    )
    loans = await cursor.to_list(1000)
    total_lent = 0.0
    total_borrowed = 0.0
    total_outstanding = 0.0
    monthly_interest = 0.0
    active = 0
    overdue = 0
    settled = 0
    now = datetime.now(timezone.utc)
    for l in loans:
        total_paid_l = await sum_payments(l["loan_id"])
        m = calc_loan_metrics(l, total_paid=total_paid_l)
        principal = float(l.get("principal_amount", 0))
        st = l.get("status", "active")
        if l.get("direction") == "borrowed":
            total_borrowed += principal
        else:
            total_lent += principal
        if st == "active":
            active += 1
            total_outstanding += m["total_due"]
            monthly_interest += m["monthly_interest"]
            due_date_str = l.get("due_date")
            if due_date_str:
                try:
                    due = datetime.fromisoformat(due_date_str.replace("Z", "+00:00"))
                    if due.tzinfo is None:
                        due = due.replace(tzinfo=timezone.utc)
                    if now > due:
                        overdue += 1
                except Exception:
                    pass
        elif st == "settled":
            settled += 1
    return {
        "total_lent": round(total_lent, 2),
        "total_borrowed": round(total_borrowed, 2),
        "total_outstanding": round(total_outstanding, 2),
        "monthly_interest_expected": round(monthly_interest, 2),
        "active_loans": active,
        "overdue_loans": overdue,
        "settled_loans": settled,
        "total_loans": len(loans),
    }

# ============ Subscription (MOCKED) ============
PLANS = {
    "free": {"id": "free", "name": "Free", "price_inr": 0, "features": ["Up to 3 loans", "Private mode only", "Basic reminders"]},
    "private": {"id": "private", "name": "Private Pro", "price_inr": 10, "features": ["Unlimited private loans", "Local notifications", "Export to CSV", "Priority support"]},
    "public": {"id": "public", "name": "Public Pro", "price_inr": 90, "features": ["Everything in Private Pro", "Unlimited public loans", "Shared with counterparty", "Push notifications to both sides", "Cloud sync across devices"]},
}

@api.get("/subscription/plans")
async def plans():
    return list(PLANS.values())

@api.get("/subscription/status")
async def subscription_status(current_user: dict = Depends(get_current_user)):
    tier = current_user.get("subscription_tier", "free")
    expires_at = current_user.get("subscription_expires_at")
    is_active = False
    if expires_at:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        is_active = datetime.now(timezone.utc) < expires_at
    return {"tier": tier, "is_active": is_active or tier == "free", "expires_at": expires_at.isoformat() if expires_at else None}

@api.post("/subscription/subscribe")
async def subscribe(data: SubscribeIn, current_user: dict = Depends(get_current_user)):
    """MOCKED payment activation."""
    plan = PLANS.get(data.tier)
    if not plan:
        raise HTTPException(status_code=400, detail="Invalid tier")
    expires_at = datetime.now(timezone.utc) + timedelta(days=30)
    await db.users.update_one(
        {"user_id": current_user["user_id"]},
        {"$set": {"subscription_tier": data.tier, "subscription_expires_at": expires_at, "last_payment_method": data.payment_method}},
    )
    return {
        "ok": True,
        "mocked": True,
        "tier": data.tier,
        "amount_inr": plan["price_inr"],
        "expires_at": expires_at.isoformat(),
        "payment_method": data.payment_method,
        "message": "Subscription activated (MOCKED payment - integrate real provider in production)",
    }

# Mount
app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
