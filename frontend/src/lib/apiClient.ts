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

export async function fetchApi(endpoint: string, options: RequestInit = {}) {
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
  const method = options.method || 'GET';

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
    if (endpoint.includes('whatsapp') || endpoint.includes('channels')) {
      console.log(`%c[UNAI-WA] HTTP_${method}`, response.ok ? 'color:#16a34a' : 'color:#ef4444', {
        endpoint: cleanEndpoint,
        status: response.status,
        durationMs: `${durationMs}ms`,
        ok: response.ok,
      });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      let errorMessage = `Request failed with status ${response.status}`;

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
    let message = isTimeout ? `Request timed out after 60s (${cleanEndpoint})` : err.message;
    if (err.message === 'Failed to fetch') {
      message = `Network or CORS error connecting to backend (${cleanEndpoint}). Please verify the backend service is reachable.`;
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
