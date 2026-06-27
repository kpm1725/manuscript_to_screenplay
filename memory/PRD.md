# PRD — Scribe

## Vision
A premium mobile companion for novelists who want to adapt their manuscript into a screenplay. An on-device AI script doctor (Claude Sonnet 4.5) translates prose into industry-standard Fountain/Hollywood format, surrounded by a calm suite of organizational tools — character bible, scene board, locations, plot beats, and notes. Monetized via native IAP (Google Play Billing + Apple IAP).

## Personality
**"Editorial Mobile"** — serif typography (Cormorant Garamond), monospaced screenplay (Space Mono), warm off-white paper palette, muted rust accent. Inspired by Scrivener, Final Draft, and iA Writer.

## Features (v1)
1. **Google Sign-In** via `expo-auth-session`, verified server-side with Google tokeninfo. Secure session-token storage via expo-secure-store.
2. **Project Library** — list, create, and delete novel-to-script projects.
3. **Project Hub** — cinematic hero, fast nav to all tools.
4. **Manuscript Editor** — distraction-free serif text area with autosave.
5. **AI Conversion Agent** — bottom sheet powered by Claude Sonnet 4.5 that converts manuscript prose to Fountain-format screenplay. "Append to Script" pushes output into the screenplay document.
6. **Screenplay Editor** — monospaced editor with formatting shortcut chips and Share/Export.
7. **Character Bible** — name, role, description, arc, traits.
8. **Scene Board** — summary, location, characters, status.
9. **Locations** — INT/EXT/time-of-day defaults + description.
10. **Plot Timeline** — beats grouped by act.
11. **Notes & Research** — tagged free-form notes.
12. **Producer Coverage (PAID)** — Claude Sonnet 4.5 generates a structured studio coverage report (LOGLINE · SYNOPSIS · GENRE & COMPARABLES · CHARACTER ANALYSIS · STRENGTHS · WEAKNESSES · MARKET VERDICT). Color-coded verdict card, Share to producer/manager. **Free tier: 1 free report per user. Then native IAP paywall.**

## Monetization (Google Play Billing + Apple IAP)
- **Single Report:** 1 prepaid coverage credit — `scribe_coverage_single` (Android) / `com.scribeapp.scribe.coverage_single` (iOS)
- **30 Days Pro:** unlimited coverages for 30 days (extendable) — `scribe_pro_monthly` (Android) / `com.scribeapp.scribe.pro_monthly` (iOS)
- Prices set in Google Play Console and App Store Connect — never hardcoded in the app.
- Entitlement model in MongoDB: `users.free_coverage_used`, `users.coverage_credits`, `users.pro_until`
- Server-side receipt verification via `iap_verify.py` — Google Play Developer API + Apple verifyReceipt. Idempotent via `iap_purchases.dedup_key` unique index.

## Tech
- **Frontend:** Expo SDK 54 + expo-router, React Native, expo-auth-session, react-native-iap, expo-font, expo-secure-store.
- **Backend:** FastAPI + Motor + MongoDB (collections: users, user_sessions, projects, characters, scenes, locations, beats, notes, iap_purchases).
- **LLM:** Anthropic Python SDK (direct) → Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`) via `ANTHROPIC_API_KEY`.
- **Auth:** Google OAuth — expo-auth-session on device, Google tokeninfo endpoint server-side.
- **Payments:** react-native-iap (client) + iap_verify.py (server) — no third-party payment proxy.
