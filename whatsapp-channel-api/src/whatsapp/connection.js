const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcodeTerminal = require('qrcode-terminal');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * WhatsApp Web connection manager.
 * Uses whatsapp-web.js with LocalAuth for persistent sessions.
 */
class WhatsAppConnection {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.currentQR = null;
    this.connectionState = 'disconnected'; // disconnected | connecting | connected | qr_pending
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 5;
  }

  /**
   * Initialize the WhatsApp Web client and start connecting.
   */
  async initialize() {
    logger.info('WA', 'Initializing WhatsApp Web client...');

    this.client = new Client({
      authStrategy: new LocalAuth({
        dataPath: config.sessionDir,
      }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--disable-gpu',
        ],
      },
    });

    // ── Event Handlers ──

    this.client.on('qr', (qr) => {
      this.currentQR = qr;
      this.lastQRTime = Date.now();
      this.connectionState = 'qr_pending';
      this._reconnectAttempts = 0;
      logger.info('WA', 'QR code received. Scan with your WhatsApp app:');
      qrcodeTerminal.generate(qr, { small: true });
      logger.info('WA', 'Or visit GET / in your browser for the live scannable web dashboard.');
    });

    this.client.on('ready', () => {
      this.isReady = true;
      this.currentQR = null;
      this.connectionState = 'connected';
      this._reconnectAttempts = 0;
      logger.info('WA', '✅ WhatsApp client is ready and connected!');
    });

    this.client.on('authenticated', () => {
      logger.info('WA', 'Session authenticated successfully.');
      this.connectionState = 'connecting';
    });

    this.client.on('auth_failure', (msg) => {
      this.isReady = false;
      this.connectionState = 'disconnected';
      logger.error('WA', `Authentication failure: ${msg}`);
    });

    this.client.on('disconnected', (reason) => {
      this.isReady = false;
      this.connectionState = 'disconnected';
      logger.warn('WA', `Disconnected: ${reason}`);
      this._handleReconnect();
    });

    this.client.on('change_state', (state) => {
      logger.debug('WA', `Connection state changed: ${state}`);
    });

    this.client.on('loading_screen', (percent, message) => {
      logger.info('WA', `Loading: ${percent}% — ${message}`);
    });

    // Start the client
    try {
      this.connectionState = 'connecting';
      await this.client.initialize();
    } catch (err) {
      logger.error('WA', `Failed to initialize: ${err.message}`);
      this.connectionState = 'disconnected';
      // Auto-retry on initialization failure
      this._handleReconnect();
    }
  }

  /**
   * Auto-reconnect with exponential backoff.
   */
  async _handleReconnect() {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      logger.error('WA', `Max reconnect attempts (${this._maxReconnectAttempts}) reached. Manual restart required.`);
      return;
    }

    this._reconnectAttempts++;
    const delay = Math.min(5000 * Math.pow(2, this._reconnectAttempts - 1), 60000);
    logger.info('WA', `Reconnecting in ${delay / 1000}s (attempt ${this._reconnectAttempts}/${this._maxReconnectAttempts})...`);

    setTimeout(async () => {
      try {
        // Destroy the old client first to clean up Puppeteer processes
        if (this.client) {
          try {
            await this.client.destroy();
          } catch (e) {
            // Ignore destroy errors
          }
        }
        this.connectionState = 'connecting';
        await this.initialize();
      } catch (err) {
        logger.error('WA', `Reconnect failed: ${err.message}`);
      }
    }, delay);
  }

  /**
   * Get current connection status.
   */
  getStatus() {
    let userInfo = null;
    try {
      if (this.client && this.client.info) {
        userInfo = {
          wid: this.client.info.wid ? this.client.info.wid._serialized : null,
          pushname: this.client.info.pushname || null,
          platform: this.client.info.platform || null,
        };
      }
    } catch (e) {}

    return {
      state: this.connectionState,
      isReady: this.isReady,
      hasQR: !!this.currentQR,
      lastQRTime: this.lastQRTime || null,
      userInfo,
      reconnectAttempts: this._reconnectAttempts,
    };
  }

  /**
   * Get the underlying whatsapp-web.js Client instance.
   */
  getClient() {
    return this.client;
  }
}

// Singleton
const connection = new WhatsAppConnection();

module.exports = connection;
