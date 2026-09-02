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
import axios from 'axios';
import { Boom } from '@hapi/boom';
import { NewsletterService } from './newsletter_service.js';

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
  private supabaseUrl: string;
  private supabaseKey: string;
  private backupTimers: Map<string, NodeJS.Timeout> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();

  private constructor() {
    this.baseSessionDir = process.env.SESSION_STORAGE_DIR || process.env.WCA_SESSION_DIR || path.resolve(process.cwd(), 'sessions');
    if (!fs.existsSync(this.baseSessionDir)) {
      fs.mkdirSync(this.baseSessionDir, { recursive: true });
    }
    this.supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    this.supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  }

  public static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * Restores session credential files from Supabase if not present on disk.
   */
  private async restoreSessionFromSupabase(connectionId: string, sessionDir: string): Promise<boolean> {
    if (!this.supabaseUrl || !this.supabaseKey) return false;
    try {
      const url = `${this.supabaseUrl}/rest/v1/whatsapp_sessions?session_identifier=eq.${encodeURIComponent(connectionId)}&select=encrypted_credentials,status`;
      const res = await axios.get(url, {
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
            if (!fs.existsSync(sessionDir)) {
              fs.mkdirSync(sessionDir, { recursive: true });
            }
            for (const [filename, content] of Object.entries(files)) {
              if (/^[a-zA-Z0-9_\-\.]+$/.test(filename)) {
                fs.writeFileSync(path.join(sessionDir, filename), content as string, 'utf-8');
              }
            }
            logger.info({ connectionId, fileCount: Object.keys(files).length }, '[WCA] Restored session files from Supabase credentials vault');
            return true;
          }
        }
      }
    } catch (err: any) {
      logger.warn({ connectionId, err: err.message }, '[WCA] Note: Could not restore session from Supabase vault');
    }
    return false;
  }

  /**
   * Backs up session credentials to Supabase asynchronously (debounced).
   */
  private scheduleBackupToSupabase(connectionId: string, sessionDir: string): void {
    if (!this.supabaseUrl || !this.supabaseKey) return;
    if (this.backupTimers.has(connectionId)) {
      clearTimeout(this.backupTimers.get(connectionId)!);
    }
    const timer = setTimeout(async () => {
      this.backupTimers.delete(connectionId);
      try {
        if (!fs.existsSync(sessionDir)) return;
        const credsPath = path.join(sessionDir, 'creds.json');
        if (!fs.existsSync(credsPath)) return;

        const files: Record<string, string> = {};
        const entries = fs.readdirSync(sessionDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isFile() && !entry.name.endsWith('.tmp')) {
            try {
              files[entry.name] = fs.readFileSync(path.join(sessionDir, entry.name), 'utf-8');
            } catch {}
          }
        }

        const payload = JSON.stringify(files);
        const url = `${this.supabaseUrl}/rest/v1/whatsapp_sessions?session_identifier=eq.${encodeURIComponent(connectionId)}`;
        await axios.patch(
          url,
          {
            encrypted_credentials: payload,
            updated_at: new Date().toISOString(),
          },
          {
            headers: {
              apikey: this.supabaseKey,
              Authorization: `Bearer ${this.supabaseKey}`,
              'Content-Type': 'application/json',
              Prefer: 'return=minimal',
            },
            timeout: 10000,
          }
        );
        logger.info({ connectionId, filesBackedUp: Object.keys(files).length }, '[WCA] Session credentials backed up to Supabase vault');
      } catch (err: any) {
        logger.warn({ connectionId, err: err.message }, '[WCA] Note: Failed to backup session to Supabase');
      }
    }, 2000);
    this.backupTimers.set(connectionId, timer);
  }

  /**
   * Clears session credentials from Supabase on explicit logout/purge.
   */
  private async clearSupabaseCredentials(connectionId: string): Promise<void> {
    if (!this.supabaseUrl || !this.supabaseKey) return;
    try {
      const url = `${this.supabaseUrl}/rest/v1/whatsapp_sessions?session_identifier=eq.${encodeURIComponent(connectionId)}`;
      await axios.patch(
        url,
        {
          encrypted_credentials: '',
          status: 'DISCONNECTED',
          updated_at: new Date().toISOString(),
        },
        {
          headers: {
            apikey: this.supabaseKey,
            Authorization: `Bearer ${this.supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          timeout: 10000,
        }
      );
      logger.info({ connectionId }, '[WCA] Cleared Supabase credentials on purge');
    } catch (err: any) {
      logger.warn({ connectionId, err: err.message }, '[WCA] Failed to clear Supabase credentials');
    }
  }

  /**
   * Scans disk and Supabase to restore all previously connected sessions on boot.
   */
  public async initAllSavedSessions(): Promise<void> {
    logger.info('[WCA] Scanning for saved WhatsApp sessions to restore...');
    const booted = new Set<string>();

    // 1. Scan local disk
    if (fs.existsSync(this.baseSessionDir)) {
      const entries = fs.readdirSync(this.baseSessionDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('session_')) {
          const connId = entry.name.replace('session_', '');
          const credsPath = path.join(this.baseSessionDir, entry.name, 'creds.json');
          if (fs.existsSync(credsPath)) {
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
        const res = await axios.get(url, {
          headers: {
            apikey: this.supabaseKey,
            Authorization: `Bearer ${this.supabaseKey}`,
          },
          timeout: 10000,
        });
        if (res.data && Array.isArray(res.data)) {
          for (const row of res.data) {
            const connId = row.session_identifier;
            if (connId && !booted.has(connId) && row.encrypted_credentials) {
              booted.add(connId);
              logger.info({ connId }, '[WCA] Restoring connected session from Supabase vault on boot...');
              this.initSession(connId).catch((err) => {
                logger.error({ err, connId }, '[WCA] Failed to boot session restored from Supabase');
              });
            }
          }
        }
      } catch (err: any) {
        logger.warn({ err: err.message }, '[WCA] Note: Supabase session discovery note on boot');
      }
    }
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

    // Attempt restoring credentials from Supabase if not on disk
    const credsPath = path.join(sessionDir, 'creds.json');
    if (!fs.existsSync(credsPath)) {
      await this.restoreSessionFromSupabase(connectionId, sessionDir);
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
      logger: pino({ level: 'silent' }),
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
        if (userSession._qrWasGenerated) {
          userSession.status = 'AUTHENTICATING';
          logger.info({ connectionId }, '[WCA] SESSION_AUTHENTICATING (QR was scanned)');
        } else {
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

        // Clear any pending reconnect timers
        if (this.reconnectTimers.has(connectionId)) {
          clearTimeout(this.reconnectTimers.get(connectionId)!);
          this.reconnectTimers.delete(connectionId);
        }

        // Fetch user profile picture
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

        // Sync credentials to Supabase vault upon successful connection
        this.scheduleBackupToSupabase(connectionId, sessionDir);

        // Auto-discover channels in the background so they are cached by the time the UI/Backend requests them
        setTimeout(() => {
          logger.info({ connectionId }, '[WCA] BACKGROUND_CHANNEL_DISCOVERY_START');
          NewsletterService.discoverChannels(sock, connectionId).catch(err => {
            logger.error({ err, connectionId }, '[WCA] BACKGROUND_CHANNEL_DISCOVERY_ERROR');
          });
        }, 1000);
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut;

        logger.warn(
          { connectionId, statusCode, reason: lastDisconnect?.error?.message, isLoggedOut },
          `[WCA] SESSION_DISCONNECTED isLoggedOut=${isLoggedOut}`
        );

        if (isLoggedOut) {
          userSession.status = 'REVOKED';
          await this.purgeSession(connectionId);
        } else {
          // CRITICAL: Maintain session as INITIALIZING and auto-reconnect continuously.
          // Never abandon session unless user explicitly clicks disconnect or logs out from phone!
          userSession.status = 'INITIALIZING';
          userSession.retryCount += 1;
          const delay = Math.min(1000 * Math.pow(1.5, Math.min(userSession.retryCount, 8)), 15000);

          if (this.reconnectTimers.has(connectionId)) {
            clearTimeout(this.reconnectTimers.get(connectionId)!);
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
   * Gets current state of a session. Lazy-boots from disk if saved creds exist.
   */
  public getSession(connectionId: string): UserSession | undefined {
    let sess = this.sessions.get(connectionId);
    if (!sess) {
      const sessionDir = path.join(this.baseSessionDir, `session_${connectionId}`);
      if (fs.existsSync(path.join(sessionDir, 'creds.json'))) {
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
  public async purgeSession(connectionId: string): Promise<void> {
    if (this.reconnectTimers.has(connectionId)) {
      clearTimeout(this.reconnectTimers.get(connectionId)!);
      this.reconnectTimers.delete(connectionId);
    }
    if (this.backupTimers.has(connectionId)) {
      clearTimeout(this.backupTimers.get(connectionId)!);
      this.backupTimers.delete(connectionId);
    }

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

    await this.clearSupabaseCredentials(connectionId);
  }
}
