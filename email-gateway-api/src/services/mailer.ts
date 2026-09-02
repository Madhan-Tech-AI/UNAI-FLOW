import nodemailer, { Transporter, SendMailOptions } from 'nodemailer';
import pino from 'pino';

const logger = pino({ level: 'info' });

export interface EmailPayload {
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

export interface SendResult {
  success: boolean;
  messageId?: string;
  accepted?: string[];
  rejected?: string[];
  error?: string;
}

export class MailerService {
  private static instance: MailerService;
  private transporter: Transporter | null = null;
  private defaultFromEmail: string;
  private defaultFromName: string;
  public totalSent = 0;
  public totalFailed = 0;
  public readonly startedAt = new Date();

  private constructor() {
    this.defaultFromEmail = process.env.EMAIL_FROM_EMAIL || process.env.SMTP_USER || 'noreply@unaiflow.com';
    this.defaultFromName = process.env.EMAIL_FROM_NAME || 'UNAI Flow';
    this.initTransporter();
  }

  public static getInstance(): MailerService {
    if (!MailerService.instance) {
      MailerService.instance = new MailerService();
    }
    return MailerService.instance;
  }

  private initTransporter(): void {
    const host = process.env.SMTP_HOST || 'smtp.gmail.com';
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    const user = process.env.SMTP_USER || '';
    const pass = process.env.SMTP_PASS || process.env.SMTP_PASSWORD || '';
    const secure = process.env.SMTP_SECURE === 'true' || port === 465;

    logger.info({ host, port, user: user ? `${user.slice(0, 3)}***` : 'none', secure }, '[MAILER] Initializing SMTP Transport...');

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: user ? { user, pass } : undefined,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateDelta: 1000,
      rateLimit: 15,
      tls: {
        rejectUnauthorized: false,
      },
    });
  }

  public async verify(): Promise<boolean> {
    if (!this.transporter) return false;
    try {
      await this.transporter.verify();
      logger.info('[MAILER] SMTP connection verified successfully.');
      return true;
    } catch (err: any) {
      logger.error({ err: err.message }, '[MAILER] SMTP connection verification failed');
      return false;
    }
  }

  public async send(payload: EmailPayload): Promise<SendResult> {
    if (!this.transporter) {
      return { success: false, error: 'SMTP transporter not initialized' };
    }

    const fromAddress = payload.fromEmail || this.defaultFromEmail;
    const fromName = payload.fromName || this.defaultFromName;
    const fromHeader = `"${fromName}" <${fromAddress}>`;

    const toHeader = payload.name ? `"${payload.name}" <${payload.to}>` : payload.to;

    const mailOptions: SendMailOptions = {
      from: fromHeader,
      to: toHeader,
      subject: payload.subject,
      html: payload.html,
      text: payload.text || 'Please view this email in an HTML-compatible client.',
    };

    if (payload.replyTo) {
      mailOptions.replyTo = payload.replyTo;
    }

    if (payload.headers) {
      mailOptions.headers = payload.headers;
    }

    try {
      const info = await this.transporter.sendMail(mailOptions);
      this.totalSent += 1;
      logger.info({ to: payload.to, messageId: info.messageId }, '[MAILER] Email delivered successfully');
      return {
        success: true,
        messageId: info.messageId,
        accepted: Array.isArray(info.accepted) ? info.accepted.map(String) : [],
        rejected: Array.isArray(info.rejected) ? info.rejected.map(String) : [],
      };
    } catch (err: any) {
      this.totalFailed += 1;
      logger.error({ to: payload.to, err: err.message }, '[MAILER] Failed to send email');
      return {
        success: false,
        error: err.message || 'SMTP transport error',
      };
    }
  }
}
