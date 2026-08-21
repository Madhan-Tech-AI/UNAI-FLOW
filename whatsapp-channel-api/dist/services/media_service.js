"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MediaService = void 0;
const axios_1 = __importDefault(require("axios"));
const mime_types_1 = __importDefault(require("mime-types"));
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
class MediaService {
    /**
     * Downloads media from a public URL or data URI and returns a Buffer with MIME type.
     */
    static async prepareMedia(mediaUrl) {
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
        const response = await axios_1.default.get(mediaUrl, {
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
            mimeType = String(mime_types_1.default.lookup(ext) || 'image/jpeg');
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
exports.MediaService = MediaService;
