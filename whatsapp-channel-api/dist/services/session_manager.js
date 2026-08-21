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
const logger = (0, pino_1.default)({ level: 'info' });
class SessionManager {
    static instance;
    sessions = new Map();
    baseSessionDir;
    constructor() {
        this.baseSessionDir = process.env.SESSION_STORAGE_DIR || path_1.default.resolve(process.cwd(), 'sessions');
        if (!fs_1.default.existsSync(this.baseSessionDir)) {
            fs_1.default.mkdirSync(this.baseSessionDir, { recursive: true });
        }
    }
    static getInstance() {
        if (!SessionManager.instance) {
            SessionManager.instance = new SessionManager();
        }
        return SessionManager.instance;
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
        const { state, saveCreds } = await (0, baileys_1.useMultiFileAuthState)(sessionDir);
        const { version, isLatest } = await (0, baileys_1.fetchLatestBaileysVersion)();
        logger.info({ connectionId, version, isLatest }, '🚀 Initializing Multi-Device WhatsApp Socket...');
        const userSession = {
            connectionId,
            socket: null,
            status: 'INITIALIZING',
            qrCodeRaw: null,
            qrCodePng: null,
            pairingCode: null,
            userJid: null,
            phoneNumber: null,
            userName: null,
            lastActive: new Date(),
            retryCount: 0,
        };
        this.sessions.set(connectionId, userSession);
        const sock = (0, baileys_1.default)({
            version,
            logger: (0, pino_1.default)({ level: 'silent' }), // clean output
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
        // Listen to credentials updates to persist to multi-file store
        sock.ev.on('creds.update', saveCreds);
        // Listen to connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) {
                userSession.qrCodeRaw = qr;
                userSession.status = 'QR_READY';
                try {
                    userSession.qrCodePng = await qrcode_1.default.toBuffer(qr, {
                        type: 'png',
                        width: 320,
                        margin: 2,
                        color: { dark: '#000000', light: '#ffffff' },
                    });
                }
                catch (err) {
                    logger.error({ err }, 'Failed to render QR Code buffer');
                }
                logger.info({ connectionId }, '📱 Fresh QR Code generated for connection');
            }
            if (connection === 'connecting') {
                userSession.status = 'AUTHENTICATING';
            }
            if (connection === 'open') {
                userSession.status = 'CONNECTED';
                userSession.qrCodeRaw = null;
                userSession.qrCodePng = null;
                userSession.pairingCode = null;
                userSession.userJid = sock.user?.id || null;
                userSession.userName = sock.user?.name || 'WhatsApp Account';
                userSession.phoneNumber = sock.user?.id?.split('@')[0]?.split(':')[0] || null;
                userSession.lastActive = new Date();
                userSession.retryCount = 0;
                logger.info({ connectionId, userJid: userSession.userJid, phone: userSession.phoneNumber }, '🎉 ✅ WhatsApp Session successfully authenticated & connected!');
            }
            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const shouldReconnect = statusCode !== baileys_1.DisconnectReason.loggedOut;
                logger.warn({ connectionId, statusCode, reason: lastDisconnect?.error?.message }, `⚠️ Socket connection closed. Should reconnect: ${shouldReconnect}`);
                if (statusCode === baileys_1.DisconnectReason.loggedOut) {
                    userSession.status = 'REVOKED';
                    await this.purgeSession(connectionId);
                }
                else if (shouldReconnect) {
                    userSession.status = 'INITIALIZING';
                    userSession.retryCount += 1;
                    const delay = Math.min(1000 * Math.pow(2, userSession.retryCount), 30000);
                    setTimeout(() => this.initSession(connectionId), delay);
                }
                else {
                    userSession.status = 'FAILED';
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
     * Gets current state of a session.
     */
    getSession(connectionId) {
        return this.sessions.get(connectionId);
    }
    /**
     * Disconnects and purges session storage.
     */
    async purgeSession(connectionId) {
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
    }
}
exports.SessionManager = SessionManager;
