"""Shared pytest fixtures for LendSplit backend tests."""
import os
import uuid
import pytest
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / "frontend" / ".env")

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://shared-lending.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def api_url():
    return API


@pytest.fixture
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def demo_token():
    """Login as the seed demo user. Re-signup if missing."""
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "demo@lendsplit.app", "password": "demo1234"})
    if r.status_code == 401:
        s.post(f"{API}/auth/signup", json={"email": "demo@lendsplit.app", "password": "demo1234", "name": "Demo User"})
        r = s.post(f"{API}/auth/login", json={"email": "demo@lendsplit.app", "password": "demo1234"})
    assert r.status_code == 200, f"Demo login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def fresh_user():
    """Create a fresh user for isolated tests; returns (email, password, token, user)."""
    email = f"test_user_{uuid.uuid4().hex[:8]}@example.com"
    password = "Testpass!123"
    r = requests.post(f"{API}/auth/signup", json={"email": email, "password": password, "name": "Test User"})
    assert r.status_code == 200, f"Signup failed: {r.text}"
    data = r.json()
    return {"email": email, "password": password, "token": data["access_token"], "user": data["user"]}


@pytest.fixture(scope="session")
def second_user():
    """Create a second user for cross-user authorization tests."""
    email = f"test_other_{uuid.uuid4().hex[:8]}@example.com"
    password = "Testpass!123"
    r = requests.post(f"{API}/auth/signup", json={"email": email, "password": password, "name": "Other User"})
    assert r.status_code == 200
    data = r.json()
    return {"email": email, "password": password, "token": data["access_token"], "user": data["user"]}
