import hashlib
import time
from typing import Optional, Dict, Any
from fastapi import FastAPI, Header, HTTPException, Response, Depends, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from config import config
from services.whatsapp_engine import whatsapp_engine

app = FastAPI(title="UNAI Flow — WhatsApp Channel API (Python)")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory duplicate post cache: hash -> timestamp
recent_post_hashes: Dict[str, float] = {}

def check_api_key(x_api_key: Optional[str] = Header(None)):
    if not x_api_key or x_api_key != config.API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing X-API-Key header")
    return x_api_key

def check_duplicate(content: str, media_url: Optional[str] = None):
    fingerprint = f"{config.CHANNEL_ID}|{content}|{media_url or ''}"
    content_hash = hashlib.sha256(fingerprint.encode()).hexdigest()
    now = time.time()

    # Clean old hashes
    expired = [h for h, ts in recent_post_hashes.items() if now - ts > config.DUPLICATE_WINDOW_SEC]
    for h in expired:
        del recent_post_hashes[h]

    if content_hash in recent_post_hashes:
        raise HTTPException(
            status_code=409,
            detail=f"Duplicate post: Identical content was published within the last {config.DUPLICATE_WINDOW_SEC} seconds."
        )

    recent_post_hashes[content_hash] = now

# ── Pydantic Request Models ──

class PublishRequest(BaseModel):
    text: Optional[str] = None
    caption: Optional[str] = None
    mediaUrl: Optional[str] = None
    channelId: Optional[str] = None

class TextPublishRequest(BaseModel):
    text: str
    channelId: Optional[str] = None

class MediaPublishRequest(BaseModel):
    mediaUrl: str
    caption: Optional[str] = None
    channelId: Optional[str] = None

# ── Lifecycle Events ──

@app.on_event("startup")
async def on_startup():
    # Start the WhatsApp Playwright engine in background
    import asyncio
    asyncio.create_task(whatsapp_engine.initialize())

@app.on_event("shutdown")
async def on_shutdown():
    await whatsapp_engine.close()

# ── Public Endpoints ──

@app.get("/api/status")
async def get_status():
    status = await whatsapp_engine.get_status()
    is_ready = status["isReady"]
    return JSONResponse(
        status_code=200 if is_ready else 503,
        content={
            "success": is_ready,
            "whatsapp": status,
            "service": "whatsapp-channel-api-python",
        }
    )

@app.get("/api/qr")
async def get_qr(format: Optional[str] = None):
    status = await whatsapp_engine.get_status()
    if status["isReady"]:
        return {"success": True, "message": "Already connected! No QR code needed.", "state": "connected"}

    if format == "json":
        if not status["hasQR"]:
            raise HTTPException(status_code=404, detail="QR code not ready yet. Please wait a few seconds.")
        return {
            "success": True,
            "qr": whatsapp_engine.current_qr,
            "state": status["state"],
            "instruction": "Scan this QR code with WhatsApp > Linked Devices > Link a Device"
        }

    # Default: return PNG image
    qr_bytes = await whatsapp_engine.get_qr_image()
    if not qr_bytes:
        raise HTTPException(status_code=404, detail="QR code generating. Refresh in 2 seconds.")

    return Response(
        content=qr_bytes,
        media_type="image/png",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
    )

# ── Protected Publishing Endpoints ──

@app.post("/api/channel/publish")
async def publish_unified(req: PublishRequest, _auth: str = Depends(check_api_key)):
    content = req.caption or req.text or ""
    if not content and not req.mediaUrl:
        raise HTTPException(status_code=400, detail="Provide at least 'text', 'caption', or 'mediaUrl'")

    check_duplicate(content, req.mediaUrl)

    try:
        result = await whatsapp_engine.publish_to_channel(
            text=req.text,
            media_url=req.mediaUrl,
            caption=req.caption
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/channel/text")
async def publish_text(req: TextPublishRequest, _auth: str = Depends(check_api_key)):
    check_duplicate(req.text)
    try:
        return await whatsapp_engine.publish_to_channel(text=req.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/channel/image")
async def publish_image(req: MediaPublishRequest, _auth: str = Depends(check_api_key)):
    check_duplicate(req.caption or "", req.mediaUrl)
    try:
        return await whatsapp_engine.publish_to_channel(media_url=req.mediaUrl, caption=req.caption)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/channel/list")
async def list_channels(_auth: str = Depends(check_api_key)):
    return {
        "success": True,
        "channels": [
            {
                "id": config.CHANNEL_ID,
                "name": "Target WhatsApp Channel",
                "link": config.CHANNEL_LINK,
            }
        ]
    }

# ── Root Live Web Dashboard ──

@app.get("/", response_class=HTMLResponse)
async def live_dashboard(request: Request):
    accept = request.headers.get("accept", "")
    if "application/json" in accept and "text/html" not in accept:
        status = await whatsapp_engine.get_status()
        return JSONResponse({
            "service": "UNAI Flow — WhatsApp Channel API (Python)",
            "version": "1.0.0",
            "status": status,
            "channel": config.CHANNEL_LINK,
        })

    html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UNAI Flow — WhatsApp Channel API (Python)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {{
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f2937;
      --primary: #25D366;
      --primary-hover: #20BA56;
      --text: #f9fafb;
      --text-muted: #9ca3af;
      --warning: #f59e0b;
      --danger: #ef4444;
    }}
    * {{ box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', sans-serif; }}
    body {{
      background: radial-gradient(circle at top center, #131d33 0%, var(--bg) 100%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem 1rem;
    }}
    .container {{ width: 100%; max-width: 800px; display: flex; flex-direction: column; gap: 1.5rem; }}
    header {{ text-align: center; }}
    .badge {{
      display: inline-block;
      background: rgba(37, 211, 102, 0.15);
      border: 1px solid rgba(37, 211, 102, 0.3);
      color: var(--primary);
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 700;
      margin-bottom: 0.75rem;
    }}
    .card {{
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 1rem;
      padding: 1.75rem;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }}
    .status-bar {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 1rem 1.25rem;
      background: #172033;
      border-radius: 0.75rem;
      border: 1px solid var(--card-border);
    }}
    .dot {{ width: 12px; height: 12px; border-radius: 50%; background: var(--warning); display: inline-block; }}
    .dot.connected {{ background: var(--primary); box-shadow: 0 0 10px var(--primary); }}
    .qr-box {{
      background: #ffffff;
      padding: 1rem;
      border-radius: 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 240px;
      height: 240px;
      margin: 1.5rem auto;
    }}
    .qr-box img {{ width: 100%; height: 100%; border-radius: 0.5rem; }}
    .code-box {{
      background: #090d16;
      border: 1px solid var(--card-border);
      border-radius: 0.5rem;
      padding: 0.85rem 1rem;
      font-family: monospace;
      font-size: 0.85rem;
      color: #38bdf8;
      word-break: break-all;
      margin-top: 0.5rem;
    }}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="badge">🐍 Pure Python WhatsApp Channel Gateway</div>
      <h1 style="font-size: 2rem; font-weight: 800;">UNAI Flow — WhatsApp Channel API</h1>
      <p style="color: var(--text-muted); margin-top: 0.25rem;">Direct broadcast engine for WhatsApp Channel ({config.CHANNEL_ID})</p>
    </header>

    <div class="status-bar">
      <div style="display: flex; align-items: center; gap: 0.75rem; font-weight: 600;">
        <span class="dot" id="statusDot"></span>
        <span id="statusText">Checking session...</span>
      </div>
      <span style="font-size: 0.85rem; color: var(--text-muted);">Python + Playwright Engine</span>
    </div>

    <div class="card" id="qrCard" style="text-align: center;">
      <h3 style="font-size: 1.2rem; font-weight: 700;">Scan QR to Link WhatsApp</h3>
      <div class="qr-box">
        <img id="qrImg" src="/api/qr" alt="WhatsApp QR Code" />
      </div>
      <p style="font-size: 0.9rem; color: var(--text-muted); line-height: 1.5;">
        Open <strong>WhatsApp</strong> &gt; <strong>Linked Devices</strong> &gt; <strong>Link a Device</strong> &gt; Scan this QR code.
      </p>
    </div>

    <div class="card" id="connectedCard" style="display: none; text-align: center;">
      <h2 style="color: var(--primary); font-size: 1.5rem; font-weight: 800; margin-bottom: 0.5rem;">🎉 WhatsApp Connected &amp; Live!</h2>
      <p style="color: var(--text-muted);">Ready to broadcast posts from your UNAI Flow Dashboard.</p>
      <div class="code-box" style="text-align: left; margin-top: 1rem;">Target Channel: {config.CHANNEL_LINK}</div>
    </div>

    <div class="card">
      <h3 style="font-size: 1rem; margin-bottom: 0.5rem;">Backend Configuration</h3>
      <p style="font-size: 0.85rem; color: var(--text-muted);">Configure these variables in your main backend:</p>
      <div class="code-box">WCA_API_URL=https://your-service.onrender.com
WCA_API_KEY={config.API_KEY}</div>
    </div>
  </div>

  <script>
    async function check() {{
      try {{
        const res = await fetch('/api/status');
        const data = await res.json();
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');
        const qrCard = document.getElementById('qrCard');
        const connCard = document.getElementById('connectedCard');

        if (data.success && data.whatsapp && data.whatsapp.isReady) {{
          dot.className = 'dot connected';
          text.innerText = 'Connected & Active';
          qrCard.style.display = 'none';
          connCard.style.display = 'block';
        }} else {{
          dot.className = 'dot';
          text.innerText = 'Scan QR Code below';
          qrCard.style.display = 'block';
          connCard.style.display = 'none';
          document.getElementById('qrImg').src = '/api/qr?t=' + Date.now();
        }}
      }} catch (e) {{}}
    }}
    setInterval(check, 3000);
    check();
  </script>
</body>
</html>"""
    return HTMLResponse(content=html_content)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=config.PORT, reload=False)
