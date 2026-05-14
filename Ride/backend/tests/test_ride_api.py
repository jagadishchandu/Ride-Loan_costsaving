"""End-to-end backend API tests for the Ride app (rider/driver/subscription/Stripe)."""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
# Fall back to reading frontend/.env when running locally
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
RIDER_EMAIL = f"TEST_rider_{UNIQ}@example.com"
DRIVER_EMAIL = f"TEST_driver_{UNIQ}@example.com"
PASSWORD = "password123"


@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def state():
    return {}


# ------------- Health -------------
def test_health_root(session):
    r = session.get(f"{API}/")
    assert r.status_code == 200
    assert "Ride API" in r.json().get("message", "")


# ------------- Auth -------------
def test_register_rider(session, state):
    r = session.post(f"{API}/auth/register", json={
        "email": RIDER_EMAIL, "password": PASSWORD, "name": "Test Rider", "role": "rider"
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert "access_token" in data and data["access_token"]
    assert data["user"]["email"] == RIDER_EMAIL.lower()
    assert data["user"]["role"] == "rider"
    assert "password_hash" not in data["user"]
    state["rider_token"] = data["access_token"]
    state["rider_id"] = data["user"]["id"]


def test_register_driver(session, state):
    r = session.post(f"{API}/auth/register", json={
        "email": DRIVER_EMAIL, "password": PASSWORD, "name": "Test Driver",
        "role": "driver", "vehicle": "Toyota Corolla 2020 - TEST-123"
    })
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["user"]["role"] == "driver"
    assert data["user"]["vehicle"] == "Toyota Corolla 2020 - TEST-123"
    state["driver_token"] = data["access_token"]
    state["driver_id"] = data["user"]["id"]


def test_register_duplicate_email(session):
    r = session.post(f"{API}/auth/register", json={
        "email": RIDER_EMAIL, "password": PASSWORD, "name": "Dup", "role": "rider"
    })
    assert r.status_code == 400


def test_login_success(session, state):
    r = session.post(f"{API}/auth/login", json={"email": RIDER_EMAIL, "password": PASSWORD})
    assert r.status_code == 200
    assert r.json()["user"]["email"] == RIDER_EMAIL.lower()


def test_login_bad_password(session):
    r = session.post(f"{API}/auth/login", json={"email": RIDER_EMAIL, "password": "wrong"})
    assert r.status_code == 401


def test_me_with_token(session, state):
    r = session.get(f"{API}/auth/me",
                    headers={"Authorization": f"Bearer {state['rider_token']}"})
    assert r.status_code == 200
    assert r.json()["email"] == RIDER_EMAIL.lower()


def test_me_without_token(session):
    r = requests.get(f"{API}/auth/me")  # bare request, no auth
    assert r.status_code == 401


# ------------- Rides -------------
def test_create_ride(session, state):
    r = session.post(f"{API}/rides",
                     headers={"Authorization": f"Bearer {state['rider_token']}"},
                     json={
                         "pickup_address": "Av. Reforma 100",
                         "dropoff_address": "Polanco 200",
                         "estimated_fare": 75.5,
                     })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "requested"
    assert body["rider_id"] == state["rider_id"]
    assert body["rider_name"] == "Test Rider"
    assert body["driver_id"] is None
    state["ride_id"] = body["id"]


def test_rider_my_rides(session, state):
    r = session.get(f"{API}/rides/my",
                    headers={"Authorization": f"Bearer {state['rider_token']}"})
    assert r.status_code == 200
    rides = r.json()
    assert any(rd["id"] == state["ride_id"] for rd in rides)


def test_driver_my_rides_empty(session, state):
    r = session.get(f"{API}/rides/my",
                    headers={"Authorization": f"Bearer {state['driver_token']}"})
    assert r.status_code == 200
    assert isinstance(r.json(), list)


# ------------- Subscription gating -------------
def test_available_rides_blocked_without_sub(session, state):
    r = session.get(f"{API}/rides/available",
                    headers={"Authorization": f"Bearer {state['driver_token']}"})
    assert r.status_code == 403


def test_accept_ride_blocked_without_sub(session, state):
    r = session.post(f"{API}/rides/{state['ride_id']}/accept",
                     headers={"Authorization": f"Bearer {state['driver_token']}"})
    assert r.status_code == 403


def test_subscription_status_inactive(session, state):
    r = session.get(f"{API}/driver/subscription",
                    headers={"Authorization": f"Bearer {state['driver_token']}"})
    assert r.status_code == 200
    body = r.json()
    assert body["active"] is False
    assert body["amount"] == 30.0
    assert body["currency"] == "mxn"


def test_subscription_status_requires_driver_role(session, state):
    r = session.get(f"{API}/driver/subscription",
                    headers={"Authorization": f"Bearer {state['rider_token']}"})
    assert r.status_code == 403


def test_driver_earnings_empty(session, state):
    r = session.get(f"{API}/driver/earnings",
                    headers={"Authorization": f"Bearer {state['driver_token']}"})
    assert r.status_code == 200
    body = r.json()
    assert body["total_earnings"] == 0
    assert body["completed_rides"] == 0
    assert body["rides"] == []


# ------------- Stripe checkout -------------
def test_create_subscription_checkout(session, state):
    r = session.post(f"{API}/driver/subscribe",
                     headers={"Authorization": f"Bearer {state['driver_token']}"},
                     json={"origin_url": BASE_URL})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["url"].startswith("https://")
    assert body["session_id"]
    state["session_id"] = body["session_id"]


def test_checkout_status_poll(session, state):
    sid = state.get("session_id")
    if not sid:
        pytest.skip("No session_id from previous step")
    # poll with rider token (different user) should fail
    r_unauth = session.get(f"{API}/payments/checkout/status/{sid}",
                           headers={"Authorization": f"Bearer {state['rider_token']}"})
    assert r_unauth.status_code == 404

    r = session.get(f"{API}/payments/checkout/status/{sid}",
                    headers={"Authorization": f"Bearer {state['driver_token']}"})
    assert r.status_code == 200, r.text
    body = r.json()
    # Status should be one of these (we cannot actually pay)
    assert body.get("payment_status") in ("unpaid", "paid", "no_payment_required", None)
    assert body.get("status") in ("open", "complete", "expired", None) or "payment_status" in body


def test_webhook_endpoint_responsive(session):
    # Webhook will fail signature verification but should still return 200
    r = session.post(f"{API}/webhook/stripe", data=b"{}",
                     headers={"Stripe-Signature": "t=0,v1=invalid"})
    assert r.status_code == 200
    assert r.json().get("received") is True


# ------------- Cleanup -------------
def test_zz_cleanup(state):
    """Cleanup test artifacts directly from MongoDB."""
    try:
        from pymongo import MongoClient
        mongo_url = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
        db_name = os.environ.get("DB_NAME", "ride_db")
        c = MongoClient(mongo_url)[db_name]
        c.users.delete_many({"email": {"$in": [RIDER_EMAIL.lower(), DRIVER_EMAIL.lower()]}})
        if state.get("rider_id"):
            c.rides.delete_many({"rider_id": state["rider_id"]})
        if state.get("driver_id"):
            c.driver_subscriptions.delete_many({"driver_id": state["driver_id"]})
            c.payment_transactions.delete_many({"user_id": state["driver_id"]})
    except Exception as e:
        print(f"Cleanup warning: {e}")
