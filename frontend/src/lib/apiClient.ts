import { supabase } from './supabaseClient';

export function getApiBaseUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
    if (!isLocalhost) {
      // In remote production (e.g. Vercel), if envUrl is missing or points to localhost, always fallback to deployed Render backend
      if (!envUrl || envUrl.includes('localhost') || envUrl.includes('127.0.0.1')) {
        return 'https://unai-flow-backend-w4al.onrender.com';
      }
      return envUrl.replace(/\/+$/, '');
    }
  }
  return (envUrl || 'http://localhost:8000').replace(/\/+$/, '');
}

export const API_BASE_URL = getApiBaseUrl();

interface ExtendedRequestInit extends RequestInit {
  _isRetry?: boolean;
}

export async function fetchApi(endpoint: string, options: ExtendedRequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  const baseUrl = getApiBaseUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${baseUrl}${cleanEndpoint}`;
  const method = (options.method || 'GET').toUpperCase();

  const startTime = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for AI generation & Render cold starts

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: options.signal || controller.signal,
    });
    clearTimeout(timeoutId);

    const durationMs = Date.now() - startTime;
    if (endpoint.includes('whatsapp') || endpoint.includes('channels') || endpoint.includes('applications')) {
      console.log(`%c[UNAI-FLOW] HTTP_${method}`, response.ok ? 'color:#16a34a' : 'color:#ef4444', {
        endpoint: cleanEndpoint,
        status: response.status,
        durationMs: `${durationMs}ms`,
        ok: response.ok,
      });
    }

    // Auto-retry transient 503 Service Unavailable for idempotent GET requests once
    if (response.status === 503 && method === 'GET' && !options._isRetry) {
      console.warn(`[UNAI-FLOW] 503 received for ${cleanEndpoint} (${durationMs}ms). Retrying in 750ms...`);
      await new Promise((r) => setTimeout(r, 750));
      return fetchApi(endpoint, { ...options, _isRetry: true });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      let errorMessage = '';

      // 1. Extract backend message if provided
      if (errorData?.error && typeof errorData.error === 'object' && errorData.error.message) {
        errorMessage = errorData.error.message;
      } else if (typeof errorData?.error === 'string') {
        errorMessage = errorData.error;
      } else if (errorData?.detail && typeof errorData.detail === 'object' && errorData.detail.message) {
        errorMessage = errorData.detail.message;
      } else if (typeof errorData?.detail === 'string') {
        errorMessage = errorData.detail;
      } else if (Array.isArray(errorData?.detail)) {
        errorMessage = errorData.detail.map((d: any) => d.msg || JSON.stringify(d)).join('; ');
      } else if (errorData?.message) {
        errorMessage = errorData.message;
      }

      // 2. Clear semantic fallback for standard HTTP error statuses
      if (!errorMessage) {
        switch (response.status) {
          case 401:
            errorMessage = 'Session expired or invalid. Please sign in again.';
            break;
          case 403:
            errorMessage = 'Permission denied. You do not have access to this resource.';
            break;
          case 404:
            errorMessage = 'The requested resource was not found.';
            break;
          case 422:
            errorMessage = 'Invalid request data. Please check your inputs.';
            break;
          case 429:
            errorMessage = 'Too many requests. Please slow down and try again shortly.';
            break;
          case 500:
            errorMessage = 'Internal server error. Please try again or contact support.';
            break;
          case 503:
            errorMessage = 'UNAI FLOW service is temporarily unavailable (503). Please retry in a few moments.';
            break;
          default:
            errorMessage = `Request failed with status ${response.status}`;
        }
      }

      const reqId = errorData?.error?.request_id || response.headers.get('x-request-id');
      if (reqId && !errorMessage.includes(reqId)) {
        errorMessage += ` [Request ID: ${reqId}]`;
      }

      const customError = new Error(errorMessage) as any;
      customError.status = response.status;
      customError.requestId = reqId;
      customError.data = errorData;
      throw customError;
    }

    return response.json();
  } catch (err: any) {
    clearTimeout(timeoutId);
    const durationMs = Date.now() - startTime;
    const isTimeout = err.name === 'AbortError';

    // Auto-retry transient network/fetch failure on idempotent GET requests once
    if (method === 'GET' && !options._isRetry && (err.message === 'Failed to fetch' || isTimeout)) {
      console.warn(`[UNAI-FLOW] Transient fetch error on ${cleanEndpoint}. Retrying in 750ms...`);
      await new Promise((r) => setTimeout(r, 750));
      return fetchApi(endpoint, { ...options, _isRetry: true });
    }

    let message = isTimeout ? `Request timed out after 60s (${cleanEndpoint})` : err.message;
    if (err.message === 'Failed to fetch') {
      message = `Cannot connect to UNAI FLOW backend (${cleanEndpoint}). Please verify the backend service is reachable.`;
    }

    if (endpoint.includes('whatsapp') || endpoint.includes('channels') || endpoint.includes('applications')) {
      console.error(`[UNAI-FLOW] HTTP_FAIL ${method} ${cleanEndpoint} (${durationMs}ms):`, message);
    }
    const enhancedError = new Error(message) as any;
    enhancedError.status = err.status;
    enhancedError.requestId = err.requestId;
    throw enhancedError;
  }
}

/**
 * Same as fetchApi but returns the raw Response object.
 * Use for binary endpoints (images, blobs) that don't return JSON.
 */
export async function fetchApiRaw(endpoint: string, options: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession();
  
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> || {}),
  };

  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }

  const baseUrl = getApiBaseUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${baseUrl}${cleanEndpoint}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(url, {
      ...options,
      headers,
      signal: options.signal || controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    return response;
  } catch (err: any) {
    clearTimeout(timeoutId);
    throw err;
  }
}
