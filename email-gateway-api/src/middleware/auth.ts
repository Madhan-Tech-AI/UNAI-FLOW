import { Request, Response, NextFunction } from 'express';

export function authenticateApiKey(req: Request, res: Response, next: NextFunction) {
  const configuredKey = process.env.EMAIL_GATEWAY_API_KEY;

  // If no key is configured in env, allow for local dev or warn
  if (!configuredKey) {
    return next();
  }

  const apiKeyHeader = req.headers['x-api-key'] || req.headers['x-gateway-key'];
  const authHeader = req.headers['authorization'];

  let providedKey = '';
  if (apiKeyHeader) {
    providedKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  } else if (authHeader && authHeader.startsWith('Bearer ')) {
    providedKey = authHeader.slice(7).trim();
  }

  if (!providedKey || providedKey !== configuredKey) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing X-API-Key header',
    });
  }

  next();
}
