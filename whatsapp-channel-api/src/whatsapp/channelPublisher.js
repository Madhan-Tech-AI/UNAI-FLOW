const { MessageMedia } = require('whatsapp-web.js');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const path = require('path');
const mime = require('mime-types');
const connection = require('./connection');
const logger = require('../utils/logger');

/**
 * WhatsApp Channel Publisher.
 * Publishes text, images, and videos to a WhatsApp Channel (newsletter).
 */
class ChannelPublisher {
  /**
   * Resolve the Channel's internal @newsletter JID.
   * whatsapp-web.js uses chatId format: <id>@newsletter
   */
  async resolveChannelId() {
    const client = connection.getClient();
    if (!client || !connection.isReady) {
      throw { code: 'NOT_CONNECTED', message: 'WhatsApp is not connected. Scan QR code at /api/qr' };
    }

    try {
      // Get all chats and filter for newsletters the user owns/admins
      const chats = await client.getChats();
      const channels = chats.filter(c => c.id && c.id.server === 'newsletter');

      if (channels.length === 0) {
        throw {
          code: 'NO_CHANNELS',
          message: 'No WhatsApp Channels found. Make sure your connected WhatsApp account is an admin/owner of at least one Channel.'
        };
      }

      logger.info('Channel', `Found ${channels.length} channel(s):`);
      channels.forEach((ch, i) => {
        logger.info('Channel', `  ${i + 1}. ${ch.name || 'Unnamed'} — ${ch.id._serialized}`);
      });

      // Return the first channel (or match by name/link if needed later)
      return channels[0];
    } catch (err) {
      if (err.code) throw err;
      throw { code: 'CHANNEL_LOOKUP_FAILED', message: `Failed to lookup channels: ${err.message}` };
    }
  }

  /**
   * List all channels the connected account admins/owns.
   */
  async listChannels() {
    const client = connection.getClient();
    if (!client || !connection.isReady) {
      throw { code: 'NOT_CONNECTED', message: 'WhatsApp is not connected.' };
    }

    const chats = await client.getChats();
    return chats
      .filter(c => c.id && c.id.server === 'newsletter')
      .map(c => ({
        id: c.id._serialized,
        name: c.name || 'Unnamed Channel',
      }));
  }

  /**
   * Publish a text message to the Channel.
   */
  async publishText(text, channelId = null) {
    const channel = channelId
      ? await this._getChatById(channelId)
      : await this.resolveChannelId();

    const chatId = channel.id ? channel.id._serialized : channel;
    const client = connection.getClient();

    logger.info('Publisher', `Publishing text to channel ${chatId}`);

    try {
      const msg = await client.sendMessage(chatId, text);
      return {
        success: true,
        platform: 'whatsapp_channel',
        messageId: msg.id ? msg.id._serialized : msg.id,
        channelId: chatId,
        channelName: channel.name || null,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      logger.error('Publisher', `Text publish failed: ${err.message}`);
      throw { code: 'PUBLISH_FAILED', message: `Failed to publish text: ${err.message}` };
    }
  }

  /**
   * Publish an image with caption to the Channel.
   */
  async publishImage(imageUrl, caption = '', channelId = null) {
    const channel = channelId
      ? await this._getChatById(channelId)
      : await this.resolveChannelId();

    const chatId = channel.id ? channel.id._serialized : channel;
    const client = connection.getClient();

    logger.info('Publisher', `Publishing image to channel ${chatId}`);

    try {
      const media = await this._downloadMedia(imageUrl);
      const msg = await client.sendMessage(chatId, media, { caption });
      return {
        success: true,
        platform: 'whatsapp_channel',
        messageId: msg.id ? msg.id._serialized : msg.id,
        channelId: chatId,
        channelName: channel.name || null,
        type: 'image',
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      if (err.code) throw err;
      logger.error('Publisher', `Image publish failed: ${err.message}`);
      throw { code: 'PUBLISH_FAILED', message: `Failed to publish image: ${err.message}` };
    }
  }

  /**
   * Publish a video with caption to the Channel.
   */
  async publishVideo(videoUrl, caption = '', channelId = null) {
    const channel = channelId
      ? await this._getChatById(channelId)
      : await this.resolveChannelId();

    const chatId = channel.id ? channel.id._serialized : channel;
    const client = connection.getClient();

    logger.info('Publisher', `Publishing video to channel ${chatId}`);

    try {
      const media = await this._downloadMedia(videoUrl);
      const msg = await client.sendMessage(chatId, media, { caption, sendVideoAsGif: false });
      return {
        success: true,
        platform: 'whatsapp_channel',
        messageId: msg.id ? msg.id._serialized : msg.id,
        channelId: chatId,
        channelName: channel.name || null,
        type: 'video',
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      if (err.code) throw err;
      logger.error('Publisher', `Video publish failed: ${err.message}`);
      throw { code: 'PUBLISH_FAILED', message: `Failed to publish video: ${err.message}` };
    }
  }

  /**
   * Download media from URL and create MessageMedia object.
   */
  async _downloadMedia(url) {
    // If it's a base64 data URI, parse directly
    if (url.startsWith('data:')) {
      try {
        const [header, data] = url.split(',');
        const mimeType = header.match(/data:(.*?);/)[1];
        return new MessageMedia(mimeType, data);
      } catch (err) {
        throw { code: 'MEDIA_PARSE_FAILED', message: `Failed to parse data URI: ${err.message}` };
      }
    }

    // Download from HTTP/HTTPS URL
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      transport.get(url, { timeout: 30000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          // Follow redirect
          return this._downloadMedia(res.headers.location).then(resolve).catch(reject);
        }

        if (res.statusCode !== 200) {
          return reject({ code: 'MEDIA_DOWNLOAD_FAILED', message: `HTTP ${res.statusCode} downloading media` });
        }

        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(chunks);
          const contentType = res.headers['content-type'] || mime.lookup(parsedUrl.pathname) || 'application/octet-stream';
          const mimeType = contentType.split(';')[0].trim();
          const base64 = buffer.toString('base64');
          resolve(new MessageMedia(mimeType, base64));
        });
        res.on('error', (err) => reject({ code: 'MEDIA_DOWNLOAD_FAILED', message: err.message }));
      }).on('error', (err) => reject({ code: 'MEDIA_DOWNLOAD_FAILED', message: err.message }));
    });
  }

  /**
   * Get chat by serialized ID.
   */
  async _getChatById(chatId) {
    const client = connection.getClient();
    if (!client || !connection.isReady) {
      throw { code: 'NOT_CONNECTED', message: 'WhatsApp is not connected.' };
    }
    try {
      return await client.getChatById(chatId);
    } catch (err) {
      throw { code: 'CHANNEL_NOT_FOUND', message: `Channel not found: ${chatId}` };
    }
  }
}

module.exports = new ChannelPublisher();
