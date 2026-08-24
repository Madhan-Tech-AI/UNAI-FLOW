import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pino from 'pino';
import { SessionManager } from './services/session_manager.js';
import { NewsletterService } from './services/newsletter_service.js';
import { MediaService } from './services/media_service.js';

dotenv.config();

const app = express();
const logger = pino({ level: 'info' });
const PORT = process.env.PORT || process.env.WCA_PORT || 3001;
const API_KEY = process.env.WCA_API_KEY || '105eadef-beae-4e08-bcc0-85a06ff80727';
const sessionManager = SessionManager.getInstance();

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Helper to get string param
function getParam(req: Request, key: string): string {
  const val = req.params[key];
  if (Array.isArray(val)) return val[0];
  return (val as string) || '';
}

// ── Auth Middleware ──
function authenticateApiKey(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey || apiKey !== API_KEY) {
    if (req.path.includes('/publish') || req.path.includes('/disconnect')) {
      return res.status(401).json({ error: 'Unauthorized: Invalid or missing X-API-Key header' });
    }
  }
  next();
}

// ── Health & Diagnostics ──
const startTime = Date.now();

app.get('/health', (req: Request, res: Response) => {
  // Count active sessions
  let activeSessions = 0;
  const allSessions = (sessionManager as any).sessions;
  if (allSessions && typeof allSessions.size === 'number') {
    activeSessions = allSessions.size;
  }

  res.json({
    ok: true,
    service: 'whatsapp-channel-api',
    status: 'healthy',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    active_sessions: activeSessions,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
  });
});

// ── Multi-Tenant Session Endpoints ──

/**
 * 1. Initialize or connect session
 * POST /v1/whatsapp/connect
 */
app.post('/v1/whatsapp/connect', async (req: Request, res: Response) => {
  try {
    const connectionId = (req.body.connectionId || req.body.connection_id || `conn_${Date.now()}`).toString();
    const session = await sessionManager.getOrCreateSession(connectionId);

    return res.status(200).json({
      success: true,
      connectionId: session.connectionId,
      status: session.status,
      isReady: session.status === 'CONNECTED',
    });
  } catch (err: any) {
    logger.error({ err }, 'Error connecting session');
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 2. Get connection status
 * GET /v1/whatsapp/:connectionId/status
 */
app.get('/v1/whatsapp/:connectionId/status', async (req: Request, res: Response) => {
  const connectionId = getParam(req, 'connectionId');
  const session = sessionManager.getSession(connectionId);

  if (!session) {
    return res.status(200).json({
      success: false,
      connectionId,
      status: 'DISCONNECTED',
      isReady: false,
      whatsapp: { state: 'disconnected', isReady: false },
    });
  }

  return res.status(200).json({
    success: session.status === 'CONNECTED',
    connectionId,
    status: session.status,
    isReady: session.status === 'CONNECTED',
    hasQR: Boolean(session.qrCodePng || session.qrCodeRaw),
    pairingCode: session.pairingCode,
    userInfo: {
      jid: session.userJid,
      name: session.userName,
      phone: session.phoneNumber,
    },
    whatsapp: {
      state: session.status.toLowerCase(),
      isReady: session.status === 'CONNECTED',
      userInfo: {
        channel_id: (req.query.channel_id as string) || '',
        phone: session.phoneNumber,
        name: session.userName,
      },
    },
  });
});

/**
 * 3. Stream QR Code
 * GET /v1/whatsapp/:connectionId/qr
 */
app.get('/v1/whatsapp/:connectionId/qr', async (req: Request, res: Response) => {
  const connectionId = getParam(req, 'connectionId');
  const format = req.query.format as string;

  // CRITICAL: Use getSession() NOT getOrCreateSession()
  // getOrCreateSession() was destroying the existing session (with QR) and creating a fresh one
  const session = sessionManager.getSession(connectionId);

  if (!session) {
    logger.warn({ connectionId }, '[WCA] QR_REQUEST_NO_SESSION');
    return res.status(404).json({ success: false, error: 'Session not found. Call /connect first.' });
  }

  if (session.status === 'CONNECTED') {
    if (format === 'json') {
      return res.json({ success: true, message: 'Already connected!', state: 'connected' });
    }
    return res.status(204).send();
  }

  if (format === 'json') {
    return res.json({
      success: Boolean(session.qrCodeRaw),
      qr: session.qrCodeRaw,
      state: session.status,
    });
  }

  if (session.qrCodePng) {
    logger.info({ connectionId, size: session.qrCodePng.length }, '[WCA] QR_SERVED_AS_PNG');
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.send(session.qrCodePng);
  }

  logger.warn({ connectionId, status: session.status, hasRaw: Boolean(session.qrCodeRaw) }, '[WCA] QR_NOT_READY_YET');
  return res.status(204).setHeader('Cache-Control', 'no-cache').send();
});

/**
 * 4. Request Phone Number Pairing
 * POST /v1/whatsapp/:connectionId/pair
 */
app.post('/v1/whatsapp/:connectionId/pair', async (req: Request, res: Response) => {
  try {
    const connectionId = getParam(req, 'connectionId');
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, error: 'Phone number is required' });
    }

    const code = await sessionManager.requestPhonePairing(connectionId, phone);
    return res.json({
      success: true,
      message: 'Pairing code generated successfully',
      pairingCode: code,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 5. Discover Channels / Newsletters
 * GET /v1/whatsapp/:connectionId/channels
 */
app.get('/v1/whatsapp/:connectionId/channels', async (req: Request, res: Response) => {
  try {
    const connectionId = getParam(req, 'connectionId');
    const session = sessionManager.getSession(connectionId);

    if (!session || session.status !== 'CONNECTED' || !session.socket) {
      return res.status(200).json({
        success: false,
        error: 'WhatsApp session not connected',
        channels: [],
      });
    }

    const channels = await NewsletterService.discoverChannels(session.socket);
    return res.json({
      success: true,
      channels,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message, channels: [] });
  }
});

/**
 * 5b. Resolve Channel by Invite Link or Code
 * POST /v1/whatsapp/:connectionId/channels/resolve
 */
app.post('/v1/whatsapp/:connectionId/channels/resolve', async (req: Request, res: Response) => {
  try {
    const connectionId = getParam(req, 'connectionId');
    const { link, code, channelId } = req.body || {};
    const input = link || code || channelId;

    if (!input) {
      return res.status(400).json({ success: false, error: 'Provide a channel link or invite code.' });
    }

    const session = sessionManager.getSession(connectionId);
    if (!session || session.status !== 'CONNECTED' || !session.socket) {
      return res.status(400).json({
        success: false,
        error: 'WhatsApp session not connected',
      });
    }

    const channel = await NewsletterService.resolveChannel(session.socket, input);
    if (!channel) {
      return res.status(404).json({
        success: false,
        error: 'Could not resolve WhatsApp channel from the provided link/code. Ensure the link is valid.',
      });
    }

    return res.json({
      success: true,
      channel,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 6. Publish to WhatsApp Channel / Newsletter
 * POST /v1/whatsapp/connections/:connectionId/channels/:channelId/publish
 */
app.post(
  '/v1/whatsapp/connections/:connectionId/channels/:channelId/publish',
  authenticateApiKey,
  async (req: Request, res: Response) => {
    try {
      const connectionId = getParam(req, 'connectionId');
      const channelId = getParam(req, 'channelId');
      const { type = 'text', text, caption, mediaUrl } = req.body;

      const session = sessionManager.getSession(connectionId);
      if (!session || session.status !== 'CONNECTED' || !session.socket) {
        return res.status(400).json({
          success: false,
          error: 'WhatsApp account is not connected. Please scan QR code first.',
        });
      }

      const contentText = caption || text || '';
      let messagePayload: any = {};

      if (type === 'image' || type === 'video' || mediaUrl) {
        const { buffer, mimeType, isVideo } = await MediaService.prepareMedia(mediaUrl);
        if (isVideo || type === 'video') {
          messagePayload = {
            video: buffer,
            caption: contentText,
            mimetype: mimeType || 'video/mp4',
          };
        } else {
          messagePayload = {
            image: buffer,
            caption: contentText,
            mimetype: mimeType || 'image/jpeg',
          };
        }
      } else {
        if (!contentText) {
          return res.status(400).json({ success: false, error: 'Provide text or mediaUrl' });
        }
        messagePayload = { text: contentText };
      }

      const result = await NewsletterService.publishToChannel(session.socket, channelId, messagePayload);
      return res.status(200).json(result);
    } catch (err: any) {
      logger.error({ err }, 'Publish to channel failed');
      return res.status(500).json({ success: false, error: err.message });
    }
  }
);

/**
 * 7. Disconnect session
 * POST /v1/whatsapp/:connectionId/disconnect
 * DELETE /v1/whatsapp/:connectionId
 * POST /v1/whatsapp/disconnect
 */
app.all(['/v1/whatsapp/:connectionId/disconnect', '/v1/whatsapp/:connectionId', '/v1/whatsapp/disconnect'], async (req: Request, res: Response) => {
  const connectionId = getParam(req, 'connectionId') || (req.body?.connectionId || req.body?.connection_id || req.body?.session_identifier || '').toString();
  if (!connectionId) {
    return res.status(400).json({ success: false, error: 'connectionId required' });
  }
  logger.info({ connectionId }, '[WCA] SESSION_PURGE_REQUEST');
  await sessionManager.purgeSession(connectionId);
  return res.json({ success: true, message: 'Session disconnected and purged' });
});

// ── Backward-Compatibility Endpoints (for existing routes) ──

const DEFAULT_CONN_ID = 'default_primary_session';

app.get('/api/status', async (req: Request, res: Response) => {
  const session = sessionManager.getSession(DEFAULT_CONN_ID);
  const isReady = session?.status === 'CONNECTED';
  return res.json({
    success: isReady,
    whatsapp: {
      state: session ? session.status.toLowerCase() : 'disconnected',
      isReady,
      hasQR: Boolean(session?.qrCodePng),
      pairingCode: session?.pairingCode,
      userInfo: {
        phone: session?.phoneNumber,
        name: session?.userName,
      },
    },
    service: 'UNAI WhatsApp Gateway v2.0',
  });
});

app.get('/api/qr', async (req: Request, res: Response) => {
  const session = await sessionManager.getOrCreateSession(DEFAULT_CONN_ID);
  if (session.status === 'CONNECTED') {
    return res.json({ success: true, message: 'Already connected!', state: 'connected' });
  }

  if (session.qrCodePng) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.send(session.qrCodePng);
  }

  return res.status(204).send();
});

app.post('/api/pair-phone', async (req: Request, res: Response) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, error: 'Phone required' });
  const code = await sessionManager.requestPhonePairing(DEFAULT_CONN_ID, phone);
  return res.json({ success: true, message: 'Pairing requested', pairingCode: code });
});

app.get('/api/channels', async (req: Request, res: Response) => {
  const session = sessionManager.getSession(DEFAULT_CONN_ID);
  if (!session || session.status !== 'CONNECTED' || !session.socket) {
    return res.json({ success: true, channels: [] });
  }
  const channels = await NewsletterService.discoverChannels(session.socket);
  return res.json({ success: true, channels });
});

app.post('/api/channel/publish', authenticateApiKey, async (req: Request, res: Response) => {
  const session = sessionManager.getSession(DEFAULT_CONN_ID);
  if (!session || session.status !== 'CONNECTED' || !session.socket) {
    return res.status(400).json({ success: false, error: 'WhatsApp is not connected. Scan QR first.' });
  }

  const { channelId, text, caption, mediaUrl } = req.body;
  const targetChannel = channelId || process.env.WCA_CHANNEL_ID || '';
  const content = caption || text || '';

  let messagePayload: any = {};
  if (mediaUrl) {
    const { buffer, mimeType, isVideo } = await MediaService.prepareMedia(mediaUrl);
    messagePayload = isVideo
      ? { video: buffer, caption: content, mimetype: mimeType || 'video/mp4' }
      : { image: buffer, caption: content, mimetype: mimeType || 'image/jpeg' };
  } else {
    messagePayload = { text: content };
  }

  const result = await NewsletterService.publishToChannel(session.socket, targetChannel, messagePayload);
  return res.json({
    success: true,
    messageId: result.postId,
    channelId: result.channelId,
    timestamp: result.publishedAt,
  });
});

app.post('/api/session/reset', async (req: Request, res: Response) => {
  await sessionManager.purgeSession(DEFAULT_CONN_ID);
  await sessionManager.initSession(DEFAULT_CONN_ID);
  return res.json({ success: true, message: 'Session reset initiated.' });
});

app.post('/api/logout', async (req: Request, res: Response) => {
  await sessionManager.purgeSession(DEFAULT_CONN_ID);
  return res.json({ success: true, message: 'Logged out successfully.' });
});

// Start Express Server
app.listen(PORT, () => {
  logger.info(`⚡ UNAI WhatsApp Gateway v2.0 listening on port ${PORT}`);
  // Pre-boot default session
  sessionManager.initSession(DEFAULT_CONN_ID).catch((err) => {
    logger.error({ err }, 'Error during default session auto-boot');
  });
});
