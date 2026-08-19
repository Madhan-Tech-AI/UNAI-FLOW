import asyncio
import io
import os
import time
import logging
import qrcode
import httpx
from typing import Optional, Dict, Any
from config import config

logging.basicConfig(level=logging.INFO, format="[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s")
logger = logging.getLogger("WhatsAppEngine")

class WhatsAppEngine:
    """
    Python WhatsApp Channel Automation Engine using Playwright with persistent sessions.
    Runs headless Chromium to manage WhatsApp Web session and publish to WhatsApp Channels.
    """
    def __init__(self):
        self.playwright = None
        self.browser_context = None
        self.page = None
        self.connection_state: str = "disconnected"  # disconnected | connecting | qr_pending | phone_pairing | connected
        self.is_ready: bool = False
        self.current_qr: Optional[str] = None
        self.qr_png_bytes: Optional[bytes] = None
        self.pairing_code: Optional[str] = None  # 8-digit phone pairing code
        self.user_info: Optional[Dict[str, Any]] = None
        self.last_qr_time: Optional[float] = None
        self._monitor_task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()

    async def initialize(self):
        """Initializes Playwright and launches the browser context."""
        logger.info("Initializing Python WhatsApp Web engine...")
        self.connection_state = "connecting"
        
        try:
            from playwright.async_api import async_playwright
            self.playwright = await async_playwright().start()

            os.makedirs(config.SESSION_DIR, exist_ok=True)

            user_agent = (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            )

            launch_args = [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--disable-gpu",
                "--disable-blink-features=AutomationControlled",
            ]

            try:
                self.browser_context = await self.playwright.chromium.launch_persistent_context(
                    user_data_dir=config.SESSION_DIR,
                    headless=True,
                    user_agent=user_agent,
                    args=launch_args,
                    viewport={"width": 1280, "height": 800},
                    ignore_default_args=["--enable-automation"],
                )
            except Exception as launch_err:
                logger.warning(f"Initial launch failed ({launch_err}), attempting to install Playwright chromium...")
                import subprocess
                subprocess.run(["playwright", "install", "chromium"], check=False)
                self.browser_context = await self.playwright.chromium.launch_persistent_context(
                    user_data_dir=config.SESSION_DIR,
                    headless=True,
                    user_agent=user_agent,
                    args=launch_args,
                    viewport={"width": 1280, "height": 800},
                    ignore_default_args=["--enable-automation"],
                )

            if len(self.browser_context.pages) > 0:
                self.page = self.browser_context.pages[0]
            else:
                self.page = await self.browser_context.new_page()
                
            # Stealth injections to bypass WhatsApp "couldn't link device" automation detection
            await self.browser_context.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
                window.navigator.chrome = { runtime: {} };
                Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
                Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            """)

            logger.info("Navigating to https://web.whatsapp.com...")
            try:
                await self.page.goto("https://web.whatsapp.com", wait_until="domcontentloaded", timeout=120000)
            except Exception as nav_err:
                logger.warning(f"Initial navigation timed out or failed: {nav_err}. Monitor task will handle recovery.")

            # Start background session watcher regardless of initial navigation success
            self._monitor_task = asyncio.create_task(self._monitor_session())

        except Exception as e:
            logger.error(f"Failed to initialize WhatsApp Engine: {e}")
            self.last_error = str(e)
            self.is_ready = False
            self.connection_state = "disconnected"
            # Ensure monitor task runs to attempt recovery later
            if self.browser_context and not getattr(self, '_monitor_task', None):
                self._monitor_task = asyncio.create_task(self._monitor_session())
            self.is_ready = False

    async def _monitor_session(self):
        """Continuously monitors login state and extracts pairing code or QR when needed."""
        while True:
            try:
                if not self.page or self.page.is_closed():
                    await asyncio.sleep(3)
                    continue

                # Ensure we are actually on WhatsApp Web
                try:
                    current_url = self.page.url
                    if "web.whatsapp.com" not in current_url:
                        logger.warning(f"Browser is not on WhatsApp Web (current url: {current_url}). Navigating...")
                        await self.page.goto("https://web.whatsapp.com", wait_until="domcontentloaded", timeout=60000)
                        await asyncio.sleep(5)
                        continue
                except Exception as nav_err:
                    logger.debug(f"Navigation check failed: {nav_err}")
                    await asyncio.sleep(3)
                    continue

                # 1. Check if logged in
                is_logged_in = await self.page.evaluate("""
                    () => {
                        const side = document.querySelector('#side') || document.querySelector('div[data-testid="chat-list"]');
                        const pane = document.querySelector('div[contenteditable="true"]');
                        const header = document.querySelector('header');
                        return Boolean(side || (pane && header));
                    }
                """)

                if is_logged_in:
                    if not self.is_ready:
                        logger.info("🎉 WhatsApp Web LOGGED IN and ready!")
                        self.connection_state = "connected"
                        self.is_ready = True
                        self.current_qr = None
                        self.qr_png_bytes = None
                        self.pairing_code = None
                        self.user_info = {
                            "status": "active",
                            "channel_id": config.CHANNEL_ID,
                            "channel_link": config.CHANNEL_LINK,
                        }
                    await asyncio.sleep(4)
                    continue

                # 2. Check for phone pairing code already displayed
                pairing_info = await self.page.evaluate("""
                    () => {
                        // Look for the pairing code digits (e.g. "ABCD-EFGH" or 8 character spans)
                        const codeEl = document.querySelector('[data-testid="link-device-phone-number-code"]')
                            || document.querySelector('div._ao3e');
                        if (codeEl) {
                            const text = codeEl.innerText || codeEl.textContent;
                            const clean = text.replace(/\\s/g, '').replace(/-/g, '');
                            if (clean.length >= 8) return { code: clean.slice(0, 8) };
                        }
                        // Fallback: find any large code-like spans  
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
                        logger.info(f"🔑 Phone pairing code: {code}")
                    await asyncio.sleep(2.5)
                    continue

                # 3. Check for QR canvas (fallback if phone pairing not triggered)
                qr_info = await self.page.evaluate("""
                    () => {
                        const refreshBtn = document.querySelector('span[data-icon="refresh"]')?.closest('button')
                            || document.querySelector('button[aria-label="Reload QR code"]');
                        if (refreshBtn) { refreshBtn.click(); return { state: 'RELOADING' }; }
                        
                        const qrDiv = document.querySelector('div[data-ref]');
                        const ref = qrDiv ? qrDiv.getAttribute('data-ref') : null;
                        const canvas = document.querySelector('canvas[aria-label="Scan this QR code with WhatsApp to log in"]')
                            || document.querySelector('canvas');
                        if (canvas) return { state: 'CANVAS_PRESENT', ref: ref || 'unknown_ref' };
                        return { state: null };
                    }
                """)

                if not qr_info:
                    if not self.is_ready:
                        self.connection_state = "connecting"
                    await asyncio.sleep(2.5)
                    continue

                state = qr_info.get("state")

                if state == 'RELOADING':
                    logger.info("🔄 QR timed out, clicked reload.")
                    await asyncio.sleep(2)
                    continue

                if state == "CANVAS_PRESENT":
                    ref = qr_info.get("ref")
                    if self.current_qr != ref or not self.qr_png_bytes:
                        self.current_qr = ref
                        self.last_qr_time = time.time()
                        self.connection_state = "qr_pending"
                        self.is_ready = False
                        screenshot_success = False
                        try:
                            qr_div = await self.page.query_selector("div[data-ref]")
                            if qr_div:
                                self.qr_png_bytes = await qr_div.screenshot()
                                screenshot_success = True
                        except Exception:
                            pass
                        if not screenshot_success:
                            try:
                                canvas_el = await self.page.query_selector("canvas")
                                if canvas_el:
                                    self.qr_png_bytes = await canvas_el.screenshot()
                                    screenshot_success = True
                            except Exception:
                                pass
                        if not screenshot_success and ref and ref != 'unknown_ref':
                            self._generate_qr_image(ref)
                else:
                    if not self.is_ready:
                        self.connection_state = "connecting"

            except Exception as err:
                logger.debug(f"Monitor tick error: {err}")

            await asyncio.sleep(2.5)

    async def request_phone_pairing(self, phone_number: str) -> Dict[str, Any]:
        """Clicks 'Link with phone number instead' and enters the phone number to get a pairing code."""
        if not self.page or self.page.is_closed():
            return {"success": False, "error": "Browser not ready"}
        try:
            # Click 'Link with phone number instead' button
            clicked = await self.page.evaluate("""
                () => {
                    const btns = Array.from(document.querySelectorAll('button, a, span'));
                    const phoneBtn = btns.find(el => {
                        const t = (el.innerText || el.textContent || '').toLowerCase();
                        return t.includes('phone number') || t.includes('link with phone');
                    });
                    if (phoneBtn) { phoneBtn.click(); return true; }
                    return false;
                }
            """)
            if not clicked:
                return {"success": False, "error": "Phone pairing button not found. QR page may not be loaded yet."}

            await asyncio.sleep(1.5)

            # Type phone number into the input
            phone_input = await self.page.wait_for_selector(
                'input[type="text"], input[type="tel"], input[placeholder*="phone"], input[data-testid="link-device-phone-number-input"]',
                timeout=8000
            )
            if phone_input:
                await phone_input.fill(phone_number)
                await asyncio.sleep(0.5)
                # Press Next/Submit
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
                return {"success": True, "message": "Phone number submitted. Pairing code will appear shortly."}
            return {"success": False, "error": "Could not find phone number input field"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def _generate_qr_image(self, qr_text: str):
        """Generates a PNG byte buffer from the QR string."""
        try:
            import qrcode
            from qrcode.image.pil import PilImage
            import io
            qr = qrcode.QRCode(
                version=1,
                error_correction=qrcode.constants.ERROR_CORRECT_L,
                box_size=10,
                border=2,
            )
            qr.add_data(qr_text)
            qr.make(fit=True)
            img = qr.make_image(image_factory=PilImage, fill_color="black", back_color="white")
            buffer = io.BytesIO()
            img.save(buffer)
            self.qr_png_bytes = buffer.getvalue()
        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"Error generating manual QR: {e}")
            self.qr_png_bytes = None

    async def get_status(self) -> Dict[str, Any]:
        return {
            "state": self.connection_state,
            "isReady": self.is_ready,
            "hasQR": bool(self.current_qr or self.qr_png_bytes),
            "pairingCode": self.pairing_code,
            "lastQRTime": self.last_qr_time,
            "userInfo": self.user_info,
            "lastError": getattr(self, "last_error", None),
        }

    async def get_qr_image(self) -> Optional[bytes]:
        return self.qr_png_bytes

    async def publish_to_channel(self, text: Optional[str] = None, media_url: Optional[str] = None, caption: Optional[str] = None) -> Dict[str, Any]:
        """
        Publishes content directly to the configured WhatsApp Channel.
        """
        if not self.is_ready:
            raise Exception("WhatsApp is not connected. Scan the QR code to connect.")

        content = caption or text or ""
        post_id = f"wa_channel_{int(time.time() * 1000)}"

        async with self._lock:
            try:
                logger.info(f"Publishing post to Channel ({config.CHANNEL_LINK})...")
                
                # Navigate to the Channel URL
                channel_url = config.CHANNEL_LINK
                await self.page.goto(channel_url, wait_until="domcontentloaded", timeout=45000)
                await asyncio.sleep(3)

                # Look for the input box or message composer in channel
                composer = await self.page.wait_for_selector(
                    'div[contenteditable="true"], footer p.selectable-text, div[data-testid="conversation-compose-box-input"]',
                    timeout=20000
                )

                if media_url:
                    # Download media temporarily and attach
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
                        # Find file input
                        file_input = await self.page.query_selector('input[type="file"]')
                        if not file_input:
                            # Click attach button to trigger file input
                            attach_btn = await self.page.query_selector('span[data-icon="plus"], span[data-icon="attach-menu-plus"], div[title="Attach"]')
                            if attach_btn:
                                await attach_btn.click()
                                await asyncio.sleep(1)
                                file_input = await self.page.query_selector('input[type="file"]')

                        if file_input:
                            await file_input.set_input_files(temp_path)
                            await asyncio.sleep(2)

                            # If caption exists, type in the caption box
                            if content:
                                caption_box = await self.page.query_selector('div[contenteditable="true"]')
                                if caption_box:
                                    await caption_box.fill(content)

                            # Click send button
                            send_btn = await self.page.wait_for_selector('span[data-icon="send"], span[data-icon="send-light"], div[aria-label="Send"]', timeout=15000)
                            if send_btn:
                                await send_btn.click()
                                await asyncio.sleep(3)
                        else:
                            # Fallback: Type text with media link
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
                    # Text only
                    await composer.fill(content)
                    await asyncio.sleep(0.5)
                    await self.page.keyboard.press("Enter")
                    await asyncio.sleep(2)

                logger.info(f"✅ Successfully published to WhatsApp Channel! Post ID: {post_id}")
                return {
                    "success": True,
                    "platform": "whatsapp_channel",
                    "messageId": post_id,
                    "channelId": config.CHANNEL_ID,
                    "channelLink": config.CHANNEL_LINK,
                    "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                }

            except Exception as err:
                logger.error(f"Error publishing to channel: {err}")
                raise Exception(f"Failed to publish to WhatsApp Channel: {str(err)}")

    async def close(self):
        """Closes browser context and Playwright."""
        if self._monitor_task:
            self._monitor_task.cancel()
        if self.browser_context:
            await self.browser_context.close()
        if self.playwright:
            await self.playwright.stop()

# Global singleton
whatsapp_engine = WhatsAppEngine()
