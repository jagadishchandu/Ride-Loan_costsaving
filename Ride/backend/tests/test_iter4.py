"""Iteration 4 backend tests: ride payment, push tokens, ratings, websocket, earnings."""
import os
import json
import uuid
import asyncio
import pytest
import requests
import websockets
from datetime import datetime, timezone, timedelta

# Bootstrap env from /app/backend/.env so MONGO_URL/DB_NAME are available
try:
    with open("/app/backend/.env") as _f:
        for _line in _f:
            _line = _line.strip()
            if not _line or _line.startswith("#") or "=" not in _line:
                continue
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip().strip('"').strip("'"))
except FileNotFoundError:
    pass

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().strip('"').rstrip("/")
                break
API = f"{BASE_URL}/api"
WS_URL = BASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/api/ws/rides"

UNIQ = uuid.uuid4().hex[:8]
RIDER_EMAIL = f"TEST_rider_v4_{UNIQ}@example.com"
DRIVER_EMAIL = f"TEST_driver_v4_{UNIQ}@example.com"
OTHER_DRIVER_EMAIL = f"TEST_other_v4_{UNIQ}@example.com"
PASSWORD = "password123"


def _auth(t): return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def state():
    return {}


# ---------- Setup users + seed driver subscription via Mongo ----------
def test_register_users(session, state):
    r = session.post(f"{API}/auth/register", json={
        "email": RIDER_EMAIL, "password": PASSWORD, "name": "V4 Rider", "role": "rider"})
    assert r.status_code == 200, r.text
    state["rider_token"] = r.json()["access_token"]
    state["rider_id"] = r.json()["user"]["id"]

    r2 = session.post(f"{API}/auth/register", json={
        "email": DRIVER_EMAIL, "password": PASSWORD, "name": "V4 Driver",
        "role": "driver", "vehicle": "Tesla"})
    assert r2.status_code == 200
    state["driver_token"] = r2.json()["access_token"]
    state["driver_id"] = r2.json()["user"]["id"]

    r3 = session.post(f"{API}/auth/register", json={
        "email": OTHER_DRIVER_EMAIL, "password": PASSWORD, "name": "Other",
        "role": "driver", "vehicle": "Civic"})
    assert r3.status_code == 200
    state["other_driver_token"] = r3.json()["access_token"]
    state["other_driver_id"] = r3.json()["user"]["id"]


def test_seed_driver_subscription(state):
    """Seed an active subscription via Mongo so driver can accept rides."""
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[os.environ["DB_NAME"]]
    async def _seed():
        await db.driver_subscriptions.insert_one({
            "id": str(uuid.uuid4()),
            "driver_id": state["driver_id"],
            "amount": 30.0, "currency": "mxn", "plan_id": "daily", "hours": 24,
            "started_at": datetime.now(timezone.utc).isoformat(),
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat(),
            "created_at": datetime.now(timezone.utc).isoformat(),
        })
    loop = asyncio.new_event_loop()
    try: loop.run_until_complete(_seed())
    finally: loop.close()
    mongo.close()


# ---------- Push token registration ----------
def test_push_register_save(session, state):
    tok = f"ExponentPushToken[TEST_{UNIQ}]"
    state["push_token"] = tok
    r = session.post(f"{API}/push/register",
                     headers=_auth(state["rider_token"]),
                     json={"token": tok, "platform": "ios"})
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True}

    # Verify in DB
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[os.environ["DB_NAME"]]
    async def _q():
        return await db.push_tokens.find_one({"token": tok})
    loop = asyncio.new_event_loop()
    try: doc = loop.run_until_complete(_q())
    finally: loop.close()
    mongo.close()
    assert doc is not None
    assert doc["user_id"] == state["rider_id"]


def test_push_register_delete(session, state):
    r = session.delete(f"{API}/push/register",
                       headers=_auth(state["rider_token"]),
                       params={"token": state["push_token"]})
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_push_register_unauth(session):
    r = session.post(f"{API}/push/register", json={"token": "x"})
    assert r.status_code == 401


# ---------- Ride payment ----------
def test_create_ride_for_payment(session, state):
    r = session.post(f"{API}/rides", headers=_auth(state["rider_token"]), json={
        "pickup_address": "A", "dropoff_address": "B", "estimated_fare": 150.0})
    assert r.status_code == 200
    state["ride_id"] = r.json()["id"]


def test_pay_400_when_not_completed(session, state):
    r = session.post(f"{API}/rides/{state['ride_id']}/pay",
                     headers=_auth(state["rider_token"]),
                     json={"origin_url": BASE_URL})
    assert r.status_code == 400
    assert "completed" in r.json().get("detail", "").lower()


def test_pay_404_when_not_owner(session, state):
    # Register another rider
    other_email = f"TEST_otherrider_v4_{UNIQ}@example.com"
    rr = session.post(f"{API}/auth/register", json={
        "email": other_email, "password": PASSWORD, "name": "Other R", "role": "rider"})
    assert rr.status_code == 200
    other_tok = rr.json()["access_token"]
    state["other_rider_id"] = rr.json()["user"]["id"]
    state["other_rider_email"] = other_email

    r = session.post(f"{API}/rides/{state['ride_id']}/pay",
                     headers=_auth(other_tok), json={"origin_url": BASE_URL})
    assert r.status_code == 404


def test_pay_403_for_driver(session, state):
    r = session.post(f"{API}/rides/{state['ride_id']}/pay",
                     headers=_auth(state["driver_token"]),
                     json={"origin_url": BASE_URL})
    assert r.status_code == 403


def test_accept_complete_then_pay_ok(session, state):
    a = session.post(f"{API}/rides/{state['ride_id']}/accept",
                     headers=_auth(state["driver_token"]))
    assert a.status_code == 200, a.text

    c = session.post(f"{API}/rides/{state['ride_id']}/complete",
                     headers=_auth(state["driver_token"]))
    assert c.status_code == 200, c.text

    r = session.post(f"{API}/rides/{state['ride_id']}/pay",
                     headers=_auth(state["rider_token"]),
                     json={"origin_url": BASE_URL})
    assert r.status_code == 200, r.text
    body = r.json()
    assert "url" in body and body["url"].startswith("http")
    assert "session_id" in body
    assert body["amount"] == 150.0
    state["pay_session_id"] = body["session_id"]

    # Verify txn persisted
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[os.environ["DB_NAME"]]
    async def _q():
        return await db.payment_transactions.find_one({"session_id": body["session_id"]})
    loop = asyncio.new_event_loop()
    try: txn = loop.run_until_complete(_q())
    finally: loop.close()
    mongo.close()
    assert txn is not None
    assert txn["purpose"] == "ride_payment"
    assert txn["ride_id"] == state["ride_id"]
    assert txn["driver_id"] == state["driver_id"]
    assert txn["amount"] == 150.0


def test_pay_400_when_already_paid(session, state):
    """Mark ride paid via Mongo and re-attempt pay."""
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[os.environ["DB_NAME"]]
    async def _mark():
        await db.rides.update_one({"id": state["ride_id"]}, {"$set": {"paid": True}})
    loop = asyncio.new_event_loop()
    try: loop.run_until_complete(_mark())
    finally: loop.close()
    mongo.close()
    r = session.post(f"{API}/rides/{state['ride_id']}/pay",
                     headers=_auth(state["rider_token"]),
                     json={"origin_url": BASE_URL})
    assert r.status_code == 400
    assert "paid" in r.json().get("detail", "").lower()


# ---------- Ratings ----------
def test_rate_400_when_not_completed(session, state):
    r0 = session.post(f"{API}/rides", headers=_auth(state["rider_token"]), json={
        "pickup_address": "X", "dropoff_address": "Y", "estimated_fare": 50.0})
    rid = r0.json()["id"]
    state["unfinished_ride_id"] = rid
    r = session.post(f"{API}/rides/{rid}/rate",
                     headers=_auth(state["rider_token"]),
                     json={"score": 5})
    assert r.status_code == 400


def test_rate_422_on_invalid_score(session, state):
    r = session.post(f"{API}/rides/{state['ride_id']}/rate",
                     headers=_auth(state["rider_token"]),
                     json={"score": 6})
    assert r.status_code == 422
    r2 = session.post(f"{API}/rides/{state['ride_id']}/rate",
                     headers=_auth(state["rider_token"]),
                     json={"score": 0})
    assert r2.status_code == 422


def test_rate_403_when_not_your_ride(session, state):
    r = session.post(f"{API}/rides/{state['ride_id']}/rate",
                     headers=_auth(state["other_driver_token"]),
                     json={"score": 5})
    assert r.status_code == 403


def test_rider_rates_driver(session, state):
    r = session.post(f"{API}/rides/{state['ride_id']}/rate",
                     headers=_auth(state["rider_token"]),
                     json={"score": 5, "comment": "Great ride"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["rating"]["score"] == 5

    # Verify ride.rider_rating set + driver rating_avg updated
    g = session.get(f"{API}/rides/{state['ride_id']}", headers=_auth(state["rider_token"]))
    assert g.json()["rider_rating"] == 5

    me = session.get(f"{API}/auth/me", headers=_auth(state["driver_token"]))
    drv = me.json()
    assert drv["rating_count"] >= 1
    assert drv["rating_avg"] == 5.0


def test_rate_400_when_already_rated(session, state):
    r = session.post(f"{API}/rides/{state['ride_id']}/rate",
                     headers=_auth(state["rider_token"]),
                     json={"score": 4})
    assert r.status_code == 400


def test_driver_rates_rider(session, state):
    r = session.post(f"{API}/rides/{state['ride_id']}/rate",
                     headers=_auth(state["driver_token"]),
                     json={"score": 4, "comment": "Polite"})
    assert r.status_code == 200, r.text

    g = session.get(f"{API}/rides/{state['ride_id']}", headers=_auth(state["driver_token"]))
    assert g.json()["driver_rating"] == 4

    me = session.get(f"{API}/auth/me", headers=_auth(state["rider_token"]))
    assert me.json()["rating_count"] >= 1
    assert me.json()["rating_avg"] == 4.0


# ---------- Driver earnings ----------
def test_driver_earnings(session, state):
    r = session.get(f"{API}/driver/earnings", headers=_auth(state["driver_token"]))
    assert r.status_code == 200
    d = r.json()
    for k in ["total_earnings", "paid_earnings", "pending_earnings", "completed_rides", "rides"]:
        assert k in d
    assert d["completed_rides"] >= 1
    # We marked the ride paid in test_pay_400_when_already_paid
    assert d["paid_earnings"] >= 150.0
    # paid_earnings should only count paid:true rides
    paid_sum = sum(rd["estimated_fare"] for rd in d["rides"] if rd.get("paid"))
    assert abs(d["paid_earnings"] - round(paid_sum, 2)) < 1e-6


# ---------- WebSocket ----------
def test_ws_invalid_token_closes_4401():
    async def _run():
        try:
            async with websockets.connect(f"{WS_URL}?token=invalid.jwt.token") as ws:
                await ws.recv()
        except websockets.exceptions.ConnectionClosed as e:
            return e.code
        except Exception as e:
            return f"err:{e}"
        return None
    loop = asyncio.new_event_loop()
    try: code = loop.run_until_complete(_run())
    finally: loop.close()
    assert code == 4401, f"Expected close 4401, got {code}"


def test_ws_valid_token_receives_ride_created(session, state):
    async def _run():
        url = f"{WS_URL}?token={state['rider_token']}"
        async with websockets.connect(url, open_timeout=10) as ws:
            await asyncio.sleep(0.5)
            # Trigger ride creation in a thread
            def _create():
                return session.post(f"{API}/rides",
                                    headers=_auth(state["rider_token"]),
                                    json={"pickup_address": "WSPickup",
                                          "dropoff_address": "WSDrop",
                                          "estimated_fare": 99.0})
            loop2 = asyncio.get_event_loop()
            r = await loop2.run_in_executor(None, _create)
            assert r.status_code == 200
            state["ws_ride_id"] = r.json()["id"]

            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=5)
            except asyncio.TimeoutError:
                return None
            return json.loads(msg)
    loop = asyncio.new_event_loop()
    try: data = loop.run_until_complete(_run())
    finally: loop.close()
    assert data is not None, "No WS message received within 5s"
    assert data["event"] == "ride.created"
    assert data["payload"]["id"] == state["ws_ride_id"]


def test_ws_ride_accepted_broadcast_to_rider_and_driver(session, state):
    """Rider+driver both connect; rider creates ride; driver accepts; both should receive ride.accepted."""
    async def _run():
        rider_url = f"{WS_URL}?token={state['rider_token']}"
        driver_url = f"{WS_URL}?token={state['driver_token']}"
        async with websockets.connect(rider_url, open_timeout=10) as rws, \
                   websockets.connect(driver_url, open_timeout=10) as dws:
            await asyncio.sleep(0.5)

            # Rider creates a new ride (rider should see ride.created; we drain it)
            def _create():
                return session.post(f"{API}/rides",
                                    headers=_auth(state["rider_token"]),
                                    json={"pickup_address": "Apickup",
                                          "dropoff_address": "Bdrop",
                                          "estimated_fare": 80.0})
            loop2 = asyncio.get_event_loop()
            cr = await loop2.run_in_executor(None, _create)
            assert cr.status_code == 200
            new_ride_id = cr.json()["id"]

            # Drain ride.created on rider socket (driver should NOT see it)
            try:
                created_msg = json.loads(await asyncio.wait_for(rws.recv(), timeout=5))
                assert created_msg["event"] == "ride.created"
            except asyncio.TimeoutError:
                return ("no_created", None, None)

            # Driver accepts
            def _accept():
                return session.post(f"{API}/rides/{new_ride_id}/accept",
                                    headers=_auth(state["driver_token"]))
            ar = await loop2.run_in_executor(None, _accept)
            assert ar.status_code == 200, ar.text

            # Both rider and driver should receive ride.accepted
            try:
                rider_msg = json.loads(await asyncio.wait_for(rws.recv(), timeout=5))
                driver_msg = json.loads(await asyncio.wait_for(dws.recv(), timeout=5))
            except asyncio.TimeoutError:
                return ("timeout", None, None)
            return (new_ride_id, rider_msg, driver_msg)

    loop = asyncio.new_event_loop()
    try: result = loop.run_until_complete(_run())
    finally: loop.close()
    new_ride_id, rmsg, dmsg = result
    assert rmsg is not None and dmsg is not None, f"WS messages missing: {result}"
    assert rmsg["event"] == "ride.accepted", f"rider got {rmsg}"
    assert dmsg["event"] == "ride.accepted", f"driver got {dmsg}"
    assert rmsg["payload"]["id"] == new_ride_id
    assert dmsg["payload"]["id"] == new_ride_id
    assert dmsg["payload"]["status"] == "accepted"
    state["accepted_ride_id"] = new_ride_id


# ---------- Welcome regression smoke (root + /api root) ----------
def test_api_root(session):
    r = session.get(f"{API}/")
    assert r.status_code == 200
    assert "Ride API" in r.json().get("message", "")


# ---------- Cleanup ----------
def test_cleanup(state):
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[os.environ["DB_NAME"]]
    async def _clean():
        emails = [RIDER_EMAIL.lower(), DRIVER_EMAIL.lower(), OTHER_DRIVER_EMAIL.lower()]
        if state.get("other_rider_email"):
            emails.append(state["other_rider_email"].lower())
        await db.users.delete_many({"email": {"$in": emails}})
        ids = [i for i in [state.get("rider_id"), state.get("driver_id"),
                           state.get("other_driver_id"), state.get("other_rider_id")] if i]
        await db.rides.delete_many({"$or": [{"rider_id": {"$in": ids}},
                                            {"driver_id": {"$in": ids}}]})
        await db.driver_subscriptions.delete_many({"driver_id": {"$in": ids}})
        await db.payment_transactions.delete_many({"user_id": {"$in": ids}})
        await db.ratings.delete_many({"$or": [{"user_id": {"$in": ids}},
                                              {"by_user_id": {"$in": ids}}]})
        await db.push_tokens.delete_many({"user_id": {"$in": ids}})
        await db.driver_payouts.delete_many({"driver_id": {"$in": ids}})
    loop = asyncio.new_event_loop()
    try: loop.run_until_complete(_clean())
    finally: loop.close()
    mongo.close()
