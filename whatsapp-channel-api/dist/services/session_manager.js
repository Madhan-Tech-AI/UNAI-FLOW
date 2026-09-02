"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionManager = void 0;
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const qrcode_1 = __importDefault(require("qrcode"));
const pino_1 = __importDefault(require("pino"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const axios_1 = __importDefault(require("axios"));
const newsletter_service_js_1 = require("./newsletter_service.js");
const logger = (0, pino_1.default)({ level: 'info' });
class SessionManager {
    static instance;
    sessions = new Map();
    baseSessionDir;
    supabaseUrl;
    supabaseKey;
    backupTimers = new Map();
    reconnectTimers = new Map();
    constructor() {
        this.baseSessionDir = process.env.SESSION_STORAGE_DIR || process.env.WCA_SESSION_DIR || path_1.default.resolve(process.cwd(), 'sessions');
        if (!fs_1.default.existsSync(this.baseSessionDir)) {
            fs_1.default.mkdirSync(this.baseSessionDir, { recursive: true });
        }
        this.supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
        this.supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    }
    static getInstance() {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager();
        }
        return SessionManager.instance;
    }
    /**
     * Restores session credential files from Supabase if not present on disk.
     */
    async restoreSessionFromSupabase(connectionId, sessionDir) {
        if (!this.supabaseUrl || !this.supabaseKey)
            return false;
        try {
            const url = `${this.supabaseUrl}/rest/v1/whatsapp_sessions?session_identifier=eq.${encodeURIComponent(connectionId)}&select=encrypted_credentials,status`;
            const res = await axios_1.default.get(url, {
                headers: {
                    apikey: this.supabaseKey,
                    Authorization: `Bearer ${this.supabaseKey}`,
                },
                timeout: 10000,
            });
            if (res.data && res.data.length > 0) {
                const raw = res.data[0].encrypted_credentials;
                if (raw && typeof raw === 'string' && raw.trim().startsWith('{')) {
                    const files = JSON.parse(raw);
                    if (files && typeof files === 'object') {
                        if (!fs_1.default.existsSync(sessionDir)) {
                            fs_1.default.mkdirSync(sessionDir, { recursive: true });
                        }
                        for (const [filename, content] of Object.entries(files)) {
                            if (/^[a-zA-Z0-9_\-\.]+$/.test(filename)) {
                                fs_1.default.writeFileSync(path_1.default.join(sessionDir, filename), content, 'utf-8');
                            }
                        }
                        logger.info({ connectionId, fileCount: Object.keys(files).length }, '[WCA] Restored session files from Supabase credentials vault');
                        return true;
                    }
                }
            }
        }
        catch (err) {
            logger.warn({ connectionId, err: err.message }, '[WCA] Note: Could not restore session from Supabase vault');
        }
        return false;
    }
    /**
     * Backs up session credentials to Supabase asynchronously (debounced).
     */
    scheduleBackupToSupabase(connectionId, sessionDir) {
        if (!this.supabaseUrl || !this.supabaseKey)
            return;
        if (this.backupTimers.has(connectionId)) {
            clearTimeout(this.backupTimers.get(connectionId));
        }
        const timer = setTimeout(async () => {
            this.backupTimers.delete(connectionId);
            try {
                if (!fs_1.default.existsSync(sessionDir))
                    return;
                const credsPath = path_1.default.join(sessionDir, 'creds.json');
                if (!fs_1.default.existsSync(credsPath))
                    return;
                const files = {};
                const entries = fs_1.default.readdirSync(sessionDir, { withFileTypes: true });
                for (const entry of entries) {
                    if (entry.isFile() && !entry.name.endsWith('.tmp')) {
                        try {
                            files[entry.name] = fs_1.default.readFileSync(path_1.default.join(sessionDir, entry.name), 'utf-8');
                        }
                        catch { }
                    }
                }
                const payload = JSON.stringify(files);
                const url = `${this.supabaseUrl}/rest/v1/whatsapp_sessions?session_identifier=eq.${encodeURIComponent(connectionId)}`;
                await axios_1.default.patch(url, {
                    encrypted_credentials: payload,
                    updated_at: new Date().toISOString(),
                }, {
                    headers: {
                        apikey: this.supabaseKey,
                        Authorization: `Bearer ${this.supabaseKey}`,
                        'Content-Type': 'application/json',
                        Prefer: 'return=minimal',
                    },
                    timeout: 10000,
                });
                logger.info({ connectionId, filesBackedUp: Object.keys(files).length }, '[WCA] Session credentials backed up to Supabase vault');
            }
            catch (err) {
                logger.warn({ connectionId, err: err.message }, '[WCA] Note: Failed to backup session to Supabase');
            }
        }, 2000);
        this.backupTimers.set(connectionId, timer);
    }
    /**
     * Clears session credentials from Supabase on explicit logout/purge.
     */
    async clearSupabaseCredentials(connectionId) {
        if (!this.supabaseUrl || !this.supabaseKey)
            return;
        try {
            const url = `${this.supabaseUrl}/rest/v1/whatsapp_sessions?session_identifier=eq.${encodeURIComponent(connectionId)}`;
            await axios_1.default.patch(url, {
                encrypted_credentials: '',
                status: 'DISCONNECTED',
                updated_at: new Date().toISOString(),
            }, {
                headers: {
                    apikey: this.supabaseKey,
                    Authorization: `Bearer ${this.supabaseKey}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=minimal',
                },
                timeout: 10000,
            });
            logger.info({ connectionId }, '[WCA] Cleared Supabase credentials on purge');
        }
        catch (err) {
            logger.warn({ connectionId, err: err.message }, '[WCA] Failed to clear Supabase credentials');
        }
    }
    /**
     * Scans disk and Supabase to restore all previously connected sessions on boot.
     */
    async initAllSavedSessions() {
        logger.info('[WCA] Scanning for saved WhatsApp sessions to restore...');
        const booted = new Set();
        // 1. Scan local disk
        if (fs_1.default.existsSync(this.baseSessionDir)) {
            const entries = fs_1.default.readdirSync(this.baseSessionDir, { withFileTypes: true });
            for (const entry of entries) {
                if (entry.isDirectory() && entry.name.startsWith('session_')) {
                    const connId = entry.name.replace('session_', '');
                    const credsPath = path_1.default.join(this.baseSessionDir, entry.name, 'creds.json');
                    if (fs_1.default.existsSync(credsPath)) {
                        booted.add(connId);
                        logger.info({ connId }, '[WCA] Restoring saved session from disk on boot...');
                        this.initSession(connId).catch((err) => {
                            logger.error({ err, connId }, '[WCA] Failed to boot saved session from disk');
                        });
                    }
                }
            }
        }
        // 2. Query Supabase for CONNECTED sessions that might not be on disk yet (e.g. after container restart)
        if (this.supabaseUrl && this.supabaseKey) {
            try {
                const url = `${this.supabaseUrl}/rest/v1/whatsapp_sessions?status=in.(CONNECTED,READY)&select=session_identifier,encrypted_credentials`;
                const res = await axios_1.default.get(url, {
                    headers: {
                        apikey: this.supabaseKey,
                        Authorization: `Bearer ${this.supabaseKey}`,
                    },
                    timeout: 10000,
                });
                if (res.data && Array.isArray(res.data)) {
                    for (const row of res.data) {
                        const connId = row.session_identifier;
                        if (connId && !booted.has(connId)) {
                            // Only attempt restore if encrypted_credentials contains actual data
                            const hasCreds = row.encrypted_credentials && typeof row.encrypted_credentials === 'string' && row.encrypted_credentials.trim().startsWith('{');
                            if (hasCreds) {
                                booted.add(connId);
                                logger.info({ connId }, '[WCA] Restoring connected session from Supabase vault on boot...');
                                this.initSession(connId).catch((err) => {
                                    logger.error({ err, connId }, '[WCA] Failed to boot session restored from Supabase');
                                });
                            }
                            else {
                                logger.warn({ connId }, '[WCA] Skipping session restore — no backed-up credentials in Supabase vault. User needs to re-scan QR.');
                            }
                        }
                    }
                }
            }
            catch (err) {
                logger.warn({ err: err.message }, '[WCA] Note: Supabase session discovery note on boot');
            }
        }
    }
    /**
     * Initializes or gets an existing multi-tenant session.
     */
    async getOrCreateSession(connectionId) {
        if (this.sessions.has(connectionId)) {
            const sess = this.sessions.get(connectionId);
            if (sess.socket && sess.status === 'CONNECTED') {
                return sess;
            }
        }
        return await this.initSession(connectionId);
    }
    /**
     * Boots a Baileys Multi-Device socket session for a given connection_id.
     */
    async initSession(connectionId) {
        const sessionDir = path_1.default.join(this.baseSessionDir, `session_${connectionId}`);
        if (!fs_1.default.existsSync(sessionDir)) {
            fs_1.default.mkdirSync(sessionDir, { recursive: true });
        }
        // Attempt restoring credentials from Supabase if not on disk
        const credsPath = path_1.default.join(sessionDir, 'creds.json');
        if (!fs_1.default.existsSync(credsPath)) {
            await this.restoreSessionFromSupabase(connectionId, sessionDir);
        }
        const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(sessionDir);
        const { version, isLatest } = await (0, baileys_1.fetchLatestBaileysVersion)();
        logger.info({ connectionId, version, isLatest }, '🚀 Initializing Multi-Device WhatsApp Socket...');
        // Check if credentials file has registered=true (i.e. has been authenticated before)
        const hadSavedCreds = (() => {
            try {
                const cp = path_1.default.join(sessionDir, 'creds.json');
                if (fs_1.default.existsSync(cp)) {
                    const raw = JSON.parse(fs_1.default.readFileSync(cp, 'utf-8'));
                    return raw.registered === true;
                }
            }
            catch { }
            return false;
        })();
        const userSession = {
            connectionId,
            socket: null,
            status: 'INITIALIZING',
            qrCodeRaw: null,
            qrCodePng: null,
            qrGeneratedAt: null,
            qrExpiresAt: null,
            pairingCode: null,
            userJid: null,
            phoneNumber: null,
            userName: null,
            profilePictureUrl: null,
            lastActive: new Date(),
            retryCount: 0,
            _qrWasGenerated: false,
            _hasEverAuthenticated: hadSavedCreds,
            _hadSavedCreds: hadSavedCreds,
        };
        logger.info({ connectionId, hadSavedCreds }, hadSavedCreds
            ? '[WCA] SESSION_INITIALIZING (has saved credentials, expecting auto-login)'
            : '[WCA] SESSION_INITIALIZING (no saved credentials, will need QR scan)');
        logger.info({ connectionId }, '[WCA] SESSION_INITIALIZING');
        this.sessions.set(connectionId, userSession);
        const sock = (0, baileys_1.default)({
            version,
            logger: (0, pino_1.default)({ level: 'silent' }),
            printQRInTerminal: false,
            auth: {
                creds: state.creds,
                keys: (0, baileys_1.makeCacheableSignalKeyStore)(state.keys, (0, pino_1.default)({ level: 'silent' })),
            },
            browser: ['UNAI Flow', 'Chrome', '124.0.0'],
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 25000,
        });
        userSession.socket = sock;
        // Listen to credentials updates to persist to multi-file store and Supabase
        sock.ev.on('creds.update', () => {
            saveCreds();
            this.scheduleBackupToSupabase(connectionId, sessionDir);
        });
        // Listen to connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                userSession.qrCodeRaw = qr;
                userSession.status = 'QR_READY';
                userSession._qrWasGenerated = true;
                userSession.qrGeneratedAt = new Date();
                userSession.qrExpiresAt = new Date(Date.now() + 60 * 1000);
                try {
                    userSession.qrCodePng = await qrcode_1.default.toBuffer(qr, {
                        type: 'png',
                        width: 320,
                        margin: 2,
                        color: { dark: '#000000', light: '#ffffff' },
                    });
                }
                catch (err) {
                    logger.error({ err }, '[WCA] QR_RENDER_FAILED');
                }
                logger.info({ connectionId, qr_length: qr.length }, '[WCA] QR_GENERATED');
            }
            if (connection === 'connecting') {
                if (userSession._qrWasGenerated) {
                    userSession.status = 'AUTHENTICATING';
                    logger.info({ connectionId }, '[WCA] SESSION_AUTHENTICATING (QR was scanned)');
                }
                else {
                    logger.info({ connectionId }, '[WCA] SESSION_CONNECTING (awaiting QR generation or credentials login)');
                }
            }
            if (connection === 'open') {
                userSession.status = 'CONNECTED';
                userSession.qrCodeRaw = null;
                userSession.qrCodePng = null;
                userSession.qrGeneratedAt = null;
                userSession.qrExpiresAt = null;
                userSession.pairingCode = null;
                userSession._qrWasGenerated = false;
                userSession.userJid = sock.user?.id || null;
                userSession.userName = sock.user?.name || 'WhatsApp Account';
                userSession.phoneNumber = sock.user?.id?.split('@')[0]?.split(':')[0] || null;
                userSession.lastActive = new Date();
                userSession.retryCount = 0;
                userSession._hasEverAuthenticated = true;
                // Clear any pending reconnect timers
                if (this.reconnectTimers.has(connectionId)) {
                    clearTimeout(this.reconnectTimers.get(connectionId));
                    this.reconnectTimers.delete(connectionId);
                }
                // Fetch user profile picture
                try {
                    const ppUrl = await sock.profilePictureUrl(sock.user?.id, 'image');
                    userSession.profilePictureUrl = ppUrl || null;
                    logger.info({ connectionId, hasProfilePic: Boolean(ppUrl) }, '[WCA] PROFILE_PICTURE_FETCHED');
                }
                catch (ppErr) {
                    userSession.profilePictureUrl = null;
                    logger.debug({ connectionId, err: ppErr }, '[WCA] PROFILE_PICTURE_NOT_AVAILABLE');
                }
                logger.info({ connectionId, phone: userSession.phoneNumber, name: userSession.userName }, '[WCA] SESSION_AUTHENTICATED');
                // Sync credentials to Supabase vault upon successful connection
                this.scheduleBackupToSupabase(connectionId, sessionDir);
                // Auto-discover channels in the background so they are cached by the time the UI/Backend requests them
                setTimeout(() => {
                    logger.info({ connectionId }, '[WCA] BACKGROUND_CHANNEL_DISCOVERY_START');
                    newsletter_service_js_1.NewsletterService.discoverChannels(sock, connectionId).catch(err => {
                        logger.error({ err, connectionId }, '[WCA] BACKGROUND_CHANNEL_DISCOVERY_ERROR');
                    });
                }, 1000);
            }
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const isLoggedOut = statusCode === baileys_1.DisconnectReason.loggedOut;
                logger.warn({ connectionId, statusCode, reason: lastDisconnect?.error?.message, isLoggedOut }, `[WCA] SESSION_DISCONNECTED isLoggedOut=${isLoggedOut}`);
                if (isLoggedOut) {
                    userSession.status = 'REVOKED';
                    await this.purgeSession(connectionId);
                }
                else {
                    // Only auto-reconnect if the session has ever successfully authenticated.
                    // If it was only generating QRs and nobody scanned them (statusCode 408),
                    // do NOT loop forever — stop and wait for the user to explicitly initiate connection.
                    const isQrTimeout = statusCode === 408;
                    const shouldAutoReconnect = userSession._hasEverAuthenticated || userSession._hadSavedCreds;
                    if (isQrTimeout && !shouldAutoReconnect) {
                        // Never authenticated, just QR timeout — stop the loop
                        userSession.status = 'DISCONNECTED';
                        logger.info({ connectionId, retryCount: userSession.retryCount }, '[WCA] SESSION_QR_TIMEOUT — no saved credentials, stopping reconnect loop. User needs to scan QR.');
                    }
                    else {
                        // Has valid credentials or network disconnect — auto-reconnect
                        userSession.status = 'INITIALIZING';
                        userSession.retryCount += 1;
                        const delay = Math.min(1000 * Math.pow(1.5, Math.min(userSession.retryCount, 8)), 15000);
                        if (this.reconnectTimers.has(connectionId)) {
                            clearTimeout(this.reconnectTimers.get(connectionId));
                        }
                        const timer = setTimeout(() => {
                            if (this.sessions.has(connectionId)) {
                                logger.info({ connectionId, attempt: userSession.retryCount }, '[WCA] Executing auto-reconnect...');
                                this.initSession(connectionId).catch((err) => {
                                    logger.error({ err, connectionId }, '[WCA] Auto-reconnect failed, will retry');
                                });
                            }
                        }, delay);
                        this.reconnectTimers.set(connectionId, timer);
                    }
                }
            }
        });
        return userSession;
    }
    /**
     * Request phone number pairing mode.
     */
    async requestPhonePairing(connectionId, phoneNumber) {
        const session = await this.getOrCreateSession(connectionId);
        if (!session.socket) {
            throw new Error('Socket not initialized');
        }
        const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
        session.status = 'WAITING_FOR_SCAN';
        const code = await session.socket.requestPairingCode(cleanPhone);
        session.pairingCode = code;
        return code;
    }
    /**
     * Gets current state of a session. Lazy-boots from disk if saved creds exist.
     */
    getSession(connectionId) {
        let sess = this.sessions.get(connectionId);
        if (!sess) {
            const sessionDir = path_1.default.join(this.baseSessionDir, `session_${connectionId}`);
            if (fs_1.default.existsSync(path_1.default.join(sessionDir, 'creds.json'))) {
                logger.info({ connectionId }, '[WCA] Lazy-booting session from disk upon request');
                this.initSession(connectionId).catch((err) => {
                    logger.error({ err, connectionId }, '[WCA] Lazy-boot error');
                });
                return this.sessions.get(connectionId);
            }
        }
        return sess;
    }
    /**
     * Disconnects and purges session storage. Only called upon explicit user disconnect or device revoke.
     */
    async purgeSession(connectionId) {
        if (this.reconnectTimers.has(connectionId)) {
            clearTimeout(this.reconnectTimers.get(connectionId));
            this.reconnectTimers.delete(connectionId);
        }
        if (this.backupTimers.has(connectionId)) {
            clearTimeout(this.backupTimers.get(connectionId));
            this.backupTimers.delete(connectionId);
        }
        const session = this.sessions.get(connectionId);
        if (session?.socket) {
            try {
                await session.socket.logout();
            }
            catch (err) {
                logger.debug({ err }, 'Logout error');
            }
            try {
                session.socket.end(new Error('Session closed'));
            }
            catch (err) { }
        }
        this.sessions.delete(connectionId);
        const sessionDir = path_1.default.join(this.baseSessionDir, `session_${connectionId}`);
        if (fs_1.default.existsSync(sessionDir)) {
            try {
                fs_1.default.rmSync(sessionDir, { recursive: true, force: true });
            }
            catch (err) {
                logger.error({ err }, 'Error cleaning up session directory');
            }
        }
        await this.clearSupabaseCredentials(connectionId);
    }
}
exports.SessionManager = SessionManager;
