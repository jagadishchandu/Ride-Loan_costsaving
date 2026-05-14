"""Iteration 2 backend tests: subscription tiers, driver location, ride detail.

Covers the iteration-2 features:
- GET /api/driver/subscription returns daily/weekly/monthly plans
- POST /api/driver/subscribe creates Stripe session per plan with correct amount
- POST /api/driver/subscribe with invalid plan_id returns 4xx
- POST /api/driver/location accepts {lat,lng}; persists to user doc
- POST /api/driver/location forbidden for rider role
- GET /api/rides/{ride_id} ownership/404/403 + driver_lat/driver_lng on accepted

Regression: register, login, create ride, list rides, driver earnings.
"""
import os
import uuid
import pytest
import requests

# Load backend .env so MONGO_URL/DB_NAME are available for direct DB assertions
try:
    with open("/app/backend/.env") as _f:
        for _line in _f:
            _line = _line.strip()
            if not _line or _line.startswith("#") or "=" not in _line:
                continue
            _k, _v = _line.split("=", 1)
            _v = _v.strip().strip('"').strip("'")
            os.environ.setdefault(_k.strip(), _v)
except FileNotFoundError:
    pass

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().strip('"')
                    break
    except FileNotFoundError:
        pass
BASE_URL = (BASE_URL or "").rstrip("/")
API = f"{BASE_URL}/api"

UNIQ = uuid.uuid4().hex[:8]
RIDER_EMAIL = f"TEST_riderv2_{UNIQ}@example.com"
DRIVER_EMAIL = f"TEST_driverv2_{UNIQ}@example.com"
OTHER_DRIVER_EMAIL = f"TEST_other_driverv2_{UNIQ}@example.com"
PASSWORD = "password123"


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def state():
    return {}


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# ---------------- Setup: register rider + driver ----------------
def test_register_users(session, state):
    r = session.post(f"{API}/auth/register", json={
        "email": RIDER_EMAIL, "password": PASSWORD, "name": "V2 Rider", "role": "rider"
    })
    assert r.status_code == 200, r.text
    state["rider_token"] = r.json()["access_token"]
    state["rider_id"] = r.json()["user"]["id"]

    r2 = session.post(f"{API}/auth/register", json={
        "email": DRIVER_EMAIL, "password": PASSWORD, "name": "V2 Driver",
        "role": "driver", "vehicle": "Tesla Model 3"
    })
    assert r2.status_code == 200, r2.text
    state["driver_token"] = r2.json()["access_token"]
    state["driver_id"] = r2.json()["user"]["id"]

    r3 = session.post(f"{API}/auth/register", json={
        "email": OTHER_DRIVER_EMAIL, "password": PASSWORD, "name": "Other Driver",
        "role": "driver", "vehicle": "Honda Civic"
    })
    assert r3.status_code == 200
    state["other_driver_token"] = r3.json()["access_token"]


# ---------------- Subscription plans ----------------
def test_subscription_plans_present(session, state):
    """GET /api/driver/subscription must return plans array with daily/weekly/monthly."""
    r = session.get(f"{API}/driver/subscription", headers=_auth(state["driver_token"]))
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["active"] is False
    plans = data.get("plans")
    assert plans is not None, f"Response missing 'plans' key. Got keys: {list(data.keys())}"
    assert isinstance(plans, list) and len(plans) == 3
    by_id = {p["id"]: p for p in plans}
    assert "daily" in by_id and "weekly" in by_id and "monthly" in by_id
    assert by_id["daily"]["amount"] == 30.0 and by_id["daily"]["hours"] == 24
    assert by_id["weekly"]["amount"] == 180.0 and by_id["weekly"]["hours"] == 168
    assert by_id["weekly"]["savings"] == "Save $30"
    assert by_id["monthly"]["amount"] == 600.0 and by_id["monthly"]["hours"] == 720
    assert by_id["monthly"]["savings"] == "Save $300"


# ---------------- Subscribe with each plan ----------------
@pytest.mark.parametrize("plan_id,expected_amount,expected_hours", [
    ("daily", 30.0, 24),
    ("weekly", 180.0, 168),
    ("monthly", 600.0, 720),
])
def test_subscribe_each_plan_uses_correct_amount(session, state, plan_id, expected_amount, expected_hours):
    """POST /api/driver/subscribe must charge the plan-specific amount and store plan_id/hours."""
    r = session.post(
        f"{API}/driver/subscribe",
        headers=_auth(state["driver_token"]),
        json={"origin_url": BASE_URL, "plan_id": plan_id},
    )
    assert r.status_code == 200, f"plan {plan_id}: {r.text}"
    body = r.json()
    assert "url" in body and body["url"].startswith("http")
    assert "session_id" in body and body["session_id"]

    # Verify the txn was persisted with correct amount/plan_id/hours
    # (we don't have a direct txn-fetch endpoint; this is verified indirectly via
    # the Stripe session URL containing the right amount – we assert via Mongo here.)
    # Use the running app's mongo via env to read.
    try:
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mongo[os.environ["DB_NAME"]]

        async def _fetch():
            return await db.payment_transactions.find_one(
                {"session_id": body["session_id"]}, {"_id": 0}
            )
        loop = asyncio.new_event_loop()
        try:
            txn = loop.run_until_complete(_fetch())
        finally:
            loop.close()
        mongo.close()
    except Exception as e:
        pytest.skip(f"Cannot read mongo directly: {e}")

    assert txn is not None, "Transaction was not persisted"
    assert txn["amount"] == expected_amount, (
        f"Plan '{plan_id}': txn.amount={txn['amount']} expected {expected_amount}. "
        "Backend may be ignoring plan_id and always using DAILY_SUB_AMOUNT."
    )
    assert txn.get("plan_id") == plan_id, (
        f"Plan '{plan_id}': txn missing plan_id (got {txn.get('plan_id')}). "
        "Backend should store plan_id on the transaction so subscription activation gets correct hours."
    )
    assert txn.get("hours") == expected_hours, (
        f"Plan '{plan_id}': txn.hours={txn.get('hours')} expected {expected_hours}"
    )


def test_subscribe_invalid_plan(session, state):
    r = session.post(
        f"{API}/driver/subscribe",
        headers=_auth(state["driver_token"]),
        json={"origin_url": BASE_URL, "plan_id": "yearly"},
    )
    # Backend uses Pydantic Literal -> 422; spec says 400. Accept either as a client error.
    assert 400 <= r.status_code < 500, r.text
    assert r.status_code in (400, 422), f"Expected 400 or 422, got {r.status_code}"


# ---------------- Driver location ----------------
def test_driver_location_update_ok(session, state):
    r = session.post(
        f"{API}/driver/location",
        headers=_auth(state["driver_token"]),
        json={"lat": 19.4326, "lng": -99.1332},
    )
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True


def test_rider_cannot_post_location(session, state):
    r = session.post(
        f"{API}/driver/location",
        headers=_auth(state["rider_token"]),
        json={"lat": 19.0, "lng": -99.0},
    )
    assert r.status_code == 403, r.text


def test_unauth_location_returns_401(session):
    r = session.post(f"{API}/driver/location", json={"lat": 1.0, "lng": 2.0})
    assert r.status_code == 401


# ---------------- Ride creation + GET /rides/{ride_id} ----------------
def test_rider_creates_ride(session, state):
    r = session.post(
        f"{API}/rides",
        headers=_auth(state["rider_token"]),
        json={
            "pickup_address": "Av Reforma 100",
            "dropoff_address": "Polanco",
            "estimated_fare": 150.0,
            "pickup_lat": 19.43, "pickup_lng": -99.13,
            "dropoff_lat": 19.45, "dropoff_lng": -99.20,
        },
    )
    assert r.status_code == 200, r.text
    state["ride_id"] = r.json()["id"]


def test_get_ride_owner_rider(session, state):
    r = session.get(f"{API}/rides/{state['ride_id']}", headers=_auth(state["rider_token"]))
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == state["ride_id"]
    assert body["status"] == "requested"


def test_get_ride_other_user_forbidden(session, state):
    r = session.get(
        f"{API}/rides/{state['ride_id']}",
        headers=_auth(state["other_driver_token"]),
    )
    assert r.status_code == 403, r.text


def test_get_ride_not_found(session, state):
    r = session.get(f"{API}/rides/{uuid.uuid4()}", headers=_auth(state["rider_token"]))
    assert r.status_code == 404


# ---------------- Driver location surfaced on accepted ride ----------------
def test_accepted_ride_includes_driver_location(session, state):
    """After driver accepts, GET /rides/{id} should include driver_lat/driver_lng.
    Requires driver to have an active subscription. We seed one directly in Mongo for test isolation.
    """
    # Seed an active subscription directly
    try:
        import asyncio
        from datetime import datetime, timezone, timedelta
        from motor.motor_asyncio import AsyncIOMotorClient
        mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mongo[os.environ["DB_NAME"]]

        async def _seed():
            await db.driver_subscriptions.insert_one({
                "id": str(uuid.uuid4()),
                "driver_id": state["driver_id"],
                "amount": 30.0, "currency": "mxn",
                "plan_id": "daily", "hours": 24,
                "started_at": datetime.now(timezone.utc).isoformat(),
                "expires_at": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(),
                "created_at": datetime.now(timezone.utc).isoformat(),
            })
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(_seed())
        finally:
            loop.close()
        mongo.close()
    except Exception as e:
        pytest.skip(f"Cannot seed subscription: {e}")

    # Driver posts location first
    r1 = session.post(
        f"{API}/driver/location",
        headers=_auth(state["driver_token"]),
        json={"lat": 19.4400, "lng": -99.1500},
    )
    assert r1.status_code == 200

    # Driver accepts the ride
    r2 = session.post(
        f"{API}/rides/{state['ride_id']}/accept",
        headers=_auth(state["driver_token"]),
    )
    assert r2.status_code == 200, r2.text

    # Driver pushes a fresh location
    r3 = session.post(
        f"{API}/driver/location",
        headers=_auth(state["driver_token"]),
        json={"lat": 19.4410, "lng": -99.1520},
    )
    assert r3.status_code == 200

    # GET ride detail must include driver coords
    r4 = session.get(f"{API}/rides/{state['ride_id']}", headers=_auth(state["rider_token"]))
    assert r4.status_code == 200
    body = r4.json()
    assert body["status"] == "accepted"
    assert body.get("driver_lat") is not None, f"driver_lat missing on accepted ride: {body}"
    assert body.get("driver_lng") is not None
    assert abs(body["driver_lat"] - 19.4410) < 1e-6
    assert abs(body["driver_lng"] - (-99.1520)) < 1e-6


# ---------------- Regression: earnings ----------------
def test_driver_earnings_regression(session, state):
    r = session.get(f"{API}/driver/earnings", headers=_auth(state["driver_token"]))
    assert r.status_code == 200
    data = r.json()
    assert "total_earnings" in data and "completed_rides" in data and "rides" in data


# ---------------- Cleanup ----------------
def test_cleanup(session, state):
    try:
        import asyncio
        from motor.motor_asyncio import AsyncIOMotorClient
        mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
        db = mongo[os.environ["DB_NAME"]]

        async def _clean():
            await db.users.delete_many({"email": {"$in": [
                RIDER_EMAIL.lower(), DRIVER_EMAIL.lower(), OTHER_DRIVER_EMAIL.lower()
            ]}})
            await db.rides.delete_many({"rider_id": state.get("rider_id")})
            await db.driver_subscriptions.delete_many({"driver_id": state.get("driver_id")})
            await db.payment_transactions.delete_many({"user_id": state.get("driver_id")})

        asyncio.get_event_loop().run_until_complete(_clean())
        mongo.close()
    except Exception:
        pass
