import axios from 'axios';
import pino from 'pino';

const logger = pino({ level: 'info' });

export interface PreparedMedia {
  buffer: Buffer;
  mimeType: string;
  isVideo: boolean;
  isDocument: boolean;
  filename?: string;
}

export class MediaService {
  /**
   * Downloads media from a URL and returns a buffer with MIME info.
   * Supports images, videos, and documents.
   */
  static async prepareMedia(url: string, forceFilename?: string): Promise<PreparedMedia> {
    logger.info({ url }, '[BULK_MEDIA] Downloading media from URL...');

    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 60000,
      maxContentLength: 64 * 1024 * 1024, // 64MB max
      headers: {
        'User-Agent': 'UNAI-Bulk-Gateway/1.0',
      },
    });

    const buffer = Buffer.from(response.data);
    const contentType = (String(response.headers['content-type'] || '')).split(';')[0].trim().toLowerCase();

    // Determine media type from Content-Type header or URL extension
    const urlLower = url.toLowerCase();
    let mimeType = contentType || 'application/octet-stream';
    let isVideo = false;
    let isDocument = false;

    // Video detection
    if (
      mimeType.startsWith('video/') ||
      urlLower.endsWith('.mp4') ||
      urlLower.endsWith('.avi') ||
      urlLower.endsWith('.mov') ||
      urlLower.endsWith('.mkv') ||
      urlLower.endsWith('.webm')
    ) {
      isVideo = true;
      if (!mimeType.startsWith('video/')) mimeType = 'video/mp4';
    }

    // Document detection
    if (
      mimeType === 'application/pdf' ||
      mimeType.includes('msword') ||
      mimeType.includes('officedocument') ||
      mimeType.includes('spreadsheet') ||
      mimeType.includes('presentation') ||
      mimeType === 'text/plain' ||
      mimeType === 'text/csv' ||
      urlLower.endsWith('.pdf') ||
      urlLower.endsWith('.doc') ||
      urlLower.endsWith('.docx') ||
      urlLower.endsWith('.xls') ||
      urlLower.endsWith('.xlsx') ||
      urlLower.endsWith('.pptx') ||
      urlLower.endsWith('.txt') ||
      urlLower.endsWith('.csv') ||
      urlLower.endsWith('.zip') ||
      urlLower.endsWith('.rar')
    ) {
      isDocument = true;
    }

    // Extract filename from URL or Content-Disposition
    let filename = forceFilename;
    if (!filename) {
      const disposition = response.headers['content-disposition'];
      if (disposition) {
        const match = disposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
        if (match) filename = match[1].replace(/['"]/g, '');
      }
      if (!filename) {
        const urlPath = new URL(url).pathname;
        const parts = urlPath.split('/');
        filename = parts[parts.length - 1] || 'file';
      }
    }

    logger.info(
      { mimeType, isVideo, isDocument, sizeBytes: buffer.length, filename },
      '[BULK_MEDIA] Media prepared successfully'
    );

    return { buffer, mimeType, isVideo, isDocument, filename };
  }
}
