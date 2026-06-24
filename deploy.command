#!/bin/bash
# Double-click this file to push the latest changes live to Railway.
cd "$(dirname "$0")" || exit 1
echo "Deploying Bullfrog Salutes..."
rm -f .git/index.lock .git/refs/heads/*.lock .git/HEAD.lock 2>/dev/null
git add -A
git commit -m "Update Bullfrog Salutes site" || echo "(nothing new to commit)"
git push origin HEAD:main
echo ""
echo "Pushed. Railway will redeploy in about a minute."
echo "Live at: https://veteran-card-production.up.railway.app"
read -p "Press Enter to close this window."
