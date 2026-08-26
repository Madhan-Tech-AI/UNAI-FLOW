import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import pino from 'pino';
import fs from 'fs';
import path from 'path';
import { Boom } from '@hapi/boom';

const logger = pino({ level: 'info' });

export type ConnectionState =
  | 'DISCONNECTED'
  | 'INITIALIZING'
  | 'QR_READY'
  | 'WAITING_FOR_SCAN'
  | 'AUTHENTICATING'
  | 'CONNECTED'
  | 'FAILED'
  | 'REVOKED';

export interface UserSession {
  connectionId: string;
  socket: WASocket | null;
  status: ConnectionState;
  qrCodeRaw: string | null;
  qrCodePng: Buffer | null;
  qrGeneratedAt: Date | null;
  qrExpiresAt: Date | null;
  pairingCode: string | null;
  userJid: string | null;
  phoneNumber: string | null;
  userName: string | null;
  profilePictureUrl: string | null;
  lastActive: Date;
  retryCount: number;
  /** Tracks whether a QR code was ever generated in this session lifecycle */
  _qrWasGenerated: boolean;
}

export class SessionManager {
  private static instance: SessionManager;
  private sessions: Map<string, UserSession> = new Map();
  private baseSessionDir: string;

  private constructor() {
    this.baseSessionDir = process.env.SESSION_STORAGE_DIR || path.resolve(process.cwd(), 'sessions');
    if (!fs.existsSync(this.baseSessionDir)) {
      fs.mkdirSync(this.baseSessionDir, { recursive: true });
    }
  }

  public static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * Initializes or gets an existing multi-tenant session.
   */
  public async getOrCreateSession(connectionId: string): Promise<UserSession> {
    if (this.sessions.has(connectionId)) {
      const sess = this.sessions.get(connectionId)!;
      if (sess.socket && sess.status === 'CONNECTED') {
        return sess;
      }
    }

    return await this.initSession(connectionId);
  }

  /**
   * Boots a Baileys Multi-Device socket session for a given connection_id.
   */
  public async initSession(connectionId: string): Promise<UserSession> {
    const sessionDir = path.join(this.baseSessionDir, `session_${connectionId}`);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    logger.info({ connectionId, version, isLatest }, '🚀 Initializing Multi-Device WhatsApp Socket...');

    const userSession: UserSession = {
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
    };

    logger.info({ connectionId }, '[WCA] SESSION_INITIALIZING');

    this.sessions.set(connectionId, userSession);

    const sock = makeWASocket({
      version,
      logger: pino({ level: 'silent' }), // clean output
      printQRInTerminal: false,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
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
        userSession._qrWasGenerated = true;
        userSession.qrGeneratedAt = new Date();
        // WhatsApp QR codes typically expire in ~60 seconds
        userSession.qrExpiresAt = new Date(Date.now() + 60 * 1000);
        try {
          userSession.qrCodePng = await QRCode.toBuffer(qr, {
            type: 'png',
            width: 320,
            margin: 2,
            color: { dark: '#000000', light: '#ffffff' },
          });
        } catch (err) {
          logger.error({ err }, '[WCA] QR_RENDER_FAILED');
        }
        logger.info(
          { connectionId, qr_length: qr.length },
          '[WCA] QR_GENERATED'
        );
      }

      if (connection === 'connecting') {
        // Only set AUTHENTICATING if QR was previously generated (user scanned it)
        // Otherwise this is just the initial socket boot phase — keep INITIALIZING
        if (userSession._qrWasGenerated) {
          userSession.status = 'AUTHENTICATING';
          logger.info({ connectionId }, '[WCA] SESSION_AUTHENTICATING (QR was scanned)');
        } else {
          // Socket is booting up, QR hasn't been generated yet
          logger.info({ connectionId }, '[WCA] SESSION_CONNECTING (awaiting QR generation)');
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

        // Fetch profile picture
        try {
          const ppUrl = await sock.profilePictureUrl(sock.user?.id!, 'image');
          userSession.profilePictureUrl = ppUrl || null;
          logger.info({ connectionId, hasProfilePic: Boolean(ppUrl) }, '[WCA] PROFILE_PICTURE_FETCHED');
        } catch (ppErr) {
          userSession.profilePictureUrl = null;
          logger.debug({ connectionId, err: ppErr }, '[WCA] PROFILE_PICTURE_NOT_AVAILABLE');
        }

        logger.info(
          { connectionId, phone: userSession.phoneNumber, name: userSession.userName },
          '[WCA] SESSION_AUTHENTICATED'
        );
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logger.warn(
          { connectionId, statusCode, reason: lastDisconnect?.error?.message },
          `[WCA] SESSION_DISCONNECTED shouldReconnect=${shouldReconnect}`
        );

        if (statusCode === DisconnectReason.loggedOut) {
          userSession.status = 'REVOKED';
          await this.purgeSession(connectionId);
        } else if (shouldReconnect) {
          userSession.status = 'INITIALIZING';
          userSession.retryCount += 1;
          const delay = Math.min(1000 * Math.pow(2, userSession.retryCount), 30000);
          setTimeout(() => this.initSession(connectionId), delay);
        } else {
          userSession.status = 'FAILED';
        }
      }
    });

    return userSession;
  }

  /**
   * Request phone number pairing mode.
   */
  public async requestPhonePairing(connectionId: string, phoneNumber: string): Promise<string> {
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
  public getSession(connectionId: string): UserSession | undefined {
    return this.sessions.get(connectionId);
  }

  /**
   * Disconnects and purges session storage.
   */
  public async purgeSession(connectionId: string): Promise<void> {
    const session = this.sessions.get(connectionId);
    if (session?.socket) {
      try {
        await session.socket.logout();
      } catch (err) {
        logger.debug({ err }, 'Logout error');
      }
      try {
        session.socket.end(new Error('Session closed'));
      } catch (err) {}
    }

    this.sessions.delete(connectionId);

    const sessionDir = path.join(this.baseSessionDir, `session_${connectionId}`);
    if (fs.existsSync(sessionDir)) {
      try {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      } catch (err) {
        logger.error({ err }, 'Error cleaning up session directory');
      }
    }
  }
}
