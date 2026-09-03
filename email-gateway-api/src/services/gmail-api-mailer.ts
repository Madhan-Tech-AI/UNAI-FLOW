import { google } from 'googleapis';
import pino from 'pino';

const logger = pino({ level: 'info' });

export interface GmailPayload {
  to: string;
  name?: string;
  subject: string;
  html: string;
  text?: string;
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface GmailSendResult {
  success: boolean;
  messageId?: string;
  threadId?: string;
  error?: string;
}

/**
 * Sends email via the Gmail REST API over HTTPS (port 443).
 * This completely bypasses SMTP ports (25/465/587) which are blocked on cloud hosts like Render.
 * 
 * Uses OAuth2 refresh token for authentication. The refresh token never expires
 * unless the user explicitly revokes it.
 */
export class GmailApiMailer {
  private static instance: GmailApiMailer;
  private gmail;
  private userEmail: string;
  private defaultFromName: string;
  public totalSent = 0;
  public totalFailed = 0;
  public readonly startedAt = new Date();

  private constructor() {
    const clientId = process.env.GMAIL_CLIENT_ID || '';
    const clientSecret = process.env.GMAIL_CLIENT_SECRET || '';
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN || '';
    this.userEmail = process.env.GMAIL_USER_EMAIL || process.env.EMAIL_FROM_EMAIL || '';
    this.defaultFromName = process.env.EMAIL_FROM_NAME || 'UNAI Flow';

    if (!clientId || !clientSecret || !refreshToken || !this.userEmail) {
      logger.error('[GMAIL_API] Missing required env vars: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN, GMAIL_USER_EMAIL');
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    this.gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    logger.info({ user: this.userEmail.slice(0, 5) + '***' }, '[GMAIL_API] Gmail API transport initialized (HTTPS port 443)');
  }

  public static getInstance(): GmailApiMailer {
    if (!GmailApiMailer.instance) {
      GmailApiMailer.instance = new GmailApiMailer();
    }
    return GmailApiMailer.instance;
  }

  public async verify(): Promise<boolean> {
    try {
      // Attempt to get profile to verify credentials
      const profile = await this.gmail.users.getProfile({ userId: 'me' });
      logger.info({ email: profile.data.emailAddress }, '[GMAIL_API] Verified: connected to Gmail account');
      return true;
    } catch (err: any) {
      logger.error({ err: err.message }, '[GMAIL_API] Verification failed');
      return false;
    }
  }

  /**
   * Constructs an RFC 2822 MIME message from the given payload.
   */
  private buildMimeMessage(payload: GmailPayload): string {
    const fromEmail = payload.fromEmail || this.userEmail;
    const fromName = payload.fromName || this.defaultFromName;
    const toHeader = payload.name ? `"${payload.name}" <${payload.to}>` : payload.to;
    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    const lines: string[] = [
      `MIME-Version: 1.0`,
      `From: "${fromName}" <${fromEmail}>`,
      `To: ${toHeader}`,
      `Subject: ${payload.subject}`,
    ];

    if (payload.replyTo) {
      lines.push(`Reply-To: ${payload.replyTo}`);
    }

    if (payload.headers) {
      for (const [key, value] of Object.entries(payload.headers)) {
        lines.push(`${key}: ${value}`);
      }
    }

    // Multipart/alternative: plain text + HTML
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push('');

    // Plain text part
    const plainText = payload.text || 'Please view this email in an HTML-compatible client.';
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(plainText);
    lines.push('');

    // HTML part
    lines.push(`--${boundary}`);
    lines.push('Content-Type: text/html; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: 7bit');
    lines.push('');
    lines.push(payload.html);
    lines.push('');

    lines.push(`--${boundary}--`);

    return lines.join('\r\n');
  }

  public async send(payload: GmailPayload): Promise<GmailSendResult> {
    try {
      const rawMessage = this.buildMimeMessage(payload);
      const encodedMessage = Buffer.from(rawMessage)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const res = await this.gmail.users.messages.send({
        userId: 'me',
        requestBody: {
          raw: encodedMessage,
        },
      });

      const messageId = res.data.id || '';
      const threadId = res.data.threadId || '';
      this.totalSent += 1;

      logger.info({ to: payload.to, messageId, threadId }, '[GMAIL_API] Email delivered successfully via Gmail API');

      return {
        success: true,
        messageId: `gmail_${messageId}`,
        threadId,
      };
    } catch (err: any) {
      this.totalFailed += 1;
      const errorMsg = err.response?.data?.error?.message || err.message || 'Gmail API error';
      logger.error({ to: payload.to, err: errorMsg }, '[GMAIL_API] Failed to send email');

      return {
        success: false,
        error: errorMsg,
      };
    }
  }
}
