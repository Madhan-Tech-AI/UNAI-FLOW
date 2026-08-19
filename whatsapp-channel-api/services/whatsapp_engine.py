import asyncio
import io
import os
import shutil
import time
import logging
from typing import Optional, Dict, Any
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

    def __init__(self):
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

            os.makedirs(config.SESSION_DIR, exist_ok=True)

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
                    user_data_dir=config.SESSION_DIR,
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
                    user_data_dir=config.SESSION_DIR,
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
                        // 1. Core navigation and chat list selectors
                        if (document.querySelector('#side') || document.querySelector('#main') || document.querySelector('#pane-side')) return true;
                        if (document.querySelector('div[data-testid="chat-list"]') || document.querySelector('div[data-testid="conversation-panel-wrapper"]')) return true;
                        if (document.querySelector('div[data-testid="chatlist-header"]') || document.querySelector('div[role="navigation"]')) return true;
                        if (document.querySelector('div[data-testid="intro-title"]') || document.querySelector('div[data-testid="intro-text"]')) return true;

                        // 2. Navigation bar icons & buttons (Chats, Channels, Status, Communities, Settings)
                        if (document.querySelector('button[aria-label="Chats"], button[aria-label="Channels"], button[aria-label="Status"], button[aria-label="Settings"], button[aria-label="Communities"]')) return true;
                        if (document.querySelector('span[data-icon="chats-outline"], span[data-icon="newsletter-outline"], span[data-icon="community-outline"], span[data-icon="status-outline"], span[data-icon="menu"]')) return true;
                        if (document.querySelector('span[data-icon="chat"], span[data-icon="newsletter"], span[data-icon="status-v3"]')) return true;

                        // 3. Message composer / header
                        if (document.querySelector('div[contenteditable="true"][data-tab]') || document.querySelector('footer div[contenteditable="true"]')) return true;

                        // 4. Auto-dismiss any blocking promo/notification dialogs
                        const dismissButtons = Array.from(document.querySelectorAll('button, div[role="button"]'));
                        const notNow = dismissButtons.find(b => {
                            const t = (b.innerText || '').toLowerCase();
                            return t.includes('not now') || t.includes('continue') || t.includes('close') || t.includes('ok');
                        });
                        if (notNow && !document.querySelector('canvas') && !document.querySelector('div[data-ref]')) {
                            try { notNow.click(); } catch(e) {}
                        }

                        // 5. Check if QR code is completely gone (consumed upon phone scan)
                        const hasQR = Boolean(
                            document.querySelector('canvas') || 
                            document.querySelector('div[data-ref]') || 
                            document.querySelector('[data-testid="qrcode"]') ||
                            document.querySelector('button[aria-label="Reload QR code"]') ||
                            document.querySelector('span[data-icon="refresh"]')
                        );

                        // If no QR elements exist and we have header/app container or sync elements -> logged in!
                        const hasAppUI = Boolean(
                            document.querySelector('header') || 
                            document.querySelector('nav') || 
                            document.querySelector('#app') ||
                            document.querySelector('div[role="region"]')
                        );

                        if (!hasQR && hasAppUI) {
                            return true;
                        }

                        return false;
                    }
                """)

                if login_check:
                    if not self.is_ready:
                        logger.info("🎉 ✅ WhatsApp Web authenticated & linked successfully! Ready for Channel broadcasting.")
                        self.connection_state = "connected"
                        self.is_ready = True
                        self.current_qr = None
                        self.qr_png_bytes = None
                        self.pairing_code = None
                        was_logged_in = True
                        self.user_info = {
                            "status": "active",
                            "channel_id": config.CHANNEL_ID,
                            "channel_link": config.CHANNEL_LINK,
                        }
                    await asyncio.sleep(2)
                    continue
                else:
                    # If we were previously logged in and now we are not -> Session expired / Logged out
                    if was_logged_in and self.is_ready:
                        logger.warning("⚠️ WhatsApp session was disconnected or logged out. Re-initializing pairing...")
                        self.is_ready = False
                        self.connection_state = "disconnected"
                        was_logged_in = False

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

                        // Look for raw QR ref in div[data-ref]
                        const qrDiv = document.querySelector('div[data-ref]');
                        const ref = qrDiv ? qrDiv.getAttribute('data-ref') : null;

                        // Look for canvas
                        const canvas = document.querySelector('canvas[aria-label="Scan this QR code with WhatsApp to log in"]')
                            || document.querySelector('canvas');

                        if (ref) {
                            return { state: 'REF_FOUND', ref: ref };
                        }
                        if (canvas) {
                            return { state: 'CANVAS_ONLY' };
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
                    await asyncio.sleep(2)
                    continue

                if state == "AUTHENTICATING":
                    if self.connection_state != "authenticating":
                        logger.info("⏳ QR code scanned! Authenticating & synchronizing session with WhatsApp...")
                        self.connection_state = "authenticating"
                        self.current_qr = None
                        self.qr_png_bytes = None
                    await asyncio.sleep(1.5)
                    continue

                if state == "REF_FOUND":
                    ref = qr_page_state.get("ref")
                    if ref and (ref != prev_ref or not self.qr_png_bytes):
                        prev_ref = ref
                        self.current_qr = ref
                        self.last_qr_time = time.time()
                        self.connection_state = "qr_pending"
                        self.is_ready = False
                        # Generate clean, high-precision QR image from data-ref
                        self._generate_qr_image(ref)
                        logger.info(f"📱 Fresh QR code generated (ref: {ref[:20]}...). Ready for scanning.")

                elif state == "CANVAS_ONLY":
                    if not self.qr_png_bytes:
                        try:
                            canvas_el = await self.page.query_selector("canvas")
                            if canvas_el:
                                self.qr_png_bytes = await canvas_el.screenshot()
                                self.current_qr = f"canvas_{int(time.time())}"
                                self.last_qr_time = time.time()
                                self.connection_state = "qr_pending"
                                logger.info("📱 QR code canvas captured. Ready for scanning.")
                        except Exception as e:
                            logger.debug(f"Canvas screenshot error: {e}")
                else:
                    if not self.is_ready:
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

    async def publish_to_channel(self, text: Optional[str] = None, media_url: Optional[str] = None, caption: Optional[str] = None) -> Dict[str, Any]:
        """Publishes message or media to configured WhatsApp Channel."""
        if not self.is_ready:
            raise Exception("WhatsApp is not connected. Please link your device first.")

        content = caption or text or ""
        post_id = f"wa_channel_{int(time.time() * 1000)}"

        async with self._lock:
            try:
                logger.info(f"📢 Publishing post to Channel ({config.CHANNEL_LINK})...")
                
                # Navigate to the Channel URL
                await self.page.goto(config.CHANNEL_LINK, wait_until="domcontentloaded", timeout=45000)
                await asyncio.sleep(3)

                # Look for the message composer
                composer = await self.page.wait_for_selector(
                    'div[contenteditable="true"], footer p.selectable-text, div[data-testid="conversation-compose-box-input"]',
                    timeout=20000
                )

                if media_url:
                    logger.info(f"Downloading media from: {media_url[:60]}...")
                    async with httpx.AsyncClient(timeout=30.0) as client:
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
                                'span[data-icon="plus"], span[data-icon="attach-menu-plus"], div[title="Attach"]'
                            )
                            if attach_btn:
                                await attach_btn.click()
                                await asyncio.sleep(1)
                                file_input = await self.page.query_selector('input[type="file"]')

                        if file_input:
                            await file_input.set_input_files(temp_path)
                            await asyncio.sleep(2)

                            if content:
                                caption_box = await self.page.query_selector('div[contenteditable="true"]')
                                if caption_box:
                                    await caption_box.fill(content)

                            send_btn = await self.page.wait_for_selector(
                                'span[data-icon="send"], span[data-icon="send-light"], div[aria-label="Send"]',
                                timeout=15000
                            )
                            if send_btn:
                                await send_btn.click()
                                await asyncio.sleep(3)
                        else:
                            await composer.fill(f"{content}\n{media_url}".strip())
                            await self.page.keyboard.press("Enter")
                            await asyncio.sleep(2)
                    finally:
                        if os.path.exists(temp_path):
                            try:
                                os.remove(temp_path)
                            except Exception:
                                pass
                else:
                    await composer.fill(content)
                    await asyncio.sleep(0.5)
                    await self.page.keyboard.press("Enter")
                    await asyncio.sleep(2)

                logger.info(f"✅ Successfully published post to WhatsApp Channel! Post ID: {post_id}")
                return {
                    "success": True,
                    "platform": "whatsapp_channel",
                    "messageId": post_id,
                    "channelId": config.CHANNEL_ID,
                    "channelLink": config.CHANNEL_LINK,
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

# Global singleton
whatsapp_engine = WhatsAppEngine()
