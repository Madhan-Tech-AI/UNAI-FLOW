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

    async def get_user_channels(self) -> Dict[str, Any]:
        """
        Discovers all WhatsApp Channels owned or administered by the connected WhatsApp account.
        Scrapes channels from WhatsApp Web's Channels/Newsletter panel.
        """
        if not self.is_ready or not self.page:
            return {
                "success": False,
                "error": "WhatsApp is not connected. Scan QR code to connect.",
                "channels": []
            }

        async with self._lock:
            try:
                logger.info("🔍 Discovering WhatsApp Channels from connected account...")

                # 1. Click the Channels / Updates navigation button
                await self.page.evaluate("""
                    () => {
                        const channelsBtn = document.querySelector('button[aria-label="Channels"], button[aria-label="Updates"], button[aria-label="Newsletters"]')
                            || document.querySelector('span[data-icon="newsletter-outline"], span[data-icon="newsletter"], span[data-icon="status-outline"]')?.closest('button');
                        if (channelsBtn) channelsBtn.click();
                    }
                """)
                await asyncio.sleep(2)

                # 2. Extract channels from the sidebar / list
                channels_data = await self.page.evaluate("""
                    () => {
                        const list = [];
                        // Query all channel / newsletter list items
                        const channelItems = document.querySelectorAll(
                            'div[data-testid="cell-frame-container"], div[role="listitem"], div[data-testid="list-item-newsletter"]'
                        );

                        channelItems.forEach((el, index) => {
                            const titleEl = el.querySelector('span[title], div[title], span.x1rg5ohu, span[dir="auto"]');
                            const name = titleEl ? (titleEl.getAttribute('title') || titleEl.innerText || '').trim() : '';
                            if (!name) return;

                            // Skip general status / non-channel items
                            const lower = name.toLowerCase();
                            if (lower === 'my status' || lower === 'status' || lower === 'channels' || lower === 'find channels') return;

                            const descEl = el.querySelector('span[data-testid="last-msg-status"], p, span.selectable-text');
                            const description = descEl ? descEl.innerText.trim() : '';

                            // Generate clean ID from name or index
                            const id = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();

                            list.push({
                                id: id,
                                name: name,
                                description: description,
                                link: ''
                            });
                        });

                        return list;
                    }
                """)

                # Return back to main chat list
                await self.page.evaluate("""
                    () => {
                        const chatsBtn = document.querySelector('button[aria-label="Chats"], span[data-icon="chats-outline"]')?.closest('button');
                        if (chatsBtn) chatsBtn.click();
                    }
                """)

                # Build final channel list
                discovered = []
                seen_names = set()

                if config.CHANNEL_ID:
                    default_name = getattr(config, "CHANNEL_NAME", "") or "WhatsApp Channel"
                    default_id = config.CHANNEL_ID
                    default_link = config.CHANNEL_LINK

                    discovered.append({
                        "id": default_id,
                        "name": default_name,
                        "link": default_link,
                        "description": "Configured Target Channel",
                        "isDefault": True,
                    })
                    seen_names.add(default_name.lower())
                    seen_names.add(default_id.lower())

                for ch in channels_data:
                    cname = ch.get("name", "").strip()
                    if cname and cname.lower() not in seen_names:
                        seen_names.add(cname.lower())
                        discovered.append({
                            "id": ch.get("id") or f"ch_{len(discovered) + 1}",
                            "name": cname,
                            "link": ch.get("link") or "",
                            "description": ch.get("description", "WhatsApp Channel"),
                            "isDefault": len(discovered) == 0,
                        })

                logger.info(f"✅ Discovered {len(discovered)} WhatsApp Channel(s).")
                return {
                    "success": True,
                    "channels": discovered
                }

            except Exception as e:
                logger.error(f"Error discovering channels: {e}")
                return {
                    "success": True,
                    "channels": []
                }

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

# Global singleton
whatsapp_engine = WhatsAppEngine()

