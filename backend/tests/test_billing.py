"""Tests for IAP billing endpoints (Scribe Producer Coverage gate).

Covers:
- GET /api/billing/entitlements (auth required, returns correct shape)
- POST /api/billing/iap/verify (auth required, idempotent, grants entitlement)
- 401 enforcement on all billing endpoints
- Full paywall flow: free use -> 402 -> seeded credit -> 200 -> 402
"""
import uuid
import pytest
from datetime import datetime, timezone, timedelta


# ── Entitlements ─────────────────────────────────────────────────────────────

class TestBillingEntitlements:
    def test_entitlements_requires_auth(self, base_url, anon_client):
        r = anon_client.get(f"{base_url}/api/billing/entitlements")
        assert r.status_code == 401

    def test_entitlements_shape_fresh_user(self, base_url, api_client, mongo_db, synthetic_user):
        # Ensure clean state
        mongo_db.users.update_one(
            {"user_id": synthetic_user["user_id"]},
            {"$unset": {"free_coverage_used": "", "coverage_credits": "", "pro_until": ""}},
        )
        r = api_client.get(f"{base_url}/api/billing/entitlements")
        assert r.status_code == 200, r.text
        ent = r.json()["entitlement"]
        assert ent["free_used"] is False
        assert ent["credits"] == 0
        assert ent["is_pro"] is False
        assert ent["pro_until"] in (None, "")


# ── IAP Verify ───────────────────────────────────────────────────────────────

class TestIAPVerify:
    def test_verify_requires_auth(self, base_url, anon_client):
        r = anon_client.post(f"{base_url}/api/billing/iap/verify", json={
            "platform": "android",
            "product_id": "scribe_coverage_single",
            "purchase_token": "fake_token_xyz",
        })
        assert r.status_code == 401

    def test_verify_invalid_platform_returns_400(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/billing/iap/verify", json={
            "platform": "windows",
            "product_id": "scribe_coverage_single",
            "purchase_token": "fake_token",
        })
        assert r.status_code == 400

    def test_verify_unknown_product_returns_400(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/billing/iap/verify", json={
            "platform": "android",
            "product_id": "not_a_real_product",
            "purchase_token": "fake_token",
        })
        assert r.status_code == 400

    def test_verify_missing_token_returns_400(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/billing/iap/verify", json={
            "platform": "android",
            "product_id": "scribe_coverage_single",
            # purchase_token intentionally omitted
        })
        assert r.status_code == 400

    def test_verify_grants_credit_in_dev_mode(self, base_url, api_client, mongo_db, synthetic_user):
        """
        In dev mode (GOOGLE_SERVICE_ACCOUNT_JSON not set), verify bypasses store
        check and grants the entitlement. This lets CI run without store credentials.
        """
        # Unique token to avoid idempotency collision with other tests
        token = f"dev_test_token_{uuid.uuid4().hex}"
        before = mongo_db.users.find_one({"user_id": synthetic_user["user_id"]})
        credits_before = before.get("coverage_credits", 0)

        r = api_client.post(f"{base_url}/api/billing/iap/verify", json={
            "platform": "android",
            "product_id": "scribe_coverage_single",
            "purchase_token": token,
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["ok"] is True
        assert data["fulfilled"] is True

        after = mongo_db.users.find_one({"user_id": synthetic_user["user_id"]})
        assert after.get("coverage_credits", 0) == credits_before + 1

    def test_verify_is_idempotent(self, base_url, api_client, mongo_db, synthetic_user):
        """Same purchase token twice should succeed but only grant once."""
        token = f"idempotent_test_{uuid.uuid4().hex}"
        before = mongo_db.users.find_one({"user_id": synthetic_user["user_id"]})
        credits_before = before.get("coverage_credits", 0)

        # First call — should fulfill
        r1 = api_client.post(f"{base_url}/api/billing/iap/verify", json={
            "platform": "android",
            "product_id": "scribe_coverage_single",
            "purchase_token": token,
        })
        assert r1.status_code == 200
        assert r1.json()["fulfilled"] is True

        # Second call — same token, should be idempotent (not double-grant)
        r2 = api_client.post(f"{base_url}/api/billing/iap/verify", json={
            "platform": "android",
            "product_id": "scribe_coverage_single",
            "purchase_token": token,
        })
        assert r2.status_code == 200
        assert r2.json()["fulfilled"] is False
        assert r2.json()["reason"] == "already_processed"

        after = mongo_db.users.find_one({"user_id": synthetic_user["user_id"]})
        assert after.get("coverage_credits", 0) == credits_before + 1  # only +1 total

    def test_verify_pro_extends_from_now(self, base_url, api_client, mongo_db, synthetic_user):
        """Pro purchase should set pro_until ~30 days from now."""
        token = f"pro_test_{uuid.uuid4().hex}"
        r = api_client.post(f"{base_url}/api/billing/iap/verify", json={
            "platform": "android",
            "product_id": "scribe_pro_monthly",
            "purchase_token": token,
        })
        assert r.status_code == 200, r.text
        assert r.json()["fulfilled"] is True

        u = mongo_db.users.find_one({"user_id": synthetic_user["user_id"]})
        pro_until = u.get("pro_until")
        assert pro_until is not None
        # Should be roughly 30 days from now (within 1 hour margin)
        now = datetime.now(timezone.utc)
        if pro_until.tzinfo is None:
            pro_until = pro_until.replace(tzinfo=timezone.utc)
        delta = (pro_until - now).total_seconds()
        assert 29 * 86400 < delta < 31 * 86400, f"Unexpected pro_until delta: {delta}s"


# ── Paywall flow (free -> 402 -> credit -> 200 -> 402) ───────────────────────

@pytest.fixture
def paywall_user(mongo_db):
    """Dedicated user to exercise the paywall flow with deterministic state."""
    user_id = f"user_pw_{uuid.uuid4().hex[:8]}"
    token = f"test_token_pw_{uuid.uuid4().hex[:10]}"
    email = f"TEST_pw_{uuid.uuid4().hex[:6]}@example.com"
    now = datetime.now(timezone.utc)
    mongo_db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": "Paywall Test",
        "picture": "",
        "created_at": now,
        "free_coverage_used": False,
        "coverage_credits": 0,
    })
    mongo_db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "expires_at": now + timedelta(days=7),
        "created_at": now,
    })
    yield {"user_id": user_id, "token": token, "email": email}
    # cleanup
    mongo_db.user_sessions.delete_many({"user_id": user_id})
    mongo_db.users.delete_one({"user_id": user_id})
    mongo_db.projects.delete_many({"user_id": user_id})
    mongo_db.iap_purchases.delete_many({"user_id": user_id})


class TestPaywallFlow:
    def test_full_paywall_flow(self, base_url, paywall_user, mongo_db):
        import requests
        hdr = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {paywall_user['token']}",
        }

        # 1. Create project
        r = requests.post(f"{base_url}/api/projects", json={"title": "TEST_Paywall"}, headers=hdr, timeout=30)
        assert r.status_code == 200, r.text
        pid = r.json()["project"]["project_id"]

        # 2. Add manuscript content
        manuscript = (
            "Maya stood at the edge of the cliff, the rain stinging her cheeks. "
            "Below, the dark sea churned. Daniel called her name, his voice "
            "breaking against the wind. She turned, and what she saw in his face "
            "would haunt her for the rest of her life."
        ) * 3
        r = requests.patch(
            f"{base_url}/api/projects/{pid}",
            json={"manuscript": manuscript},
            headers=hdr, timeout=30,
        )
        assert r.status_code == 200

        # 3. Entitlements: fresh user, nothing used
        r = requests.get(f"{base_url}/api/billing/entitlements", headers=hdr, timeout=30)
        assert r.status_code == 200
        ent = r.json()["entitlement"]
        assert ent["free_used"] is False
        assert ent["credits"] == 0
        assert ent["is_pro"] is False

        # 4. First coverage -> 200 (free consumed). Long timeout for LLM.
        r = requests.post(
            f"{base_url}/api/projects/{pid}/coverage",
            json={"use_screenplay": False},
            headers=hdr, timeout=180,
        )
        assert r.status_code == 200, r.text
        assert "coverage" in r.json()
        assert len(r.json()["coverage"]["report"]) > 50

        # Free should now be marked used
        u = mongo_db.users.find_one({"user_id": paywall_user["user_id"]})
        assert u["free_coverage_used"] is True

        # 5. Second coverage -> 402 with payment_required detail
        r = requests.post(
            f"{base_url}/api/projects/{pid}/coverage",
            json={"use_screenplay": False},
            headers=hdr, timeout=60,
        )
        assert r.status_code == 402, r.text
        detail = r.json().get("detail", {})
        assert isinstance(detail, dict)
        assert detail.get("code") == "payment_required"

        # 6. Simulate IAP purchase (dev mode bypass — no store credentials needed in CI)
        purchase_token = f"ci_test_{uuid.uuid4().hex}"
        r = requests.post(
            f"{base_url}/api/billing/iap/verify",
            json={
                "platform": "android",
                "product_id": "scribe_coverage_single",
                "purchase_token": purchase_token,
            },
            headers=hdr, timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["fulfilled"] is True

        # Credits should now be 1
        r = requests.get(f"{base_url}/api/billing/entitlements", headers=hdr, timeout=30)
        assert r.json()["entitlement"]["credits"] == 1

        # 7. Third coverage -> 200 (credit consumed)
        r = requests.post(
            f"{base_url}/api/projects/{pid}/coverage",
            json={"use_screenplay": False},
            headers=hdr, timeout=180,
        )
        assert r.status_code == 200, r.text

        # 8. Credits back to 0
        r = requests.get(f"{base_url}/api/billing/entitlements", headers=hdr, timeout=30)
        ent = r.json()["entitlement"]
        assert ent["credits"] == 0
        assert ent["free_used"] is True

        # 9. Fourth coverage -> 402 again
        r = requests.post(
            f"{base_url}/api/projects/{pid}/coverage",
            json={"use_screenplay": False},
            headers=hdr, timeout=60,
        )
        assert r.status_code == 402
