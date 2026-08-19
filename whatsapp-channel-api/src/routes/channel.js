const express = require('express');
const publisher = require('../whatsapp/channelPublisher');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /api/channel/publish
 * Unified publish endpoint — auto-detects content type.
 * Body: { text?, caption?, mediaUrl?, channelId? }
 */
router.post('/publish', async (req, res) => {
  try {
    const { text, caption, mediaUrl, channelId } = req.body;

    if (!text && !caption && !mediaUrl) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_CONTENT', message: 'Provide at least "text", "caption", or "mediaUrl".' }
      });
    }

    let result;

    if (mediaUrl) {
      const isVideo = /\.(mp4|mov|avi|webm)($|\?)/i.test(mediaUrl) || (mediaUrl.startsWith('data:video'));
      if (isVideo) {
        result = await publisher.publishVideo(mediaUrl, caption || text || '', channelId);
      } else {
        result = await publisher.publishImage(mediaUrl, caption || text || '', channelId);
      }
    } else {
      result = await publisher.publishText(text || caption, channelId);
    }

    logger.info('Route', `Published to channel: ${result.messageId}`);
    return res.json(result);
  } catch (err) {
    logger.error('Route', `Publish failed: ${err.message || err}`);
    return res.status(err.code === 'NOT_CONNECTED' ? 503 : 500).json({
      success: false,
      error: { code: err.code || 'PUBLISH_ERROR', message: err.message || 'Unknown error' }
    });
  }
});

/**
 * POST /api/channel/text
 * Body: { text, channelId? }
 */
router.post('/text', async (req, res) => {
  try {
    const { text, channelId } = req.body;
    if (!text) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_TEXT', message: '"text" field is required.' }
      });
    }

    const result = await publisher.publishText(text, channelId);
    return res.json(result);
  } catch (err) {
    return res.status(err.code === 'NOT_CONNECTED' ? 503 : 500).json({
      success: false,
      error: { code: err.code || 'PUBLISH_ERROR', message: err.message || 'Unknown error' }
    });
  }
});

/**
 * POST /api/channel/image
 * Body: { mediaUrl, caption?, channelId? }
 */
router.post('/image', async (req, res) => {
  try {
    const { mediaUrl, caption, channelId } = req.body;
    if (!mediaUrl) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_MEDIA', message: '"mediaUrl" field is required.' }
      });
    }

    const result = await publisher.publishImage(mediaUrl, caption || '', channelId);
    return res.json(result);
  } catch (err) {
    return res.status(err.code === 'NOT_CONNECTED' ? 503 : 500).json({
      success: false,
      error: { code: err.code || 'PUBLISH_ERROR', message: err.message || 'Unknown error' }
    });
  }
});

/**
 * POST /api/channel/video
 * Body: { mediaUrl, caption?, channelId? }
 */
router.post('/video', async (req, res) => {
  try {
    const { mediaUrl, caption, channelId } = req.body;
    if (!mediaUrl) {
      return res.status(400).json({
        success: false,
        error: { code: 'MISSING_MEDIA', message: '"mediaUrl" field is required.' }
      });
    }

    const result = await publisher.publishVideo(mediaUrl, caption || '', channelId);
    return res.json(result);
  } catch (err) {
    return res.status(err.code === 'NOT_CONNECTED' ? 503 : 500).json({
      success: false,
      error: { code: err.code || 'PUBLISH_ERROR', message: err.message || 'Unknown error' }
    });
  }
});

/**
 * GET /api/channel/list
 * List all channels the connected account admins.
 */
router.get('/list', async (req, res) => {
  try {
    const channels = await publisher.listChannels();
    return res.json({ success: true, channels });
  } catch (err) {
    return res.status(err.code === 'NOT_CONNECTED' ? 503 : 500).json({
      success: false,
      error: { code: err.code || 'LIST_ERROR', message: err.message || 'Unknown error' }
    });
  }
});

module.exports = router;
