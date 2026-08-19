const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * In-memory duplicate post guard.
 * Rejects posts with identical content+media within a configurable time window.
 */
const recentHashes = new Map(); // hash -> timestamp

// Cleanup expired entries every 60 seconds
setInterval(() => {
  const now = Date.now();
  const windowMs = config.duplicateWindowSec * 1000;
  for (const [hash, ts] of recentHashes) {
    if (now - ts > windowMs) {
      recentHashes.delete(hash);
    }
  }
}, 60_000);

function duplicateGuard(req, res, next) {
  const { text, caption, mediaUrl, channelId } = req.body || {};
  const content = text || caption || '';
  const fingerprint = `${channelId || 'default'}|${content}|${mediaUrl || ''}`;
  const hash = crypto.createHash('sha256').update(fingerprint).digest('hex');

  const windowMs = config.duplicateWindowSec * 1000;
  const existing = recentHashes.get(hash);

  if (existing && (Date.now() - existing) < windowMs) {
    logger.warn('DuplicateGuard', `Duplicate post blocked (hash: ${hash.slice(0, 12)}...)`);
    return res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_POST',
        message: `This exact content was already published within the last ${config.duplicateWindowSec} seconds.`
      }
    });
  }

  // Store hash for dedup window
  recentHashes.set(hash, Date.now());
  next();
}

module.exports = duplicateGuard;
