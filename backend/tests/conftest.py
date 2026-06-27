"""Shared fixtures: synthetic user/session injection, base URL, http client."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pathlib import Path

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv(Path(__file__).parent.parent / ".env")

BASE_URL = os.environ.get("BACKEND_URL", "http://localhost:8001")
BASE_URL = BASE_URL.rstrip("/")

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "scribe_database")


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def mongo_db():
    cli = MongoClient(MONGO_URL)
    yield cli[DB_NAME]
    cli.close()


@pytest.fixture(scope="session")
def synthetic_user(mongo_db):
    """Insert synthetic user + session token directly into Mongo, return dict."""
    user_id = f"user_test_{uuid.uuid4().hex[:8]}"
    token = f"test_token_{uuid.uuid4().hex}"
    email = f"TEST_{uuid.uuid4().hex[:6]}@example.com"
    now = datetime.now(timezone.utc)

    mongo_db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": "Test Synthetic",
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

    yield {"user_id": user_id, "email": email, "session_token": token}

    # Cleanup
    mongo_db.user_sessions.delete_many({"user_id": user_id})
    mongo_db.users.delete_one({"user_id": user_id})
    mongo_db.projects.delete_many({"user_id": user_id})
    mongo_db.iap_purchases.delete_many({"user_id": user_id})
    for c in ("characters", "scenes", "locations", "beats", "notes"):
        mongo_db[c].delete_many({"user_id": user_id})


@pytest.fixture
def api_client(synthetic_user):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {synthetic_user['session_token']}",
    })
    return s


@pytest.fixture
def anon_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s
