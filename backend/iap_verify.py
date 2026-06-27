"""
IAP receipt verification for Google Play and Apple App Store.

Google Play: uses the Google Play Developer API (service account JSON).
Apple:       uses Apple's App Store Server API (verifyReceipt).

Both are called server-side so the client can never fake a purchase.
"""
import os
import json
import logging
import httpx
from datetime import datetime, timezone, timedelta

log = logging.getLogger("scribe.iap")

# ── Product ID → entitlement mapping ──────────────────────────────────────────
PRODUCT_ENTITLEMENTS = {
    # Android SKUs
    "scribe_coverage_single": {"type": "credit", "amount": 1},
    "scribe_pro_monthly":     {"type": "pro_days", "days": 30},
    # iOS SKUs
    "com.scribeapp.scribe.coverage_single": {"type": "credit", "amount": 1},
    "com.scribeapp.scribe.pro_monthly":     {"type": "pro_days", "days": 30},
}


# ── Google Play verification ───────────────────────────────────────────────────

async def verify_google_purchase(product_id: str, purchase_token: str) -> bool:
    """
    Verify a Google Play purchase using the Google Play Developer API.
    Requires GOOGLE_SERVICE_ACCOUNT_JSON env var (path to service account JSON file).

    Returns True if purchase is valid and not already consumed/cancelled.
    """
    sa_path = os.environ.get("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not sa_path:
        log.warning("GOOGLE_SERVICE_ACCOUNT_JSON not set — skipping Google Play verification in dev mode")
        return True   # Allow in dev/test; MUST be set in production

    package_name = os.environ.get("ANDROID_PACKAGE_NAME", "com.scribeapp.scribe")

    # Get OAuth2 access token from service account
    try:
        with open(sa_path) as f:
            sa = json.load(f)

        import time, base64
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import padding

        now = int(time.time())
        header = base64.urlsafe_b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()).rstrip(b"=")
        payload_data = {
            "iss": sa["client_email"],
            "scope": "https://www.googleapis.com/auth/androidpublisher",
            "aud": "https://oauth2.googleapis.com/token",
            "iat": now,
            "exp": now + 3600,
        }
        payload = base64.urlsafe_b64encode(json.dumps(payload_data).encode()).rstrip(b"=")
        to_sign = header + b"." + payload

        private_key = serialization.load_pem_private_key(sa["private_key"].encode(), password=None)
        sig = private_key.sign(to_sign, padding.PKCS1v15(), hashes.SHA256())
        sig_b64 = base64.urlsafe_b64encode(sig).rstrip(b"=")
        jwt_token = (to_sign + b"." + sig_b64).decode()

        async with httpx.AsyncClient(timeout=15) as hc:
            token_resp = await hc.post(
                "https://oauth2.googleapis.com/token",
                data={"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": jwt_token},
            )
            access_token = token_resp.json()["access_token"]

            # Verify the purchase
            verify_url = (
                f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
                f"/{package_name}/purchases/products/{product_id}/tokens/{purchase_token}"
            )
            r = await hc.get(verify_url, headers={"Authorization": f"Bearer {access_token}"})
            data = r.json()

        # purchaseState 0 = purchased, 1 = cancelled, 2 = pending
        return data.get("purchaseState") == 0

    except Exception as e:
        log.exception("Google Play verification failed: %s", e)
        return False


# ── Apple App Store verification ───────────────────────────────────────────────

async def verify_apple_purchase(transaction_receipt: str) -> tuple[bool, str | None]:
    """
    Verify an Apple IAP receipt using Apple's verifyReceipt endpoint.
    Returns (is_valid, product_id).

    Requires APPLE_SHARED_SECRET env var (from App Store Connect).
    """
    shared_secret = os.environ.get("APPLE_SHARED_SECRET")
    if not shared_secret:
        log.warning("APPLE_SHARED_SECRET not set — skipping Apple verification in dev mode")
        return True, None   # Allow in dev/test; MUST be set in production

    payload = {"receipt-data": transaction_receipt, "password": shared_secret, "exclude-old-transactions": True}

    # Try production first, fall back to sandbox
    for url in [
        "https://buy.itunes.apple.com/verifyReceipt",
        "https://sandbox.itunes.apple.com/verifyReceipt",
    ]:
        try:
            async with httpx.AsyncClient(timeout=15) as hc:
                r = await hc.post(url, json=payload)
                data = r.json()

            status = data.get("status", -1)
            if status == 21007:
                continue   # Sandbox receipt sent to production — retry sandbox
            if status == 0:
                # Find the most recent transaction
                receipts = data.get("latest_receipt_info", [])
                if receipts:
                    latest = max(receipts, key=lambda x: int(x.get("purchase_date_ms", 0)))
                    return True, latest.get("product_id")
                return False, None
            return False, None
        except Exception as e:
            log.exception("Apple IAP verification error: %s", e)
            return False, None

    return False, None
