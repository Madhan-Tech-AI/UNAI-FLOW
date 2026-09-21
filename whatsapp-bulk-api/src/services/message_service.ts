import { WASocket, proto } from '@whiskeysockets/baileys';
import pino from 'pino';
import { MediaService } from './media_service.js';

const logger = pino({ level: 'info' });

export interface SendResult {
  success: boolean;
  messageId: string;
  to: string;
  timestamp: string;
  error?: string;
}

export class MessageService {
  /**
   * Normalizes a phone number into a WhatsApp JID.
   * Examples:
   *   "+91 98765 43210"  → "919876543210@s.whatsapp.net"
   *   "919876543210"     → "919876543210@s.whatsapp.net"
   *   "98765 43210"      → "9876543210@s.whatsapp.net" (no country code — user must handle)
   *   "1234@s.whatsapp.net" → "1234@s.whatsapp.net" (already a JID)
   */
  static normalizeJid(phone: string): string {
    if (!phone) throw new Error('Phone number is required');

    // Already a JID
    if (phone.includes('@')) return phone;

    // Strip all non-digit characters
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 7) throw new Error(`Invalid phone number: "${phone}" — too few digits`);

    return `${digits}@s.whatsapp.net`;
  }

  /**
   * Send a plain text message to a phone number.
   */
  static async sendText(
    socket: WASocket,
    to: string,
    body: string
  ): Promise<SendResult> {
    const jid = this.normalizeJid(to);
    logger.info({ jid, bodyLength: body.length }, '[BULK_MSG] Sending text message...');

    try {
      const result = await socket.sendMessage(jid, { text: body });
      const messageId = result?.key?.id || `msg_${Date.now()}`;

      logger.info({ jid, messageId }, '[BULK_MSG] Text message sent successfully');
      return {
        success: true,
        messageId,
        to: jid,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      logger.error({ jid, err: err.message }, '[BULK_MSG] Failed to send text message');
      return {
        success: false,
        messageId: '',
        to: jid,
        timestamp: new Date().toISOString(),
        error: err.message,
      };
    }
  }

  /**
   * Send an image message (from URL) with optional caption.
   */
  static async sendImage(
    socket: WASocket,
    to: string,
    mediaUrl: string,
    caption?: string
  ): Promise<SendResult> {
    const jid = this.normalizeJid(to);
    logger.info({ jid, mediaUrl, hasCaption: !!caption }, '[BULK_MSG] Sending image message...');

    try {
      const { buffer, mimeType } = await MediaService.prepareMedia(mediaUrl);

      const result = await socket.sendMessage(jid, {
        image: buffer,
        caption: caption || undefined,
        mimetype: mimeType || 'image/jpeg',
      });

      const messageId = result?.key?.id || `msg_${Date.now()}`;
      logger.info({ jid, messageId }, '[BULK_MSG] Image message sent successfully');
      return {
        success: true,
        messageId,
        to: jid,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      logger.error({ jid, err: err.message }, '[BULK_MSG] Failed to send image message');
      return {
        success: false,
        messageId: '',
        to: jid,
        timestamp: new Date().toISOString(),
        error: err.message,
      };
    }
  }

  /**
   * Send a video message (from URL) with optional caption.
   */
  static async sendVideo(
    socket: WASocket,
    to: string,
    mediaUrl: string,
    caption?: string
  ): Promise<SendResult> {
    const jid = this.normalizeJid(to);
    logger.info({ jid, mediaUrl, hasCaption: !!caption }, '[BULK_MSG] Sending video message...');

    try {
      const { buffer, mimeType } = await MediaService.prepareMedia(mediaUrl);

      const result = await socket.sendMessage(jid, {
        video: buffer,
        caption: caption || undefined,
        mimetype: mimeType || 'video/mp4',
      });

      const messageId = result?.key?.id || `msg_${Date.now()}`;
      logger.info({ jid, messageId }, '[BULK_MSG] Video message sent successfully');
      return {
        success: true,
        messageId,
        to: jid,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      logger.error({ jid, err: err.message }, '[BULK_MSG] Failed to send video message');
      return {
        success: false,
        messageId: '',
        to: jid,
        timestamp: new Date().toISOString(),
        error: err.message,
      };
    }
  }

  /**
   * Send a document/file message (from URL) with optional caption and filename.
   */
  static async sendDocument(
    socket: WASocket,
    to: string,
    mediaUrl: string,
    filename?: string,
    caption?: string
  ): Promise<SendResult> {
    const jid = this.normalizeJid(to);
    logger.info({ jid, mediaUrl, filename }, '[BULK_MSG] Sending document message...');

    try {
      const media = await MediaService.prepareMedia(mediaUrl, filename);

      const result = await socket.sendMessage(jid, {
        document: media.buffer,
        mimetype: media.mimeType || 'application/octet-stream',
        fileName: media.filename || filename || 'document',
        caption: caption || undefined,
      });

      const messageId = result?.key?.id || `msg_${Date.now()}`;
      logger.info({ jid, messageId }, '[BULK_MSG] Document message sent successfully');
      return {
        success: true,
        messageId,
        to: jid,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      logger.error({ jid, err: err.message }, '[BULK_MSG] Failed to send document message');
      return {
        success: false,
        messageId: '',
        to: jid,
        timestamp: new Date().toISOString(),
        error: err.message,
      };
    }
  }

  /**
   * Send a poll message.
   */
  static async sendPoll(
    socket: WASocket,
    to: string,
    question: string,
    options: string[],
    selectableCount: number = 1
  ): Promise<SendResult> {
    const jid = this.normalizeJid(to);
    logger.info({ jid, question, optionCount: options.length }, '[BULK_MSG] Sending poll message...');

    try {
      const result = await socket.sendMessage(jid, {
        poll: {
          name: question,
          values: options,
          selectableCount,
        },
      });

      const messageId = result?.key?.id || `msg_${Date.now()}`;
      logger.info({ jid, messageId }, '[BULK_MSG] Poll message sent successfully');
      return {
        success: true,
        messageId,
        to: jid,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      logger.error({ jid, err: err.message }, '[BULK_MSG] Failed to send poll message');
      return {
        success: false,
        messageId: '',
        to: jid,
        timestamp: new Date().toISOString(),
        error: err.message,
      };
    }
  }
}
