const config = require('../config');

function renderDashboardHtml() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UNAI Flow — WhatsApp Channel API (Live)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f2937;
      --primary: #25D366;
      --primary-hover: #20BA56;
      --primary-glow: rgba(37, 211, 102, 0.25);
      --text: #f9fafb;
      --text-muted: #9ca3af;
      --accent: #6366f1;
      --danger: #ef4444;
      --warning: #f59e0b;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', -apple-system, sans-serif; }
    body {
      background: radial-gradient(circle at top center, #131d33 0%, var(--bg) 100%);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 2rem 1rem;
    }
    .container {
      width: 100%;
      max-width: 860px;
      display: flex;
      flex-direction: column;
      gap: 1.5rem;
    }
    header {
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
    }
    .logo-badge {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      background: rgba(37, 211, 102, 0.12);
      border: 1px solid rgba(37, 211, 102, 0.3);
      color: var(--primary);
      padding: 0.35rem 0.85rem;
      border-radius: 9999px;
      font-size: 0.85rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    h1 { font-size: 2rem; font-weight: 800; letter-spacing: -0.02em; }
    p.subtitle { color: var(--text-muted); font-size: 0.95rem; }
    
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 1rem;
      padding: 1.5rem;
      box-shadow: 0 10px 25px -5px rgba(0,0,0,0.5);
    }
    
    .status-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1rem;
      padding: 1rem 1.25rem;
      background: #172033;
      border-radius: 0.75rem;
      border: 1px solid var(--card-border);
    }
    .status-indicator {
      display: flex;
      align-items: center;
      gap: 0.65rem;
      font-weight: 600;
    }
    .dot {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: var(--warning);
      box-shadow: 0 0 10px var(--warning);
      animation: pulse 2s infinite;
    }
    .dot.connected { background: var(--primary); box-shadow: 0 0 12px var(--primary); }
    .dot.error { background: var(--danger); box-shadow: 0 0 10px var(--danger); }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.5; transform: scale(0.85); }
    }
    
    /* QR Section */
    .qr-section {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 1.25rem;
      padding: 2rem 1rem;
    }
    .qr-box {
      position: relative;
      background: #ffffff;
      padding: 1rem;
      border-radius: 1rem;
      box-shadow: 0 0 35px var(--primary-glow);
      display: flex;
      align-items: center;
      justify-content: center;
      min-width: 260px;
      min-height: 260px;
    }
    .qr-box img {
      width: 240px;
      height: 240px;
      display: block;
      border-radius: 0.5rem;
    }
    .instructions {
      max-width: 480px;
      font-size: 0.9rem;
      color: var(--text-muted);
      line-height: 1.6;
    }
    .instructions ol {
      text-align: left;
      margin-top: 0.75rem;
      padding-left: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    
    /* Connected View */
    .connected-view {
      display: none;
      flex-direction: column;
      gap: 1.5rem;
    }
    .connected-banner {
      background: rgba(37, 211, 102, 0.1);
      border: 1px solid rgba(37, 211, 102, 0.3);
      padding: 1.25rem;
      border-radius: 0.75rem;
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .connected-banner svg { width: 36px; height: 36px; fill: var(--primary); flex-shrink: 0; }
    
    /* Form */
    .test-form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    label { font-size: 0.85rem; font-weight: 600; color: var(--text-muted); }
    textarea, input {
      width: 100%;
      background: #090d16;
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 0.75rem 1rem;
      border-radius: 0.5rem;
      font-size: 0.95rem;
    }
    textarea:focus, input:focus { outline: none; border-color: var(--primary); }
    
    button {
      background: var(--primary);
      color: #052e16;
      font-weight: 700;
      font-size: 0.95rem;
      padding: 0.75rem 1.5rem;
      border-radius: 0.5rem;
      border: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
      transition: all 0.2s;
    }
    button:hover { background: var(--primary-hover); transform: translateY(-1px); }
    button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
    
    .code-box {
      background: #090d16;
      border: 1px solid var(--card-border);
      border-radius: 0.5rem;
      padding: 0.85rem 1rem;
      font-family: monospace;
      font-size: 0.85rem;
      color: #38bdf8;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .channels-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .channel-pill {
      background: #172033;
      border: 1px solid var(--card-border);
      padding: 0.5rem 0.85rem;
      border-radius: 0.5rem;
      font-size: 0.85rem;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="logo-badge">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.582 2.128 2.182-.573c.978.58 1.911.928 3.145.929 3.178 0 5.767-2.587 5.768-5.766.001-3.187-2.575-5.77-5.764-5.771zm3.392 8.244c-.144.405-.837.774-1.17.824-.312.045-.698.058-2.002-.486-1.579-.658-2.613-2.261-2.694-2.368-.08-.108-.655-.87-.655-1.66 0-.79.414-1.179.56-1.339.145-.16.319-.2.425-.2.106 0 .213.001.306.006.098.005.23-.037.36.275.133.319.455 1.11.495 1.192.04.082.067.177.013.285-.053.107-.08.175-.16.269-.079.094-.167.21-.239.282-.08.08-.163.167-.07.327.093.16.413.682.887 1.104.61.543 1.124.711 1.284.791.16.08.253.067.346-.04.094-.108.4-466.507-.626.107-.16.213-.133.36-.08.147.054.933.44 1.093.52.16.08.267.12.307.187.04.067.04.387-.104.792z"/></svg>
        Self-Hosted API
      </div>
      <h1>WhatsApp Channel Publishing Service</h1>
      <p class="subtitle">Real-time gateway for broadcasting directly to your WhatsApp Channel.</p>
    </header>

    <div class="status-bar">
      <div class="status-indicator">
        <span class="dot" id="statusDot"></span>
        <span id="statusText">Checking connection...</span>
      </div>
      <div style="font-size: 0.85rem; color: var(--text-muted);" id="uptimeInfo"></div>
    </div>

    <!-- QR Section (Shown when disconnected/qr_pending) -->
    <div class="card" id="qrCard">
      <div class="qr-section">
        <h2 style="font-size: 1.25rem; font-weight: 700;">Scan QR Code to Link WhatsApp</h2>
        <div class="qr-box" id="qrBox">
          <div id="qrLoader" style="color: #64748b; font-size: 0.9rem;">Generating QR code...</div>
          <img id="qrImage" style="display: none;" alt="WhatsApp QR Code" />
        </div>
        <div class="instructions">
          <p><strong>How to pair:</strong></p>
          <ol>
            <li>Open <strong>WhatsApp</strong> on your phone</li>
            <li>Tap <strong>Settings</strong> or <strong>⋮ (3 dots)</strong> &gt; <strong>Linked Devices</strong></li>
            <li>Tap <strong>Link a Device</strong> and point your camera at this QR code</li>
          </ol>
          <p style="margin-top: 0.75rem; font-size: 0.8rem; color: #64748b;">
            🔄 QR code refreshes automatically. Session is saved permanently upon connection.
          </p>
        </div>
      </div>
    </div>

    <!-- Connected Section (Shown when connected) -->
    <div class="connected-view" id="connectedCard">
      <div class="connected-banner">
        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
        <div>
          <h3 style="font-weight: 700; color: var(--primary);">WhatsApp Connected & Ready!</h3>
          <p style="font-size: 0.9rem; color: var(--text-muted);" id="userAccountInfo">Ready to publish to your Channel.</p>
        </div>
      </div>

      <div class="card">
        <h3 style="font-size: 1.1rem; margin-bottom: 1rem;">Detected WhatsApp Channels</h3>
        <div class="channels-list" id="channelsList">
          <div style="color: var(--text-muted); font-size: 0.9rem;">Fetching channels...</div>
        </div>
      </div>

      <div class="card">
        <h3 style="font-size: 1.1rem; margin-bottom: 1rem;">Live Test Publisher</h3>
        <form class="test-form" id="publishForm" onsubmit="event.preventDefault(); publishTest();">
          <div>
            <label for="postContent">Post Text / Caption</label>
            <textarea id="postContent" rows="3" placeholder="Write something to test publish to your WhatsApp Channel..."></textarea>
          </div>
          <div>
            <label for="mediaUrl">Optional Media URL (Image or MP4 Video)</label>
            <input type="url" id="mediaUrl" placeholder="https://example.com/image.jpg" />
          </div>
          <button type="submit" id="publishBtn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
            Send Test Post to WhatsApp Channel
          </button>
        </form>
        <div id="publishResult" style="margin-top: 1rem; display: none;"></div>
      </div>
    </div>

    <!-- API Config Card -->
    <div class="card">
      <h3 style="font-size: 1.1rem; margin-bottom: 0.75rem;">Backend Integration Setup</h3>
      <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.75rem;">
        Add these environment variables to your dashboard backend (e.g., in Render or backend <code>.env</code>):
      </p>
      <div class="code-box" id="envSnippet">WCA_API_URL=https://your-service-url.onrender.com
WCA_API_KEY=${config.apiKey}
WHATSAPP_CHANNEL_LINK=${config.channelLink}</div>
    </div>
  </div>

  <script>
    const API_KEY = "${config.apiKey}";
    let isConnected = false;

    async function checkStatus() {
      try {
        const res = await fetch('/api/status');
        const data = await res.json();
        
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');
        const qrCard = document.getElementById('qrCard');
        const connectedCard = document.getElementById('connectedCard');
        
        if (data.success && data.whatsapp && data.whatsapp.isReady) {
          // Connected!
          isConnected = true;
          dot.className = 'dot connected';
          text.innerText = 'Connected & Active';
          qrCard.style.display = 'none';
          connectedCard.style.display = 'flex';
          
          if (data.whatsapp.userInfo) {
            const u = data.whatsapp.userInfo;
            document.getElementById('userAccountInfo').innerText = 
              'Linked Account: ' + (u.pushname || 'User') + ' (' + (u.wid ? u.wid.split('@')[0] : '') + ')';
          }
          loadChannels();
        } else {
          // Pending QR or connecting
          isConnected = false;
          connectedCard.style.display = 'none';
          qrCard.style.display = 'block';
          
          if (data.whatsapp && data.whatsapp.state === 'qr_pending') {
            dot.className = 'dot';
            text.innerText = 'Scan QR code below with WhatsApp';
            fetchQR();
          } else {
            dot.className = 'dot';
            text.innerText = 'Initializing client (' + (data.whatsapp ? data.whatsapp.state : 'loading') + ')...';
          }
        }
      } catch (e) {
        document.getElementById('statusDot').className = 'dot error';
        document.getElementById('statusText').innerText = 'API Offline';
      }
    }

    async function fetchQR() {
      try {
        const res = await fetch('/api/qr?format=json');
        if (res.ok) {
          const data = await res.json();
          if (data.qr) {
            const qrImg = document.getElementById('qrImage');
            const qrLoader = document.getElementById('qrLoader');
            qrImg.src = '/api/qr?t=' + Date.now();
            qrImg.style.display = 'block';
            qrLoader.style.display = 'none';
          }
        }
      } catch (e) {}
    }

    let channelsLoaded = false;
    async function loadChannels() {
      if (channelsLoaded) return;
      try {
        const res = await fetch('/api/channel/list', {
          headers: { 'X-API-Key': API_KEY }
        });
        const data = await res.json();
        const listDiv = document.getElementById('channelsList');
        if (data.success && data.channels && data.channels.length > 0) {
          channelsLoaded = true;
          listDiv.innerHTML = data.channels.map(ch => \`
            <div class="channel-pill">
              <span style="font-weight: 600;">\${ch.name}</span>
              <span style="color: var(--text-muted); font-family: monospace;">\${ch.id}</span>
            </div>
          \`).join('');
        } else {
          listDiv.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem;">No WhatsApp Channels found for this account. Ensure your linked phone number is an admin of a WhatsApp Channel.</div>';
        }
      } catch (e) {}
    }

    async function publishTest() {
      const text = document.getElementById('postContent').value.trim();
      const mediaUrl = document.getElementById('mediaUrl').value.trim();
      const btn = document.getElementById('publishBtn');
      const resultDiv = document.getElementById('publishResult');
      
      if (!text && !mediaUrl) {
        alert('Please enter some text or a media URL.');
        return;
      }
      
      btn.disabled = true;
      btn.innerText = 'Publishing to Channel...';
      resultDiv.style.display = 'none';
      
      try {
        const res = await fetch('/api/channel/publish', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-Key': API_KEY
          },
          body: JSON.stringify({
            text: text || undefined,
            caption: text || undefined,
            mediaUrl: mediaUrl || undefined
          })
        });
        
        const data = await res.json();
        resultDiv.style.display = 'block';
        if (data.success) {
          resultDiv.innerHTML = '<div class="code-box" style="color: var(--primary); border-color: rgba(37, 211, 102, 0.4);">✅ Published successfully!\\nMessage ID: ' + data.messageId + '</div>';
          document.getElementById('postContent').value = '';
          document.getElementById('mediaUrl').value = '';
        } else {
          resultDiv.innerHTML = '<div class="code-box" style="color: var(--danger); border-color: rgba(239, 68, 68, 0.4);">❌ Publish failed: ' + (data.error ? data.error.message : 'Unknown error') + '</div>';
        }
      } catch (err) {
        resultDiv.style.display = 'block';
        resultDiv.innerHTML = '<div class="code-box" style="color: var(--danger);">❌ Request error: ' + err.message + '</div>';
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg> Send Test Post to WhatsApp Channel';
      }
    }

    // Polling every 2.5 seconds
    setInterval(checkStatus, 2500);
    checkStatus();
  </script>
</body>
</html>`;
}

module.exports = { renderDashboardHtml };
