import asyncio
import io
import json
import os
import re
import shutil
import time
import logging
from typing import Optional, Dict, Any, List
import qrcode
from qrcode.image.pil import PilImage
import httpx

from config import config

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] [WhatsAppEngine] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("WhatsAppEngine")

# ══════════════════════════════════════════════════════════════════════════════
# CENTRALIZED WHATSAPP WEB SELECTORS
# When WhatsApp Web changes its DOM structure, update ONLY this block.
# ══════════════════════════════════════════════════════════════════════════════

WA_SELECTORS = {
    # Navigation buttons to switch to the Channels/Updates tab
    "CHANNEL_NAV_BUTTONS": [
        'button[aria-label="Channels"]',
        'button[aria-label="Updates"]',
        'button[aria-label="Newsletters"]',
        'button[aria-label="Status"]',
        # Icon-based fallbacks (find the parent button)
        'span[data-icon="newsletter-outline"]',
        'span[data-icon="newsletter"]',
        'span[data-icon="newsletter-fill"]',
        'span[data-icon="status-outline"]',
        'span[data-icon="status-v3-outline"]',
        'span[data-icon="updates-outline"]',
    ],
    # Containers that indicate the Channels/Updates view is active
    "CHANNEL_VIEW_INDICATORS": [
        'div[data-testid="updates-panel"]',
        'div[data-testid="newsletters-panel"]',
        'div[data-testid="channel-list"]',
        'div[aria-label="Channel list"]',
        'div[aria-label="Updates"]',
        'div[aria-label="Channels"]',
        'header span[title="Channels"]',
        'header span[title="Updates"]',
    ],
    # Individual channel list items in the sidebar
    "CHANNEL_ITEM_SELECTORS": [
        'div[data-testid="cell-frame-container"]',
        'div[data-testid="list-item-newsletter"]',
        'div[data-testid="chat-list-item"]',
        'div[role="listitem"]',
        'div[role="row"]',
        'a[role="listitem"]',
        'div[role="gridcell"]',
    ],
    # Elements within a channel item that contain the channel name
    "CHANNEL_NAME_SELECTORS": [
        'span[title]',
        'span[dir="auto"][title]',
        'div[title]',
        'span.x1rg5ohu',
        'span[dir="auto"]',
    ],
    # Avatar image within a channel item
    "CHANNEL_AVATAR_SELECTORS": [
        'img[draggable="false"]',
        'img[data-testid="user-avatar"]',
        'div[data-testid="chat-avatar"] img',
        'img[src*="pps.whatsapp.net"]',
        'img[src*="mmg.whatsapp.net"]',
    ],
    # Navigation back to Chats view
    "CHAT_NAV_BUTTONS": [
        'button[aria-label="Chats"]',
        'span[data-icon="chats-outline"]',
        'span[data-icon="chats-filled"]',
        'span[data-icon="chat-outline"]',
    ],
    # Channel detail/info panel selectors (when a channel is opened)
    "CHANNEL_DETAIL": {
        "header_name": [
            'div[data-testid="conversation-info-header"] span[dir="auto"]',
            'header span[title]',
            'div[data-testid="conversation-header"] span[title]',
            'span.x1rg5ohu[title]',
        ],
        "avatar": [
            'div[data-testid="conversation-info-header"] img',
            'header img[draggable="false"]',
            'div[data-testid="chat-avatar"] img',
            'img[data-testid="user-avatar"]',
        ],
        "description": [
            'div[data-testid="conversation-info-header"] span.selectable-text',
            'section span.selectable-text',
            'div[data-testid="section-about"] span',
        ],
        "subscriber_pattern": r'([\d,.]+[kKmM]?)\s*(subscribers?|followers?)',
        "admin_indicators": [
            'span[data-icon="settings"]',
            'button[aria-label="Channel settings"]',
            'div[data-testid="channel-admin-badge"]',
            'span[title="Admin"]',
            'span[title="Owner"]',
        ],
        "composer": [
            'div[data-testid="conversation-compose-box-input"]',
            'div[contenteditable="true"][data-tab="10"]',
            'div[contenteditable="true"][data-tab="6"]',
            'footer div[contenteditable="true"]',
            'div[role="textbox"]',
        ],
    },
    # Names/labels to filter out (not real channels)
    "NON_CHANNEL_NAMES": {
        "my status", "status", "channels", "find channels",
        "communities", "new channel", "create channel",
        "search", "archived", "starred messages",
    },
}

class WhatsAppEngine:
    """
    Production-grade WhatsApp Web Channel Automation Engine using Playwright.
    Features:
      - Full anti-bot evasion / stealth injection to prevent "Couldn't link device" errors.
      - Crisp, real-time QR code generation from live data-ref.
      - Auto-recovery and reload on QR expiration.
      - Persistent session storage in user_data_dir.
      - Automatic session reconnect on restart.
      - Robust Channel publishing (text + media).
    """

    def __init__(self, session_identifier: str):
        self.session_identifier = session_identifier
        self.session_dir = os.path.join(config.SESSION_DIR, self.session_identifier)
        self.playwright = None
        self.browser_context = None
        self.page = None
        self.connection_state: str = "disconnected"  # disconnected | connecting | qr_pending | authenticating | connected
        self.is_ready: bool = False
        self.current_qr: Optional[str] = None
        self.qr_png_bytes: Optional[bytes] = None
        self.pairing_code: Optional[str] = None
        self.user_info: Optional[Dict[str, Any]] = None
        self.last_qr_time: Optional[float] = None
        self.last_error: Optional[str] = None
        self._monitor_task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()
        self._is_initializing: bool = False

    async def initialize(self):
        """Initializes Playwright with full stealth settings and launches WhatsApp Web."""
        async with self._lock:
            if self._is_initializing:
                return
            self._is_initializing = True

        logger.info("🚀 Initializing WhatsApp Web automation engine...")
        self.connection_state = "connecting"
        self.is_ready = False
        self.last_error = None

        try:
            from playwright.async_api import async_playwright
            if not self.playwright:
                self.playwright = await async_playwright().start()

            os.makedirs(self.session_dir, exist_ok=True)

            user_agent = (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )

            # Chromium launch arguments engineered to pass WhatsApp's Noise handshake & WebGL checks
            launch_args = [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-blink-features=AutomationControlled",
                "--disable-features=IsolateOrigins,site-per-process",
                "--disable-infobars",
                "--window-size=1920,1080",
                "--no-first-run",
                "--no-default-browser-check",
                "--ignore-certificate-errors",
            ]

            try:
                self.browser_context = await self.playwright.chromium.launch_persistent_context(
                    user_data_dir=self.session_dir,
                    headless=True,
                    user_agent=user_agent,
                    args=launch_args,
                    viewport={"width": 1920, "height": 1080},
                    locale="en-US",
                    timezone_id="America/New_York",
                    permissions=["notifications"],
                    color_scheme="light",
                    ignore_default_args=["--enable-automation"],
                )
            except Exception as launch_err:
                logger.warning(f"Browser launch failed ({launch_err}), installing Playwright Chromium...")
                import subprocess
                subprocess.run(["playwright", "install", "chromium"], check=False)
                self.browser_context = await self.playwright.chromium.launch_persistent_context(
                    user_data_dir=self.session_dir,
                    headless=True,
                    user_agent=user_agent,
                    args=launch_args,
                    viewport={"width": 1920, "height": 1080},
                    locale="en-US",
                    timezone_id="America/New_York",
                    permissions=["notifications"],
                    color_scheme="light",
                    ignore_default_args=["--enable-automation"],
                )

            if len(self.browser_context.pages) > 0:
                self.page = self.browser_context.pages[0]
            else:
                self.page = await self.browser_context.new_page()

            # Comprehensive stealth script injection (removes webdriver, mocks plugins, WebGL, chrome runtime)
            await self.browser_context.add_init_script("""
                // 1. Remove navigator.webdriver cleanly
                try {
                    delete Object.getPrototypeOf(navigator).webdriver;
                } catch (e) {}
                Object.defineProperty(Navigator.prototype, 'webdriver', {
                    get: () => undefined,
                    enumerable: false,
                    configurable: true
                });

                // 2. Realistic window.chrome object
                window.chrome = {
                    app: {
                        isInstalled: false,
                        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
                        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
                    },
                    runtime: {
                        OnInstalledReason: {},
                        OnRestartRequiredReason: {},
                        PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                        PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
                        PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
                        RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }
                    },
                    csi: function() {},
                    loadTimes: function() {}
                };

                // 3. Realistic navigator properties
                Object.defineProperty(Navigator.prototype, 'languages', {
                    get: () => ['en-US', 'en'],
                    configurable: true
                });

                Object.defineProperty(Navigator.prototype, 'platform', {
                    get: () => 'Win32',
                    configurable: true
                });

                Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', {
                    get: () => 8,
                    configurable: true
                });

                Object.defineProperty(Navigator.prototype, 'deviceMemory', {
                    get: () => 8,
                    configurable: true
                });

                // 4. Realistic PluginArray
                function mockPlugins() {
                    const pluginData = [
                        { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                        { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                        { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                        { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                        { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: 'Portable Document Format' }
                    ];
                    const plugins = Object.create(PluginArray.prototype);
                    pluginData.forEach((p, i) => {
                        const plugin = Object.create(Plugin.prototype);
                        Object.defineProperties(plugin, {
                            name: { value: p.name },
                            filename: { value: p.filename },
                            description: { value: p.description },
                            length: { value: 0 }
                        });
                        plugins[i] = plugin;
                    });
                    Object.defineProperty(plugins, 'length', { value: pluginData.length });
                    return plugins;
                }
                try {
                    const plugins = mockPlugins();
                    Object.defineProperty(Navigator.prototype, 'plugins', {
                        get: () => plugins,
                        configurable: true
                    });
                } catch (e) {}

                // 5. Realistic WebGL Vendor & Renderer
                const getParameter = WebGLRenderingContext.prototype.getParameter;
                WebGLRenderingContext.prototype.getParameter = function(parameter) {
                    // UNMASKED_VENDOR_WEBGL
                    if (parameter === 37445) return 'Intel Inc.';
                    // UNMASKED_RENDERER_WEBGL
                    if (parameter === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                    return getParameter.apply(this, arguments);
                };

                if (typeof WebGL2RenderingContext !== 'undefined') {
                    const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
                    WebGL2RenderingContext.prototype.getParameter = function(parameter) {
                        if (parameter === 37445) return 'Intel Inc.';
                        if (parameter === 37446) return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
                        return getParameter2.apply(this, arguments);
                    };
                }

                // 6. Notification permission
                if (typeof Notification !== 'undefined') {
                    Object.defineProperty(Notification, 'permission', {
                        get: () => 'default',
                        configurable: true
                    });
                }

                // 7. Screen & Window dimensions
                Object.defineProperty(Screen.prototype, 'colorDepth', { get: () => 24 });
                Object.defineProperty(Screen.prototype, 'availWidth', { get: () => 1920 });
                Object.defineProperty(Screen.prototype, 'availHeight', { get: () => 1040 });
            """)

            logger.info("🌐 Navigating to https://web.whatsapp.com...")
            try:
                await self.page.goto("https://web.whatsapp.com", wait_until="domcontentloaded", timeout=120000)
            except Exception as nav_err:
                logger.warning(f"Initial navigation slow/timed out: {nav_err}. Background monitor will continue loading.")

            # Start background session watcher
            if self._monitor_task and not self._monitor_task.done():
                self._monitor_task.cancel()
            self._monitor_task = asyncio.create_task(self._monitor_session())

        except Exception as e:
            logger.error(f"❌ Failed to initialize WhatsApp Engine: {e}")
            self.last_error = str(e)
            self.is_ready = False
            self.connection_state = "disconnected"
        finally:
            self._is_initializing = False

    async def _monitor_session(self):
        """Continuously monitors login state, captures QR codes, and detects session changes."""
        logger.info("👀 WhatsApp session monitor started.")
        prev_ref: Optional[str] = None
        was_logged_in: bool = False
        login_confirm_count: int = 0
        logout_confirm_count: int = 0
        authenticating_since: Optional[float] = None  # Timestamp when authenticating started
        no_qr_count: int = 0  # Consecutive ticks with no QR elements after auth started
        last_diagnostic_time: float = 0  # Throttle diagnostic logs

        while True:
            try:
                if not self.page or self.page.is_closed():
                    await asyncio.sleep(2)
                    continue

                # Ensure we are on web.whatsapp.com
                try:
                    current_url = self.page.url
                    if "web.whatsapp.com" not in current_url:
                        logger.warning(f"Page is at {current_url}. Navigating to WhatsApp Web...")
                        await self.page.goto("https://web.whatsapp.com", wait_until="domcontentloaded", timeout=60000)
                        await asyncio.sleep(4)
                        continue
                except Exception as url_err:
                    logger.debug(f"URL check exception: {url_err}")
                    await asyncio.sleep(2)
                    continue

                # ── 1. Check if Logged In / Authenticated ──
                login_check = await self.page.evaluate("""
                    () => {
                        // 1. Core container selectors
                        const coreSelectors = [
                            '#pane-side', '#side', '#main',
                            'div[data-testid="chat-list"]',
                            'div[data-testid="chatlist-header"]',
                            'div[data-testid="conversation-panel-wrapper"]'
                        ];
                        for (const sel of coreSelectors) {
                            if (document.querySelector(sel)) return { logged_in: true, matched: sel };
                        }

                        // 2. Navigation bar icons & buttons
                        const navSelectors = [
                            'button[aria-label="Chats"]', 'button[aria-label="Channels"]',
                            'button[aria-label="Status"]', 'button[aria-label="Settings"]',
                            'button[aria-label="Communities"]',
                            'span[data-icon="chats-outline"]', 'span[data-icon="newsletter-outline"]',
                            'span[data-icon="community-outline"]', 'span[data-icon="status-outline"]',
                            'span[data-icon="menu"]', 'span[data-icon="chat"]',
                            'span[data-icon="newsletter"]', 'span[data-icon="status-v3"]',
                            'div[role="navigation"]'
                        ];
                        for (const sel of navSelectors) {
                            if (document.querySelector(sel)) return { logged_in: true, matched: sel };
                        }

                        // 3. Message composer
                        if (document.querySelector('footer div[contenteditable="true"]')) return { logged_in: true, matched: 'footer composer' };
                        if (document.querySelector('div[contenteditable="true"][data-tab]')) return { logged_in: true, matched: 'data-tab composer' };

                        // 4. Intro screen
                        if (document.querySelector('div[data-testid="intro-title"]')) return { logged_in: true, matched: 'intro-title' };
                        if (document.querySelector('div[data-testid="intro-text"]')) return { logged_in: true, matched: 'intro-text' };

                        // 5. Check QR-related elements (used for negative signal)
                        const hasQR = Boolean(
                            document.querySelector('canvas') ||
                            document.querySelector('div[data-ref]') ||
                            document.querySelector('[data-testid="qrcode"]') ||
                            document.querySelector('button[aria-label="Reload QR code"]')
                        );
                        const hasSpinner = Boolean(
                            document.querySelector('progress') ||
                            document.querySelector('span[data-icon="spinner"]') ||
                            document.querySelector('div[data-testid="loading-screen"]') ||
                            document.querySelector('div[role="progressbar"]')
                        );

                        // 6. Auto-dismiss dialogs
                        if (!hasQR) {
                            const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
                            const notNow = btns.find(b => {
                                const t = (b.innerText || '').toLowerCase();
                                return t.includes('not now') || t.includes('continue') || t.includes('ok, got it');
                            });
                            if (notNow) { try { notNow.click(); } catch(e) {} }
                        }

                        // 7. Diagnostic info for debugging
                        const appEl = document.querySelector('#app');
                        const bodyText = (document.body?.innerText || '').substring(0, 200);
                        const childCount = appEl ? appEl.children.length : 0;
                        const allDataTestIds = Array.from(document.querySelectorAll('[data-testid]'))
                            .slice(0, 10)
                            .map(el => el.getAttribute('data-testid'));

                        return {
                            logged_in: false,
                            hasQR: hasQR,
                            hasSpinner: hasSpinner,
                            appChildCount: childCount,
                            dataTestIds: allDataTestIds,
                            bodySnippet: bodyText.substring(0, 100)
                        };
                    }
                """)

                is_logged_in = login_check.get("logged_in", False) if login_check else False

                if is_logged_in:
                    logout_confirm_count = 0
                    no_qr_count = 0
                    authenticating_since = None
                    login_confirm_count += 1
                    if login_confirm_count >= 2 and not self.is_ready:
                        matched = login_check.get("matched", "unknown")
                        logger.info(f"🎉 ✅ WhatsApp Web authenticated & linked! (matched: {matched}) Ready for Channel broadcasting.")
                        self.connection_state = "connected"
                        self.is_ready = True
                        self.current_qr = None
                        self.qr_png_bytes = None
                        self.pairing_code = None
                        was_logged_in = True
                        
                        # Try to extract phone number from localStorage
                        try:
                            phone = await self.page.evaluate("() => { const wid = localStorage.getItem('last-wid') || localStorage.getItem('last-wid-md'); return wid ? wid.replace(/[^0-9]/g, '') : null; }")
                            if phone and len(phone) > 5:
                                phone = f"+{phone}"
                        except:
                            phone = None

                        self.user_info = {
                            "status": "active",
                            "phone": phone,
                            "channel_id": config.CHANNEL_ID,
                            "channel_link": config.CHANNEL_LINK,
                        }
                    await asyncio.sleep(2)
                    continue
                else:
                    login_confirm_count = 0

                    # ── AUTHENTICATION TIMEOUT ──
                    if authenticating_since:
                        elapsed = time.time() - authenticating_since
                        if elapsed > 120:
                            logger.error(f"❌ WhatsApp authentication timed out after {elapsed:.0f}s.")
                            self.connection_state = "error"
                            self.last_error = "WhatsApp authentication timed out. Please try connecting again."
                            self.is_ready = False
                            authenticating_since = None
                            await asyncio.sleep(2)
                            continue

                    # Handle logout detection
                    if was_logged_in and self.is_ready:
                        logout_confirm_count += 1
                        if logout_confirm_count >= 5:
                            logger.warning("⚠️ WhatsApp session was disconnected or logged out. Re-initializing pairing...")
                            self.is_ready = False
                            self.connection_state = "disconnected"
                            was_logged_in = False
                            logout_confirm_count = 0
                            authenticating_since = None
                            no_qr_count = 0
                        else:
                            await asyncio.sleep(1.5)
                            continue

                # ── 2. Check for Phone Pairing Code ──
                pairing_info = await self.page.evaluate("""
                    () => {
                        const codeEl = document.querySelector('[data-testid="link-device-phone-number-code"]')
                            || document.querySelector('div._ao3e');
                        if (codeEl) {
                            const text = codeEl.innerText || codeEl.textContent;
                            const clean = text.replace(/\\s/g, '').replace(/-/g, '');
                            if (clean.length >= 8) return { code: clean.slice(0, 8) };
                        }
                        const spans = Array.from(document.querySelectorAll('span, div'));
                        for (const el of spans) {
                            const t = (el.innerText || '').trim();
                            if (/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(t)) return { code: t.replace('-','') };
                            if (/^[A-Z0-9]{8}$/.test(t)) return { code: t };
                        }
                        return null;
                    }
                """)

                if pairing_info and pairing_info.get('code'):
                    code = pairing_info['code']
                    if self.pairing_code != code:
                        self.pairing_code = code
                        self.connection_state = "phone_pairing"
                        self.is_ready = False
                        logger.info(f"🔑 Phone pairing code generated: {code}")
                    await asyncio.sleep(2)
                    continue

                # ── 3. Check for QR Code State on Page ──
                qr_page_state = await self.page.evaluate("""
                    () => {
                        // Check if QR reload button is showing (QR expired)
                        const refreshBtn = document.querySelector('span[data-icon="refresh"]')?.closest('button')
                            || document.querySelector('button[aria-label="Reload QR code"]')
                            || document.querySelector('div[role="button"][data-testid="qrcode-reload-button"]');
                        if (refreshBtn) {
                            refreshBtn.click();
                            return { state: 'RELOAD_CLICKED' };
                        }

                        // Check for loading / authenticating spinner
                        const spinner = document.querySelector('progress, span[data-icon="spinner"], div[data-testid="loading-screen"], div[role="progressbar"]');
                        if (spinner) {
                            return { state: 'AUTHENTICATING' };
                        }

                        // PRIORITY: Try canvas first (most reliable QR capture)
                        const canvas = document.querySelector('canvas[aria-label="Scan this QR code with WhatsApp to log in"]')
                            || document.querySelector('canvas');
                        if (canvas) {
                            return { state: 'CANVAS_FOUND' };
                        }

                        // Fallback: Look for raw QR ref in div[data-ref]
                        const qrDiv = document.querySelector('div[data-ref]');
                        const ref = qrDiv ? qrDiv.getAttribute('data-ref') : null;
                        if (ref) {
                            return { state: 'REF_FOUND', ref: ref };
                        }

                        return { state: 'WAITING_PAGE_LOAD' };
                    }
                """)

                state = qr_page_state.get("state") if qr_page_state else "UNKNOWN"

                if state == "RELOAD_CLICKED":
                    logger.info("🔄 QR code expired on page. Clicked reload button...")
                    self.current_qr = None
                    self.qr_png_bytes = None
                    self.connection_state = "connecting"
                    authenticating_since = None
                    no_qr_count = 0
                    await asyncio.sleep(2)
                    continue

                if state == "AUTHENTICATING":
                    if self.connection_state != "authenticating":
                        logger.info("⏳ QR code scanned! Authenticating & synchronizing session with WhatsApp...")
                        self.connection_state = "authenticating"
                        self.current_qr = None
                        self.qr_png_bytes = None
                    # Start the timeout clock
                    if authenticating_since is None:
                        authenticating_since = time.time()
                        no_qr_count = 0
                    await asyncio.sleep(1.5)
                    continue

                if state == "CANVAS_FOUND":
                    # QR canvas is visible — reset auth timeout since QR is back
                    authenticating_since = None
                    no_qr_count = 0
                    try:
                        canvas_el = await self.page.query_selector("canvas")
                        if canvas_el:
                            screenshot_bytes = await canvas_el.screenshot()
                            if screenshot_bytes and len(screenshot_bytes) > 100:
                                self.qr_png_bytes = screenshot_bytes
                                self.current_qr = f"canvas_{int(time.time())}"
                                self.last_qr_time = time.time()
                                self.connection_state = "qr_pending"
                                self.is_ready = False
                                if not prev_ref or not prev_ref.startswith("canvas_"):
                                    logger.info("📱 QR code canvas captured. Ready for scanning.")
                                prev_ref = self.current_qr
                    except Exception as e:
                        logger.debug(f"Canvas screenshot error: {e}")

                elif state == "REF_FOUND":
                    authenticating_since = None
                    no_qr_count = 0
                    ref = qr_page_state.get("ref")
                    if ref and len(ref) > 50 and not ref.startswith("http"):
                        if ref != prev_ref or not self.qr_png_bytes:
                            prev_ref = ref
                            self.current_qr = ref
                            self.last_qr_time = time.time()
                            self.connection_state = "qr_pending"
                            self.is_ready = False
                            self._generate_qr_image(ref)
                            logger.info(f"📱 Fresh QR code generated from data-ref (len={len(ref)}). Ready for scanning.")
                    elif ref:
                        logger.debug(f"Ignoring invalid data-ref (not a QR code): {ref[:40]}...")

                else:
                    # WAITING_PAGE_LOAD — no QR, no spinner, no login selectors
                    # If we were previously in authenticating state, keep the timeout clock running
                    if self.connection_state == "authenticating" and authenticating_since is None:
                        authenticating_since = time.time()
                        no_qr_count = 0
                    if not self.is_ready:
                        if not authenticating_since:
                            self.connection_state = "connecting"

            except Exception as err:
                logger.debug(f"Monitor tick exception: {err}")

            await asyncio.sleep(1.5)

    def _generate_qr_image(self, qr_text: str):
        """Generates a crisp, high-contrast PNG byte buffer directly from the QR ref string."""
        try:
            qr = qrcode.QRCode(
                version=None,
                error_correction=qrcode.constants.ERROR_CORRECT_M,
                box_size=10,
                border=4,
            )
            qr.add_data(qr_text)
            qr.make(fit=True)
            img = qr.make_image(image_factory=PilImage, fill_color="#000000", back_color="#FFFFFF")
            buffer = io.BytesIO()
            img.save(buffer, format="PNG")
            self.qr_png_bytes = buffer.getvalue()
        except Exception as e:
            logger.error(f"Failed to generate QR image buffer: {e}")

    async def request_phone_pairing(self, phone_number: str) -> Dict[str, Any]:
        """Triggers WhatsApp Web's 'Link with phone number instead' flow."""
        if not self.page or self.page.is_closed():
            return {"success": False, "error": "Browser not ready. Please wait a few seconds."}

        try:
            # Click 'Link with phone number' button
            clicked = await self.page.evaluate("""
                () => {
                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
                    let node;
                    while (node = walker.nextNode()) {
                        if (!node.nodeValue) continue;
                        const t = node.nodeValue.toLowerCase();
                        if (t.includes('phone number') || t.includes('link with phone')) {
                            let el = node.parentElement;
                            while (el && el !== document.body) {
                                if (el.tagName === 'BUTTON' || el.tagName === 'A' || el.getAttribute('role') === 'button' || window.getComputedStyle(el).cursor === 'pointer') {
                                    el.click();
                                    return true;
                                }
                                el = el.parentElement;
                            }
                            if (node.parentElement) {
                                node.parentElement.click();
                                return true;
                            }
                        }
                    }
                    return false;
                }
            """)
            if not clicked:
                return {"success": False, "error": "Phone pairing button not found on page. Ensure QR page is fully loaded."}

            await asyncio.sleep(1.5)

            # Locate phone number input
            phone_input = await self.page.wait_for_selector(
                'input[type="text"], input[type="tel"], input[placeholder*="phone"], input[data-testid="link-device-phone-number-input"]',
                timeout=8000
            )
            if phone_input:
                await phone_input.fill(phone_number)
                await asyncio.sleep(0.5)
                # Click Next
                await self.page.evaluate("""
                    () => {
                        const btns = Array.from(document.querySelectorAll('button'));
                        const nextBtn = btns.find(el => {
                            const t = (el.innerText || '').toLowerCase();
                            return t.includes('next') || t.includes('continue') || t.includes('ok');
                        });
                        if (nextBtn) nextBtn.click();
                    }
                """)
                self.pairing_code = None
                self.connection_state = "phone_pairing"
                logger.info(f"📲 Phone pairing requested for: {phone_number}")
                return {"success": True, "message": "Phone number submitted. 8-digit pairing code will appear shortly."}

            return {"success": False, "error": "Could not find phone number input field"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def reset_session(self) -> Dict[str, Any]:
        """Completely clears unauthenticated/corrupted session state and reloads clean WhatsApp Web."""
        logger.warning("🔄 Resetting WhatsApp session and clearing browser cache...")
        async with self._lock:
            try:
                if self._monitor_task:
                    self._monitor_task.cancel()
                if self.browser_context:
                    await self.browser_context.close()
                if self.playwright:
                    await self.playwright.stop()
                    self.playwright = None

                # Remove session dir to ensure fresh clean state
                if os.path.exists(config.SESSION_DIR):
                    shutil.rmtree(config.SESSION_DIR, ignore_errors=True)

                self.connection_state = "disconnected"
                self.is_ready = False
                self.current_qr = None
                self.qr_png_bytes = None
                self.pairing_code = None
                self.user_info = None

                # Restart
                asyncio.create_task(self.initialize())
                return {"success": True, "message": "Session reset initiated. Fresh QR code will generate in a few seconds."}
            except Exception as e:
                logger.error(f"Error resetting session: {e}")
                return {"success": False, "error": str(e)}

    async def get_status(self) -> Dict[str, Any]:
        return {
            "state": self.connection_state,
            "isReady": self.is_ready,
            "hasQR": bool(self.current_qr or self.qr_png_bytes),
            "pairingCode": self.pairing_code,
            "lastQRTime": self.last_qr_time,
            "userInfo": self.user_info,
            "lastError": self.last_error,
        }

    async def get_qr_image(self) -> Optional[bytes]:
        return self.qr_png_bytes

    async def resolve_channel_metadata(self, invite_code_or_link: str) -> Optional[Dict[str, Any]]:
        """
        Resolve a WhatsApp Channel's real metadata (name, picture, description, subscribers)
        by navigating to the channel page in WhatsApp Web.
        Returns None if the engine is not connected or resolution fails.
        """
        if not self.is_ready or not self.page:
            return None

        import re
        # Extract invite code from URL if needed
        m = re.search(r'(?:whatsapp\.com/channel/)?([a-zA-Z0-9_-]{15,35})', invite_code_or_link)
        invite_code = m.group(1) if m else invite_code_or_link.strip()
        channel_url = f"https://whatsapp.com/channel/{invite_code}"

        async with self._lock:
            try:
                logger.info(f"🔍 Resolving channel metadata via WhatsApp Web: {channel_url}")

                # Navigate to the channel
                await self.page.goto(channel_url, wait_until="domcontentloaded", timeout=20000)
                await asyncio.sleep(3)

                # Scrape metadata from the channel page
                metadata = await self.page.evaluate("""
                    () => {
                        const result = { name: '', pictureUrl: '', description: '', subscribers_count: 0, jid: '' };

                        // Channel name from header
                        const headerTitle = document.querySelector(
                            'div[data-testid="conversation-info-header"] span[dir="auto"], ' +
                            'header span[title], ' +
                            'div[data-testid="conversation-header"] span[title], ' +
                            'span.x1rg5ohu[title]'
                        );
                        if (headerTitle) {
                            result.name = (headerTitle.getAttribute('title') || headerTitle.innerText || '').trim();
                        }

                        // Profile picture
                        const avatar = document.querySelector(
                            'div[data-testid="conversation-info-header"] img, ' +
                            'header img[draggable="false"], ' +
                            'div[data-testid="chat-avatar"] img, ' +
                            'img[data-testid="user-avatar"], ' +
                            'div[data-testid="conversation-header"] img'
                        );
                        if (avatar && avatar.src && !avatar.src.includes('default') && !avatar.src.includes('data:')) {
                            result.pictureUrl = avatar.src;
                        }

                        // Subscriber/follower count
                        const subTexts = Array.from(document.querySelectorAll('span[dir="auto"], span'));
                        for (const el of subTexts) {
                            const txt = (el.innerText || '').toLowerCase();
                            const match = txt.match(/([\d,.]+[kKmM]?)\s*(subscribers?|followers?)/);
                            if (match) {
                                let num = match[1].replace(/,/g, '');
                                if (num.toLowerCase().endsWith('k')) num = String(parseFloat(num) * 1000);
                                if (num.toLowerCase().endsWith('m')) num = String(parseFloat(num) * 1000000);
                                result.subscribers_count = parseInt(num) || 0;
                                break;
                            }
                        }

                        // Description
                        const descEl = document.querySelector(
                            'div[data-testid="conversation-info-header"] span[class*="selectable-text"], ' +
                            'section span.selectable-text'
                        );
                        if (descEl) {
                            result.description = (descEl.innerText || '').trim();
                        }

                        return result;
                    }
                """)

                # Navigate back to main chat list
                await self.page.goto("https://web.whatsapp.com/", wait_until="domcontentloaded", timeout=15000)
                await asyncio.sleep(1)

                channel_name = metadata.get("name", "").strip()
                if not channel_name:
                    logger.warning(f"⚠️ Could not resolve channel name from WhatsApp Web for {invite_code}")
                    return None

                logger.info(f"✅ Resolved channel: name='{channel_name}', subscribers={metadata.get('subscribers_count', 0)}")
                return {
                    "id": invite_code,
                    "name": channel_name,
                    "link": channel_url,
                    "role": "admin",
                    "subscribers_count": metadata.get("subscribers_count", 0),
                    "verified": False,
                    "description": metadata.get("description", ""),
                    "pictureUrl": metadata.get("pictureUrl", ""),
                }

            except Exception as e:
                logger.error(f"❌ Failed to resolve channel metadata: {e}")
                # Try to navigate back to main page
                try:
                    await self.page.goto("https://web.whatsapp.com/", wait_until="domcontentloaded", timeout=10000)
                except Exception:
                    pass
                return None

    async def get_user_channels(self) -> Dict[str, Any]:
        """
        Discovers all WhatsApp Channels visible to the connected WhatsApp account.
        Uses robust multi-selector navigation, explicit waits, virtualized-list
        scrolling, and a metadata enrichment pass for ownership/admin detection.
        Returns diagnostics alongside the channel list for debugging.
        """
        discovery_start = time.time()
        diag = {
            "authenticated": False,
            "channels_page_opened": False,
            "nav_selector_used": None,
            "channel_items_seen": 0,
            "owned_channels_found": 0,
            "scroll_iterations": 0,
            "discovery_duration_ms": 0,
            "errors": [],
        }

        if not self.is_ready or not self.page:
            diag["errors"].append("WHATSAPP_SESSION_NOT_CONNECTED")
            return {
                "success": False,
                "error": "WhatsApp is not connected. Scan QR code to connect.",
                "channels": [],
                "diagnostics": diag,
            }

        diag["authenticated"] = True

        async with self._lock:
            try:
                logger.info("[WA DISCOVERY] session=%s starting channel discovery", self.session_identifier)

                # Verify page is alive and on WhatsApp Web
                try:
                    current_url = self.page.url or ""
                    if "web.whatsapp.com" not in current_url:
                        logger.info("[WA DISCOVERY] not on WhatsApp Web (url=%s), navigating...", current_url)
                        await self.page.goto("https://web.whatsapp.com/", wait_until="domcontentloaded", timeout=30000)
                        await asyncio.sleep(3)
                except Exception as nav_err:
                    diag["errors"].append(f"PAGE_NAVIGATION_FAILED: {nav_err}")
                    logger.error("[WA DISCOVERY] page navigation failed: %s", nav_err)
                    return {
                        "success": False,
                        "error": "Failed to navigate to WhatsApp Web",
                        "channels": [],
                        "diagnostics": diag,
                    }

                # ── Step 1: Navigate to Channels/Updates tab ──
                logger.info("[WA DISCOVERY] locating Channels navigation button")
                nav_clicked = False

                # Build the JS selector string from our centralized constants
                nav_selectors_js = json.dumps(WA_SELECTORS["CHANNEL_NAV_BUTTONS"])

                nav_result = await self.page.evaluate("""
                    (selectors) => {
                        for (const sel of selectors) {
                            let el = document.querySelector(sel);
                            if (el) {
                                // If we found an icon span, find its parent button
                                if (el.tagName === 'SPAN' && !el.matches('button')) {
                                    const btn = el.closest('button') || el.closest('[role="button"]') || el.parentElement;
                                    if (btn) el = btn;
                                }
                                el.click();
                                return { clicked: true, selector: sel };
                            }
                        }
                        return { clicked: false, selector: null };
                    }
                """, WA_SELECTORS["CHANNEL_NAV_BUTTONS"])

                nav_clicked = nav_result.get("clicked", False)
                diag["nav_selector_used"] = nav_result.get("selector")
                logger.info("[WA DISCOVERY] channels navigation clicked=%s selector=%s",
                            nav_clicked, diag["nav_selector_used"])

                if not nav_clicked:
                    # Fallback: Try using keyboard or finding any nav-like button
                    logger.warning("[WA DISCOVERY] primary nav click failed, trying text-based search")
                    nav_clicked = await self.page.evaluate("""
                        () => {
                            // Search for any button/element containing "Channels", "Updates", or "Newsletters" text
                            const candidates = Array.from(document.querySelectorAll('button, [role="tab"], [role="button"], nav a, nav button'));
                            for (const el of candidates) {
                                const text = (el.getAttribute('aria-label') || el.innerText || '').toLowerCase();
                                if (text === 'channels' || text === 'updates' || text === 'newsletters') {
                                    el.click();
                                    return true;
                                }
                            }
                            return false;
                        }
                    """)
                    if nav_clicked:
                        diag["nav_selector_used"] = "text-based-fallback"
                        logger.info("[WA DISCOVERY] text-based nav fallback succeeded")

                if not nav_clicked:
                    diag["errors"].append("CHANNELS_NAV_BUTTON_NOT_FOUND")
                    diag["channels_page_opened"] = False
                    logger.error("[WA DISCOVERY] could not find Channels navigation button")
                    # Save diagnostic screenshot
                    try:
                        screenshot_path = os.path.join(self.session_dir, "diag_nav_failed.png")
                        await self.page.screenshot(path=screenshot_path)
                        logger.info("[WA DISCOVERY] diagnostic screenshot saved: %s", screenshot_path)
                    except Exception:
                        pass
                    return {
                        "success": False,
                        "error": "CHANNELS_PAGE_NOT_FOUND",
                        "channels": [],
                        "diagnostics": diag,
                    }

                # ── Step 2: Wait for and verify the Channels view is active ──
                logger.info("[WA DISCOVERY] waiting for channels view to become active")
                channels_view_active = False

                # Try explicit wait_for_selector for view indicators
                view_indicator_selectors = WA_SELECTORS["CHANNEL_VIEW_INDICATORS"]
                for sel in view_indicator_selectors:
                    try:
                        await self.page.wait_for_selector(sel, timeout=3000)
                        channels_view_active = True
                        logger.info("[WA DISCOVERY] channels view confirmed via: %s", sel)
                        break
                    except Exception:
                        continue

                if not channels_view_active:
                    # Fallback: wait for any list item to appear (channels or otherwise)
                    logger.info("[WA DISCOVERY] no explicit view indicator found, waiting for list items...")
                    await asyncio.sleep(2)
                    # Check if any channel-like items exist
                    item_check = await self.page.evaluate("""
                        (itemSelectors) => {
                            for (const sel of itemSelectors) {
                                const items = document.querySelectorAll(sel);
                                if (items.length > 0) return { found: true, count: items.length, selector: sel };
                            }
                            return { found: false, count: 0, selector: null };
                        }
                    """, WA_SELECTORS["CHANNEL_ITEM_SELECTORS"])
                    if item_check.get("found"):
                        channels_view_active = True
                        logger.info("[WA DISCOVERY] found %d list items via %s",
                                    item_check["count"], item_check["selector"])
                    else:
                        # Last resort: wait another 3 seconds
                        await asyncio.sleep(3)
                        channels_view_active = True  # Proceed optimistically

                diag["channels_page_opened"] = channels_view_active

                # ── Step 3: Extract channels with scrolling for virtualized lists ──
                logger.info("[WA DISCOVERY] beginning channel extraction with scroll support")

                all_channels: Dict[str, Dict[str, Any]] = {}
                max_scroll_iterations = 8
                no_new_items_count = 0

                # Build the extraction JS with all our selectors
                item_sels_js = ", ".join(WA_SELECTORS["CHANNEL_ITEM_SELECTORS"])
                name_sels = WA_SELECTORS["CHANNEL_NAME_SELECTORS"]
                avatar_sels = WA_SELECTORS["CHANNEL_AVATAR_SELECTORS"]
                non_channel = WA_SELECTORS["NON_CHANNEL_NAMES"]

                for scroll_iter in range(max_scroll_iterations):
                    diag["scroll_iterations"] = scroll_iter + 1

                    channels_data = await self.page.evaluate("""
                        (config) => {
                            const results = [];
                            const itemSelectors = config.itemSelectors;
                            const nameSelectors = config.nameSelectors;
                            const avatarSelectors = config.avatarSelectors;
                            const nonChannelNames = new Set(config.nonChannelNames.map(n => n.toLowerCase()));

                            // Gather all candidate list items
                            const allItems = new Set();
                            for (const sel of itemSelectors) {
                                document.querySelectorAll(sel).forEach(el => allItems.add(el));
                            }

                            allItems.forEach(el => {
                                // Extract name
                                let name = '';
                                for (const nSel of nameSelectors) {
                                    const nameEl = el.querySelector(nSel);
                                    if (nameEl) {
                                        name = (nameEl.getAttribute('title') || nameEl.innerText || '').trim();
                                        if (name) break;
                                    }
                                }
                                if (!name) return;

                                // Filter out non-channel items
                                const lower = name.toLowerCase();
                                if (nonChannelNames.has(lower)) return;
                                // Skip very short or generic items
                                if (lower.length < 2) return;

                                // Extract channel ID from data attributes or links
                                let channelId = '';
                                // Check for data attributes
                                channelId = el.getAttribute('data-id') || el.getAttribute('data-testid-channel') || '';

                                // Check for links within the item
                                if (!channelId) {
                                    const linkEl = el.querySelector('a[href*="channel"], a[href*="newsletter"]');
                                    if (linkEl) {
                                        const href = linkEl.getAttribute('href') || '';
                                        const match = href.match(/channel\\/([a-zA-Z0-9_-]{15,35})/);
                                        if (match) channelId = match[1];
                                    }
                                }

                                // Check for JID or newsletter ID in nested elements
                                if (!channelId) {
                                    const allAttrs = el.querySelectorAll('[data-id], [data-jid]');
                                    for (const attrEl of allAttrs) {
                                        const val = attrEl.getAttribute('data-id') || attrEl.getAttribute('data-jid') || '';
                                        if (val.includes('@newsletter') || val.includes('channel')) {
                                            channelId = val;
                                            break;
                                        }
                                    }
                                }

                                // Extract avatar URL
                                let avatarUrl = '';
                                for (const aSel of avatarSelectors) {
                                    const imgEl = el.querySelector(aSel);
                                    if (imgEl) {
                                        const src = imgEl.getAttribute('src') || '';
                                        if (src && !src.includes('data:') && !src.includes('default')) {
                                            avatarUrl = src;
                                            break;
                                        }
                                    }
                                }

                                // Extract description / last message preview
                                const descEl = el.querySelector(
                                    'span[data-testid="last-msg-status"], ' +
                                    'span.matched-text, ' +
                                    'span[class*="selectable-text"], ' +
                                    'div[data-testid="cell-frame-secondary"] span'
                                );
                                const description = descEl ? descEl.innerText.trim() : '';

                                // Check for subscriber count text in the item
                                let subscriberText = '';
                                const spans = el.querySelectorAll('span');
                                for (const sp of spans) {
                                    const txt = (sp.innerText || '').toLowerCase();
                                    if (txt.match(/([\d,.]+[kKmM]?)\s*(subscribers?|followers?)/)) {
                                        subscriberText = sp.innerText.trim();
                                        break;
                                    }
                                }

                                results.push({
                                    name: name,
                                    channelId: channelId,
                                    avatarUrl: avatarUrl,
                                    description: description,
                                    subscriberText: subscriberText,
                                    // Position info for scroll detection
                                    offsetTop: el.offsetTop,
                                });
                            });

                            return results;
                        }
                    """, {
                        "itemSelectors": WA_SELECTORS["CHANNEL_ITEM_SELECTORS"],
                        "nameSelectors": WA_SELECTORS["CHANNEL_NAME_SELECTORS"],
                        "avatarSelectors": WA_SELECTORS["CHANNEL_AVATAR_SELECTORS"],
                        "nonChannelNames": list(WA_SELECTORS["NON_CHANNEL_NAMES"]),
                    })

                    prev_count = len(all_channels)

                    for ch in channels_data:
                        name = ch.get("name", "").strip()
                        if not name:
                            continue

                        # Determine the best available ID
                        ch_id = ch.get("channelId", "").strip()
                        if not ch_id:
                            # Generate a stable hash-based ID from the name as last resort
                            import hashlib
                            ch_id = f"wa_ch_{hashlib.md5(name.encode()).hexdigest()[:12]}"

                        # Parse subscriber count from text
                        sub_count = None
                        sub_text = ch.get("subscriberText", "")
                        if sub_text:
                            match = re.search(r'([\d,.]+)\s*([kKmM]?)', sub_text)
                            if match:
                                num_str = match.group(1).replace(",", "")
                                suffix = match.group(2).lower()
                                try:
                                    num = float(num_str)
                                    if suffix == "k":
                                        num *= 1000
                                    elif suffix == "m":
                                        num *= 1000000
                                    sub_count = int(num)
                                except (ValueError, TypeError):
                                    pass

                        # Reconstruct link from channel ID if it looks like an invite code
                        link = ""
                        if ch_id and not ch_id.startswith("wa_ch_") and "@" not in ch_id:
                            link = f"https://whatsapp.com/channel/{ch_id}"

                        if ch_id not in all_channels:
                            all_channels[ch_id] = {
                                "id": ch_id,
                                "name": name,
                                "link": link,
                                "description": ch.get("description", ""),
                                "avatar_url": ch.get("avatarUrl", ""),
                                "subscriber_count": sub_count,
                                "is_owned": None,  # Will be enriched in metadata pass
                                "is_admin": None,
                                "can_publish": None,
                                "source": "whatsapp_web",
                                "metadata_complete": False,
                            }

                    new_count = len(all_channels)
                    new_this_iter = new_count - prev_count
                    logger.info("[WA DISCOVERY] scroll_iter=%d items_in_dom=%d new_unique=%d total_unique=%d",
                                scroll_iter, len(channels_data), new_this_iter, new_count)

                    if new_this_iter == 0:
                        no_new_items_count += 1
                        if no_new_items_count >= 2:
                            logger.info("[WA DISCOVERY] no new items after 2 scroll attempts, stopping")
                            break
                    else:
                        no_new_items_count = 0

                    # Scroll the channel list to load more items
                    if scroll_iter < max_scroll_iterations - 1:
                        scrolled = await self.page.evaluate("""
                            (itemSelectors) => {
                                // Find the scrollable container
                                const containers = [
                                    document.querySelector('[data-testid="chat-list"]'),
                                    document.querySelector('[aria-label="Channel list"]'),
                                    document.querySelector('[role="list"]'),
                                    document.querySelector('#pane-side'),
                                ];
                                for (const container of containers) {
                                    if (container && container.scrollHeight > container.clientHeight) {
                                        container.scrollTop += 400;
                                        return true;
                                    }
                                }
                                // Try scrolling any list item's parent
                                for (const sel of itemSelectors) {
                                    const item = document.querySelector(sel);
                                    if (item) {
                                        const parent = item.parentElement;
                                        if (parent && parent.scrollHeight > parent.clientHeight) {
                                            parent.scrollTop += 400;
                                            return true;
                                        }
                                    }
                                }
                                return false;
                            }
                        """, WA_SELECTORS["CHANNEL_ITEM_SELECTORS"])

                        if scrolled:
                            await asyncio.sleep(1.5)  # Wait for lazy-loaded items

                diag["channel_items_seen"] = len(all_channels)
                logger.info("[WA DISCOVERY] extraction complete: %d unique channels found", len(all_channels))

                # ── Step 4: Metadata enrichment — check ownership per channel ──
                logger.info("[WA DISCOVERY] starting metadata enrichment pass")
                enriched_channels = []
                for ch_id, ch_data in all_channels.items():
                    enriched = await self._enrich_channel_metadata(ch_data)
                    enriched_channels.append(enriched)

                # Count owned
                owned_count = sum(1 for c in enriched_channels if c.get("can_publish"))
                diag["owned_channels_found"] = owned_count

                # ── Step 5: Navigate back to Chats ──
                await self._navigate_back_to_chats()

                # ── Step 6: Include configured default channel if not already discovered ──
                if config.CHANNEL_ID:
                    existing_ids = {c["id"] for c in enriched_channels}
                    if config.CHANNEL_ID not in existing_ids:
                        default_name = getattr(config, "CHANNEL_NAME", "") or "WhatsApp Channel"
                        enriched_channels.insert(0, {
                            "id": config.CHANNEL_ID,
                            "name": default_name,
                            "link": config.CHANNEL_LINK or f"https://whatsapp.com/channel/{config.CHANNEL_ID}",
                            "description": "Configured Target Channel",
                            "avatar_url": "",
                            "subscriber_count": None,
                            "is_owned": True,
                            "is_admin": True,
                            "can_publish": True,
                            "source": "config",
                            "metadata_complete": False,
                        })

                diag["discovery_duration_ms"] = int((time.time() - discovery_start) * 1000)
                logger.info("[WA DISCOVERY] ✅ completed: %d channels (%d publishable) in %dms",
                            len(enriched_channels), owned_count, diag["discovery_duration_ms"])

                return {
                    "success": True,
                    "channels": enriched_channels,
                    "diagnostics": diag,
                }

            except Exception as e:
                diag["errors"].append(str(e))
                diag["discovery_duration_ms"] = int((time.time() - discovery_start) * 1000)
                logger.error("[WA DISCOVERY] ❌ discovery failed: %s", e)
                # Save diagnostic screenshot
                try:
                    screenshot_path = os.path.join(self.session_dir, "diag_discovery_error.png")
                    await self.page.screenshot(path=screenshot_path)
                except Exception:
                    pass
                # Navigate back to chats to leave page in clean state
                await self._navigate_back_to_chats()
                return {
                    "success": False,
                    "error": f"CHANNEL_DISCOVERY_FAILED: {e}",
                    "channels": [],
                    "diagnostics": diag,
                }

    async def _navigate_back_to_chats(self):
        """Navigate back to the main Chats list view."""
        try:
            await self.page.evaluate("""
                (selectors) => {
                    for (const sel of selectors) {
                        let el = document.querySelector(sel);
                        if (el) {
                            if (el.tagName === 'SPAN') {
                                const btn = el.closest('button') || el.closest('[role="button"]');
                                if (btn) el = btn;
                            }
                            el.click();
                            return true;
                        }
                    }
                    return false;
                }
            """, WA_SELECTORS["CHAT_NAV_BUTTONS"])
            await asyncio.sleep(0.5)
        except Exception as e:
            logger.debug("[WA DISCOVERY] navigate back to chats failed: %s", e)

    async def _enrich_channel_metadata(self, channel: Dict[str, Any]) -> Dict[str, Any]:
        """
        Opens a discovered channel to extract detailed metadata:
        subscriber count, full description, avatar, and ownership/admin status.
        Determines can_publish by checking for a composer element.
        """
        ch_name = channel.get("name", "")
        ch_id = channel.get("id", "")
        ch_link = channel.get("link", "")
        logger.info("[WA DISCOVERY] enriching metadata for channel=%s id=%s", ch_name, ch_id)

        try:
            # Navigate to the channel — prefer link, fall back to clicking by name
            channel_opened = False

            if ch_link and "whatsapp.com/channel" in ch_link:
                try:
                    await self.page.goto(ch_link, wait_until="domcontentloaded", timeout=15000)
                    await asyncio.sleep(2)
                    channel_opened = True
                except Exception:
                    logger.debug("[WA DISCOVERY] direct link navigation failed for %s", ch_name)

            if not channel_opened:
                # Click the channel by name in the sidebar
                clicked = await self.page.evaluate("""
                    (name) => {
                        const lower = name.toLowerCase().trim();
                        const items = document.querySelectorAll(
                            'div[data-testid="cell-frame-container"], div[role="listitem"], ' +
                            'div[data-testid="list-item-newsletter"], div[data-testid="chat-list-item"]'
                        );
                        for (const item of items) {
                            if ((item.innerText || '').toLowerCase().includes(lower)) {
                                item.click();
                                return true;
                            }
                        }
                        return false;
                    }
                """, ch_name)
                if clicked:
                    await asyncio.sleep(2)
                    channel_opened = True

            if not channel_opened:
                logger.warning("[WA DISCOVERY] could not open channel %s for enrichment", ch_name)
                channel["metadata_complete"] = False
                channel["is_owned"] = False
                channel["is_admin"] = False
                channel["can_publish"] = False
                return channel

            # Scrape detailed metadata from the channel view
            detail_selectors = WA_SELECTORS["CHANNEL_DETAIL"]
            metadata = await self.page.evaluate("""
                (config) => {
                    const result = {
                        name: '',
                        avatarUrl: '',
                        description: '',
                        subscriberCount: null,
                        hasComposer: false,
                        hasAdminIndicator: false,
                    };

                    // Channel name from header
                    for (const sel of config.headerNameSels) {
                        const el = document.querySelector(sel);
                        if (el) {
                            result.name = (el.getAttribute('title') || el.innerText || '').trim();
                            if (result.name) break;
                        }
                    }

                    // Avatar
                    for (const sel of config.avatarSels) {
                        const el = document.querySelector(sel);
                        if (el && el.src && !el.src.includes('data:') && !el.src.includes('default')) {
                            result.avatarUrl = el.src;
                            break;
                        }
                    }

                    // Description
                    for (const sel of config.descSels) {
                        const el = document.querySelector(sel);
                        if (el && el.innerText) {
                            result.description = el.innerText.trim();
                            if (result.description) break;
                        }
                    }

                    // Subscriber count — search all visible spans
                    const allSpans = document.querySelectorAll('span, div');
                    const subRegex = /([\d,.]+[kKmM]?)\s*(subscribers?|followers?)/i;
                    for (const sp of allSpans) {
                        const txt = (sp.innerText || '');
                        const match = txt.match(subRegex);
                        if (match) {
                            let num = match[1].replace(/,/g, '');
                            const suffix = num.slice(-1).toLowerCase();
                            if (suffix === 'k') num = String(parseFloat(num) * 1000);
                            else if (suffix === 'm') num = String(parseFloat(num) * 1000000);
                            result.subscriberCount = parseInt(num) || 0;
                            break;
                        }
                    }

                    // Check for composer (indicates admin/owner can publish)
                    for (const sel of config.composerSels) {
                        const el = document.querySelector(sel);
                        if (el) {
                            result.hasComposer = true;
                            break;
                        }
                    }

                    // Check for admin indicators
                    for (const sel of config.adminSels) {
                        const el = document.querySelector(sel);
                        if (el) {
                            result.hasAdminIndicator = true;
                            break;
                        }
                    }

                    return result;
                }
            """, {
                "headerNameSels": detail_selectors["header_name"],
                "avatarSels": detail_selectors["avatar"],
                "descSels": detail_selectors["description"],
                "composerSels": detail_selectors["composer"],
                "adminSels": detail_selectors["admin_indicators"],
            })

            # Update channel with enriched data
            if metadata.get("name"):
                channel["name"] = metadata["name"]
            if metadata.get("avatarUrl"):
                channel["avatar_url"] = metadata["avatarUrl"]
            if metadata.get("description"):
                channel["description"] = metadata["description"]
            if metadata.get("subscriberCount") is not None:
                channel["subscriber_count"] = metadata["subscriberCount"]

            # Ownership / publish capability
            has_composer = metadata.get("hasComposer", False)
            has_admin = metadata.get("hasAdminIndicator", False)
            channel["can_publish"] = has_composer
            channel["is_admin"] = has_composer or has_admin
            channel["is_owned"] = has_composer  # Composer presence = definitive publish access
            channel["metadata_complete"] = True

            logger.info("[WA DISCOVERY] enriched channel=%s subs=%s can_publish=%s",
                        channel["name"], channel.get("subscriber_count"), channel["can_publish"])

            # Navigate back — use browser back or go to main page
            try:
                await self.page.go_back(wait_until="domcontentloaded", timeout=5000)
                await asyncio.sleep(0.5)
            except Exception:
                pass

            return channel

        except Exception as e:
            logger.warning("[WA DISCOVERY] metadata enrichment failed for %s: %s", ch_name, e)
            channel["metadata_complete"] = False
            channel["is_owned"] = False
            channel["is_admin"] = False
            channel["can_publish"] = False
            return channel

    async def logout_session(self) -> Dict[str, Any]:
        """Gracefully logs out of WhatsApp Web and purges session storage."""
        logger.warning("🚪 Logging out WhatsApp Web session...")
        async with self._lock:
            try:
                if self.page and not self.page.is_closed():
                    try:
                        # Attempt UI logout
                        await self.page.evaluate("""
                            () => {
                                const menuBtn = document.querySelector('button[aria-label="Menu"], span[data-icon="menu"]')?.closest('button');
                                if (menuBtn) {
                                    menuBtn.click();
                                    setTimeout(() => {
                                        const items = Array.from(document.querySelectorAll('div[role="button"], li'));
                                        const logout = items.find(i => (i.innerText || '').toLowerCase().includes('log out'));
                                        if (logout) logout.click();
                                    }, 500);
                                }
                            }
                        """)
                        await asyncio.sleep(2)
                    except Exception:
                        pass

                if self._monitor_task:
                    self._monitor_task.cancel()
                if self.browser_context:
                    await self.browser_context.close()
                if self.playwright:
                    await self.playwright.stop()
                    self.playwright = None

                # Purge session directory
                if os.path.exists(self.session_dir):
                    shutil.rmtree(self.session_dir, ignore_errors=True)

                self.connection_state = "disconnected"
                self.is_ready = False
                self.current_qr = None
                self.qr_png_bytes = None
                self.pairing_code = None
                self.user_info = None

                # Re-initialize clean engine
                asyncio.create_task(self.initialize())
                logger.info("✅ Session successfully logged out. Ready for new account pairing.")
                return {"success": True, "message": "WhatsApp session disconnected successfully."}
            except Exception as e:
                logger.error(f"Error during logout: {e}")
                return {"success": False, "error": str(e)}

    async def publish_to_channel(
        self,
        text: Optional[str] = None,
        media_url: Optional[str] = None,
        caption: Optional[str] = None,
        channel_id: Optional[str] = None,
        channel_link: Optional[str] = None,
        channel_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Publishes message or media to a WhatsApp Channel inside WhatsApp Web with high speed."""
        if not self.is_ready or not self.page:
            raise Exception("WhatsApp is not connected. Please scan the QR code to link your device first.")

        target_name = channel_name or getattr(config, "CHANNEL_NAME", "") or "WhatsApp Channel"
        target_id = channel_id or config.CHANNEL_ID
        target_link = channel_link or config.CHANNEL_LINK

        content = caption or text or ""
        post_id = f"wa_channel_{int(time.time() * 1000)}"

        async with self._lock:
            try:
                logger.info(f"⚡ Publishing to WhatsApp Channel '{target_name}'...")

                # Ensure page is on WhatsApp Web
                current_url = self.page.url or ""
                if "web.whatsapp.com" not in current_url:
                    await self.page.goto("https://web.whatsapp.com/", wait_until="domcontentloaded", timeout=30000)
                    await asyncio.sleep(2)

                # ── Strategy 1: Navigate to channel via its link URL ──
                if target_link and "whatsapp.com/channel" in target_link:
                    logger.info(f"📍 Navigating to channel via link: {target_link}")
                    try:
                        await self.page.goto(target_link, wait_until="domcontentloaded", timeout=20000)
                        await asyncio.sleep(3)
                    except Exception as e:
                        logger.debug(f"Direct channel link navigation failed: {e}")

                # ── Strategy 2: Click on channel in sidebar list ──
                clicked = await self.page.evaluate("""
                    (name) => {
                        const lower = (name || '').toLowerCase().trim();
                        
                        // First try to click on the Channels/Updates/Newsletters tab
                        const channelsBtn = document.querySelector('button[aria-label="Channels"], button[aria-label="Updates"], button[aria-label="Newsletters"]')
                            || document.querySelector('span[data-icon="newsletter-outline"], span[data-icon="newsletter"]')?.closest('button');
                        if (channelsBtn) {
                            channelsBtn.click();
                        }

                        // Wait a bit for list to render, then search
                        const items = Array.from(document.querySelectorAll(
                            'div[data-testid="cell-frame-container"], div[role="listitem"], ' +
                            'div[data-testid="list-item-newsletter"], div[data-testid="chat-list-item"], ' +
                            'div[role="row"], div[role="gridcell"], a[role="listitem"]'
                        ));
                        for (const item of items) {
                            if ((item.innerText || '').toLowerCase().includes(lower)) {
                                item.click();
                                return true;
                            }
                        }
                        return false;
                    }
                """, target_name)

                if not clicked:
                    await asyncio.sleep(1.5)
                    # Retry after Channels tab loads
                    clicked = await self.page.evaluate("""
                        (name) => {
                            const lower = (name || '').toLowerCase().trim();
                            const items = Array.from(document.querySelectorAll(
                                'div[data-testid="cell-frame-container"], div[role="listitem"], ' +
                                'div[data-testid="list-item-newsletter"], div[data-testid="chat-list-item"], ' +
                                'div[role="row"], div[role="gridcell"], span, a'
                            ));
                            for (const item of items) {
                                const txt = (item.innerText || '').toLowerCase();
                                if (txt.includes(lower) && txt.length < 200) {
                                    item.click();
                                    return true;
                                }
                            }
                            // Click first item as fallback
                            const firstItems = Array.from(document.querySelectorAll(
                                'div[data-testid="cell-frame-container"], div[role="listitem"]'
                            ));
                            if (firstItems.length > 0) {
                                firstItems[0].click();
                                return true;
                            }
                            return false;
                        }
                    """, target_name)

                await asyncio.sleep(2)

                # ── 2. Find composer — try multiple selectors for Channel compose box ──
                # WhatsApp Channel composer selectors differ from regular chat
                composer_selectors = [
                    'div[data-testid="conversation-compose-box-input"]',
                    'div[contenteditable="true"][data-tab="10"]',
                    'div[contenteditable="true"][data-tab="6"]',
                    'div[contenteditable="true"][data-tab]',
                    'footer div[contenteditable="true"]',
                    'footer p.selectable-text',
                    'div[role="textbox"]',
                    'div[contenteditable="true"]',
                ]

                composer = None
                for sel in composer_selectors:
                    try:
                        composer = await self.page.wait_for_selector(sel, timeout=3000)
                        if composer:
                            logger.info(f"✅ Found composer with selector: {sel}")
                            break
                    except Exception:
                        continue

                if not composer:
                    # Diagnostic: dump what's on the page
                    diag = await self.page.evaluate("""
                        () => {
                            const editables = Array.from(document.querySelectorAll('[contenteditable]'))
                                .map(e => ({
                                    tag: e.tagName, 
                                    role: e.getAttribute('role'),
                                    dataTab: e.getAttribute('data-tab'),
                                    testId: e.getAttribute('data-testid'),
                                    parent: e.parentElement?.tagName
                                }));
                            const testIds = Array.from(document.querySelectorAll('[data-testid]'))
                                .slice(0, 15)
                                .map(e => e.getAttribute('data-testid'));
                            return { editables, testIds, url: window.location.href };
                        }
                    """)
                    logger.error(f"❌ No composer found! Diagnostics: {diag}")
                    raise Exception(
                        f"Could not find message composer for channel '{target_name}'. "
                        f"The channel may not be open or the page is not rendering correctly. "
                        f"Page elements: {diag.get('testIds', [])[:5]}"
                    )

                # ── 3. Publish content ──
                if media_url:
                    logger.info(f"Downloading media: {media_url[:50]}...")
                    async with httpx.AsyncClient(timeout=20.0) as client:
                        resp = await client.get(media_url)
                        if resp.status_code != 200:
                            raise Exception(f"Failed to download media (HTTP {resp.status_code})")
                        media_bytes = resp.content

                    temp_ext = ".mp4" if any(x in media_url.lower() for x in [".mp4", ".mov"]) else ".jpg"
                    temp_path = os.path.abspath(f"temp_upload_{int(time.time())}{temp_ext}")

                    with open(temp_path, "wb") as f:
                        f.write(media_bytes)

                    try:
                        file_input = await self.page.query_selector('input[type="file"]')
                        if not file_input:
                            attach_btn = await self.page.query_selector(
                                'span[data-icon="plus"], span[data-icon="attach-menu-plus"], '
                                'div[title="Attach"], button[aria-label="Attach"], '
                                'span[data-icon="clip"]'
                            )
                            if attach_btn:
                                await attach_btn.click()
                                await asyncio.sleep(0.5)
                                file_input = await self.page.query_selector('input[type="file"]')

                        if file_input:
                            await file_input.set_input_files(temp_path)
                            await asyncio.sleep(1.5)

                            if content:
                                caption_box = await self.page.query_selector('div[contenteditable="true"]')
                                if caption_box:
                                    await caption_box.fill(content)

                            send_btn = await self.page.wait_for_selector(
                                'span[data-icon="send"], span[data-icon="send-light"], '
                                'div[aria-label="Send"], span[data-icon="send-alt"], '
                                'button[aria-label="Send"]',
                                timeout=10000
                            )
                            if send_btn:
                                await send_btn.click()
                                await asyncio.sleep(1.5)
                        else:
                            await composer.click()
                            await composer.fill(f"{content}\n{media_url}".strip())
                            await self.page.keyboard.press("Enter")
                            await asyncio.sleep(1)
                    finally:
                        if os.path.exists(temp_path):
                            try:
                                os.remove(temp_path)
                            except Exception:
                                pass
                else:
                    await composer.click()
                    await asyncio.sleep(0.2)
                    await composer.fill(content)
                    await asyncio.sleep(0.3)
                    await self.page.keyboard.press("Enter")
                    await asyncio.sleep(1)

                logger.info(f"✅ Published post to WhatsApp Channel '{target_name}'! Post ID: {post_id}")
                return {
                    "success": True,
                    "platform": "whatsapp_channel",
                    "messageId": post_id,
                    "channelId": target_id,
                    "channelName": target_name,
                    "channelLink": target_link,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }

            except Exception as err:
                logger.error(f"❌ Error publishing to channel: {err}")
                raise Exception(f"Failed to publish to WhatsApp Channel: {str(err)}")

    async def close(self):
        """Gracefully closes browser and stops Playwright."""
        if self._monitor_task:
            self._monitor_task.cancel()
        if self.browser_context:
            await self.browser_context.close()
        if self.playwright:
            await self.playwright.stop()

