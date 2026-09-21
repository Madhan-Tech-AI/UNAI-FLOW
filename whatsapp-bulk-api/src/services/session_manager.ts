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

export interface BulkSession {
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
  _qrWasGenerated: boolean;
  _hasEverAuthenticated: boolean;
  _hadSavedCreds: boolean;
}

export class BulkSessionManager {
  private static instance: BulkSessionManager;
  private sessions: Map<string, BulkSession> = new Map();
  private baseSessionDir: string;
  private supabaseUrl: string;
  private supabaseKey: string;
  private backupTimers: Map<string, NodeJS.Timeout> = new Map();
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();

  private constructor() {
    this.baseSessionDir = process.env.BULK_SESSION_DIR || path.resolve(process.cwd(), 'sessions');
    if (!fs.existsSync(this.baseSessionDir)) {
      fs.mkdirSync(this.baseSessionDir, { recursive: true });
    }
    this.supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
    this.supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  }

  public static getInstance(): BulkSessionManager {
    if (!BulkSessionManager.instance) {
      BulkSessionManager.instance = new BulkSessionManager();
    }
    return BulkSessionManager.instance;
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
            logger.info({ connectionId, fileCount: Object.keys(files).length }, '[BULK] Restored session files from Supabase vault');
            return true;
          }
        }
      }
    } catch (err: any) {
      logger.warn({ connectionId, err: err.message }, '[BULK] Could not restore session from Supabase vault');
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
        logger.info({ connectionId, filesBackedUp: Object.keys(files).length }, '[BULK] Session credentials backed up to Supabase vault');
      } catch (err: any) {
        logger.warn({ connectionId, err: err.message }, '[BULK] Failed to backup session to Supabase');
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
      logger.info({ connectionId }, '[BULK] Cleared Supabase credentials on purge');
    } catch (err: any) {
      logger.warn({ connectionId, err: err.message }, '[BULK] Failed to clear Supabase credentials');
    }
  }

  /**
   * Scans disk and Supabase to restore all previously connected sessions on boot.
   */
  public async initAllSavedSessions(): Promise<void> {
    logger.info('[BULK] Scanning for saved WhatsApp sessions to restore...');
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
            logger.info({ connId }, '[BULK] Restoring saved session from disk on boot...');
            this.initSession(connId).catch((err) => {
              logger.error({ err, connId }, '[BULK] Failed to boot saved session from disk');
            });
          }
        }
      }
    }

    // 2. Query Supabase for CONNECTED sessions that might not be on disk
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
            if (connId && !booted.has(connId)) {
              const hasCreds = row.encrypted_credentials && typeof row.encrypted_credentials === 'string' && row.encrypted_credentials.trim().startsWith('{');
              if (hasCreds) {
                booted.add(connId);
                logger.info({ connId }, '[BULK] Restoring connected session from Supabase vault on boot...');
                this.initSession(connId).catch((err) => {
                  logger.error({ err, connId }, '[BULK] Failed to boot session restored from Supabase');
                });
              }
            }
          }
        }
      } catch (err: any) {
        logger.warn({ err: err.message }, '[BULK] Supabase session discovery note on boot');
      }
    }
  }

  /**
   * Gets an existing session or creates a new one.
   */
  public async getOrCreateSession(connectionId: string): Promise<BulkSession> {
    if (this.sessions.has(connectionId)) {
      const sess = this.sessions.get(connectionId)!;
      sess.lastActive = new Date();
      // If connected with a live socket, just return
      if (sess.status === 'CONNECTED' && sess.socket) {
        return sess;
      }
      // If in QR_READY or WAITING_FOR_SCAN state, also just return
      if (sess.status === 'QR_READY' || sess.status === 'WAITING_FOR_SCAN' || sess.status === 'INITIALIZING') {
        return sess;
      }
    }
    return this.initSession(connectionId);
  }

  /**
   * Gets an existing session without creating a new one.
   */
  public getSession(connectionId: string): BulkSession | undefined {
    return this.sessions.get(connectionId);
  }

  /**
   * Initializes a Baileys session for the given connection.
   */
  public async initSession(connectionId: string): Promise<BulkSession> {
    // Clean up existing session if any
    const existing = this.sessions.get(connectionId);
    if (existing?.socket) {
      try {
        existing.socket.end(undefined);
      } catch {}
    }

    const sessionDir = path.join(this.baseSessionDir, `session_${connectionId}`);

    // Try to restore from Supabase if no local creds
    const credsPath = path.join(sessionDir, 'creds.json');
    if (!fs.existsSync(credsPath)) {
      await this.restoreSessionFromSupabase(connectionId, sessionDir);
    }

    const hadSavedCreds = fs.existsSync(path.join(sessionDir, 'creds.json'));

    // Check if creds indicate registered user
    let credsRegistered = false;
    if (hadSavedCreds) {
      try {
        const credsContent = JSON.parse(fs.readFileSync(path.join(sessionDir, 'creds.json'), 'utf-8'));
        credsRegistered = credsContent?.me?.id ? true : false;
      } catch {}
    }

    const session: BulkSession = {
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
      _hasEverAuthenticated: credsRegistered,
      _hadSavedCreds: hadSavedCreds,
    };

    this.sessions.set(connectionId, session);

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
      },
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['UNAI Bulk Gateway', 'Chrome', '22.0'],
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
    });

    session.socket = sock;

    // QR Code handler
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        session.status = 'QR_READY';
        session.qrCodeRaw = qr;
        session._qrWasGenerated = true;
        try {
          session.qrCodePng = await QRCode.toBuffer(qr, { width: 512, margin: 2 });
        } catch {}
        session.qrGeneratedAt = new Date();
        session.qrExpiresAt = new Date(Date.now() + 60000);
        logger.info({ connectionId }, '[BULK] QR_CODE_GENERATED');
      }

      if (connection === 'open') {
        session.status = 'CONNECTED';
        session._hasEverAuthenticated = true;
        session.qrCodeRaw = null;
        session.qrCodePng = null;
        session.retryCount = 0;

        // Extract user info
        const me = sock.user;
        if (me) {
          session.userJid = me.id;
          session.userName = me.name || null;
          const rawId = me.id.split(':')[0].split('@')[0];
          session.phoneNumber = rawId;
        }

        // Try to get profile picture
        try {
          if (session.userJid) {
            const ppUrl = await sock.profilePictureUrl(session.userJid, 'image');
            session.profilePictureUrl = ppUrl || null;
          }
        } catch {}

        logger.info(
          { connectionId, phone: session.phoneNumber, name: session.userName },
          '[BULK] SESSION_CONNECTED'
        );

        // Update Supabase status
        this.updateSupabaseStatus(connectionId, 'CONNECTED', session.phoneNumber, session.userName);

        // Backup credentials
        this.scheduleBackupToSupabase(connectionId, sessionDir);
      }

      if (connection === 'close') {
        const boom = (lastDisconnect?.error as Boom)?.output;
        const statusCode = boom?.statusCode ?? 0;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== 401;

        logger.warn(
          { connectionId, statusCode, shouldReconnect },
          '[BULK] SESSION_DISCONNECTED'
        );

        if (shouldReconnect && session.retryCount < 5) {
          session.status = 'DISCONNECTED';
          session.retryCount++;
          const delay = Math.min(2000 * Math.pow(2, session.retryCount - 1), 30000);
          logger.info({ connectionId, delay, retryCount: session.retryCount }, '[BULK] Scheduling reconnect...');

          if (this.reconnectTimers.has(connectionId)) {
            clearTimeout(this.reconnectTimers.get(connectionId)!);
          }
          const timer = setTimeout(() => {
            this.reconnectTimers.delete(connectionId);
            this.initSession(connectionId).catch((err) => {
              logger.error({ err, connectionId }, '[BULK] Reconnect failed');
            });
          }, delay);
          this.reconnectTimers.set(connectionId, timer);
        } else {
          session.status = statusCode === DisconnectReason.loggedOut ? 'REVOKED' : 'FAILED';
          session.socket = null;

          if (statusCode === DisconnectReason.loggedOut) {
            // Clean up session files
            try {
              if (fs.existsSync(sessionDir)) {
                fs.rmSync(sessionDir, { recursive: true, force: true });
              }
            } catch {}
            await this.clearSupabaseCredentials(connectionId);
          }

          this.updateSupabaseStatus(connectionId, session.status, null, null);
        }
      }
    });

    // Credentials saver
    sock.ev.on('creds.update', async () => {
      await saveCreds();
      this.scheduleBackupToSupabase(connectionId, sessionDir);
    });

    return session;
  }

  /**
   * Request phone number pairing code.
   */
  public async requestPhonePairing(connectionId: string, phoneNumber: string): Promise<string> {
    const session = this.sessions.get(connectionId);
    if (!session || !session.socket) {
      throw new Error('Session not initialized. Call /connect first.');
    }

    const cleaned = phoneNumber.replace(/\D/g, '');
    logger.info({ connectionId, phone: cleaned }, '[BULK] Requesting phone pairing code...');

    const code = await session.socket.requestPairingCode(cleaned);
    session.pairingCode = code;
    return code;
  }

  /**
   * Purge a session completely (disconnect + delete credentials).
   */
  public async purgeSession(connectionId: string): Promise<void> {
    const session = this.sessions.get(connectionId);

    // Clear reconnect timer
    if (this.reconnectTimers.has(connectionId)) {
      clearTimeout(this.reconnectTimers.get(connectionId)!);
      this.reconnectTimers.delete(connectionId);
    }

    // Clear backup timer
    if (this.backupTimers.has(connectionId)) {
      clearTimeout(this.backupTimers.get(connectionId)!);
      this.backupTimers.delete(connectionId);
    }

    if (session?.socket) {
      try {
        await session.socket.logout();
      } catch {}
      try {
        session.socket.end(undefined);
      } catch {}
    }

    // Delete local session files
    const sessionDir = path.join(this.baseSessionDir, `session_${connectionId}`);
    try {
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }
    } catch {}

    // Clear from Supabase
    await this.clearSupabaseCredentials(connectionId);

    this.sessions.delete(connectionId);
    logger.info({ connectionId }, '[BULK] Session purged completely');
  }

  /**
   * Updates session status in Supabase.
   */
  private async updateSupabaseStatus(
    connectionId: string,
    status: string,
    phone: string | null,
    name: string | null
  ): Promise<void> {
    if (!this.supabaseUrl || !this.supabaseKey) return;
    try {
      const url = `${this.supabaseUrl}/rest/v1/whatsapp_sessions?session_identifier=eq.${encodeURIComponent(connectionId)}`;
      const updateData: any = {
        status,
        updated_at: new Date().toISOString(),
      };
      if (phone) updateData.phone_number = phone;
      if (name) updateData.display_name = name;

      await axios.patch(url, updateData, {
        headers: {
          apikey: this.supabaseKey,
          Authorization: `Bearer ${this.supabaseKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        timeout: 10000,
      });
    } catch (err: any) {
      logger.warn({ connectionId, err: err.message }, '[BULK] Failed to update Supabase status');
    }
  }
}
