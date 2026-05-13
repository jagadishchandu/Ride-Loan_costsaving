"""LendSplit backend test suite - covers health, auth, contacts, loans, dashboard, subscription."""
import os
import requests
import pytest
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL", "https://shared-lending.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"


def _auth(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ============ Health ============
class TestHealth:
    def test_root_ok(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200
        body = r.json()
        assert body.get("status") == "ok"
        assert body.get("app") == "LendSplit"


# ============ Auth (JWT) ============
class TestAuth:
    def test_signup_creates_user_and_returns_token(self, fresh_user):
        assert fresh_user["token"]
        assert fresh_user["user"]["email"] == fresh_user["email"]
        assert fresh_user["user"]["subscription_tier"] == "free"
        assert "user_id" in fresh_user["user"]

    def test_signup_duplicate_returns_409(self, fresh_user):
        r = requests.post(f"{API}/auth/signup", json={
            "email": fresh_user["email"], "password": "anyOther1!", "name": "Dup"
        })
        assert r.status_code == 409

    def test_login_success(self, fresh_user):
        r = requests.post(f"{API}/auth/login", json={
            "email": fresh_user["email"], "password": fresh_user["password"]
        })
        assert r.status_code == 200
        data = r.json()
        assert data["token_type"] == "bearer"
        assert data["user"]["email"] == fresh_user["email"]

    def test_login_wrong_password_returns_401(self, fresh_user):
        r = requests.post(f"{API}/auth/login", json={
            "email": fresh_user["email"], "password": "WrongPass!9"
        })
        assert r.status_code == 401

    def test_login_nonexistent_returns_401(self):
        r = requests.post(f"{API}/auth/login", json={
            "email": "nobody_xyz_unique999@example.com", "password": "anything"
        })
        assert r.status_code == 401

    def test_me_with_token(self, fresh_user):
        r = requests.get(f"{API}/auth/me", headers=_auth(fresh_user["token"]))
        assert r.status_code == 200
        assert r.json()["email"] == fresh_user["email"]
        # hashed_password must not leak
        assert "hashed_password" not in r.json()

    def test_me_without_token_returns_401(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_invalid_token_returns_401(self):
        r = requests.get(f"{API}/auth/me", headers={"Authorization": "Bearer invalid.token.value"})
        assert r.status_code == 401

    def test_logout_ok(self, fresh_user):
        r = requests.post(f"{API}/auth/logout", headers=_auth(fresh_user["token"]))
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_demo_user_login(self, demo_token):
        # demo_token fixture ensures the seeded user logs in
        r = requests.get(f"{API}/auth/me", headers=_auth(demo_token))
        assert r.status_code == 200
        assert r.json()["email"] == "demo@lendsplit.app"


# ============ Contacts ============
class TestContacts:
    def test_create_and_list_contact(self, fresh_user):
        payload = {"name": "TEST Friend A", "email": "friend_a@example.com", "phone": "+919999000001"}
        r = requests.post(f"{API}/contacts", json=payload, headers=_auth(fresh_user["token"]))
        assert r.status_code == 200, r.text
        contact = r.json()
        assert contact["name"] == payload["name"]
        assert contact["email"] == payload["email"]
        assert contact["owner_user_id"] == fresh_user["user"]["user_id"]

        # Verify GET list contains it
        r2 = requests.get(f"{API}/contacts", headers=_auth(fresh_user["token"]))
        assert r2.status_code == 200
        ids = [c["contact_id"] for c in r2.json()]
        assert contact["contact_id"] in ids

    def test_create_contact_missing_email_and_phone(self, fresh_user):
        r = requests.post(f"{API}/contacts", json={"name": "no-contact-info"}, headers=_auth(fresh_user["token"]))
        assert r.status_code == 400

    def test_search_user_by_email_found(self, fresh_user, second_user):
        r = requests.get(f"{API}/contacts/search", params={"q": second_user["email"]}, headers=_auth(fresh_user["token"]))
        assert r.status_code == 200
        body = r.json()
        assert body["found"] is True
        assert body["user"]["email"] == second_user["email"]

    def test_search_user_not_found(self, fresh_user):
        r = requests.get(f"{API}/contacts/search", params={"q": "ghost_xyz@nowhere.test"}, headers=_auth(fresh_user["token"]))
        assert r.status_code == 200
        assert r.json()["found"] is False


# ============ Loans (PUBLIC) ============
@pytest.fixture
def created_loan(fresh_user):
    start = (datetime.now(timezone.utc) - timedelta(days=70)).isoformat()  # ~2 months ago
    due = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    payload = {
        "mode": "public",
        "counterparty_name": "TEST Borrower",
        "counterparty_email": "tb@lendsplit.test",
        "direction": "lent",
        "principal_amount": 12000.0,
        "interest_rate": 12.0,
        "start_date": start,
        "due_date": due,
        "reminder_enabled": True,
        "reminder_day": 5,
        "notes": "Test loan"
    }
    r = requests.post(f"{API}/loans", json=payload, headers=_auth(fresh_user["token"]))
    assert r.status_code == 200, r.text
    return r.json()


class TestLoans:
    def test_private_mode_rejected(self, fresh_user):
        payload = {
            "mode": "private",
            "counterparty_name": "Local Only",
            "direction": "lent",
            "principal_amount": 1000.0,
            "interest_rate": 10.0,
            "start_date": datetime.now(timezone.utc).isoformat(),
        }
        r = requests.post(f"{API}/loans", json=payload, headers=_auth(fresh_user["token"]))
        assert r.status_code == 400

    def test_create_public_loan_metrics(self, created_loan):
        # principal=12000, rate=12 → monthly_interest = 12000*12/1200 = 120
        assert created_loan["monthly_interest"] == 120.0
        # ~2 months elapsed since start_date 70 days ago
        assert created_loan["months_elapsed"] >= 1
        # total_due = principal + accrued
        assert created_loan["total_due"] == round(12000.0 + created_loan["accrued_interest"], 2)
        assert created_loan["status"] == "active"
        assert created_loan["mode"] == "public"
        assert "_id" not in created_loan

    def test_list_loans_includes_created(self, fresh_user, created_loan):
        r = requests.get(f"{API}/loans", headers=_auth(fresh_user["token"]))
        assert r.status_code == 200
        ids = [l["loan_id"] for l in r.json()]
        assert created_loan["loan_id"] in ids

    def test_get_loan_by_id(self, fresh_user, created_loan):
        r = requests.get(f"{API}/loans/{created_loan['loan_id']}", headers=_auth(fresh_user["token"]))
        assert r.status_code == 200
        assert r.json()["loan_id"] == created_loan["loan_id"]

    def test_other_user_cannot_access_loan(self, second_user, created_loan):
        r = requests.get(f"{API}/loans/{created_loan['loan_id']}", headers=_auth(second_user["token"]))
        assert r.status_code == 403

    def test_other_user_cannot_update(self, second_user, created_loan):
        r = requests.patch(f"{API}/loans/{created_loan['loan_id']}",
                           json={"status": "settled"}, headers=_auth(second_user["token"]))
        assert r.status_code == 403

    def test_other_user_cannot_delete(self, second_user, created_loan):
        r = requests.delete(f"{API}/loans/{created_loan['loan_id']}", headers=_auth(second_user["token"]))
        assert r.status_code == 403

    def test_update_loan_status_settled(self, fresh_user, created_loan):
        r = requests.patch(f"{API}/loans/{created_loan['loan_id']}",
                           json={"status": "settled"}, headers=_auth(fresh_user["token"]))
        assert r.status_code == 200
        assert r.json()["status"] == "settled"
        # Verify persistence via GET
        r2 = requests.get(f"{API}/loans/{created_loan['loan_id']}", headers=_auth(fresh_user["token"]))
        assert r2.json()["status"] == "settled"

    def test_delete_loan(self, fresh_user):
        # Create a fresh one specifically to delete
        payload = {
            "mode": "public",
            "counterparty_name": "TEST DeleteMe",
            "direction": "lent",
            "principal_amount": 500.0,
            "interest_rate": 5.0,
            "start_date": datetime.now(timezone.utc).isoformat(),
        }
        r = requests.post(f"{API}/loans", json=payload, headers=_auth(fresh_user["token"]))
        assert r.status_code == 200
        lid = r.json()["loan_id"]
        rd = requests.delete(f"{API}/loans/{lid}", headers=_auth(fresh_user["token"]))
        assert rd.status_code == 200
        rg = requests.get(f"{API}/loans/{lid}", headers=_auth(fresh_user["token"]))
        assert rg.status_code == 404

    def test_loans_requires_auth(self):
        r = requests.get(f"{API}/loans")
        assert r.status_code == 401


# ============ Dashboard ============
class TestDashboard:
    def test_dashboard_summary(self, fresh_user):
        # Create two active loans for this fresh user
        for amt, rate in [(10000.0, 12.0), (5000.0, 24.0)]:
            requests.post(f"{API}/loans", json={
                "mode": "public",
                "counterparty_name": "TEST DB",
                "direction": "lent",
                "principal_amount": amt,
                "interest_rate": rate,
                "start_date": datetime.now(timezone.utc).isoformat(),
            }, headers=_auth(fresh_user["token"])).raise_for_status()

        r = requests.get(f"{API}/dashboard/summary", headers=_auth(fresh_user["token"]))
        assert r.status_code == 200
        d = r.json()
        for k in ["total_lent", "total_outstanding", "monthly_interest_expected", "active_loans", "overdue_loans"]:
            assert k in d
        assert d["total_lent"] >= 15000.0
        # monthly interest = 10000*12/1200 + 5000*24/1200 = 100 + 100 = 200
        assert d["monthly_interest_expected"] >= 200.0
        assert d["active_loans"] >= 2


# ============ Subscription ============
class TestSubscription:
    def test_plans_returns_three(self):
        r = requests.get(f"{API}/subscription/plans")
        assert r.status_code == 200
        plans = r.json()
        ids = sorted(p["id"] for p in plans)
        assert ids == ["free", "private", "public"]
        prices = {p["id"]: p["price_inr"] for p in plans}
        assert prices["private"] == 10
        assert prices["public"] == 90
        assert prices["free"] == 0

    def test_subscribe_private_phonepe(self, fresh_user):
        r = requests.post(f"{API}/subscription/subscribe",
                          json={"tier": "private", "payment_method": "phonepe"},
                          headers=_auth(fresh_user["token"]))
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["ok"] is True
        assert body["mocked"] is True
        assert body["tier"] == "private"
        assert body["amount_inr"] == 10

        # Status should reflect new tier
        rs = requests.get(f"{API}/subscription/status", headers=_auth(fresh_user["token"]))
        assert rs.status_code == 200
        assert rs.json()["tier"] == "private"
        assert rs.json()["is_active"] is True

    def test_subscribe_public_google_play(self, second_user):
        r = requests.post(f"{API}/subscription/subscribe",
                          json={"tier": "public", "payment_method": "google_play"},
                          headers=_auth(second_user["token"]))
        assert r.status_code == 200
        assert r.json()["tier"] == "public"
        assert r.json()["amount_inr"] == 90

    def test_subscription_status_requires_auth(self):
        r = requests.get(f"{API}/subscription/status")
        assert r.status_code == 401
