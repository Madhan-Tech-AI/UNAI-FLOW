# UNAI Email Gateway — Deployment Guide

`unai-email-gateway` is your own dedicated, self-hosted email microservice. It receives email requests via authenticated HTTPS and delivers them to recipient inboxes.

---

## 1. Quick Deploy to Railway (Recommended - No Port Blocks!)

Railway is the easiest cloud platform to host mail relays because outbound network traffic is **not blocked**.

1. Go to [railway.app](https://railway.app) and click **New Project** → **Deploy from GitHub repo**.
2. Select your repository and set the **Root Directory** to `email-gateway-api`.
3. In **Variables**, add:
   ```env
   PORT=3002
   EMAIL_GATEWAY_API_KEY=unai_email_sec_8a7d32f91bc4028e
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_USER=madhankumar070406@gmail.com
   SMTP_PASS=itiohbtfrmdeoizw
   SMTP_SECURE=false
   EMAIL_FROM_EMAIL=madhankumar070406@gmail.com
   EMAIL_FROM_NAME=UNAI Flow
   ```
4. Click **Generate Domain** (e.g. `https://unai-email-gateway-production.up.railway.app`).
5. Copy your domain and set it in your **UNAI Flow Backend (Render)**:
   ```env
   EMAIL_PROVIDER=unai_gateway
   EMAIL_GATEWAY_URL=https://unai-email-gateway-production.up.railway.app
   EMAIL_GATEWAY_API_KEY=unai_email_sec_8a7d32f91bc4028e
   ```

---

## 2. Deploy to Render (Web Service)

You can also deploy it as a separate Web Service on Render:
1. Render Dashboard → **New Web Service** → Connect your GitHub repo.
2. Set:
   - **Root Directory**: `email-gateway-api`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
3. Add the same Environment Variables listed above.

---

## 3. Local Development

```bash
cd email-gateway-api
npm install
npm run dev
```

Test health:
```bash
curl http://localhost:3002/health
```

Test send:
```bash
curl -X POST http://localhost:3002/v1/email/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: unai_email_sec_8a7d32f91bc4028e" \
  -d '{
    "to": "your-email@example.com",
    "subject": "Hello from my self-hosted Email Gateway",
    "html": "<h1>It works!</h1><p>Sent from my own UNAI Email Gateway.</p>"
  }'
```
