# UNAI Flow — Master Product & Engineering Documentation

**Product:** UNAI Flow — a single-input social automation engine (Zapier/Make.com-style) that takes one piece of content and intelligently distributes customized versions of it across WhatsApp Community, Instagram, and Twitter/X.

**Prepared for:** UNAI Tech
**Stack:** React (frontend) · Python/FastAPI (backend) · Supabase (auth + database + storage + realtime) · Antigravity + Claude Code (build tooling)
**Design system:** White background, blue text/accents
**Doc versioning:** v0 (MVP proof-of-concept) → v1 (production-ready core) → v2 (scale + intelligence)

---

## 1. Product Vision

A user writes **one piece of content once**. UNAI Flow then:

1. Authenticates the user and connects their social accounts (WhatsApp Community, Instagram, Twitter/X).
2. Takes the single input (text, optional media).
3. Runs it through a **Customization Engine** that rewrites/reshapes the content per platform — character limits, tone, hashtags/taglines, mentions, line breaks, media specs.
4. Lets the user preview each platform's version before publishing.
5. Publishes immediately or schedules, then logs delivery status, errors, and analytics per platform.

The core value proposition: **"Write once. UNAI Flow makes it native everywhere."**

---

## 2. High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                            CLIENT (React)                            │
│  Auth Pages · Dashboard · Composer · Platform Previews · Automation  │
│  History · Connections Manager · Settings                            │
└───────────────────────────┬───────────────────────────────────────────┘
                             │ REST/WebSocket (HTTPS)
┌───────────────────────────▼───────────────────────────────────────────┐
│                     BACKEND (Python / FastAPI)                       │
│  ┌───────────────┐ ┌────────────────────┐ ┌────────────────────────┐ │
│  │ Auth Service   │ │ Customization      │ │ Publishing Orchestrator│ │
│  │ (Supabase JWT) │ │ Engine (LLM-based) │ │ (platform adapters)    │ │
│  └───────────────┘ └────────────────────┘ └────────────────────────┘ │
│  ┌───────────────┐ ┌────────────────────┐ ┌────────────────────────┐ │
│  │ Scheduler /    │ │ Webhook Listener   │ │ Analytics & Logging     │ │
│  │ Job Queue      │ │ (delivery status)  │ │ Service                │ │
│  └───────────────┘ └────────────────────┘ └────────────────────────┘ │
└───────────────────────────┬───────────────────────────────────────────┘
                             │
┌───────────────────────────▼───────────────────────────────────────────┐
│                          SUPABASE                                     │
│  Postgres (all tables) · Auth (users, OAuth) · Storage (media)       │
│  Realtime (job status push) · Row Level Security                     │
└───────────────────────────┬───────────────────────────────────────────┘
                             │
┌───────────────────────────▼───────────────────────────────────────────┐
│                    EXTERNAL PLATFORM APIs                             │
│  WhatsApp Business/Community API · Instagram Graph API · X API v2    │
└─────────────────────────────────────────────────────────────────────┘
```

**Why this shape:** the backend never talks to platform APIs directly from the frontend (keeps tokens server-side and secret), Supabase is the single source of truth for both auth and data, and the Customization Engine and Publishing Orchestrator are decoupled so each platform's quirks are isolated in its own adapter.

---

## 3. End-to-End User Flow (Authentication → Automation → Completion)

### Step 1 — Authentication
1. User lands on UNAI Flow → **Sign Up / Log In** (Supabase Auth: email/password + Google OAuth).
2. On first login, a `profiles` row is auto-created via a Supabase trigger.
3. JWT issued by Supabase is used for all subsequent API calls (validated by FastAPI middleware using Supabase's JWKS).

### Step 2 — Connect Platforms
1. User goes to **Connections** page.
2. For each platform, user clicks Connect:
   - **Instagram** → Meta OAuth (Instagram Graph API via a connected Facebook Page).
   - **Twitter/X** → OAuth 2.0 with PKCE.
   - **WhatsApp Community** → WhatsApp Business Platform (Meta) — requires a verified WhatsApp Business Account + Community/Group ID mapping.
3. Tokens (access + refresh) are stored encrypted in Supabase (`platform_connections` table), never exposed to the frontend.
4. Connection status/health is checked periodically (token expiry, revoked scopes).

### Step 3 — Single Input Composer
1. User opens **New Automation** → single text box (+ optional image/video upload) + platform toggle (select which of the 3 platforms to publish to).
2. User can optionally set: campaign name, tone (professional/casual/promotional), CTA link, schedule time (now / later / recurring in v2).

### Step 4 — Customization Engine (the core transformation step)
When the user hits **Generate Previews**:
1. Backend receives the raw content + selected platforms.
2. For each selected platform, a platform-specific prompt/ruleset is applied:
   - **Twitter/X**: hard 280-character cap (or thread-splitting logic), concise hook-first phrasing, 1–2 relevant hashtags, link shortening.
   - **Instagram**: caption up to ~2,200 chars but front-load first 125 chars (pre-fold), line-break friendly, 5–15 relevant hashtags block at the end, emoji-friendly tone.
   - **WhatsApp Community**: conversational tone, no hashtags, short paragraphs, emphasis on clarity and a direct CTA, formatting via WhatsApp markdown (`*bold*`, `_italic_`).
3. Each variant is generated by calling an LLM (Claude via Anthropic API) with a **platform ruleset system prompt** (see §7) plus brand taglines pulled from a `brand_taglines` table.
4. Variants are validated programmatically (character count, forbidden words, hashtag count) before being shown — this is a deterministic post-check layer, not left purely to the model.
5. User sees a **side-by-side preview** (mimicking each platform's UI) and can manually edit any variant before publishing.

### Step 5 — Publish / Schedule
1. User clicks **Publish Now** or **Schedule**.
2. Request goes to the **Publishing Orchestrator**, which fans out to platform-specific adapters:
   - `whatsapp_adapter.py`
   - `instagram_adapter.py`
   - `twitter_adapter.py`
3. Each adapter handles its own auth headers, payload shape, media upload requirements, and rate limits.
4. A `publish_jobs` row is created per platform per automation with status `queued → processing → success/failed`.
5. If scheduled, a job is placed in the scheduler (Celery/RQ + Redis, or Supabase cron/Edge Functions for v0/v1 simplicity).

### Step 6 — Status, Retry & Logging
1. Each adapter returns platform response (post ID, permalink, or error).
2. Status updates are pushed to the frontend via Supabase Realtime — the user sees live status chips (✅ Posted / ⏳ Scheduled / ❌ Failed — Retry).
3. Failed jobs show the platform's error reason (e.g., token expired, rate limit, content policy violation) and offer a one-click retry.
4. All activity is logged in `automation_logs` for audit/analytics.

### Step 7 — Analytics (v1/v2)
1. Dashboard aggregates posts sent, per-platform success rate, and (v2) engagement metrics pulled back from each platform's API.

---

## 4. Database Schema (Supabase / Postgres)

```sql
-- USERS handled by Supabase auth.users natively

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  company text,
  role text,
  created_at timestamptz default now()
);

create table platform_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  platform text not null check (platform in ('whatsapp','instagram','twitter')),
  access_token text not null,          -- store encrypted (pgsodium / vault)
  refresh_token text,
  token_expires_at timestamptz,
  platform_account_id text,            -- e.g. IG business account id, WA community id
  platform_account_name text,
  status text default 'active' check (status in ('active','expired','revoked')),
  connected_at timestamptz default now()
);

create table automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  campaign_name text,
  raw_content text not null,
  media_url text,
  tone text default 'professional',
  cta_link text,
  target_platforms text[] not null,     -- e.g. {'instagram','twitter'}
  schedule_type text default 'now' check (schedule_type in ('now','scheduled','recurring')),
  scheduled_at timestamptz,
  created_at timestamptz default now()
);

create table content_variants (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid references automations(id) on delete cascade,
  platform text not null,
  generated_text text not null,
  char_count int,
  hashtags text[],
  edited_by_user boolean default false,
  created_at timestamptz default now()
);

create table publish_jobs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid references automations(id) on delete cascade,
  variant_id uuid references content_variants(id),
  platform text not null,
  status text default 'queued' check (status in ('queued','processing','success','failed')),
  platform_post_id text,
  platform_post_url text,
  error_message text,
  attempts int default 0,
  updated_at timestamptz default now()
);

create table automation_logs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid references automations(id) on delete cascade,
  event text not null,          -- e.g. 'generated', 'published', 'retry', 'failed'
  meta jsonb,
  created_at timestamptz default now()
);

create table brand_taglines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  platform text,
  tagline text
);
```

**Row Level Security:** every table with `user_id` (directly or via `automation_id` join) gets an RLS policy so a user can only read/write their own rows. Service-role key is used only by the backend for adapter/webhook operations.

---

## 5. Backend API Design (FastAPI)

```
POST   /auth/callback                 -> exchange Supabase session, sync profile
GET    /connections                   -> list connected platforms + status
POST   /connections/{platform}/start  -> begin OAuth flow, return redirect URL
GET    /connections/{platform}/callback -> handle OAuth redirect, store tokens
DELETE /connections/{platform}        -> disconnect / revoke

POST   /automations                   -> create automation (raw content + target platforms)
POST   /automations/{id}/generate     -> run Customization Engine, return variants
PATCH  /automations/{id}/variants/{variant_id} -> user edits a variant manually
POST   /automations/{id}/publish      -> trigger Publishing Orchestrator (now or schedule)
GET    /automations/{id}/status       -> job status per platform
POST   /automations/{id}/retry/{platform} -> retry a failed publish job

GET    /analytics/summary             -> aggregated stats
POST   /webhooks/whatsapp             -> delivery/status callbacks
POST   /webhooks/instagram            -> delivery/status callbacks
POST   /webhooks/twitter              -> delivery/status callbacks
```

**Service layering inside the backend:**
- `services/customization_engine.py` — builds platform prompts, calls Claude, runs post-validation.
- `services/orchestrator.py` — fans out publish jobs to adapters, updates `publish_jobs`.
- `adapters/whatsapp_adapter.py`, `adapters/instagram_adapter.py`, `adapters/twitter_adapter.py` — one class per platform implementing a common `PlatformAdapter` interface (`publish()`, `validate()`, `refresh_token()`).
- `services/scheduler.py` — queues scheduled jobs (Celery+Redis in v1/v2, simple cron table in v0).

---

## 6. Platform Constraints Reference (used by the Customization Engine)

| Platform | Char limit | Hashtags | Tone notes | Media |
|---|---|---|---|---|
| Twitter/X | 280 (or thread split) | 1–2 max | Punchy, hook-first | 1 image/video, or 4 images |
| Instagram | ~2,200 (first 125 shown pre-fold) | 5–15, placed at end | Visual-first, emoji-friendly | Image/video required for feed post |
| WhatsApp Community | ~4,096 (practically keep under 300–500 for readability) | None | Conversational, direct CTA | Optional single image/doc |

These constraints are stored as config (not hardcoded) in a `platform_rules.json` so they can be updated without a redeploy.

---

## 7. Customization Engine — Prompting Approach

Each platform gets its own system prompt template, for example (Twitter):

> "Rewrite the following content as a single tweet under 280 characters. Keep the core message and CTA. Use at most 2 relevant hashtags. Tone: {tone}. Brand taglines to consider: {taglines}. Output only the tweet text."

The backend then:
1. Sends `raw_content + platform ruleset` to Claude via the Anthropic API.
2. Receives the draft variant.
3. Runs deterministic checks (char count, hashtag count, banned words) — if it fails, either auto-retries with a corrective instruction ("shorten by X characters") or truncates safely.
4. Stores the final variant + validation metadata in `content_variants`.

This two-layer approach (LLM generation + deterministic validation) avoids relying on the model alone to respect hard limits like character counts.

---

## 8. Frontend Structure (React)

```
/src
  /pages
    Login.jsx / Signup.jsx
    Dashboard.jsx
    Connections.jsx
    NewAutomation.jsx        -> the single-input composer
    PreviewVariants.jsx      -> side-by-side platform previews
    AutomationHistory.jsx
    Settings.jsx
  /components
    PlatformCard.jsx
    VariantPreviewCard.jsx   -> mimics WhatsApp/Instagram/Twitter UI chrome
    StatusChip.jsx
    CharacterCounter.jsx
  /stores                    -> Zustand or Context for automation state
  /lib
    supabaseClient.js
    apiClient.js
```

**Design system (v0 baseline):**
- Background: `#FFFFFF`
- Primary text/accent: a single blue, e.g. `#1D4ED8` (headings, buttons, links, active states)
- Secondary text: neutral gray `#475569` for body copy on white
- Success/Error states use standard green/red sparingly, kept minimal against the white/blue palette
- Typography: clean sans-serif (e.g., Inter), generous white space, card-based layout for platform previews

---

## 9. Versioned Build Roadmap

### v0 — Proof of Concept (Frontend-first, mock data)
**Goal:** validate the single-input → multi-platform-preview experience without real publishing.
- Auth via Supabase (email/password only).
- Static/mock "connections" (no real OAuth yet).
- Composer with single text input.
- Customization Engine calls Claude directly, produces 3 variants (Twitter/Instagram/WhatsApp) with char-count validation.
- Preview UI for all 3 platforms.
- No real publishing — "Publish" just marks status as success in the DB (simulated).
- No scheduling yet.

### v1 — Production-Ready Core
**Goal:** real accounts, real publishing, real reliability.
- Real OAuth connections: Instagram Graph API, Twitter/X API v2, WhatsApp Business Platform.
- Publishing Orchestrator with platform adapters actually posting live.
- Retry logic + error surfacing per platform.
- Scheduling ("publish later" — single scheduled time).
- Automation history with filters (platform, status, date).
- Manual variant editing before publish.
- Webhooks for delivery status where platforms support them.
- RLS fully enforced; token encryption at rest.

### v2 — Scale & Intelligence
**Goal:** make UNAI Flow a genuine automation platform, not just a poster.
- Recurring/repeating automations (daily/weekly campaigns).
- Analytics dashboard pulling back engagement (likes, replies, delivery reads) per platform.
- Multi-account support per platform (e.g., multiple IG business accounts).
- Team roles (admin/editor/viewer) for company use.
- Additional platform adapters (LinkedIn, Facebook Page) via the same `PlatformAdapter` interface.
- Smarter Customization Engine: learns brand voice from past high-performing posts (fine-tuned prompt context, not model fine-tuning).
- Rate-limit-aware queueing across all platforms.
- Audit log export + compliance reporting.

---

## 10. Security & Compliance Notes
- All platform access/refresh tokens stored encrypted (Supabase Vault or pgsodium column encryption) — never sent to the frontend.
- Backend validates Supabase JWT on every request (signature + expiry) before touching any data.
- RLS policies enforced on every user-owned table as the last line of defense even if backend logic has a bug.
- Webhook endpoints verify platform signatures (Meta's `X-Hub-Signature-256`, Twitter's CRC/webhook secret) before processing.
- Rate limiting on the Publishing Orchestrator per platform to respect API quotas and avoid account suspension.

---

## 11. Suggested Build Sequence for Antigravity / Claude Code

Consistent with a frontend-first, phase-locked build discipline:

1. **Phase 1 — Frontend shell (v0):** Auth pages, Dashboard shell, Composer UI, mock variant previews, design system (white/blue) fully implemented with static/mock data.
2. **Phase 2 — Backend skeleton:** FastAPI project, Supabase schema migration (§4), auth middleware, `/automations` + `/generate` endpoints wired to the real Customization Engine.
3. **Phase 3 — Connect frontend to real backend:** replace mock data with live API calls; real Claude-generated variants; simulated publish.
4. **Phase 4 (v1) — Real platform adapters:** OAuth flows + live publishing for one platform at a time (recommended order: Twitter/X → Instagram → WhatsApp, based on API complexity).
5. **Phase 5 (v1) — Scheduling, retries, webhooks, history.**
6. **Phase 6 (v2) — Analytics, recurring automations, team roles, additional platforms.**

Each phase should be handed to Antigravity/Claude Code as its own scoped master prompt (mirroring the structure of this document) so the coding agent builds one clean, testable layer at a time before moving to the next.

---

*End of UNAI Flow Master Documentation.*
