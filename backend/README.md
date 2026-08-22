# UNAI Flow: Production WhatsApp Channels API Gateway

A self-hosted, multi-tenant WhatsApp Channels API Gateway inspired by the developer experience and architecture of **Whapi.Cloud**.

Seamlessly integrated into the **UNAI Flow** social media automation dashboard alongside Facebook and Instagram.

---

## 🏗 Architecture Overview

```
                       +-----------------------------------+
                       |        Frontend Dashboard         |
                       |    (React / TypeScript / Vite)    |
                       +-----------------+-----------------+
                                         |
                       +-----------------v-----------------+
                       |         FastAPI Gateway           |
                       |      (/v1 API / JWT & Keys)       |
                       +--------+-----------------+--------+
                                |                 |
            +-------------------v---+         +---v--------------------+
            | Supabase Auth / JWT   |         | API Key Manager (Hash) |
            +-------------------+---+         +---+--------------------+
                                |                 |
                       +--------v-----------------v--------+
                       |        Connection Manager         |
                       |      & State Machine Engine       |
                       +--------+-----------------+--------+
                                |                 |
            +-------------------v---+         +---v--------------------+
            |   Supabase Postgres   |         |  Redis + Distributed   |
            | (RLS Multi-Tenancy)   |         |   Locking & Celery     |
            +-------------------+---+         +---+--------------------+
                                |                 |
                       +--------v-----------------v--------+
                       |      WhatsAppProvider Base        |
                       |   (Clean Adapter Abstraction)     |
                       +--------+-----------------+--------+
                                |                 |
            +-------------------v---+         +---v--------------------+
            | FakeWhatsAppProvider  |         | WhatsAppWebSession     |
            | (CI / Unit Tests)     |         | Provider (Playwright)  |
            +-----------------------+         +---+--------------------+
                                                  |
                                      +-----------v------------+
                                      |   WhatsApp Web / App   |
                                      |     Linked Devices     |
                                      +-----------+------------+
                                                  |
                                      +-----------v------------+
                                      |   WhatsApp Channels    |
                                      | (120363...@newsletter) |
                                      +------------------------+
```

---

## 🚀 Quick Start & Deployment

### 1. Environment Setup
Copy the example environment file and set your credentials:
```bash
cp .env.example .env
```

Key variables:
- `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`: Supabase Postgres connection.
- `SESSION_ENCRYPTION_KEY`: 32-byte secret for AES-256-GCM session vaulting.
- `API_KEY_PEPPER`: Secret pepper for HMAC-SHA256 API key hashing.
- `WCA_API_URL`: External WhatsApp Channel daemon (e.g. `https://unai-whatsapp-channelapi.onrender.com`).
- `REDIS_URL`: Redis broker for Celery publishing queue.

### 2. Database Migration
Run the SQL migration in your Supabase SQL Editor:
```sql
-- File: backend/migrations/02_whapi_gateway_schema.sql
```

### 3. Run with Docker Compose
```bash
docker-compose up -d --build
```
Services started:
- `api`: FastAPI Gateway on port `8000`.
- `worker`: Celery Background Publishing Worker.
- `redis`: Redis cache and message broker on port `6379`.

Interactive Swagger Documentation is available at:
`http://localhost:8000/docs`

---

## 🔑 Developer API Key Usage

Generate first-party API keys for programmatic publishing:

```bash
curl -X POST http://localhost:8000/v1/api-keys \
  -H "Authorization: Bearer <SUPABASE_JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Marketing Automation Bot",
    "scopes": ["instances:read", "channels:read", "messages:send"]
  }'
```

Response:
```json
{
  "id": "7b8e1f...",
  "name": "Marketing Automation Bot",
  "prefix": "wa_live_3f9a",
  "scopes": ["instances:read", "channels:read", "messages:send"],
  "raw_key": "wa_live_3f9a7b8c..."
}
```

---

## 📱 WhatsApp Linked-Device Connection Flow

### 1. Create Instance
```bash
curl -X POST http://localhost:8000/v1/instances \
  -H "Authorization: Bearer wa_live_xxxx" \
  -H "Content-Type: application/json" \
  -d '{"display_name": "Support Channel Gateway"}'
```

### 2. Start Connection & Get QR Code
```bash
# Start connection process
curl -X POST http://localhost:8000/v1/instances/<INSTANCE_ID>/connect \
  -H "Authorization: Bearer wa_live_xxxx"

# Fetch QR payload
curl -X GET http://localhost:8000/v1/instances/<INSTANCE_ID>/qr \
  -H "Authorization: Bearer wa_live_xxxx"
```

### 3. Discover Administered Channels
```bash
curl -X GET http://localhost:8000/v1/instances/<INSTANCE_ID>/channels \
  -H "Authorization: Bearer wa_live_xxxx"
```

Response:
```json
[
  {
    "id": "c1f...",
    "newsletter_jid": "120363171744447809@newsletter",
    "name": "Tech Announcements",
    "role": "admin",
    "subscribers_count": 5200,
    "verified": true
  }
]
```

---

## 📢 Publishing to WhatsApp Channels

### 1. Publish Text Broadcast
```bash
curl -X POST http://localhost:8000/v1/messages/text \
  -H "Authorization: Bearer wa_live_xxxx" \
  -H "Idempotency-Key: post_unique_req_101" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "120363171744447809@newsletter",
    "body": "🚀 Product Launch: UNAI Flow 2.0 is now live!"
  }'
```

### 2. Publish Image Broadcast
```bash
curl -X POST http://localhost:8000/v1/messages/image \
  -H "Authorization: Bearer wa_live_xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "120363171744447809@newsletter",
    "media_url": "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe",
    "caption": "Check out our latest update!"
  }'
```

### 3. Publish Interactive Poll
```bash
curl -X POST http://localhost:8000/v1/messages/poll \
  -H "Authorization: Bearer wa_live_xxxx" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "120363171744447809@newsletter",
    "question": "Which social integration should we add next?",
    "options": ["LinkedIn", "TikTok", "Pinterest", "Telegram"],
    "selectable_count": 1
  }'
```

---

## 🔔 Webhook Event Signatures

All outbound webhook events are signed with **HMAC-SHA256**:
- `X-Webhook-ID`: Unique event identifier (`evt_...`).
- `X-Webhook-Timestamp`: Unix timestamp of dispatch.
- `X-Webhook-Signature`: HMAC-SHA256 signature calculated over `${timestamp}.${payload}`.

Verify signatures in Node.js / Python:
```python
import hmac, hashlib
computed = hmac.new(secret.encode(), f"{timestamp}.{raw_body}".encode(), hashlib.sha256).hexdigest()
is_valid = hmac.compare_digest(computed, received_signature)
```

---

## 🧪 Testing

Run the automated test suite:
```bash
cd backend
python -m pytest tests/test_gateway.py
```
Outputs:
```
tests/test_gateway.py ..... [100%]
5 passed in 0.21s
```
