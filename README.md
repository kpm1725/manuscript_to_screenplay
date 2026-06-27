# Scribe

> A premium mobile companion for novelists who want to turn their manuscript into a screenplay.

Scribe is a full-stack Expo + FastAPI app that converts long-form prose into industry-standard **Fountain/Hollywood-format screenplays** using **Claude Sonnet 4.5**, wrapped in a calm "Editorial Mobile" workspace with a full suite of organizational tools — character bible, scene board, locations tracker, plot timeline, and notes & research.

Producer Coverage (a studio-grade AI script reader) is monetized via **Google Play Billing** (Android) and **Apple IAP** (iOS) with a 1-free-report-then-paywall model.

---

## Highlights

- **AI script doctor** — Claude Sonnet 4.5 converts manuscript paragraphs into properly formatted screenplays (sluglines, action, character cues, parentheticals, dialogue).
- **Producer Coverage report** — one tap generates a structured report: `LOGLINE · SYNOPSIS · GENRE & COMPARABLES · CHARACTER ANALYSIS · STRENGTHS · WEAKNESSES · MARKET VERDICT`. Share to producers/managers.
- **Native IAP paywall** — 1 free coverage per user, then a single report or 30-day Pro access. Prices are set in Google Play Console and App Store Connect and displayed directly from the store.
- **Google Sign-In** via `expo-auth-session` — verified server-side with Google's tokeninfo endpoint. No password storage.
- **Distraction-free editors** — serif (Cormorant Garamond) for prose, monospace (Space Mono) for screenplay, with autosave and Fountain shortcut chips.
- **Organizational suite** — Characters, Scenes, Locations, Plot Beats, Notes — all project-scoped.

---

## Tech Stack

| Layer | Stack |
|-------|-------|
| **Frontend** | Expo SDK 54 · React Native · expo-router · expo-auth-session · react-native-iap · expo-font · expo-secure-store |
| **Backend** | FastAPI · Motor (async MongoDB) · Pydantic v2 |
| **Database** | MongoDB (Atlas or self-hosted) |
| **LLM** | Claude Sonnet 4.5 via Anthropic Python SDK (direct) |
| **Payments** | Google Play Billing + Apple IAP via `react-native-iap` (server-side receipt verification) |
| **Auth** | Google OAuth — `expo-auth-session` on device, `tokeninfo` verification on server |

---

## Project Structure

```
.
├── backend/
│   ├── server.py            # FastAPI app: auth, projects, CRUD, AI convert, coverage, IAP billing
│   ├── iap_verify.py        # Google Play + Apple receipt verification
│   ├── requirements.txt
│   ├── .env.example
│   └── tests/
├── frontend/
│   ├── app/
│   │   ├── _layout.tsx
│   │   ├── index.tsx
│   │   ├── login.tsx
│   │   ├── library.tsx
│   │   └── project/[id]/
│   │       ├── index.tsx
│   │       ├── manuscript.tsx
│   │       ├── screenplay.tsx
│   │       ├── characters.tsx
│   │       ├── scenes.tsx
│   │       ├── locations.tsx
│   │       ├── beats.tsx
│   │       ├── notes.tsx
│   │       └── coverage.tsx    # Producer Coverage + IAP paywall
│   ├── src/
│   │   ├── api/client.ts
│   │   ├── context/AuthContext.tsx
│   │   ├── hooks/
│   │   │   ├── use-app-fonts.ts
│   │   │   └── use-iap.ts      # react-native-iap wrapper
│   │   ├── components/
│   │   ├── theme.ts
│   │   └── utils/
│   ├── assets/fonts/           # Bundled local fonts (see SETUP.md)
│   ├── app.json
│   ├── eas.json
│   └── package.json
├── SETUP.md                    # Full self-hosting + store submission guide
└── README.md
```

---

## Getting Started

See **[SETUP.md](./SETUP.md)** for the full guide including Google OAuth, IAP product creation, backend deployment, and EAS store submission.

### Quick local run

```bash
# Backend
cd backend
pip install -r requirements.txt
cp .env.example .env        # fill in your values
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# Frontend
cd frontend
yarn install
cp .env.example .env        # fill in your values
yarn expo start
```

---

## API Surface

All routes prefixed with `/api`. Most require `Authorization: Bearer <session_token>`.

### Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/google` | Exchange a Google ID token for a Scribe session token |
| `GET` | `/api/auth/me` | Return the current user |
| `POST` | `/api/auth/logout` | Invalidate the session |

### Projects & Child Resources

| Method | Endpoint |
|--------|----------|
| `GET / POST` | `/api/projects` |
| `GET / PATCH / DELETE` | `/api/projects/{pid}` |
| `GET / POST` | `/api/projects/{pid}/{characters\|scenes\|locations\|beats\|notes}` |
| `PATCH / DELETE` | `/api/projects/{pid}/{resource}/{id}` |

### AI

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/projects/{pid}/convert_sync` | Convert prose → screenplay (blocking) |
| `POST` | `/api/projects/{pid}/convert` | Same, streamed as Server-Sent Events |
| `POST` | `/api/projects/{pid}/coverage` | Generate Producer Coverage (paywalled) |
| `GET` | `/api/projects/{pid}/coverage` | Fetch latest coverage report |

### Billing

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/billing/entitlements` | User's current entitlement status |
| `POST` | `/api/billing/iap/verify` | Verify store receipt + grant entitlement |

---

## Monetization Model

Producer Coverage uses an entitlement stored on the user document:

| Field | Meaning |
|-------|---------|
| `free_coverage_used: bool` | Has the user consumed their 1 free report? |
| `coverage_credits: int` | Prepaid one-shot coverage credits |
| `pro_until: datetime?` | Pro unlimited access expiry |

The `consume_entitlement_or_402` helper debits in priority order: **pro → credits → free → 402**. The 402 response triggers the native IAP paywall sheet in the app.

### IAP Products

| Platform | Product ID | Grants |
|----------|-----------|--------|
| Android | `scribe_coverage_single` | +1 coverage credit |
| Android | `scribe_pro_monthly` | +30 days Pro |
| iOS | `com.scribeapp.scribe.coverage_single` | +1 coverage credit |
| iOS | `com.scribeapp.scribe.pro_monthly` | +30 days Pro |

Prices are set in Google Play Console and App Store Connect — never hardcoded in the app.

Receipt verification is server-side only (`iap_verify.py`) so purchases cannot be faked client-side.

---

## Design Language

**"Editorial Mobile"** — inspired by Scrivener, Final Draft, and iA Writer.

- **Palette**: warm off-white paper (`#F7F5F0`) + ink (`#1A1918`) with a muted rust accent (`#8A3E31`).
- **Typography**: Cormorant Garamond (serif body), Space Mono (screenplay output), Inter (UI).

---

## Testing

```bash
cd backend
pytest -v
```

---

## Roadmap

- [ ] Profile screen surfacing Pro status & remaining credits
- [ ] PDF export of the coverage report
- [ ] Beat/scene drag-to-reorder
- [ ] Multi-character export to `.fdx` (Final Draft) format
- [ ] Collaborative editing (writer + co-writer)
- [ ] Annotation layer on AI-generated screenplay sections

---

## License

Private project. All rights reserved.

---

## Built With

- [Anthropic Claude Sonnet 4.5](https://www.anthropic.com)
- [Expo](https://expo.dev) + [FastAPI](https://fastapi.tiangolo.com) + [MongoDB](https://mongodb.com)
- [react-native-iap](https://react-native-iap.dooboolab.com)
