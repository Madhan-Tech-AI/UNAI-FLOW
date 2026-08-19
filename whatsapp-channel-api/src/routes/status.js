const express = require('express');
const qrcode = require('qrcode');
const connection = require('../whatsapp/connection');

const router = express.Router();

/**
 * GET /api/status
 * Returns WhatsApp connection health and session status.
 * No API key required — public health check.
 */
router.get('/status', (req, res) => {
  const status = connection.getStatus();
  const httpStatus = status.isReady ? 200 : 503;
  res.status(httpStatus).json({
    success: status.isReady,
    whatsapp: status,
    service: 'whatsapp-channel-api',
    uptime: process.uptime(),
  });
});

/**
 * GET /api/qr
 * Returns the current QR code as a PNG image for scanning.
 * No API key required — needed for initial setup.
 */
router.get('/qr', async (req, res) => {
  const { currentQR, connectionState } = connection;

  if (connectionState === 'connected') {
    return res.json({
      success: true,
      message: 'Already connected! No QR code needed.',
      state: connectionState,
    });
  }

  if (!currentQR) {
    return res.status(404).json({
      success: false,
      message: 'No QR code available yet. The client may still be initializing. Wait a few seconds and refresh.',
      state: connectionState,
    });
  }

  // Return QR as PNG image
  if (req.query.format === 'json') {
    return res.json({
      success: true,
      qr: currentQR,
      state: connectionState,
      instruction: 'Scan this QR code with WhatsApp > Linked Devices > Link a Device',
    });
  }

  // Default: return as image
  try {
    const qrImage = await qrcode.toBuffer(currentQR, { type: 'png', width: 300, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-cache, no-store');
    return res.send(qrImage);
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to generate QR image.',
    });
  }
});

module.exports = router;
