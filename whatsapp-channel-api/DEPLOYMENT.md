# WhatsApp Channel API — Cloud Deployment Guide

This service allows your UNAI Flow Dashboard to publish posts directly to your WhatsApp Channel without any paid 3rd-party services.

---

## 🚀 Option 1: Deploy to Render (Recommended)

1. Go to **[dashboard.render.com](https://dashboard.render.com)**.
2. Click **New +** → **Web Service**.
3. Select your GitHub repository (`UNAI-FLOW`).
4. Set the following settings:
   - **Name**: `unai-whatsapp-channel-api`
   - **Root Directory**: `whatsapp-channel-api`
   - **Language / Runtime**: `Docker`
   - **Region**: Choose the closest region (e.g., Singapore, Frankfurt, Oregon)
   - **Instance Type**: `Starter` (Recommended: 512MB RAM for headless Chromium)
5. Under **Environment Variables**, add:
   - `WCA_API_KEY`: `105eadef-beae-4e08-bcc0-85a06ff80727`
   - `WCA_CHANNEL_LINK`: `https://whatsapp.com/channel/0029VbDxqHz6hENhNBcZM31M`
6. Click **Create Web Service**.

Once deployed, Render will provide a public HTTPS URL (e.g. `https://unai-whatsapp-channel-api.onrender.com`).

---

## 🚀 Option 2: Deploy to Railway

1. Go to **[railway.app](https://railway.app)** → **New Project** → **Deploy from GitHub repo**.
2. Select your repository.
3. In settings, set **Root Directory** to `/whatsapp-channel-api`.
4. Railway will automatically build using the included `Dockerfile`.
5. Under **Variables**, add:
   - `WCA_API_KEY`: `105eadef-beae-4e08-bcc0-85a06ff80727`
   - `WCA_CHANNEL_LINK`: `https://whatsapp.com/channel/0029VbDxqHz6hENhNBcZM31M`
6. In **Networking**, click **Generate Domain** to get a public HTTPS URL.

---

## 📱 How to Pair with WhatsApp Once Deployed

1. Open your deployed cloud URL in your browser:
   ```
   https://your-deployed-service.onrender.com/
   ```
2. The interactive dashboard will load with a live QR code.
3. Open **WhatsApp** on your phone → **Linked Devices** → **Link a Device**.
4. Scan the QR code on your screen.
5. The dashboard will automatically turn **GREEN** ("✅ Connected & Ready").
6. You can even use the built-in **Live Test Publisher** on that page to send an instant test post to your WhatsApp Channel!

---

## 🔗 Connect to your UNAI Flow Backend

In your main backend (e.g., your Python backend on Render or `backend/.env`), update:

```env
WCA_API_URL=https://your-deployed-service.onrender.com
WCA_API_KEY=105eadef-beae-4e08-bcc0-85a06ff80727
```

Now, whenever you publish from your UNAI Flow Dashboard:
- **Instagram** publishes via Meta Graph API ✅
- **Facebook** publishes via Meta Graph API ✅
- **WhatsApp** publishes to your Channel via your cloud API ✅
