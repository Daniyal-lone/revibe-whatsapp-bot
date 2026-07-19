# Render Environment Variables

Add these in Render after the GitHub repo is connected.

Do not commit these values to GitHub.

```text
NODE_ENV=production
PUBLIC_BASE_URL=https://YOUR-RENDER-APP.onrender.com
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.ulpcjbbqjinchnxsbdjj.supabase.co:5432/postgres
SUPABASE_URL=https://ulpcjbbqjinchnxsbdjj.supabase.co
SUPABASE_SERVICE_ROLE_KEY=PASTE_SERVICE_ROLE_KEY_HERE
JWT_SECRET=GENERATE_A_LONG_RANDOM_SECRET
STAFF_PIN=4556
OWNER_PIN=8552
DEVELOPER_PIN=9097
ENABLE_INLINE_AUTOMATION=true
WHATSAPP_ENABLED=true
WHATSAPP_PHONE_NUMBER_ID=1147624408445209
WHATSAPP_ACCESS_TOKEN=PASTE_WHATSAPP_TOKEN_HERE
WHATSAPP_API_VERSION=v23.0
BUSINESS_WHATSAPP_NUMBER=+919797550647
DEVELOPER_ALERT_WEBHOOK_URL=
```

After the first Render deploy creates the app URL, update `PUBLIC_BASE_URL` to that exact URL and redeploy.

Receipt images are sent to WhatsApp using:

```text
PUBLIC_BASE_URL + /receipts/<receipt-number>.png
```

So `PUBLIC_BASE_URL` must be public HTTPS.
