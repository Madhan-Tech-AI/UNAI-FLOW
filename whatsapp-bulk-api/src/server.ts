import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pino from 'pino';
import { BulkSessionManager } from './services/session_manager.js';
import { MessageService } from './services/message_service.js';

dotenv.config();

const app = express();
const logger = pino({ level: process.env.BULK_LOG_LEVEL || 'info' });
const PORT = process.env.PORT || process.env.BULK_PORT || 3002;
const API_KEY = process.env.BULK_API_KEY || 'bulk-7f3a9c2e-d841-4b6f-a5e3-91c8d0f2e7b4';
const sessionManager = BulkSessionManager.getInstance();

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
  if (apiKey && apiKey !== API_KEY) {
    return res.status(401).json({ error: 'Unauthorized: Invalid API key' });
  }
  next();
}

// ── Health & Diagnostics ──
const startTime = Date.now();

app.get('/', (req: Request, res: Response) => {
  res.json({
    ok: true,
    service: 'whatsapp-bulk-api',
    status: 'healthy',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      connect: 'POST /v1/bulk/connect',
      status: 'GET /v1/bulk/:connectionId/status',
      qr: 'GET /v1/bulk/:connectionId/qr',
      pair: 'POST /v1/bulk/:connectionId/pair',
      sendText: 'POST /v1/bulk/:connectionId/messages/text',
      sendImage: 'POST /v1/bulk/:connectionId/messages/image',
      sendVideo: 'POST /v1/bulk/:connectionId/messages/video',
      sendDocument: 'POST /v1/bulk/:connectionId/messages/document',
      sendPoll: 'POST /v1/bulk/:connectionId/messages/poll',
      disconnect: 'POST /v1/bulk/:connectionId/disconnect',
    },
  });
});

app.get('/health', (req: Request, res: Response) => {
  let activeSessions = 0;
  const allSessions = (sessionManager as any).sessions;
  if (allSessions && typeof allSessions.size === 'number') {
    activeSessions = allSessions.size;
  }

  res.json({
    ok: true,
    service: 'whatsapp-bulk-api',
    status: 'healthy',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    active_sessions: activeSessions,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
  });
});

// ──────────────────────────────────────────────
// SESSION MANAGEMENT ENDPOINTS
// ──────────────────────────────────────────────

/**
 * 1. Initialize or connect session
 * POST /v1/bulk/connect
 */
app.post('/v1/bulk/connect', async (req: Request, res: Response) => {
  try {
    const connectionId = (req.body.connectionId || req.body.connection_id || `bulk_${Date.now()}`).toString();
    const session = await sessionManager.getOrCreateSession(connectionId);

    return res.status(200).json({
      success: true,
      connectionId: session.connectionId,
      status: session.status,
      isReady: session.status === 'CONNECTED',
    });
  } catch (err: any) {
    logger.error({ err }, '[BULK] Error connecting session');
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 2. Get connection status
 * GET /v1/bulk/:connectionId/status
 */
app.get('/v1/bulk/:connectionId/status', async (req: Request, res: Response) => {
  const connectionId = getParam(req, 'connectionId');
  let session = sessionManager.getSession(connectionId);

  // If session is not in memory, attempt to restore
  if (!session) {
    try {
      session = await sessionManager.getOrCreateSession(connectionId);
    } catch {}
  }

  if (!session) {
    return res.status(200).json({
      success: false,
      connectionId,
      status: 'DISCONNECTED',
      isReady: false,
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
      profilePictureUrl: session.profilePictureUrl,
    },
  });
});

/**
 * 3. Get QR Code
 * GET /v1/bulk/:connectionId/qr
 */
app.get('/v1/bulk/:connectionId/qr', async (req: Request, res: Response) => {
  const connectionId = getParam(req, 'connectionId');
  const format = req.query.format as string;

  const session = sessionManager.getSession(connectionId);

  if (!session) {
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
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    return res.send(session.qrCodePng);
  }

  return res.status(204).setHeader('Cache-Control', 'no-cache').send();
});

/**
 * 4. Request Phone Number Pairing
 * POST /v1/bulk/:connectionId/pair
 */
app.post('/v1/bulk/:connectionId/pair', async (req: Request, res: Response) => {
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

// ──────────────────────────────────────────────
// MESSAGE SENDING ENDPOINTS
// ──────────────────────────────────────────────

/**
 * Helper: ensure session is connected before sending.
 * Falls back to ANY connected session if the requested connectionId isn't found,
 * because campaign workers may use a different ID than the one used during pairing.
 */
async function getConnectedSession(connectionId: string, res: Response) {
  let session = sessionManager.getSession(connectionId);
  logger.info({ connectionId, found: !!session, status: session?.status }, '[BULK] getConnectedSession: initial lookup');

  // Try to restore if not in memory
  if (!session || session.status !== 'CONNECTED' || !session.socket) {
    try {
      session = await sessionManager.getOrCreateSession(connectionId);
      // Wait up to 15s for reconnection
      const maxWaitMs = 15000;
      const pollIntervalMs = 500;
      let waited = 0;
      while (waited < maxWaitMs && session.status !== 'CONNECTED') {
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
        waited += pollIntervalMs;
        session = sessionManager.getSession(connectionId) || session;
      }
      logger.info({ connectionId, status: session?.status, waited }, '[BULK] getConnectedSession: after restore attempt');
    } catch (err: any) {
      logger.warn({ connectionId, err: err.message }, '[BULK] getConnectedSession: restore failed');
    }
  }

  // Fallback: if requested connectionId doesn't have a connected session,
  // try finding ANY connected session (handles instance_uuid vs 'default' mismatch)
  if (!session || session.status !== 'CONNECTED' || !session.socket) {
    logger.info({ connectionId }, '[BULK] getConnectedSession: requested ID not connected, trying fallback to any connected session');
    const fallback = sessionManager.getAnyConnectedSession();
    if (fallback && fallback.status === 'CONNECTED' && fallback.socket) {
      logger.info({ requestedId: connectionId, actualId: fallback.connectionId }, '[BULK] getConnectedSession: using fallback session');
      session = fallback;
    }
  }

  if (!session || session.status !== 'CONNECTED' || !session.socket) {
    const currentStatus = session?.status || 'NO_SESSION';
    logger.error({ connectionId, currentStatus }, '[BULK] getConnectedSession: NO connected session found');
    res.status(400).json({
      success: false,
      error: `WhatsApp session is not connected (status: ${currentStatus}). Please scan the QR code to link your WhatsApp account first.`,
      sessionStatus: currentStatus,
      requestedConnectionId: connectionId,
    });
    return null;
  }

  return session;
}


/**
 * 5. Send Text Message
 * POST /v1/bulk/:connectionId/messages/text
 */
app.post('/v1/bulk/:connectionId/messages/text', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const connectionId = getParam(req, 'connectionId');
    const { to, body, text } = req.body;
    const messageText = body || text;

    if (!to || !messageText) {
      return res.status(400).json({ success: false, error: '"to" and "body" (or "text") are required' });
    }

    const session = await getConnectedSession(connectionId, res);
    if (!session) return;

    const result = await MessageService.sendText(session.socket!, to, messageText);

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    return res.json({
      success: true,
      message_id: result.messageId,
      to: result.to,
      timestamp: result.timestamp,
    });
  } catch (err: any) {
    logger.error({ err }, '[BULK] Send text failed');
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 6. Send Image Message
 * POST /v1/bulk/:connectionId/messages/image
 */
app.post('/v1/bulk/:connectionId/messages/image', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const connectionId = getParam(req, 'connectionId');
    const { to, media_url, mediaUrl, caption } = req.body;
    const url = media_url || mediaUrl;

    if (!to || !url) {
      return res.status(400).json({ success: false, error: '"to" and "media_url" are required' });
    }

    const session = await getConnectedSession(connectionId, res);
    if (!session) return;

    const result = await MessageService.sendImage(session.socket!, to, url, caption);

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    return res.json({
      success: true,
      message_id: result.messageId,
      to: result.to,
      timestamp: result.timestamp,
    });
  } catch (err: any) {
    logger.error({ err }, '[BULK] Send image failed');
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 7. Send Video Message
 * POST /v1/bulk/:connectionId/messages/video
 */
app.post('/v1/bulk/:connectionId/messages/video', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const connectionId = getParam(req, 'connectionId');
    const { to, media_url, mediaUrl, caption } = req.body;
    const url = media_url || mediaUrl;

    if (!to || !url) {
      return res.status(400).json({ success: false, error: '"to" and "media_url" are required' });
    }

    const session = await getConnectedSession(connectionId, res);
    if (!session) return;

    const result = await MessageService.sendVideo(session.socket!, to, url, caption);

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    return res.json({
      success: true,
      message_id: result.messageId,
      to: result.to,
      timestamp: result.timestamp,
    });
  } catch (err: any) {
    logger.error({ err }, '[BULK] Send video failed');
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 8. Send Document Message
 * POST /v1/bulk/:connectionId/messages/document
 */
app.post('/v1/bulk/:connectionId/messages/document', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const connectionId = getParam(req, 'connectionId');
    const { to, media_url, mediaUrl, filename, caption } = req.body;
    const url = media_url || mediaUrl;

    if (!to || !url) {
      return res.status(400).json({ success: false, error: '"to" and "media_url" are required' });
    }

    const session = await getConnectedSession(connectionId, res);
    if (!session) return;

    const result = await MessageService.sendDocument(session.socket!, to, url, filename, caption);

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    return res.json({
      success: true,
      message_id: result.messageId,
      to: result.to,
      timestamp: result.timestamp,
    });
  } catch (err: any) {
    logger.error({ err }, '[BULK] Send document failed');
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 9. Send Poll Message
 * POST /v1/bulk/:connectionId/messages/poll
 */
app.post('/v1/bulk/:connectionId/messages/poll', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const connectionId = getParam(req, 'connectionId');
    const { to, question, options, selectable_count } = req.body;

    if (!to || !question || !options || !Array.isArray(options) || options.length < 2) {
      return res.status(400).json({ success: false, error: '"to", "question", and "options" (min 2) are required' });
    }

    const session = await getConnectedSession(connectionId, res);
    if (!session) return;

    const result = await MessageService.sendPoll(session.socket!, to, question, options, selectable_count || 1);

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    return res.json({
      success: true,
      message_id: result.messageId,
      to: result.to,
      timestamp: result.timestamp,
    });
  } catch (err: any) {
    logger.error({ err }, '[BULK] Send poll failed');
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ──────────────────────────────────────────────
// SESSION MANAGEMENT
// ──────────────────────────────────────────────

/**
 * 10. Disconnect session
 * POST /v1/bulk/:connectionId/disconnect
 */
app.post('/v1/bulk/:connectionId/disconnect', async (req: Request, res: Response) => {
  const connectionId = getParam(req, 'connectionId');
  if (!connectionId) {
    return res.status(400).json({ success: false, error: 'connectionId required' });
  }
  logger.info({ connectionId }, '[BULK] SESSION_PURGE_REQUEST');
  await sessionManager.purgeSession(connectionId);
  return res.json({ success: true, message: 'Session disconnected and purged' });
});

// ── Start Express Server ──
app.listen(PORT, () => {
  logger.info(`⚡ UNAI WhatsApp Bulk Messaging API v1.0 listening on port ${PORT}`);
  // Pre-boot all saved sessions
  sessionManager.initAllSavedSessions().catch((err) => {
    logger.error({ err }, '[BULK] Error during saved sessions auto-boot');
  });
});
