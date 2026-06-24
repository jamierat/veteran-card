# Bullfrog Salutes - Veterans Program

Apple Wallet card for veterans and military. Two perks, one card:

- **Military discount on every visit** (set the % yourself, default 10% OFF)
- **One free pint per calendar month**, scanned and tracked so it can't be reused

Built on the exact same rails as the Lunch Punchcard: Node/Express, SQLite, real
signed `.pkpass`, live pass updates, deployed on Railway. It reuses the **same Apple
signing certificate**, so there is no new Apple Developer setup to get passes working.

---

## How it works

```
Veteran signs up on /register.html → gets Apple Wallet card (QR + ID code)
        ↓
First visit: shows military ID / VA card / DD-214 → staff taps VERIFY
        ↓  (discount + free monthly pint now switched on)
Every visit: staff scans the QR → screen shows "VERIFIED VETERAN, apply 10% off"
        ↓
Once a month: that screen shows a green FREE PINT button → staff taps it
        ↓
Same month again: button is gone, screen says "back July 1" - no double-dipping
```

The free pint resets on the 1st of each month, anchored to Florida time
(`BREWERY_TZ`). A unique database index makes a second pint in the same month
impossible, even on a double-tap.

---

## What's done vs what you need to do

**Done and tested:**
- Full backend, staff page, signup page, member card page
- Monthly-pint logic (verified by test: fresh vet = eligible, used-this-month = blocked)
- Real signed `.pkpass` (verified against your Apple certs - signature checks out)
- Reuses your existing cert + Pass Type ID

**You need to do (about 30 min):**
1. Pick the real discount number (see `MILITARY_DISCOUNT_LABEL` below)
2. Decide how staff verifies service (default: check ID once at the bar)
3. Deploy it (steps below)
4. Optional: drop your saluting-frog art in (see Branding)

---

## Quick start (local test)

```bash
npm install
cp .env.example .env       # then edit .env - set STAFF_CODE and your discount
node setup.js              # fills in any missing pass images
npm start
```

- Sign up: http://localhost:3000/register.html
- Staff:   http://localhost:3000/staff.html

---

## Config (.env)

| Key | What it does |
|-----|--------------|
| `STAFF_CODE` | PIN staff type to verify vets and redeem pints. **Change it.** |
| `MILITARY_DISCOUNT_LABEL` | The discount shown on the card + staff screen, e.g. `15% OFF`. |
| `BREWERY_TZ` | Timezone the monthly reset is anchored to. Default `America/New_York`. |
| `TEAM_ID` / `PASS_TYPE_ID` | Already set - same Apple cert as the lunch card. |
| `WEB_SERVICE_URL` | Your live HTTPS URL. Set it so cards auto-update after verify/redeem. |
| `APN_PRODUCTION` | `true` for live push updates. |

---

## Deploy (Railway - same as the lunch card)

```bash
npm i -g @railway/cli
railway login
railway init
railway up
```

Then in the Railway dashboard:
1. Add a **persistent volume** mounted at `/data`, and set `DATA_DIR=/data` (keeps your member list between deploys)
2. Set the env vars from your `.env`
3. For Apple Wallet signing on Railway, paste base64 of your three certs as
   `SIGNER_CERT_B64`, `SIGNER_KEY_B64`, `WWDR_CERT_B64` (the `certs/` files don't deploy - they're gitignored)
4. Set `BASE_URL` and `WEB_SERVICE_URL` to your Railway domain

Make a base64 cert string:
```bash
base64 -i certs/signerCert.pem | tr -d '\n'   # repeat for signerKey.pem, wwdr.pem
```

---

## Branding

- **Logo:** the cream Bullfrog Creek wordmark (`pass-images/logo.png` / `logo@2x.png`),
  also used on the sign-up and member pages (`brand-logo.png`).
- **Frog:** the camo "Army Frog" sticker, cut out and used as the card thumbnail
  (`pass-images/thumbnail.png` 90x90, `thumbnail@2x.png` 180x180).
- **Top of card:** STATUS (VETERAN) + ID CODE, mirroring the lunch card header.
- **Colors:** olive drab background + field-tan labels, in `pass-generator.js` →
  `backgroundColor` / `labelColor`.

To swap the frog later (e.g. the saluting-uniform frog), just replace those two
`thumbnail` PNGs with square images at the same sizes.

---

## Print a sign-up QR for the bar

Once it's live, make a QR code pointing at `https://yourdomain.com/register.html`
and put it on a table tent or by the taps. Vets scan, sign up in 20 seconds, done.

---

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/register | New member |
| GET  | /api/pass/:id/download | Download .pkpass |
| GET  | /api/member/:id | Member status (JSON) |
| GET  | /api/lookup?id= or ?code= | Staff lookup |
| POST | /api/verify | Verify a vet (staff code required) |
| POST | /api/redeem-pint | Redeem the monthly pint (staff code required) |
| GET  | /api/admin/members?staffCode= | List members |
| GET  | /api/admin/export/emails?staffCode= | Email list CSV |

Plus the Apple Wallet web-service routes (`/v1/...`) for live pass updates.

---

## Notes

- This is a sibling app to `bullfrog-punchcard`. Separate database (`salutes.db`),
  separate deploy, separate QR codes. It just shares the Apple cert.
- A veteran can hold both the lunch card and the salutes card with no conflict.
