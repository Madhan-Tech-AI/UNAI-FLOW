import axios from 'axios';
import mime from 'mime-types';
import pino from 'pino';

const logger = pino({ level: 'info' });

export class MediaService {
  /**
   * Downloads media from a public URL or data URI and returns a Buffer with MIME type.
   */
  public static async prepareMedia(mediaUrl: string): Promise<{ buffer: Buffer; mimeType: string; isVideo: boolean }> {
    if (!mediaUrl) {
      throw new Error('Media URL is required');
    }

    if (mediaUrl.startsWith('data:')) {
      const parts = mediaUrl.split(',');
      const header = parts[0];
      const data = parts[1];
      const mimeMatch = header.match(/data:([^;]+);/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const buffer = Buffer.from(data, 'base64');
      const isVideo = mimeType.startsWith('video/');

      return { buffer, mimeType, isVideo };
    }

    // Download from HTTP URL (Supabase storage or CDN)
    logger.info({ url: mediaUrl.substring(0, 80) }, 'Downloading media for broadcast...');
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      timeout: 30000,
      headers: {
        'User-Agent': 'UNAI-Flow-WhatsApp-Gateway/2.0',
      },
    });

    const buffer = Buffer.from(response.data);
    let mimeType = String(response.headers['content-type'] || '');

    if (!mimeType || mimeType === 'application/octet-stream') {
      const ext = mediaUrl.split('?')[0].split('.').pop() || 'jpg';
      mimeType = String(mime.lookup(ext) || 'image/jpeg');
    }

    const isVideo = mimeType.startsWith('video/') || mediaUrl.toLowerCase().includes('.mp4') || mediaUrl.toLowerCase().includes('.mov');

    // Max size validation (WhatsApp allows up to 16MB for video/audio, 5MB for standard images)
    const MAX_SIZE_BYTES = 16 * 1024 * 1024;
    if (buffer.length > MAX_SIZE_BYTES) {
      throw new Error(`Media size (${(buffer.length / (1024 * 1024)).toFixed(1)}MB) exceeds WhatsApp 16MB limit.`);
    }

    return { buffer, mimeType, isVideo };
  }
}
