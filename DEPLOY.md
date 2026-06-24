# Deploy Bullfrog Salutes to Railway (via GitHub)

Same flow as your lunch card: push to GitHub, deploy from the repo. About 5 minutes.

Repo: https://github.com/jamierat/veteran-card

## 1. Push the code to GitHub
The remote is already set. Run on your Mac:
```bash
cd ~/Library/CloudStorage/Dropbox/COWORK/"01 - Bullfrog Creek Brewing"/Operations/bullfrog-salutes
git push -u origin master:main
```
Refresh the repo on github.com and confirm the files are there.

## 2. Create the Railway project from the repo
- Railway dashboard: **New Project > Deploy from GitHub repo > jamierat/veteran-card**
- It builds automatically (Nixpacks, `node server.js` from `railway.toml`)

## 3. Add a disk so member data survives deploys
In the Railway dashboard for this service:
- **Settings > Volumes > New Volume**, mount path `/data`

## 4. Paste the environment variables
- Open `railway-env.txt` in this folder (it has your certs already base64-encoded)
- In Railway: **Variables > Raw Editor**, paste the whole block
- Change `STAFF_CODE=CHANGE_ME` to your real staff PIN
- Confirm `MILITARY_DISCOUNT_LABEL` is your real discount (default 10% OFF)

## 5. Get your domain, then point the app at itself
- Railway: **Settings > Networking > Generate Domain**
- Copy that URL (e.g. `https://bullfrog-salutes-production.up.railway.app`)
- Back in **Variables**, set both:
  - `BASE_URL=` that URL
  - `WEB_SERVICE_URL=` that same URL
- Railway redeploys automatically.

## 6. Test it
- Visit `https://YOURDOMAIN/register.html` on your iPhone, sign up, Add to Apple Wallet
- Open `https://YOURDOMAIN/staff.html`, sign in with your staff PIN, scan the pass
- Tap Verify, then Redeem Free Pint. Try redeeming again — it should block until next month.

## 7. Print a sign-up QR for the bar
Make a QR pointing at `https://YOURDOMAIN/register.html` and put it by the taps.

---

### Notes
- `railway-env.txt` holds your signing key (base64). It's gitignored. Don't share it or commit it.
- This is a separate project from the lunch card. Different database, different domain, same Apple cert.
- If `railway` isn't installed: `npm i -g @railway/cli`
