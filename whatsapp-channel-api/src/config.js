require('dotenv').config();

const config = {
  // Support dynamic PORT provided by cloud hosts like Render/Railway
  port: parseInt(process.env.PORT || process.env.WCA_PORT || '3001', 10),
  apiKey: process.env.WCA_API_KEY || '105eadef-beae-4e08-bcc0-85a06ff80727',
  channelLink: process.env.WCA_CHANNEL_LINK || 'https://whatsapp.com/channel/0029VbDxqHz6hENhNBcZM31M',
  sessionDir: process.env.WCA_SESSION_DIR || './sessions',
  maxRequestsPerMinute: parseInt(process.env.WCA_MAX_REQUESTS_PER_MINUTE || '30', 10),
  duplicateWindowSec: parseInt(process.env.WCA_DUPLICATE_WINDOW_SEC || '300', 10),
  logLevel: process.env.WCA_LOG_LEVEL || 'info',
};

module.exports = config;
