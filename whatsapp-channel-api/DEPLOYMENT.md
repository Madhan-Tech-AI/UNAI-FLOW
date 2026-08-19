# WhatsApp Channel API — Python Cloud Deployment Guide (No Docker)

This service is built in **Python (FastAPI + Playwright)**. You can deploy it to **Render** as a standard Python Web Service with **zero Docker**.

---

## 🚀 How to Deploy on Render as a Python Web Service

1. Go to **[dashboard.render.com](https://dashboard.render.com)**.
2. Click **New +** → **Web Service**.
3. Connect your GitHub repository (`UNAI-FLOW`).
4. Configure the service settings:
   - **Name**: `unai-whatsapp-channel-api`
   - **Region**: Same region as your main backend *(e.g., Singapore, Oregon, Frankfurt)*
   - **Root Directory**: `whatsapp-channel-api`
   - **Runtime**: **`Python 3`** *(NOT Docker)*
   - **Build Command**:
     ```bash
     pip install -r requirements.txt && playwright install chromium
     ```
   - **Start Command**:
     ```bash
     uvicorn main:app --host 0.0.0.0 --port $PORT
     ```
   - **Instance Type**: **Starter** *(Recommended for headless browser operations)*

5. Under **Environment Variables**, add:
   | Key | Value |
   | :--- | :--- |
   | `WCA_API_KEY` | `105eadef-beae-4e08-bcc0-85a06ff80727` |
   | `WCA_CHANNEL_LINK` | `https://whatsapp.com/channel/0029VbDxqHz6hENhNBcZM31M` |
   | `WCA_CHANNEL_ID` | `0029VbDxqHz6hENhNBcZM31M` |

6. Click **Create Web Service**.

Once deployed, Render gives you a public HTTPS URL:
```
https://unai-whatsapp-channel-api.onrender.com
```

---

## 🔗 Connect to your Main UNAI Flow Backend

In your main backend on Render (or `backend/.env`), set:

```env
WCA_API_URL=https://unai-whatsapp-channel-api.onrender.com
WCA_API_KEY=105eadef-beae-4e08-bcc0-85a06ff80727
```

---

## 📱 How to Pair with WhatsApp

1. Open your deployed URL (`https://unai-whatsapp-channel-api.onrender.com/`) in your browser (or open the **Connections** page in your UNAI Flow dashboard).
2. Scan the live QR code with **WhatsApp on your phone** (`Settings / ⋮ Menu → Linked Devices → Link a Device`).
3. The session connects and turns green automatically.
4. All future posts published from UNAI Flow will publish live to your WhatsApp Channel!
