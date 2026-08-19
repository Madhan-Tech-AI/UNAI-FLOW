const config = require('../config');
const logger = require('../utils/logger');

/**
 * Middleware: validates X-API-Key header against configured WCA_API_KEY.
 */
function apiKeyAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];

  if (!apiKey) {
    logger.warn('Auth', `Missing API key from ${req.ip}`);
    return res.status(401).json({
      success: false,
      error: { code: 'MISSING_API_KEY', message: 'X-API-Key header is required.' }
    });
  }

  if (apiKey !== config.apiKey) {
    logger.warn('Auth', `Invalid API key attempt from ${req.ip}`);
    return res.status(401).json({
      success: false,
      error: { code: 'INVALID_API_KEY', message: 'Invalid API key.' }
    });
  }

  next();
}

module.exports = apiKeyAuth;
