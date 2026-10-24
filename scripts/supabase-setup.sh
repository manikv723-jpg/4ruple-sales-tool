#!/bin/sh
# One-time setup of the 4ruple licence service in Supabase: tables, functions and secrets.
#
# Before running, once:
#   npx --yes supabase@latest login        (opens a browser and stores your token)
#   create a project at https://supabase.com/dashboard (Mumbai region), then copy its project ref
#     (the xxxx in https://xxxx.supabase.co)
#
# Then:
#   ./scripts/supabase-setup.sh <project-ref>
#
# Nothing secret is printed. The values you need for Vercel are written to
# .license-keys/vercel-env.txt, which is git-ignored and readable only by you.
set -e

REF="$1"
if [ -z "$REF" ]; then
  echo "Usage: $0 <project-ref>"
  exit 1
fi

cd "$(dirname "$0")/.."
SUPA="npx --yes supabase@latest"

if [ ! -f .license-keys/signing-private.jwk.json ]; then
  echo "Missing .license-keys/signing-private.jwk.json. Run: npm run keygen"
  exit 1
fi

echo "1/5 linking the project"
$SUPA link --project-ref "$REF"

echo "2/5 creating the tables"
$SUPA db push

echo "3/5 setting the secrets"
ADMIN_TOKEN="$(openssl rand -hex 32)"
$SUPA secrets set \
  LICENSE_SIGNING_JWK="$(cat .license-keys/signing-private.jwk.json)" \
  LICENSE_ADMIN_TOKEN="$ADMIN_TOKEN" \
  LICENSE_MIN_PAISE=200000 >/dev/null
echo "   done (values not printed)"

echo "4/5 deploying the functions"
$SUPA functions deploy license
$SUPA functions deploy issue-license
$SUPA functions deploy team

echo "5/5 checking the licence service answers"
LICENSE_URL="https://$REF.supabase.co/functions/v1/license"
ANSWER=$(curl -s --max-time 20 -X POST "$LICENSE_URL" \
  -H 'Content-Type: application/json' \
  -d '{"action":"devices","key":"4R-AAAAA-BBBBB-CCCCC-DDDDD"}')
echo "   $ANSWER"
case "$ANSWER" in
  *INVALID_KEY*) echo "   the service is live (it refused a made-up key, which is correct)" ;;
  *) echo "   unexpected answer, check the function logs in the Supabase dashboard" ;;
esac

umask 077
mkdir -p .license-keys
cat > .license-keys/vercel-env.txt <<ENV
Paste these into Vercel (project basement-protocol), as Production variables, then redeploy:

FOURUPLE_LICENSE_API=$LICENSE_URL
FOURUPLE_ISSUE_URL=https://$REF.supabase.co/functions/v1/issue-license
FOURUPLE_ADMIN_TOKEN=$ADMIN_TOKEN
RAZORPAY_WEBHOOK_SECRET=<make one with: openssl rand -hex 32, and paste the same value into the Razorpay webhook>

Then in Razorpay (Account & Settings, Webhooks), add:
  URL     https://basementprotocol.com/api/4ruple/razorpay-webhook
  Secret  the RAZORPAY_WEBHOOK_SECRET above
  Events  payment.captured, order.paid, refund.processed

Email (so keys actually reach buyers), after verifying basementprotocol.com in Resend:
  npx --yes supabase@latest secrets set RESEND_API_KEY=... LICENSE_EMAIL_FROM="4ruple.ai <licenses@basementprotocol.com>" LICENSE_REPLY_TO=...

Issue a key by hand (for a sale already made):
  FOURUPLE_ISSUE_URL=https://$REF.supabase.co/functions/v1/issue-license \\
  FOURUPLE_ADMIN_TOKEN=$ADMIN_TOKEN \\
  node scripts/issue-license.mjs buyer@example.com "razorpay:pay_xxxxx"
ENV
chmod 600 .license-keys/vercel-env.txt

echo
echo "Done. Open .license-keys/vercel-env.txt for the values to paste into Vercel and Razorpay."
echo "Keep .license-keys backed up: it signs every licence."
