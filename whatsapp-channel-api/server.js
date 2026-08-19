const express = require('express');
const helmet = require('helmet');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const apiKeyAuth = require('./src/middleware/apiKeyAuth');
const rateLimiter = require('./src/middleware/rateLimiter');
const duplicateGuard = require('./src/middleware/duplicateGuard');
const channelRoutes = require('./src/routes/channel');
const statusRoutes = require('./src/routes/status');
const connection = require('./src/whatsapp/connection');
const { renderDashboardHtml } = require('./src/views/dashboard');

const app = express();

// ── Core Middleware ──
// Configure helmet to allow cross-origin embedding of QR and live web dashboard
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, X-API-Key, Authorization');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ── Public Routes (no API key needed) ──
app.use('/api', statusRoutes);

// ── Protected Routes (API key + rate limit + dedup) ──
app.use('/api/channel', apiKeyAuth, rateLimiter, duplicateGuard, channelRoutes);

// ── Live Web Dashboard (Root) ──
app.get('/', (req, res) => {
  if (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers.accept.includes('text/html')) {
    return res.json({
      service: 'UNAI Flow — WhatsApp Channel API',
      version: '1.0.0',
      status: connection.getStatus(),
      endpoints: {
        health: 'GET /api/status',
        qr: 'GET /api/qr',
        publish: 'POST /api/channel/publish',
        text: 'POST /api/channel/text',
        image: 'POST /api/channel/image',
        video: 'POST /api/channel/video',
        list: 'GET /api/channel/list',
      },
    });
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(renderDashboardHtml());
});

app.get('/qr', (req, res) => {
  res.redirect('/#qrCard');
});

// ── 404 ──
app.use((req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found.` } });
});

// ── Global Error Handler ──
app.use((err, req, res, _next) => {
  logger.error('Server', `Unhandled error: ${err.message}`);
  res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
});

// ── Start Server & WhatsApp Connection ──
async function start() {
  logger.info('Server', `Starting WhatsApp Channel API on port ${config.port}...`);
  logger.info('Server', `API Key: ${config.apiKey.slice(0, 8)}...${config.apiKey.slice(-4)}`);

  // Start Express on all interfaces (0.0.0.0) so it's accessible locally and in cloud containers
  app.listen(config.port, '0.0.0.0', () => {
    logger.info('Server', `✅ Server running at http://0.0.0.0:${config.port}`);
    logger.info('Server', `   Web Dashboard: http://localhost:${config.port}/`);
    logger.info('Server', `   Health Check:  http://localhost:${config.port}/api/status`);
    logger.info('Server', `   QR API:        http://localhost:${config.port}/api/qr`);
  });

  // Start WhatsApp connection
  await connection.initialize();
}

start().catch((err) => {
  logger.error('Server', `Fatal startup error: ${err.message}`);
  process.exit(1);
});
