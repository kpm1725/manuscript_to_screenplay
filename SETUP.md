# Scribe — Self-Hosted Setup Guide

## Overview

Fully self-hosted. No Stripe. Payments go through Google Play Billing (Android) and Apple IAP (iOS) — both required by store policy for in-app digital purchases.

---

## 1. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create or select a project
3. Enable the **Google People API**
4. Create three **OAuth 2.0 Client IDs**:
   - **Web application** (used for Expo Go + web)
     - Authorized redirect URIs: `https://auth.expo.io/@YOUR_EXPO_USERNAME/scribe`
   - **iOS** → Bundle ID: `com.scribeapp.scribe`
   - **Android** → Package: `com.scribeapp.scribe` + your debug/release SHA-1 fingerprint
     - Get SHA-1: `cd android && ./gradlew signingReport`
5. Paste all three IDs into `frontend/.env`

---

## 2. Backend Environment

Copy `backend/.env.example` → `backend/.env` and fill in:

```env
MONGO_URL=mongodb+srv://user:pass@cluster.mongodb.net   # Atlas free tier works
DB_NAME=scribe_database
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com        # Web client ID

# IAP verification (see sections 4 + 5 below)
GOOGLE_SERVICE_ACCOUNT_JSON=/app/service-account.json
ANDROID_PACKAGE_NAME=com.scribeapp.scribe
APPLE_SHARED_SECRET=abc123...
```

---

## 3. Backend Deployment

```bash
cd backend
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload   # local
```

**Production options (pick one):**

| Platform | How |
|----------|-----|
| Railway | Connect GitHub repo → add env vars → deploy |
| Render | Web Service, Python, start: `uvicorn server:app --host 0.0.0.0 --port $PORT` |
| Fly.io | `fly launch` + `fly secrets set KEY=val ...` |
| VPS | Docker or systemd + nginx reverse proxy |

MongoDB: use [Atlas free tier](https://cloud.mongodb.com) or self-host.

---

## 4. Google Play IAP Setup

### Create in-app products in Google Play Console:
1. Go to **Monetize → In-app products → Managed products**
2. Create two products with exactly these IDs:
   - `scribe_coverage_single` — Single Coverage Report (set your price)
   - `scribe_pro_monthly` — 30 Days Pro Access (set your price)
3. Activate both products

### Google Play Developer API (for server-side receipt verification):
1. Go to [Google Play Console → Setup → API access](https://play.google.com/console/developers/api-access)
2. Link to a Google Cloud project
3. Create a **Service Account** with role: **Financial data viewer**
4. Download the JSON key → save as `service-account.json`
5. Set `GOOGLE_SERVICE_ACCOUNT_JSON=/path/to/service-account.json` in backend `.env`

---

## 5. Apple IAP Setup

### Create in-app purchases in App Store Connect:
1. Go to **Your App → In-App Purchases → Create**
2. Create two **Non-Consumable** products:
   - `com.scribeapp.scribe.coverage_single` — Single Coverage Report
   - `com.scribeapp.scribe.pro_monthly` — 30 Days Pro Access
3. Fill in display names, pricing, and screenshots for each
4. Submit for review (required before products are purchasable)

### App-Specific Shared Secret (for receipt verification):
1. In App Store Connect → **Your App → General → App Information**
2. Scroll to **App-Specific Shared Secret** → Generate
3. Set `APPLE_SHARED_SECRET=...` in backend `.env`

---

## 6. Font Assets

Download and place in `frontend/assets/fonts/`:

| File | Source |
|------|--------|
| `CormorantGaramond-Regular.ttf` | [Google Fonts — Cormorant Garamond](https://fonts.google.com/specimen/Cormorant+Garamond) |
| `CormorantGaramond-Bold.ttf` | Same (download all weights, pick Bold) |
| `Inter-Regular.ttf` | [Google Fonts — Inter](https://fonts.google.com/specimen/Inter) |
| `Inter-Medium.ttf` | Same |
| `Inter-Bold.ttf` | Same |

`SpaceMono-Regular.ttf` is already included.

---

## 7. Frontend Environment

Copy `frontend/.env.example` → `frontend/.env`:

```env
EXPO_PUBLIC_BACKEND_URL=https://your-api-host.com
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=xxxx.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=xxxx.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=xxxx.apps.googleusercontent.com
```

---

## 8. EAS Build & Store Submission

```bash
npm install -g eas-cli
cd frontend
eas login
eas init                    # generates your EAS project ID
```

Paste the project ID into `app.json` → `extra.eas.projectId`.

**Build:**
```bash
eas build --platform android --profile preview   # APK for internal testing
eas build --platform all --profile production    # Store builds (AAB + IPA)
```

**Submit:**
```bash
eas submit --platform android --profile production
eas submit --platform ios --profile production
```

---

## 9. Store Submission Checklist

**Both stores require:**
- [ ] Privacy policy URL — generate at [privacypolicygenerator.info](https://privacypolicygenerator.info)
- [ ] App icon (already in `assets/images/icon.png`)
- [ ] Screenshots: 6.7" iPhone + Pixel 8 (minimum)
- [ ] Short description + full description

**Google Play:**
- [ ] Developer account ($25 one-time fee)
- [ ] `google-service-account.json` for EAS automated submit
- [ ] App signed with upload key (EAS manages this)
- [ ] Data safety form filled (declare: Google account sign-in, purchase history)

**Apple App Store:**
- [ ] Developer account ($99/year)
- [ ] Apple ID, App Store Connect App ID, Team ID in `eas.json`
- [ ] IAP products approved before submitting the app
- [ ] Export compliance (No encryption beyond standard HTTPS → answer No)

---

## 10. IAP Testing

**Android:** Use [Google Play's license testing](https://developer.android.com/google/play/billing/test) — add test accounts in Play Console → License testing. Test purchases are free and don't charge.

**iOS:** Create [Sandbox Tester accounts](https://developer.apple.com/documentation/storekit/original_api_for_in-app_purchase/testing_in-app_purchases_with_sandbox) in App Store Connect. Use those Apple IDs on a real device running a TestFlight or debug build.

**Dev bypass:** If `GOOGLE_SERVICE_ACCOUNT_JSON` or `APPLE_SHARED_SECRET` are not set, the backend logs a warning and approves the purchase — safe for local development, never deploy to production without these set.

