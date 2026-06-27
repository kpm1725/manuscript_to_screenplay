import os
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Optional, AsyncGenerator

import httpx
import anthropic
from iap_verify import (
    verify_google_purchase,
    verify_apple_purchase,
    PRODUCT_ENTITLEMENTS,
)
from fastapi import FastAPI, APIRouter, HTTPException, Header
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
# Google OAuth: used to verify the id_token sent by the frontend
GOOGLE_CLIENT_ID = os.environ["GOOGLE_CLIENT_ID"]
anthropic_client = anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)

mongo_client = AsyncIOMotorClient(MONGO_URL)
db = mongo_client[DB_NAME]

app = FastAPI(title="Scribe API")
api = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("scribe")


# ─── Helpers ────────────────────────────────────────────────────────────────

def now_utc() -> datetime:
    return datetime.now(timezone.utc)

def ensure_aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

def new_id(prefix: str = "id") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


# ─── Models ─────────────────────────────────────────────────────────────────

class GoogleTokenRequest(BaseModel):
    id_token: str          # Google ID token from expo-auth-session

class ProjectIn(BaseModel):
    title: str
    logline: Optional[str] = ""
    genre: Optional[str] = ""

class ProjectUpdate(BaseModel):
    title: Optional[str] = None
    logline: Optional[str] = None
    genre: Optional[str] = None
    manuscript: Optional[str] = None
    screenplay: Optional[str] = None

class CharacterIn(BaseModel):
    name: str
    role: Optional[str] = ""
    description: Optional[str] = ""
    arc: Optional[str] = ""
    traits: Optional[str] = ""

class SceneIn(BaseModel):
    title: str
    summary: Optional[str] = ""
    location: Optional[str] = ""
    characters: Optional[str] = ""
    status: Optional[str] = "draft"
    order: Optional[int] = 0

class LocationIn(BaseModel):
    name: str
    int_ext: Optional[str] = "INT"
    time_of_day: Optional[str] = "DAY"
    description: Optional[str] = ""

class BeatIn(BaseModel):
    title: str
    act: Optional[str] = "I"
    summary: Optional[str] = ""
    order: Optional[int] = 0

class NoteIn(BaseModel):
    title: str
    body: Optional[str] = ""
    tag: Optional[str] = ""

class ConvertRequest(BaseModel):
    text: str
    style: Optional[str] = "fountain"

class CoverageRequest(BaseModel):
    use_screenplay: Optional[bool] = False


# ─── Auth helpers ────────────────────────────────────────────────────────────

async def verify_google_token(id_token: str) -> dict:
    """Verify Google ID token and return user info."""
    async with httpx.AsyncClient(timeout=10.0) as hc:
        r = await hc.get(
            "https://oauth2.googleapis.com/tokeninfo",
            params={"id_token": id_token},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid Google token")
    data = r.json()
    if data.get("aud") != GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=401, detail="Token audience mismatch")
    return data  # keys: email, name, picture, sub, ...


async def get_user_from_token(token: str) -> Optional[dict]:
    if not token:
        return None
    sess = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not sess:
        return None
    if ensure_aware(sess["expires_at"]) < now_utc():
        await db.user_sessions.delete_one({"session_token": token})
        return None
    return await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0})


async def require_user(authorization: Optional[str]) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    user = await get_user_from_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user


# ─── Routes: Auth ────────────────────────────────────────────────────────────

@api.post("/auth/google")
async def auth_google(body: GoogleTokenRequest):
    """Exchange a Google ID token for a Scribe session token."""
    google_data = await verify_google_token(body.id_token)
    email = google_data["email"]

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        # Refresh name/picture in case they changed
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {
                "name": google_data.get("name", existing.get("name", "")),
                "picture": google_data.get("picture", existing.get("picture", "")),
            }},
        )
    else:
        user_id = new_id("user")
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": google_data.get("name", ""),
            "picture": google_data.get("picture", ""),
            "created_at": now_utc(),
        })

    session_token = f"scribe_{uuid.uuid4().hex}"
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "expires_at": now_utc() + timedelta(days=30),
        "created_at": now_utc(),
    })

    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return {"user": user, "session_token": session_token}


@api.get("/auth/me")
async def me(authorization: Optional[str] = Header(None)):
    user = await require_user(authorization)
    return {"user": user}


@api.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# ─── Routes: Projects ────────────────────────────────────────────────────────

@api.get("/projects")
async def list_projects(authorization: Optional[str] = Header(None)):
    user = await require_user(authorization)
    cursor = db.projects.find({"user_id": user["user_id"]}, {"_id": 0}).sort("updated_at", -1)
    items = await cursor.to_list(500)
    return {"projects": [{
        "project_id": p["project_id"],
        "title": p["title"],
        "logline": p.get("logline", ""),
        "genre": p.get("genre", ""),
        "manuscript_len": len(p.get("manuscript", "")),
        "screenplay_len": len(p.get("screenplay", "")),
        "updated_at": p.get("updated_at"),
        "created_at": p.get("created_at"),
    } for p in items]}


@api.post("/projects")
async def create_project(body: ProjectIn, authorization: Optional[str] = Header(None)):
    user = await require_user(authorization)
    pid = new_id("proj")
    doc = {
        "project_id": pid,
        "user_id": user["user_id"],
        "title": body.title.strip() or "Untitled",
        "logline": (body.logline or "").strip(),
        "genre": (body.genre or "").strip(),
        "manuscript": "",
        "screenplay": "",
        "created_at": now_utc(),
        "updated_at": now_utc(),
    }
    await db.projects.insert_one(doc)
    doc.pop("_id", None)
    return {"project": doc}


@api.get("/projects/{pid}")
async def get_project(pid: str, authorization: Optional[str] = Header(None)):
    user = await require_user(authorization)
    p = await db.projects.find_one({"project_id": pid, "user_id": user["user_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"project": p}


@api.patch("/projects/{pid}")
async def update_project(pid: str, body: ProjectUpdate, authorization: Optional[str] = Header(None)):
    user = await require_user(authorization)
    upd = {k: v for k, v in body.model_dump().items() if v is not None}
    if not upd:
        raise HTTPException(status_code=400, detail="Nothing to update")
    upd["updated_at"] = now_utc()
    res = await db.projects.update_one(
        {"project_id": pid, "user_id": user["user_id"]}, {"$set": upd}
    )
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    p = await db.projects.find_one({"project_id": pid}, {"_id": 0})
    return {"project": p}


@api.delete("/projects/{pid}")
async def delete_project(pid: str, authorization: Optional[str] = Header(None)):
    user = await require_user(authorization)
    await db.projects.delete_one({"project_id": pid, "user_id": user["user_id"]})
    for coll in ("characters", "scenes", "locations", "beats", "notes"):
        await db[coll].delete_many({"project_id": pid, "user_id": user["user_id"]})
    return {"ok": True}


# ─── Generic CRUD factory ────────────────────────────────────────────────────

def _build_crud(resource: str, model, id_prefix: str):
    @api.get(f"/projects/{{pid}}/{resource}")
    async def _list(pid: str, authorization: Optional[str] = Header(None)):
        user = await require_user(authorization)
        cursor = db[resource].find(
            {"project_id": pid, "user_id": user["user_id"]}, {"_id": 0}
        ).sort([("order", 1), ("created_at", 1)])
        return {"items": await cursor.to_list(1000)}

    @api.post(f"/projects/{{pid}}/{resource}")
    async def _create(pid: str, body: model, authorization: Optional[str] = Header(None)):
        user = await require_user(authorization)
        p = await db.projects.find_one({"project_id": pid, "user_id": user["user_id"]}, {"_id": 0})
        if not p:
            raise HTTPException(status_code=404, detail="Project not found")
        doc = body.model_dump()
        doc.update({"id": new_id(id_prefix), "project_id": pid, "user_id": user["user_id"],
                    "created_at": now_utc(), "updated_at": now_utc()})
        await db[resource].insert_one(doc)
        doc.pop("_id", None)
        return {"item": doc}

    @api.patch(f"/projects/{{pid}}/{resource}/{{iid}}")
    async def _update(pid: str, iid: str, body: model, authorization: Optional[str] = Header(None)):
        user = await require_user(authorization)
        upd = body.model_dump()
        upd["updated_at"] = now_utc()
        res = await db[resource].update_one(
            {"id": iid, "project_id": pid, "user_id": user["user_id"]}, {"$set": upd}
        )
        if res.matched_count == 0:
            raise HTTPException(status_code=404, detail="Not found")
        return {"item": await db[resource].find_one({"id": iid}, {"_id": 0})}

    @api.delete(f"/projects/{{pid}}/{resource}/{{iid}}")
    async def _delete(pid: str, iid: str, authorization: Optional[str] = Header(None)):
        user = await require_user(authorization)
        await db[resource].delete_one({"id": iid, "project_id": pid, "user_id": user["user_id"]})
        return {"ok": True}


_build_crud("characters", CharacterIn, "char")
_build_crud("scenes", SceneIn, "scn")
_build_crud("locations", LocationIn, "loc")
_build_crud("beats", BeatIn, "beat")
_build_crud("notes", NoteIn, "note")


# ─── AI: Screenplay Conversion ───────────────────────────────────────────────

SCREENPLAY_SYSTEM_PROMPT = """You are a world-class screenwriter and adaptation specialist. Convert prose from a novel manuscript into a properly formatted screenplay in Fountain format.

STRICT FORMATTING RULES (Fountain / Hollywood industry standard):
- Scene Headings (Sluglines): ALL CAPS, start with INT. or EXT., end with - DAY / - NIGHT / - CONTINUOUS.
  Example: INT. COFFEE SHOP - DAY
- Action lines: present tense, vivid, concise. No novelistic interiority. Show, don't tell.
- Character cues: ALL CAPS, centered (single line), preceded by a blank line.
- Parentheticals: lowercase, in (parentheses), directly under character cue. Use sparingly.
- Dialogue: directly under the character cue (or parenthetical). One blank line between speakers.
- Transitions (CUT TO:, FADE OUT.) only when essential.
- Convert internal monologue into externalized visual action or sparing voiceover (V.O.).
- Compress long descriptive passages into tight, filmable images.

OUTPUT: Return ONLY the formatted screenplay text. No commentary, no markdown. Begin directly with the first slugline."""

SIMPLE_SYSTEM_PROMPT = """You are a screenwriter. Convert the prose into simple screenplay format: scene headings in CAPS, action paragraphs, character dialogue prefixed by CHARACTER NAME:. Return only the converted text."""

COVERAGE_SYSTEM_PROMPT = """You are a seasoned development executive and script reader at a major studio. Produce a professional COVERAGE REPORT.

Use exactly these section headings in ALL CAPS on their own line, then content:

LOGLINE
One sentence (max 35 words): protagonist, goal, conflict, stakes.

SYNOPSIS
4-7 sentence plot summary.

GENRE & COMPARABLES
Genre/tone and 2-3 comparable produced films or shows with brief reasoning.

CHARACTER ANALYSIS
Short paragraph per principal character (max 4): arc, motivation, castability.

STRENGTHS
3-5 bullet points (use "- " prefix) on what works.

WEAKNESSES
3-5 bullet points (use "- " prefix) on craft, structure, or marketability concerns.

MARKET VERDICT
RECOMMEND / CONSIDER / PASS — one sentence justification and projected audience.

Use clear prose. No markdown beyond headings and bullet dashes. Output ONLY the report."""


@api.post("/projects/{pid}/convert_sync")
async def convert_sync(pid: str, body: ConvertRequest, authorization: Optional[str] = Header(None)):
    user = await require_user(authorization)
    p = await db.projects.find_one({"project_id": pid, "user_id": user["user_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    if not body.text or not body.text.strip():
        raise HTTPException(status_code=400, detail="No text provided")

    system_msg = SCREENPLAY_SYSTEM_PROMPT if body.style == "fountain" else SIMPLE_SYSTEM_PROMPT
    try:
        resp = await anthropic_client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=4096,
            system=system_msg,
            messages=[{"role": "user", "content": f"Convert the following manuscript excerpt into a screenplay.\n\nMANUSCRIPT:\n\n{body.text.strip()}"}],
        )
        text = resp.content[0].text if resp.content else ""
    except Exception as e:
        log.exception("LLM call failed")
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")
    return {"text": text}


@api.post("/projects/{pid}/convert")
async def convert_stream(pid: str, body: ConvertRequest, authorization: Optional[str] = Header(None)):
    user = await require_user(authorization)
    p = await db.projects.find_one({"project_id": pid, "user_id": user["user_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    if not body.text or not body.text.strip():
        raise HTTPException(status_code=400, detail="No text provided")

    system_msg = SCREENPLAY_SYSTEM_PROMPT if body.style == "fountain" else SIMPLE_SYSTEM_PROMPT

    async def gen() -> AsyncGenerator[bytes, None]:
        try:
            async with anthropic_client.messages.stream(
                model="claude-sonnet-4-5-20250929",
                max_tokens=4096,
                system=system_msg,
                messages=[{"role": "user", "content": f"Convert the following manuscript excerpt into a screenplay.\n\nMANUSCRIPT:\n\n{body.text.strip()}"}],
            ) as stream:
                async for text in stream.text_stream:
                    safe = text.replace("\\", "\\\\").replace("\n", "\\n").replace('"', '\\"')
                    yield f'data: {{"delta":"{safe}"}}\n\n'.encode()
            yield b'data: {"done":true}\n\n'
        except Exception as e:
            log.exception("LLM stream failed")
            err = str(e).replace('"', "'")
            yield f'data: {{"error":"{err}"}}\n\n'.encode()

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


# ─── AI: Producer Coverage ───────────────────────────────────────────────────

async def get_entitlement(user_id: str) -> dict:
    u = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    if not u:
        return {"free_used": True, "credits": 0, "pro_until": None, "is_pro": False}
    pro_until = u.get("pro_until")
    is_pro = False
    if pro_until:
        pro_until = ensure_aware(pro_until)
        is_pro = pro_until > now_utc()
    return {
        "free_used": bool(u.get("free_coverage_used", False)),
        "credits": int(u.get("coverage_credits", 0)),
        "pro_until": pro_until.isoformat() if pro_until else None,
        "is_pro": is_pro,
    }


async def consume_entitlement_or_402(user_id: str) -> str:
    ent = await get_entitlement(user_id)
    if ent["is_pro"]:
        return "pro"
    if ent["credits"] > 0:
        await db.users.update_one({"user_id": user_id}, {"$inc": {"coverage_credits": -1}})
        return "credit"
    if not ent["free_used"]:
        await db.users.update_one({"user_id": user_id}, {"$set": {"free_coverage_used": True}})
        return "free"
    raise HTTPException(
        status_code=402,
        detail={
            "message": "Free coverage report already used. Unlock more to continue.",
            "code": "payment_required",
            "packages": [{"id": k, **v} for k, v in BILLING_PACKAGES.items()],
        },
    )


@api.post("/projects/{pid}/coverage")
async def generate_coverage(pid: str, body: CoverageRequest, authorization: Optional[str] = Header(None)):
    user = await require_user(authorization)
    p = await db.projects.find_one({"project_id": pid, "user_id": user["user_id"]}, {"_id": 0})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")

    source_text = (p.get("screenplay") or "") if body.use_screenplay else (p.get("manuscript") or "")
    source_label = "screenplay" if body.use_screenplay else "novel manuscript"
    if not source_text.strip():
        raise HTTPException(status_code=400, detail=f"No {source_label} content yet.")

    tier_used = await consume_entitlement_or_402(user["user_id"])
    log.info("Coverage: user=%s tier=%s", user["user_id"], tier_used)

    chars = await db.characters.find({"project_id": pid, "user_id": user["user_id"]}, {"_id": 0}).to_list(50)
    beats = await db.beats.find({"project_id": pid, "user_id": user["user_id"]}, {"_id": 0}).sort("order", 1).to_list(50)

    ctx = []
    if p.get("title"):    ctx.append(f"TITLE: {p['title']}")
    if p.get("logline"):  ctx.append(f"AUTHOR LOGLINE: {p['logline']}")
    if p.get("genre"):    ctx.append(f"AUTHOR GENRE: {p['genre']}")
    if chars:
        ctx.append("CHARACTER NOTES:\n" + "\n".join(
            f"- {c.get('name','?')} ({c.get('role','')}): {c.get('description','')}".strip() for c in chars))
    if beats:
        ctx.append("AUTHOR BEAT OUTLINE:\n" + "\n".join(
            f"- Act {b.get('act','?')}: {b.get('title','?')} — {b.get('summary','')}".strip() for b in beats))

    excerpt = source_text[:24000]
    if len(source_text) > 24000:
        excerpt += "\n\n[... excerpt truncated ...]"

    prompt = (("\n\n".join(ctx) + "\n\n") if ctx else "") + f"FULL {source_label.upper()} TEXT:\n\n{excerpt}"

    try:
        resp = await anthropic_client.messages.create(
            model="claude-sonnet-4-5-20250929",
            max_tokens=2048,
            system=COVERAGE_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        report = resp.content[0].text.strip() if resp.content else ""
    except Exception as e:
        log.exception("Coverage LLM call failed")
        raise HTTPException(status_code=502, detail=f"LLM error: {e}")

    if not report:
        raise HTTPException(status_code=502, detail="Empty report returned")

    coverage_doc = {
        "report": report,
        "source": "screenplay" if body.use_screenplay else "manuscript",
        "generated_at": now_utc(),
    }
    await db.projects.update_one(
        {"project_id": pid, "user_id": user["user_id"]},
        {"$set": {"coverage": coverage_doc, "updated_at": now_utc()}},
    )
    return {"coverage": coverage_doc}


@api.get("/projects/{pid}/coverage")
async def get_coverage(pid: str, authorization: Optional[str] = Header(None)):
    user = await require_user(authorization)
    p = await db.projects.find_one({"project_id": pid, "user_id": user["user_id"]}, {"_id": 0, "coverage": 1})
    if not p:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"coverage": p.get("coverage")}


# ─── Billing / IAP (Google Play + Apple App Store) ───────────────────────────

class IAPVerifyBody(BaseModel):
    platform: str                           # "android" or "ios"
    product_id: str
    purchase_token: Optional[str] = None   # Android
    transaction_id: Optional[str] = None   # iOS
    transaction_receipt: Optional[str] = None  # iOS


@api.get("/billing/entitlements")
async def my_entitlements(authorization: Optional[str] = Header(None)):
    user = await require_user(authorization)
    return {"entitlement": await get_entitlement(user["user_id"])}


@api.post("/billing/iap/verify")
async def iap_verify(body: IAPVerifyBody, authorization: Optional[str] = Header(None)):
    """
    Called by the mobile app after a successful in-app purchase.
    Verifies with Google Play or Apple, then fulfills the entitlement.
    Idempotent: duplicate purchase tokens/transaction IDs are ignored.
    """
    user = await require_user(authorization)

    if body.platform not in ("android", "ios"):
        raise HTTPException(status_code=400, detail="platform must be 'android' or 'ios'")

    entitlement_def = PRODUCT_ENTITLEMENTS.get(body.product_id)
    if not entitlement_def:
        raise HTTPException(status_code=400, detail=f"Unknown product: {body.product_id}")

    # Idempotency check
    dedup_key = body.purchase_token or body.transaction_id
    if not dedup_key:
        raise HTTPException(status_code=400, detail="purchase_token or transaction_id required")

    existing = await db.iap_purchases.find_one({"dedup_key": dedup_key})
    if existing:
        # Already fulfilled — return success without double-granting
        log.info("IAP duplicate: dedup_key=%s user=%s", dedup_key, user["user_id"])
        return {"ok": True, "fulfilled": False, "reason": "already_processed"}

    # Verify with the store
    verified = False
    if body.platform == "android":
        if not body.purchase_token:
            raise HTTPException(status_code=400, detail="purchase_token required for Android")
        verified = await verify_google_purchase(body.product_id, body.purchase_token)
    else:
        if not body.transaction_receipt:
            raise HTTPException(status_code=400, detail="transaction_receipt required for iOS")
        verified, verified_product_id = await verify_apple_purchase(body.transaction_receipt)
        # Sanity check: Apple returned product matches what the client claims
        if verified and verified_product_id and verified_product_id != body.product_id:
            log.warning(
                "IAP product mismatch: client=%s apple=%s user=%s",
                body.product_id, verified_product_id, user["user_id"]
            )
            verified = False

    if not verified:
        raise HTTPException(status_code=402, detail="Purchase verification failed")

    # Record before fulfilling (prevents race conditions)
    await db.iap_purchases.insert_one({
        "dedup_key": dedup_key,
        "user_id": user["user_id"],
        "platform": body.platform,
        "product_id": body.product_id,
        "transaction_id": body.transaction_id,
        "purchase_token": body.purchase_token,
        "fulfilled_at": now_utc(),
    })

    # Grant entitlement
    etype = entitlement_def["type"]
    if etype == "credit":
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$inc": {"coverage_credits": entitlement_def["amount"]}},
        )
    elif etype == "pro_days":
        ent = await get_entitlement(user["user_id"])
        base = now_utc()
        if ent["pro_until"]:
            cur = datetime.fromisoformat(ent["pro_until"])
            if ensure_aware(cur) > base:
                base = ensure_aware(cur)
        new_until = base + timedelta(days=entitlement_def["days"])
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {"$set": {"pro_until": new_until}},
        )

    log.info("IAP fulfilled: user=%s product=%s type=%s", user["user_id"], body.product_id, etype)
    return {"ok": True, "fulfilled": True}


@api.get("/")
async def root():
    return {"app": "scribe", "ok": True}


# ─── App setup ───────────────────────────────────────────────────────────────

app.include_router(api)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.projects.create_index([("user_id", 1), ("updated_at", -1)])
    for coll in ("characters", "scenes", "locations", "beats", "notes"):
        await db[coll].create_index([("project_id", 1), ("user_id", 1)])
    await db.iap_purchases.create_index("dedup_key", unique=True)
    await db.iap_purchases.create_index("user_id")
    log.info("Scribe API ready")


@app.on_event("shutdown")
async def shutdown():
    mongo_client.close()
