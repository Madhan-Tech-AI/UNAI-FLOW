import { supabase } from './supabaseClient';

export function getApiBaseUrl(): string {
  const envUrl = (import.meta as any).env?.VITE_API_URL;
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
    if (!isLocalhost) {
      // In remote production (e.g. Vercel), if envUrl is missing or points to localhost, always fallback to deployed Render backend
      if (!envUrl || envUrl.includes('localhost') || envUrl.includes('127.0.0.1')) {
        return 'https://unai-flow-backend.onrender.com';
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

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail?.message || errorData.detail || errorData.error || `Request failed with status ${response.status}`);
  }

  return response.json();
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

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response;
}
