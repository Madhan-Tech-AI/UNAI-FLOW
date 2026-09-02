import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import pino from 'pino';
import { MailerService, EmailPayload } from './services/mailer.js';
import { authenticateApiKey } from './middleware/auth.js';

dotenv.config();

const logger = pino({ level: 'info' });
const app = express();
const port = parseInt(process.env.PORT || '3002', 10);

app.use(cors());
app.use(express.json({ limit: '10mb' }));

const mailer = MailerService.getInstance();

// ── 1. Health Check (Unauthenticated) ──
app.get('/health', async (_req: Request, res: Response) => {
  const isSmtpConnected = await mailer.verify();
  return res.json({
    ok: true,
    service: 'unai-email-gateway',
    status: isSmtpConnected ? 'healthy' : 'degraded',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor((Date.now() - mailer.startedAt.getTime()) / 1000),
    total_sent: mailer.totalSent,
    total_failed: mailer.totalFailed,
  });
});

app.get('/', (_req: Request, res: Response) => {
  return res.json({
    service: 'UNAI Flow Email Gateway',
    version: '1.0.0',
    docs: 'POST /v1/email/send with X-API-Key header',
  });
});

// ── 2. Send Single Email ──
app.post('/v1/email/send', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { to, name, subject, html, text, from_email, from_name, reply_to, headers } = req.body;

    if (!to || !subject || !html) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: to, subject, html are required.',
      });
    }

    const payload: EmailPayload = {
      to,
      name,
      subject,
      html,
      text,
      fromEmail: from_email,
      fromName: from_name,
      replyTo: reply_to,
      headers,
    };

    const result = await mailer.send(payload);

    if (result.success) {
      return res.status(200).json({
        success: true,
        messageId: result.messageId,
        accepted: result.accepted,
        rejected: result.rejected,
      });
    } else {
      return res.status(500).json({
        success: false,
        error: result.error || 'Failed to dispatch email',
      });
    }
  } catch (err: any) {
    logger.error({ err: err.message }, 'Unexpected error in /v1/email/send');
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── 3. Batch Email Send ──
app.post('/v1/email/batch', authenticateApiKey, async (req: Request, res: Response) => {
  try {
    const { emails } = req.body;
    if (!emails || !Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ success: false, error: 'emails must be a non-empty array' });
    }

    logger.info({ count: emails.length }, '[GATEWAY] Processing batch send...');

    const results = [];
    for (const item of emails) {
      const payload: EmailPayload = {
        to: item.to,
        name: item.name,
        subject: item.subject,
        html: item.html,
        text: item.text,
        fromEmail: item.from_email,
        fromName: item.from_name,
        replyTo: item.reply_to,
        headers: item.headers,
      };
      const resItem = await mailer.send(payload);
      results.push({ to: item.to, ...resItem });
    }

    const totalSuccess = results.filter((r) => r.success).length;
    return res.json({
      success: true,
      total_requested: emails.length,
      total_sent: totalSuccess,
      results,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Batch send error');
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── 4. Delivery Status & Metrics ──
app.get('/v1/email/status', authenticateApiKey, (_req: Request, res: Response) => {
  return res.json({
    success: true,
    total_sent: mailer.totalSent,
    total_failed: mailer.totalFailed,
    uptime_seconds: Math.floor((Date.now() - mailer.startedAt.getTime()) / 1000),
  });
});

app.listen(port, () => {
  logger.info(`🚀 UNAI Email Gateway listening on port ${port}`);
});
