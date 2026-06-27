"""End-to-end backend tests for Scribe.
Covers: health, auth, projects CRUD, resources CRUD, cascade delete,
LLM screenplay convert (sync), and MongoDB _id hygiene.
"""
import json
import pytest

PROSE_EXCERPT = (
    "Maya stepped into the dim coffee shop, the door chiming behind her. "
    "Rain dripped from her coat onto worn floorboards. At the corner table, "
    "Daniel looked up from a laptop, his eyes guarded. \"You came,\" he said softly. "
    "She slid into the booth opposite him, hands trembling against the cold mug the "
    "waitress had left. \"I shouldn't have. But I needed to hear it from you.\" "
    "Daniel closed the laptop slowly. The hum of an espresso machine filled the silence. "
    "Outside, a streetcar rattled past, throwing pale light across his face. \"I lied "
    "about everything,\" he admitted. \"About the money. About my brother. About us.\" "
    "Maya's jaw tightened. She looked at the door, then back at him. Twelve years of "
    "memories warred with the truth she'd come for. \"Then start over,\" she said. "
    "\"And this time, don't leave anything out.\" Daniel exhaled, nodded once, and began."
)


# ---------- Health ----------
class TestHealth:
    def test_root_health(self, base_url, anon_client):
        r = anon_client.get(f"{base_url}/api/")
        assert r.status_code == 200
        data = r.json()
        assert data == {"app": "scribe", "ok": True}


# ---------- Auth ----------
class TestAuth:
    def test_me_unauthenticated_returns_401(self, base_url, anon_client):
        r = anon_client.get(f"{base_url}/api/auth/me")
        assert r.status_code == 401

    def test_projects_unauthenticated_returns_401(self, base_url, anon_client):
        r = anon_client.get(f"{base_url}/api/projects")
        assert r.status_code == 401

    def test_session_invalid_id_returns_401(self, base_url, anon_client):
        r = anon_client.post(
            f"{base_url}/api/auth/session",
            json={"session_id": "obviously_invalid_session_id_xyz_123"},
        )
        assert r.status_code == 401

    def test_me_with_synthetic_token(self, base_url, api_client, synthetic_user):
        r = api_client.get(f"{base_url}/api/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert "user" in body
        assert body["user"]["user_id"] == synthetic_user["user_id"]
        assert body["user"]["email"] == synthetic_user["email"]
        # Mongo _id should never be returned
        assert '"_id"' not in json.dumps(body)


# ---------- Projects CRUD ----------
class TestProjectsCRUD:
    def test_full_project_lifecycle(self, base_url, api_client, mongo_db, synthetic_user):
        # Create
        r = api_client.post(
            f"{base_url}/api/projects",
            json={"title": "The Test Novel", "logline": "A test", "genre": "Drama"},
        )
        assert r.status_code == 200, r.text
        proj = r.json()["project"]
        pid = proj["project_id"]
        assert proj["title"] == "The Test Novel"
        assert proj["user_id"] == synthetic_user["user_id"]
        assert '"_id"' not in json.dumps(r.json())

        # List
        r = api_client.get(f"{base_url}/api/projects")
        assert r.status_code == 200
        listing = r.json()["projects"]
        assert any(p["project_id"] == pid for p in listing)

        # Get single
        r = api_client.get(f"{base_url}/api/projects/{pid}")
        assert r.status_code == 200
        full = r.json()["project"]
        assert full["project_id"] == pid
        assert full["manuscript"] == ""

        # Patch manuscript
        r = api_client.patch(
            f"{base_url}/api/projects/{pid}",
            json={"manuscript": "Chapter 1. It was a dark and stormy night."},
        )
        assert r.status_code == 200
        updated = r.json()["project"]
        assert "dark and stormy" in updated["manuscript"]

        # Verify persistence via GET
        r = api_client.get(f"{base_url}/api/projects/{pid}")
        assert r.json()["project"]["manuscript"].startswith("Chapter 1")

        # Delete
        r = api_client.delete(f"{base_url}/api/projects/{pid}")
        assert r.status_code == 200

        # Verify gone
        r = api_client.get(f"{base_url}/api/projects/{pid}")
        assert r.status_code == 404


# ---------- Resources CRUD ----------
RESOURCES = [
    ("characters", {"name": "Maya", "role": "Lead", "description": "Determined journalist"}),
    ("scenes", {"title": "Opening Cafe", "summary": "Maya confronts Daniel", "order": 1}),
    ("locations", {"name": "Cafe", "int_ext": "INT", "time_of_day": "NIGHT"}),
    ("beats", {"title": "Inciting Incident", "act": "I", "order": 1}),
    ("notes", {"title": "Theme", "body": "Trust & lies", "tag": "theme"}),
]


@pytest.fixture
def project_id(base_url, api_client):
    r = api_client.post(f"{base_url}/api/projects", json={"title": "TEST_Resource_Project"})
    assert r.status_code == 200
    pid = r.json()["project"]["project_id"]
    yield pid
    api_client.delete(f"{base_url}/api/projects/{pid}")


@pytest.mark.parametrize("resource,payload", RESOURCES)
class TestResourceCRUD:
    def test_resource_lifecycle(self, base_url, api_client, project_id, resource, payload):
        # Create
        r = api_client.post(f"{base_url}/api/projects/{project_id}/{resource}", json=payload)
        assert r.status_code == 200, f"{resource} create failed: {r.text}"
        item = r.json()["item"]
        iid = item["id"]
        assert '"_id"' not in json.dumps(r.json())

        # List
        r = api_client.get(f"{base_url}/api/projects/{project_id}/{resource}")
        assert r.status_code == 200
        items = r.json()["items"]
        assert any(it["id"] == iid for it in items)

        # Patch (model fields are not strictly Optional for required, must resupply)
        patched = dict(payload)
        # bump a known field
        if "title" in patched:
            patched["title"] = patched["title"] + " (Updated)"
        elif "name" in patched:
            patched["name"] = patched["name"] + " (Updated)"
        r = api_client.patch(
            f"{base_url}/api/projects/{project_id}/{resource}/{iid}", json=patched
        )
        assert r.status_code == 200, r.text

        # Verify persistence
        r = api_client.get(f"{base_url}/api/projects/{project_id}/{resource}")
        items = r.json()["items"]
        updated = next(it for it in items if it["id"] == iid)
        if "title" in payload:
            assert "(Updated)" in updated["title"]
        elif "name" in payload:
            assert "(Updated)" in updated["name"]

        # Delete
        r = api_client.delete(f"{base_url}/api/projects/{project_id}/{resource}/{iid}")
        assert r.status_code == 200

        # Verify removed
        r = api_client.get(f"{base_url}/api/projects/{project_id}/{resource}")
        assert not any(it["id"] == iid for it in r.json()["items"])


# ---------- Cascade delete ----------
class TestCascadeDelete:
    def test_cascade_deletes_all_child_resources(self, base_url, api_client, mongo_db, synthetic_user):
        # Create project
        r = api_client.post(f"{base_url}/api/projects", json={"title": "TEST_Cascade"})
        pid = r.json()["project"]["project_id"]

        # Add one of each resource
        for resource, payload in RESOURCES:
            r = api_client.post(f"{base_url}/api/projects/{pid}/{resource}", json=payload)
            assert r.status_code == 200

        # Confirm rows exist in Mongo
        for coll in ("characters", "scenes", "locations", "beats", "notes"):
            assert mongo_db[coll].count_documents({"project_id": pid}) == 1

        # Delete project
        r = api_client.delete(f"{base_url}/api/projects/{pid}")
        assert r.status_code == 200

        # Confirm cascade
        for coll in ("characters", "scenes", "locations", "beats", "notes"):
            assert mongo_db[coll].count_documents({"project_id": pid}) == 0, f"{coll} not cleaned"


# ---------- Convert sync (LLM) ----------
class TestConvertSync:
    def test_convert_sync_empty_text_400(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/projects", json={"title": "TEST_Convert_Empty"})
        pid = r.json()["project"]["project_id"]
        try:
            r = api_client.post(
                f"{base_url}/api/projects/{pid}/convert_sync",
                json={"text": "   ", "style": "fountain"},
            )
            assert r.status_code == 400
        finally:
            api_client.delete(f"{base_url}/api/projects/{pid}")

    def test_convert_sync_unknown_project_404(self, base_url, api_client):
        r = api_client.post(
            f"{base_url}/api/projects/proj_does_not_exist_xyz/convert_sync",
            json={"text": PROSE_EXCERPT, "style": "fountain"},
        )
        assert r.status_code == 404

    def test_convert_sync_fountain_style(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/projects", json={"title": "TEST_Convert_Fountain"})
        pid = r.json()["project"]["project_id"]
        try:
            r = api_client.post(
                f"{base_url}/api/projects/{pid}/convert_sync",
                json={"text": PROSE_EXCERPT, "style": "fountain"},
                timeout=90,
            )
            assert r.status_code == 200, r.text
            data = r.json()
            assert "text" in data
            text = data["text"]
            assert isinstance(text, str) and len(text) > 50, f"Output too short: {text!r}"
            # Should contain slugline markers
            upper = text.upper()
            assert ("INT." in upper) or ("EXT." in upper), f"No slugline marker in output: {text[:300]}"
        finally:
            api_client.delete(f"{base_url}/api/projects/{pid}")

    def test_convert_sync_simple_style(self, base_url, api_client):
        r = api_client.post(f"{base_url}/api/projects", json={"title": "TEST_Convert_Simple"})
        pid = r.json()["project"]["project_id"]
        try:
            r = api_client.post(
                f"{base_url}/api/projects/{pid}/convert_sync",
                json={"text": PROSE_EXCERPT, "style": "simple"},
                timeout=90,
            )
            assert r.status_code == 200, r.text
            text = r.json()["text"]
            assert isinstance(text, str) and len(text) > 50
        finally:
            api_client.delete(f"{base_url}/api/projects/{pid}")


# ---------- Logout ----------
class TestLogout:
    def test_logout_deletes_session_and_subsequent_me_401(self, base_url, mongo_db):
        """Use a one-off synthetic session to avoid breaking other tests."""
        import uuid
        from datetime import datetime, timezone, timedelta
        import requests

        user_id = f"user_logout_{uuid.uuid4().hex[:8]}"
        token = f"test_token_logout_{uuid.uuid4().hex}"
        now = datetime.now(timezone.utc)
        try:
            mongo_db.users.insert_one({
                "user_id": user_id,
                "email": f"TEST_logout_{uuid.uuid4().hex[:6]}@example.com",
                "name": "Logout Test",
                "picture": "",
                "created_at": now,
            })
            mongo_db.user_sessions.insert_one({
                "session_token": token,
                "user_id": user_id,
                "expires_at": now + timedelta(days=7),
                "created_at": now,
            })

            hdr = {"Authorization": f"Bearer {token}"}
            # me works first
            r = requests.get(f"{base_url}/api/auth/me", headers=hdr, timeout=15)
            assert r.status_code == 200

            # logout
            r = requests.post(f"{base_url}/api/auth/logout", headers=hdr, timeout=15)
            assert r.status_code == 200
            assert mongo_db.user_sessions.count_documents({"session_token": token}) == 0

            # subsequent me returns 401
            r = requests.get(f"{base_url}/api/auth/me", headers=hdr, timeout=15)
            assert r.status_code == 401
        finally:
            mongo_db.users.delete_one({"user_id": user_id})
            mongo_db.user_sessions.delete_many({"user_id": user_id})


# ---------- _id hygiene ----------
class TestMongoIdHygiene:
    def test_no_objectid_leak_anywhere(self, base_url, api_client):
        # Create project + one child resource and verify no `_id` in any response
        r = api_client.post(f"{base_url}/api/projects", json={"title": "TEST_NoIdLeak"})
        pid = r.json()["project"]["project_id"]
        try:
            checks = [
                api_client.get(f"{base_url}/api/projects"),
                api_client.get(f"{base_url}/api/projects/{pid}"),
                api_client.get(f"{base_url}/api/auth/me"),
            ]
            for resource, payload in RESOURCES:
                cr = api_client.post(f"{base_url}/api/projects/{pid}/{resource}", json=payload)
                checks.append(cr)
                checks.append(api_client.get(f"{base_url}/api/projects/{pid}/{resource}"))
            for resp in checks:
                assert resp.status_code == 200
                assert '"_id"' not in resp.text, f"_id leaked in {resp.url}: {resp.text[:200]}"
        finally:
            api_client.delete(f"{base_url}/api/projects/{pid}")
