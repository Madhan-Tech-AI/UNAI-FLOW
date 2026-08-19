const rateLimit = require('express-rate-limit');
const config = require('../config');

/**
 * Rate limiter: max N requests per minute per IP.
 */
const rateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: config.maxRequestsPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: `Too many requests. Max ${config.maxRequestsPerMinute} per minute.`
    }
  }
});

module.exports = rateLimiter;
