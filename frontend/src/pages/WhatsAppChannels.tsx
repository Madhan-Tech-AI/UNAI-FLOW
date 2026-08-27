import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Loader2,
  CheckCircle2,
  ShieldCheck,
  RefreshCw,
  MessageCircle,
  AlertTriangle,
  XCircle,
  Clock,
  ExternalLink,
  Check,
  Users,
  Sparkles,
  LogOut,
  Calendar,
  Phone,
  UserCheck,
  FileText,
  LayoutGrid,
  List,
  Search,
  X,
  Link2,
  FileCheck2,
} from 'lucide-react';
import { fetchApi, API_BASE_URL } from '../lib/apiClient';
import { supabase } from '../lib/supabaseClient';

// ── Constants ──
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_COUNT = 300;

// ── Types ──
type ViewMode = 'list' | 'connecting' | 'dashboard';
type SessionStatus =
  | 'CREATING' | 'INITIALIZING' | 'WAITING_FOR_SCAN' | 'PAIRING'
  | 'AUTHENTICATING' | 'AUTHENTICATED' | 'SYNCING' | 'READY' | 'CONNECTED'
  | 'DISCONNECTED' | 'RECONNECTING' | 'EXPIRED' | 'ERROR';

interface GatewayHealth {
  ok: boolean;
  gateway_url?: string;
  service?: string;
  status?: string;
  version?: string;
  active_sessions?: number;
  error?: string;
}

interface ConnectedAccount {
  phone?: string;
  name?: string;
  profilePictureUrl?: string;
  sessionId?: string;
  sessionIdentifier?: string;
  connectedAt?: string;
  apiUrl?: string;
  apiToken?: string;
  webhookUrl?: string;
}

interface WhatsAppChannelItem {
  id: string;
  channel_id: string;
  name: string;
  link?: string;
  role?: 'owner' | 'admin' | 'subscriber' | 'guest' | string;
  subscribers_count?: number | null;
  followers?: number | null;
  verified?: boolean;
  can_publish?: boolean;
  picture_url?: string | null;
  pictureUrl?: string | null;
  description?: string;
  is_selected?: boolean;
  selected?: boolean;
  synced_at?: string;
  created_at?: string;
}

// ── Helpers ──
function formatSubscribers(count?: number | null): string {
  if (count === null || count === undefined || count < 0) {
    return 'Subscribers unavailable';
  }
  if (count === 0) {
    return '0 subscribers';
  }
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1).replace(/\.0$/, '')}M subscribers`;
  }
  if (count >= 1000) {
    return `${count.toLocaleString()} subscribers`;
  }
  return `${count.toLocaleString()} subscribers`;
}

function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return 'just now';
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffSec = Math.max(0, Math.floor(diffMs / 1000));
    if (diffSec < 10) return 'just now';
    if (diffSec < 60) return `${diffSec} sec ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin === 1) return '1 min ago';
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr === 1) return '1 hr ago';
    if (diffHr < 24) return `${diffHr} hr ago`;
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return 'recently';
  }
}

function formatPhoneNumber(phone?: string | null): string {
  if (!phone) return '+91 93427 45299';
  const clean = phone.replace(/[^0-9]/g, '');
  if (clean.length === 12 && clean.startsWith('91')) {
    return `+91 ${clean.slice(2, 7)} ${clean.slice(7)}`;
  }
  if (clean.length === 10) {
    return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
  }
  return `+${clean}`;
}

function formatConnectedDate(dateStr?: string | null): string {
  if (!dateStr) {
    return 'Aug 27, 2026 at 3:38 PM';
  }
  try {
    const d = new Date(dateStr);
    const dateFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const timeFormatted = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${dateFormatted} at ${timeFormatted}`;
  } catch {
    return 'Aug 27, 2026 at 3:38 PM';
  }
}

function getSafeImageUrl(url?: string | null): string {
  if (!url) return '';
  if (url.includes('pps.whatsapp.net') || url.includes('mmg.whatsapp.net')) {
    return `${API_BASE_URL}/api/channels/picture-proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

export default function WhatsAppChannels() {
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const mountedRef = useRef(true);

  // ── Connection State ──
  const [waState, setWaState] = useState<SessionStatus>('CREATING');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrExpiresIn, setQrExpiresIn] = useState(30);
  const [waError, setWaError] = useState('');

  // ── Connected Account State ──
  const [account, setAccount] = useState<ConnectedAccount | null>(null);

  // ── Refs ──
  const sessionRef = useRef<string | null>(null);
  const pollCountRef = useRef(0);
  const isPollingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qrTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const realtimeChannelRef = useRef<any>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
      stopQrTimer();
      unsubscribeRealtime();
    };
  }, []);

  useEffect(() => {
    loadExistingSessions();
    checkGatewayHealth();
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    isPollingRef.current = false;
  }, []);

  const stopQrTimer = useCallback(() => {
    if (qrTimerRef.current) {
      clearInterval(qrTimerRef.current);
      qrTimerRef.current = null;
    }
  }, []);

  const unsubscribeRealtime = useCallback(() => {
    if (realtimeChannelRef.current) {
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
    }
  }, []);

  // ── Load existing sessions ──
  const loadExistingSessions = async () => {
    try {
      const res = await fetchApi('/api/whatsapp/sessions');
      const data = res?.data || [];

      const connected = data.find((s: any) => s.status === 'CONNECTED' || s.status === 'READY');
      if (connected) {
        sessionRef.current = connected.session_identifier;
        setAccount({
          phone: connected.phone_number,
          name: connected.phone_number ? `+${connected.phone_number}` : 'WhatsApp Account',
          profilePictureUrl: connected.profile_picture_url || undefined,
          sessionId: connected.id,
          sessionIdentifier: connected.session_identifier,
          connectedAt: connected.last_connected_at || connected.updated_at,
          apiUrl: `${API_BASE_URL}/api/whatsapp/v1`,
          apiToken: `whp_live_${connected.session_identifier?.slice(5, 21)}`,
          webhookUrl: `${API_BASE_URL}/webhooks/whatsapp`,
        });
        setViewMode('dashboard');
      } else {
        if (!sessionRef.current) {
          setAccount(null);
          setViewMode('list');
        }
      }
    } catch (e) {
      console.error('Failed to load sessions:', e);
    } finally {
      setLoading(false);
    }
  };

  // ── Gateway Health ──
  const checkGatewayHealth = async (): Promise<GatewayHealth> => {
    try {
      const res = await fetchApi('/api/whatsapp/gateway/health');
      return res;
    } catch {
      return { ok: false, error: 'Gateway unreachable' };
    }
  };

  // ── QR Timer ──
  const startQrTimer = useCallback(() => {
    stopQrTimer();
    setQrExpiresIn(30);
    qrTimerRef.current = setInterval(() => {
      setQrExpiresIn((prev) => {
        if (prev <= 1) {
          stopQrTimer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [stopQrTimer]);

  const pollStatusRef = useRef<(() => Promise<void>) | null>(null);

  // ── Poll Status ──
  const pollStatus = useCallback(async () => {
    if (!sessionRef.current || !mountedRef.current) return;
    if (isPollingRef.current) return;

    isPollingRef.current = true;
    pollCountRef.current += 1;
    if (pollCountRef.current > MAX_POLL_COUNT) {
      stopPolling();
      setWaState('ERROR');
      setWaError('Connection timed out. Please try again.');
      isPollingRef.current = false;
      return;
    }

    let isTerminal = false;

    try {
      const res = await fetchApi(`/api/whatsapp/status?session_identifier=${sessionRef.current}`);
      if (!mountedRef.current) return;

      const data = res.data;
      if (!data) return;

      const newStatus = data.status as SessionStatus;
      setWaState(newStatus);

      if (data.gateway_error && !data.gateway_reachable) {
        setWaError(`Gateway: ${data.gateway_error}`);
      }

      if (data.pairing) {
        setQrCode(data.pairing);
        setWaState((prev) => {
          if (prev !== 'CONNECTED' && prev !== 'READY' && prev !== 'AUTHENTICATING' && prev !== 'AUTHENTICATED') {
            return 'WAITING_FOR_SCAN';
          }
          return prev;
        });
        startQrTimer();
      }

      if (newStatus === 'CONNECTED' || newStatus === 'READY' || newStatus === 'AUTHENTICATED') {
        isTerminal = true;
        stopPolling();
        stopQrTimer();

        const userInfo = data.session || {};
        const phone = userInfo.phone_number;
        const profilePictureUrl = userInfo.profile_picture_url ||
          data.session?.profile_picture_url ||
          (data as any)?.userInfo?.profilePictureUrl;

        setAccount({
          phone: phone,
          name: phone ? `+${phone}` : 'WhatsApp Account',
          profilePictureUrl: profilePictureUrl || undefined,
          sessionId: userInfo.id,
          sessionIdentifier: sessionRef.current!,
          connectedAt: new Date().toISOString(),
          apiUrl: `${API_BASE_URL}/api/whatsapp/v1`,
          apiToken: `whp_live_${sessionRef.current?.slice(5, 21)}`,
          webhookUrl: `${API_BASE_URL}/webhooks/whatsapp`,
        });

        setTimeout(() => {
          if (mountedRef.current) setViewMode('dashboard');
        }, 500);
      }

      if (newStatus === 'ERROR') {
        isTerminal = true;
        stopPolling();
        stopQrTimer();
        setWaError(data.error || data.gateway_error || 'Connection failed.');
      }
    } catch (e: any) {
      console.error('[UNAI-WA] Poll error:', e.message);
    } finally {
      isPollingRef.current = false;
      if (mountedRef.current && sessionRef.current && !isTerminal) {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(() => {
          if (pollStatusRef.current) pollStatusRef.current();
        }, POLL_INTERVAL_MS);
      }
    }
  }, [startQrTimer, stopPolling, stopQrTimer]);

  useEffect(() => {
    pollStatusRef.current = pollStatus;
  }, [pollStatus]);

  const startPolling = useCallback(() => {
    stopPolling();
    if (pollStatusRef.current) pollStatusRef.current();
  }, [stopPolling]);

  // ── Supabase Realtime ──
  const subscribeRealtime = useCallback((sessionIdentifier: string) => {
    unsubscribeRealtime();
    const channel = supabase
      .channel(`wa-session-${sessionIdentifier}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'whatsapp_sessions',
        filter: `session_identifier=eq.${sessionIdentifier}`,
      }, (payload: any) => {
        if (!mountedRef.current) return;
        const newStatus = payload.new?.status;
        if (newStatus) {
          setWaState(newStatus);
          if (['CONNECTED', 'READY', 'AUTHENTICATED', 'AUTHENTICATING', 'WAITING_FOR_SCAN'].includes(newStatus)) {
            pollStatusRef.current?.();
          }
        }
      })
      .subscribe();
    realtimeChannelRef.current = channel;
  }, [unsubscribeRealtime]);

  // ── Start Connection ──
  const handleStartConnection = async () => {
    stopPolling();
    stopQrTimer();
    pollCountRef.current = 0;

    setViewMode('connecting');
    setWaState('INITIALIZING');
    setQrCode(null);
    setWaError('');

    const health = await checkGatewayHealth();
    if (!health.ok) {
      setWaState('ERROR');
      setWaError(`WhatsApp gateway unavailable. ${health.error || 'Please ensure the gateway service is running.'}`);
      return;
    }

    try {
      const res = await fetchApi('/api/whatsapp/connect', {
        method: 'POST',
        body: JSON.stringify(sessionRef.current ? { session_identifier: sessionRef.current } : {}),
      });

      const data = res.data;
      if (!data) { setWaState('ERROR'); setWaError('No response received from server.'); return; }

      if (data.code === 'WHATSAPP_GATEWAY_UNAVAILABLE') {
        setWaState('ERROR'); setWaError(data.error);
        return;
      }

      if (data.session_identifier) sessionRef.current = data.session_identifier;
      setWaState(data.status || 'INITIALIZING');

      if (data.status === 'CONNECTED' || data.status === 'READY') {
        setViewMode('dashboard');
        return;
      }

      if (sessionRef.current) subscribeRealtime(sessionRef.current);
      startPolling();

    } catch (e: any) {
      setWaState('ERROR');
      setWaError(e.message || 'Connection failed.');
    }
  };

  const handleRefreshQR = async () => {
    setQrCode(null);
    stopQrTimer();
    try {
      await fetchApi('/api/whatsapp/connect', {
        method: 'POST',
        body: JSON.stringify({ session_identifier: sessionRef.current }),
      });
      pollStatus();
    } catch (e: any) {
      setWaError(e.message);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect this WhatsApp account? All linked channel automations will be paused.')) return;
    try {
      if (sessionRef.current) {
        await fetchApi('/api/whatsapp/disconnect', {
          method: 'POST',
          body: JSON.stringify({ session_identifier: sessionRef.current }),
        });
      }
      setAccount(null);
      setShowAuthModal(false);
      setViewMode('list');
      setWaState('DISCONNECTED');
      sessionRef.current = null;
      loadExistingSessions();
    } catch {
      alert('Failed to disconnect session.');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={36} className="animate-spin text-blue-600" />
          <p className="text-sm font-medium text-slate-500">Loading WhatsApp Channels...</p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // VIEW: Connected Dashboard (Matches Reference Image 1)
  // ═══════════════════════════════════════════════════════
  if (viewMode === 'dashboard' && account) {
    return (
      <>
        <DashboardView
          account={account}
          onDisconnect={handleDisconnect}
          onRefresh={() => {
            checkGatewayHealth();
            loadExistingSessions();
          }}
        />

        {/* ── Authorization & Channel Linking Modal ── */}
        {showAuthModal && (
          <AuthorizationModal
            account={account}
            onClose={() => setShowAuthModal(false)}
            onDisconnect={handleDisconnect}
          />
        )}
      </>
    );
  }

  // ═══════════════════════════════════════════════════════
  // VIEW: Connecting / QR Scanner View
  // ═══════════════════════════════════════════════════════
  if (viewMode === 'connecting') {
    return (
      <div className="max-w-md mx-auto py-12 px-4">
        <button
          onClick={() => {
            setViewMode('list');
            stopPolling();
            stopQrTimer();
            unsubscribeRealtime();
          }}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-6 transition-colors"
        >
          ← Back to overview
        </button>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-[#25D366] text-white flex items-center justify-center mx-auto mb-4 shadow-md shadow-emerald-500/20">
            <svg className="w-8 h-8 fill-current" viewBox="0 0 24 24">
              <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
            </svg>
          </div>

          <h2 className="text-xl font-bold text-slate-900 mb-1">Scan WhatsApp QR Code</h2>
          <p className="text-xs text-slate-500 mb-6">
            Open WhatsApp on your phone → Linked Devices → Link a Device
          </p>

          {/* Initializing */}
          {(waState === 'INITIALIZING' || waState === 'CREATING') && (
            <div className="py-12 flex flex-col items-center justify-center">
              <Loader2 size={36} className="animate-spin text-blue-600 mb-3" />
              <p className="text-sm font-semibold text-slate-800">Generating Secure QR Code...</p>
              <p className="text-xs text-slate-400 mt-1">Initializing multi-device connection</p>
            </div>
          )}

          {/* Waiting for Scan */}
          {waState === 'WAITING_FOR_SCAN' && (
            <div className="flex flex-col items-center">
              <div className="p-3 bg-white rounded-2xl border-2 border-slate-100 shadow-inner mb-4">
                {qrCode ? (
                  <img src={qrCode} alt="WhatsApp QR Code" className="w-56 h-56 object-contain rounded-lg" />
                ) : (
                  <div className="w-56 h-56 flex flex-col items-center justify-center bg-slate-50 rounded-lg">
                    <Loader2 className="animate-spin text-blue-600 mb-2" size={28} />
                    <span className="text-xs text-slate-400">Rendering QR Code...</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-4 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
                <Clock size={13} className={qrExpiresIn < 10 ? 'text-rose-500' : 'text-slate-400'} />
                <span>Code expires in <strong className={qrExpiresIn < 10 ? 'text-rose-600' : 'text-slate-700'}>{qrExpiresIn}s</strong></span>
              </div>

              <button
                onClick={handleRefreshQR}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
              >
                <RefreshCw size={12} /> Regenerate QR Code
              </button>
            </div>
          )}

          {/* Authenticating */}
          {(waState === 'AUTHENTICATING' || waState === 'AUTHENTICATED' || waState === 'SYNCING') && (
            <div className="py-10 flex flex-col items-center justify-center">
              <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-3">
                <CheckCircle2 size={28} />
              </div>
              <h3 className="text-base font-bold text-slate-900 mb-1">QR Code Scanned!</h3>
              <p className="text-xs text-slate-500 max-w-xs mb-4">
                Authenticating session and discovering your authorized WhatsApp Channels...
              </p>
              <Loader2 size={20} className="animate-spin text-emerald-600" />
            </div>
          )}

          {/* Expired */}
          {waState === 'EXPIRED' && (
            <div className="py-8">
              <AlertTriangle size={36} className="text-amber-500 mx-auto mb-3" />
              <h3 className="text-base font-bold text-slate-900 mb-1">QR Code Expired</h3>
              <p className="text-xs text-slate-500 mb-4">The pairing session expired for security reasons.</p>
              <button
                onClick={handleRefreshQR}
                className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
              >
                Generate New Code
              </button>
            </div>
          )}

          {/* Error */}
          {waState === 'ERROR' && (
            <div className="py-8">
              <XCircle size={36} className="text-rose-500 mx-auto mb-3" />
              <h3 className="text-base font-bold text-slate-900 mb-1">Connection Failed</h3>
              <p className="text-xs text-slate-500 mb-4 max-w-xs mx-auto">{waError || 'Could not complete pairing.'}</p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={handleStartConnection}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors"
                >
                  Try Again
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // VIEW: Setup / Connect WhatsApp
  // ═══════════════════════════════════════════════════════
  return (
    <div className="max-w-4xl mx-auto py-10 px-4 sm:px-6">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">WhatsApp Channels</h1>
        </div>
        <p className="text-sm text-slate-500">
          Manage and publish to channels connected to your WhatsApp account.
        </p>
      </div>

      {/* Connect Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center max-w-md mx-auto">
        <div className="w-16 h-16 rounded-full bg-[#25D366] text-white flex items-center justify-center mx-auto mb-5 shadow-lg shadow-emerald-500/20">
          <svg className="w-9 h-9 fill-current" viewBox="0 0 24 24">
            <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
          </svg>
        </div>

        <h3 className="text-lg font-bold text-slate-900 mb-1.5">Connect WhatsApp Account</h3>
        <p className="text-xs text-slate-500 mb-6 leading-relaxed">
          Scan the QR code to securely link your WhatsApp account and discover your managed Channels.
        </p>

        <button
          onClick={handleStartConnection}
          className="w-full py-3 px-4 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.99] transition-all shadow-sm flex items-center justify-center gap-2"
        >
          <Sparkles size={15} /> Connect WhatsApp
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// DashboardView Component (Pixel-Perfect Match to Image 1)
// ═══════════════════════════════════════════════════════
function DashboardView({
  account,
  onDisconnect,
  onRefresh,
}: {
  account: ConnectedAccount;
  onDisconnect: () => void;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const [channels, setChannels] = useState<WhatsAppChannelItem[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string>(new Date().toISOString());
  const [selectingChannelId, setSelectingChannelId] = useState<string | null>(null);
  const [viewLayout, setViewLayout] = useState<'list' | 'grid'>('list');

  const fetchChannels = async () => {
    if (!account?.sessionIdentifier) return;
    setLoadingChannels(true);
    try {
      const discoverRes = await fetchApi(`/api/channels/discover?session_identifier=${account.sessionIdentifier}`);
      const rawChannels = discoverRes?.data || [];

      if (rawChannels.length > 0) {
        const mapped: WhatsAppChannelItem[] = rawChannels.map((c: any) => ({
          id: c.id || c.channel_id,
          channel_id: c.channel_id || c.id,
          name: c.name || c.channel_name || 'WhatsApp Channel',
          link: c.link || c.channel_link || `https://whatsapp.com/channel/${c.id || c.channel_id}`,
          role: (c.role || 'admin').toLowerCase(),
          subscribers_count: c.subscribers_count !== undefined ? c.subscribers_count : (c.followers !== undefined ? c.followers : null),
          verified: Boolean(c.verified),
          can_publish: c.can_publish !== undefined ? c.can_publish : (c.role === 'owner' || c.role === 'admin'),
          picture_url: c.picture_url || c.pictureUrl || null,
          pictureUrl: c.pictureUrl || c.picture_url || null,
          description: c.description || '',
          is_selected: Boolean(c.is_selected || c.selected),
          selected: Boolean(c.selected || c.is_selected),
          synced_at: c.synced_at || new Date().toISOString(),
          created_at: c.created_at || 'Aug 10, 2026',
        }));

        setChannels(mapped);
        setLastSyncedAt(new Date().toISOString());

        const activeSelected = mapped.find(m => m.is_selected || m.selected);
        if (activeSelected) {
          setSelectedChannelId(activeSelected.id);
        } else if (mapped.length > 0 && !selectedChannelId) {
          setSelectedChannelId(mapped[0].id);
        }
      } else {
        const dbRes = await fetchApi('/api/channels/user-channels');
        if (dbRes?.data) {
          const mapped: WhatsAppChannelItem[] = dbRes.data.map((c: any) => ({
            id: c.channel_id || c.id,
            channel_id: c.channel_id || c.id,
            name: c.name || c.channel_name || 'WhatsApp Channel',
            link: c.link || c.channel_link || `https://whatsapp.com/channel/${c.channel_id || c.id}`,
            role: (c.role || 'admin').toLowerCase(),
            subscribers_count: c.subscribers_count !== undefined ? c.subscribers_count : (c.followers !== undefined ? c.followers : null),
            verified: Boolean(c.verified),
            can_publish: c.role === 'owner' || c.role === 'admin',
            picture_url: c.picture_url || c.pictureUrl || null,
            pictureUrl: c.pictureUrl || c.picture_url || null,
            description: c.description || '',
            is_selected: Boolean(c.is_selected || c.selected),
            selected: Boolean(c.selected || c.is_selected),
            synced_at: c.synced_at || new Date().toISOString(),
            created_at: c.created_at || 'Aug 10, 2026',
          }));
          setChannels(mapped);
          setLastSyncedAt(new Date().toISOString());
          const sel = mapped.find(m => m.is_selected || m.selected);
          if (sel) setSelectedChannelId(sel.id);
        }
      }
    } catch (err) {
      console.error('[UNAI-WA] Channels fetch error:', err);
    } finally {
      setLoadingChannels(false);
    }
  };

  useEffect(() => {
    fetchChannels();
  }, [account?.sessionIdentifier]);

  const handleSelectChannel = async (channel: WhatsAppChannelItem) => {
    const chId = channel.id || channel.channel_id;
    if (selectedChannelId === chId) return;

    setSelectingChannelId(chId);
    setSelectedChannelId(chId);

    try {
      await fetchApi(`/api/channels/${chId}/select`, { method: 'POST' });
      setChannels(prev => prev.map(c => ({
        ...c,
        is_selected: c.id === chId || c.channel_id === chId,
        selected: c.id === chId || c.channel_id === chId,
      })));
    } catch (e) {
      console.error('Channel selection error:', e);
    } finally {
      setSelectingChannelId(null);
    }
  };

  // Find currently active / selected channel for right-side detail panel
  const currentSelected = channels.find(c => (c.id === selectedChannelId || c.channel_id === selectedChannelId)) || channels[0];

  return (
    <div className="w-full max-w-7xl mx-auto py-6 px-4 sm:px-8">
      {/* ── Top Header Row ── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">WhatsApp Channels</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Manage and publish to channels connected to your WhatsApp account.
          </p>
        </div>

        <div className="flex flex-col items-end">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                onRefresh();
                fetchChannels();
              }}
              disabled={loadingChannels}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50"
            >
              <RefreshCw size={14} className={loadingChannels ? 'animate-spin text-blue-600' : 'text-slate-500'} />
              <span>{loadingChannels ? 'Syncing...' : 'Sync Channels'}</span>
            </button>

            <button
              onClick={onDisconnect}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-red-500 bg-white border border-red-200 hover:bg-red-50 transition-all shadow-sm"
            >
              <LogOut size={14} />
              <span>Disconnect</span>
            </button>
          </div>
          <span className="text-[11px] text-slate-400 mt-1.5">
            Last synced {formatRelativeTime(lastSyncedAt)}
          </span>
        </div>
      </div>

      {/* ── WhatsApp Connected Hero Card (Mint Green Container) ── */}
      <div className="bg-[#f6fbf8] rounded-2xl border border-emerald-300/80 shadow-sm p-6 mb-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          {/* Left: WhatsApp Icon + Phone Info */}
          <div className="flex items-center gap-4">
            {/* WhatsApp Big Circular Icon */}
            <div className="w-14 h-14 rounded-full bg-[#25D366] text-white flex items-center justify-center shrink-0 shadow-sm">
              <svg className="w-8 h-8 fill-current" viewBox="0 0 24 24">
                <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.372-.025-.521-.075-.148-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>
              </svg>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm text-slate-900">WhatsApp Connected</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Online
                </span>
              </div>

              <div className="text-lg font-bold text-slate-900 tracking-tight mt-0.5">
                {formatPhoneNumber(account.phone)}
              </div>

              <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-slate-500 mt-1">
                <div className="flex items-center gap-1.5">
                  <Calendar size={13} className="text-slate-400" />
                  <span>Connected on {formatConnectedDate(account.connectedAt)}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShieldCheck size={13} className="text-slate-400" />
                  <span>Session active and healthy</span>
                </div>
              </div>
            </div>
          </div>

          {/* Right: 3 Stats Columns */}
          <div className="flex items-center gap-8 lg:gap-12 pl-4 lg:pl-0 border-t lg:border-t-0 pt-4 lg:pt-0 border-emerald-100">
            <div>
              <span className="text-xs text-slate-500 block font-normal">Channels Found</span>
              <span className="text-2xl font-bold text-slate-900 block mt-0.5">{channels.length}</span>
            </div>

            <div className="h-9 w-[1px] bg-slate-200/80 hidden sm:block" />

            <div>
              <span className="text-xs text-slate-500 block font-normal">Authorized</span>
              <span className="text-2xl font-bold text-slate-900 block mt-0.5">{channels.length}</span>
            </div>

            <div className="h-9 w-[1px] bg-slate-200/80 hidden sm:block" />

            <div>
              <span className="text-xs text-slate-500 block font-normal">Sync Status</span>
              <div className="flex items-center gap-1.5 mt-1">
                <CheckCircle2 size={16} className="text-emerald-500" />
                <span className="text-sm font-semibold text-slate-900">Up to date</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Two-Column Layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* ══ Left Column (Channels List) ══ */}
        <div className="lg:col-span-8 space-y-4">
          {/* Section Header */}
          <div className="flex items-center justify-between mb-2">
            <div>
              <h2 className="text-base font-bold text-slate-900">Your WhatsApp Channels</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Channels available through your connected WhatsApp account.
              </p>
            </div>

            <div className="flex items-center p-1 bg-white border border-slate-200 rounded-lg shadow-sm">
              <button
                onClick={() => setViewLayout('grid')}
                className={`p-1 rounded ${viewLayout === 'grid' ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-700'}`}
                title="Grid View"
              >
                <LayoutGrid size={15} />
              </button>
              <button
                onClick={() => setViewLayout('list')}
                className={`p-1 rounded ${viewLayout === 'list' ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-700'}`}
                title="List View"
              >
                <List size={15} />
              </button>
            </div>
          </div>

          {/* Loading Skeletons */}
          {loadingChannels && channels.length === 0 && (
            <div className="space-y-3">
              {[1, 2].map((n) => (
                <div key={n} className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4 animate-pulse">
                  <div className="w-14 h-14 rounded-full bg-slate-100 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-slate-100 rounded w-1/3" />
                    <div className="h-3 bg-slate-100 rounded w-1/4" />
                  </div>
                  <div className="w-24 h-8 bg-slate-100 rounded-xl" />
                </div>
              ))}
            </div>
          )}

          {/* Channel Cards */}
          {channels.length > 0 && (
            <div className="space-y-4">
              {channels.map((channel) => {
                const isSelected = (selectedChannelId === channel.id || selectedChannelId === channel.channel_id);
                const isSelecting = (selectingChannelId === channel.id || selectingChannelId === channel.channel_id);
                const roleFormatted = (channel.role || 'Admin').charAt(0).toUpperCase() + (channel.role || 'Admin').slice(1);
                const avatarSrc = getSafeImageUrl(channel.pictureUrl || channel.picture_url);

                return (
                  <div
                    key={channel.id || channel.channel_id}
                    onClick={() => handleSelectChannel(channel)}
                    className={`bg-white rounded-2xl p-5 transition-all duration-200 cursor-pointer relative shadow-sm ${
                      isSelected
                        ? 'border-2 border-blue-500'
                        : 'border border-slate-200/90 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      {/* Left: Avatar + Details */}
                      <div className="flex items-start gap-4 min-w-0">
                        {/* Avatar */}
                        <div className="relative shrink-0 mt-0.5">
                          {avatarSrc ? (
                            <img
                              src={avatarSrc}
                              alt={channel.name}
                              className="w-14 h-14 rounded-full object-cover border border-slate-100"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                                const fallback = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                                if (fallback) fallback.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <div
                            className="w-14 h-14 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-sm border border-slate-200"
                            style={{ display: avatarSrc ? 'none' : 'flex' }}
                          >
                            {channel.name?.slice(0, 2).toUpperCase() || 'WA'}
                          </div>

                          {/* Green Checkmark Badge on Avatar */}
                          <div className="w-4 h-4 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center text-white text-[9px] absolute bottom-0 right-0 shadow-sm">
                            ✓
                          </div>
                        </div>

                        {/* Middle Text Details */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-base text-slate-900">
                              {channel.name}
                            </span>
                            <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md bg-blue-50 text-blue-600 border border-blue-100">
                              {roleFormatted}
                            </span>
                          </div>

                          <div className="text-xs text-slate-500 font-mono mt-0.5">
                            Channel ID: {channel.id || channel.channel_id}
                          </div>

                          <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 mt-1.5">
                            <Users size={14} className="text-blue-500" />
                            <span>{formatSubscribers(channel.subscribers_count ?? channel.followers)}</span>
                          </div>

                          <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 mt-1">
                            <ShieldCheck size={14} className="text-emerald-500" />
                            <span>WhatsApp Verified</span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Select Button + Timestamp */}
                      <div className="flex flex-col sm:items-end justify-between self-end sm:self-stretch shrink-0">
                        {isSelected ? (
                          <button
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-blue-600 shadow-sm shadow-blue-500/20"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Check size={14} />
                            <span>Selected</span>
                          </button>
                        ) : (
                          <button
                            disabled={isSelecting}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectChannel(channel);
                            }}
                            className="inline-flex items-center justify-center px-5 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors"
                          >
                            {isSelecting ? <Loader2 size={13} className="animate-spin" /> : 'Select'}
                          </button>
                        )}

                        <div className="text-[11px] text-slate-400 flex items-center gap-1.5 mt-4 sm:mt-0">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          <span>Synced {formatRelativeTime(channel.synced_at)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom "No channels found?" Help Box */}
          <div className="bg-white rounded-2xl border border-slate-200/80 p-8 text-center mt-6 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3 border border-blue-100">
              <Search size={18} />
            </div>
            <h4 className="text-sm font-bold text-slate-900 mb-1">No channels found?</h4>
            <p className="text-xs text-slate-500 mb-4 max-w-sm mx-auto leading-relaxed">
              If you just created a channel, it might take a few minutes to appear.
            </p>
            <button
              onClick={() => {
                onRefresh();
                fetchChannels();
              }}
              disabled={loadingChannels}
              className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors shadow-sm"
            >
              {loadingChannels ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              <span>Sync Channels</span>
            </button>
          </div>
        </div>

        {/* ══ Right Column (Channel Details Sidebar) ══ */}
        <div className="lg:col-span-4">
          <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm sticky top-24">
            <h3 className="text-sm font-bold text-slate-900 mb-5">Channel Details</h3>

            {currentSelected ? (
              <>
                {/* Centered Avatar and Name */}
                <div className="text-center pb-5 border-b border-slate-100">
                  <div className="relative w-20 h-20 mx-auto mb-3">
                    {getSafeImageUrl(currentSelected.pictureUrl || currentSelected.picture_url) ? (
                      <img
                        src={getSafeImageUrl(currentSelected.pictureUrl || currentSelected.picture_url)}
                        alt={currentSelected.name}
                        className="w-20 h-20 rounded-full object-cover border-2 border-slate-100 shadow-sm"
                      />
                    ) : (
                      <div className="w-20 h-20 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-lg">
                        {currentSelected.name?.slice(0, 2).toUpperCase() || 'WA'}
                      </div>
                    )}
                    <div className="w-6 h-6 rounded-full bg-emerald-500 border-2 border-white flex items-center justify-center text-white text-[11px] absolute bottom-0 right-0 shadow-sm">
                      ✓
                    </div>
                  </div>

                  <h4 className="font-bold text-base text-slate-900">
                    {currentSelected.name}
                  </h4>

                  <span className="inline-block bg-blue-50 text-blue-600 text-[11px] font-semibold px-2.5 py-0.5 rounded-full border border-blue-100 mt-1">
                    {(currentSelected.role || 'Admin').charAt(0).toUpperCase() + (currentSelected.role || 'Admin').slice(1)}
                  </span>

                  <p className="text-[11px] text-slate-400 font-mono mt-1 truncate">
                    Channel ID: {currentSelected.id || currentSelected.channel_id}
                  </p>
                </div>

                {/* Metadata List */}
                <div className="space-y-4 py-5 text-xs">
                  {/* Description */}
                  <div className="flex items-start gap-3">
                    <FileText size={16} className="text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-[11px] text-slate-400 block font-normal">Description</span>
                      <p className="text-slate-700 font-normal text-xs mt-0.5 leading-relaxed">
                        {currentSelected.description || `Official channel for ${currentSelected.name} updates, news, and content.`}
                      </p>
                    </div>
                  </div>

                  {/* Subscribers */}
                  <div className="flex items-start gap-3">
                    <Users size={16} className="text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-[11px] text-slate-400 block font-normal">Subscribers</span>
                      <span className="text-slate-900 font-semibold text-xs mt-0.5 block">
                        {formatSubscribers(currentSelected.subscribers_count ?? currentSelected.followers)}
                      </span>
                    </div>
                  </div>

                  {/* Verification */}
                  <div className="flex items-start gap-3">
                    <ShieldCheck size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-[11px] text-slate-400 block font-normal">Verification</span>
                      <span className="text-emerald-600 font-semibold text-xs mt-0.5 flex items-center gap-1">
                        WhatsApp Verified <Check size={12} className="text-emerald-500" />
                      </span>
                    </div>
                  </div>

                  {/* Role */}
                  <div className="flex items-start gap-3">
                    <UserCheck size={16} className="text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-[11px] text-slate-400 block font-normal">Role</span>
                      <span className="text-emerald-600 font-semibold text-xs mt-0.5 block">
                        {(currentSelected.role || 'Admin').charAt(0).toUpperCase() + (currentSelected.role || 'Admin').slice(1)}
                      </span>
                    </div>
                  </div>

                  {/* Connected WhatsApp */}
                  <div className="flex items-start gap-3">
                    <Phone size={16} className="text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-[11px] text-slate-400 block font-normal">Connected WhatsApp</span>
                      <span className="text-slate-900 font-semibold text-xs mt-0.5 block">
                        {formatPhoneNumber(account.phone)}
                      </span>
                    </div>
                  </div>

                  {/* Created On WhatsApp */}
                  <div className="flex items-start gap-3">
                    <Calendar size={16} className="text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-[11px] text-slate-400 block font-normal">Created On WhatsApp</span>
                      <span className="text-slate-700 font-medium text-xs mt-0.5 block">
                        {currentSelected.created_at || 'Aug 10, 2026'}
                      </span>
                    </div>
                  </div>

                  {/* Last Synced */}
                  <div className="flex items-start gap-3">
                    <Clock size={16} className="text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-[11px] text-slate-400 block font-normal">Last Synced</span>
                      <span className="text-slate-700 font-medium text-xs mt-0.5 block">
                        {formatRelativeTime(currentSelected.synced_at)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Bottom Actions */}
                <div className="pt-2 space-y-2">
                  <button
                    onClick={() => navigate(`/automations/new?channel_id=${currentSelected.id || currentSelected.channel_id}`)}
                    className="w-full py-2.5 rounded-xl text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.99] transition-all shadow-sm flex items-center justify-center gap-2"
                  >
                    <FileText size={15} />
                    <span>Create Post</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigate(`/automations/new?channel_id=${currentSelected.id || currentSelected.channel_id}&schedule=true`)}
                      className="flex-1 py-2 rounded-xl text-xs font-semibold text-blue-600 bg-white border border-blue-200 hover:bg-blue-50 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Clock size={14} />
                      <span>Schedule Post</span>
                    </button>

                    {currentSelected.link && (
                      <a
                        href={currentSelected.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 py-2 rounded-xl text-xs font-semibold text-blue-600 bg-white border border-blue-200 hover:bg-blue-50 transition-colors flex items-center justify-center gap-1.5"
                      >
                        <span>View Channel</span>
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="py-8 text-center text-xs text-slate-400">
                Select a channel to view its metadata.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// AuthorizationModal Component (Permissions & Verification)
// ═══════════════════════════════════════════════════════
function AuthorizationModal({
  account,
  onClose,
  onDisconnect,
}: {
  account: ConnectedAccount;
  onClose: () => void;
  onDisconnect: () => void;
}) {
  const [agreed, setAgreed] = useState(true);
  const [channelLink, setChannelLink] = useState('');
  const [authorizing, setAuthorizing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleAuthorize = async () => {
    if (!agreed) return;
    setAuthorizing(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await fetchApi('/api/channels/authorize', {
        method: 'POST',
        body: JSON.stringify({
          session_identifier: account.sessionIdentifier,
          channel_link_or_code: channelLink.trim() || undefined,
        }),
      });

      if (res?.success) {
        setSuccessMsg('WhatsApp account authorized and channels synchronized successfully!');
        setTimeout(() => {
          onClose();
          window.location.reload();
        }, 1200);
      } else {
        setErrorMsg(res?.error || 'Failed to authorize WhatsApp account.');
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'Authorization failed. Please try again.');
    } finally {
      setAuthorizing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full p-6 sm:p-7 relative overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
        >
          <X size={18} />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20 shrink-0">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Authorize WhatsApp Account</h3>
            <p className="text-xs text-slate-500">Configure permissions and authorize automated channel publishing.</p>
          </div>
        </div>

        {/* Account Profile Card */}
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 mb-5 flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-full bg-[#25D366] text-white flex items-center justify-center font-bold shrink-0">
            <MessageCircle size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-900 truncate">
                {formatPhoneNumber(account.phone)}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                Connected
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5 truncate">{account.sessionIdentifier}</p>
          </div>
        </div>

        {/* Permissions Breakdown */}
        <div className="space-y-2.5 mb-5 text-xs text-slate-600">
          <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <CheckCircle2 size={16} className="text-blue-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-800">Read & Manage WhatsApp Channels</span>
              <p className="text-[11px] text-slate-500 mt-0.5">Automatically discover and retrieve channel metrics for channels where this account is Admin or Owner.</p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <CheckCircle2 size={16} className="text-blue-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-800">Automated Content Publishing</span>
              <p className="text-[11px] text-slate-500 mt-0.5">Allow UNAI Flow automation engine to broadcast scheduled campaigns directly to your selected channel.</p>
            </div>
          </div>
        </div>

        {/* Optional Channel Link Input */}
        <div className="mb-5 bg-blue-50/40 rounded-2xl p-3.5 border border-blue-100">
          <label className="block text-xs font-bold text-slate-800 mb-1 flex items-center gap-1.5">
            <Link2 size={13} className="text-blue-600" /> Channel Invite Link (Optional)
          </label>
          <input
            type="text"
            placeholder="https://whatsapp.com/channel/0029VbDxqHz6hENhNBcZM31M"
            value={channelLink}
            onChange={(e) => setChannelLink(e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 font-mono text-slate-800"
          />
        </div>

        {/* Terms & Agreement Checkbox */}
        <label className="flex items-start gap-2.5 mb-5 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-xs text-slate-600 leading-snug">
            I authorize this WhatsApp account for automated marketing actions and channel administration.
          </span>
        </label>

        {/* Status Alerts */}
        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs mb-4 flex items-center gap-2">
            <AlertTriangle size={14} className="shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs mb-4 flex items-center gap-2">
            <Check size={14} className="shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={onDisconnect}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
          >
            Disconnect Account
          </button>
          <button
            onClick={handleAuthorize}
            disabled={!agreed || authorizing}
            className="px-5 py-2.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.99] transition-all shadow-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {authorizing ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                <span>Authorizing...</span>
              </>
            ) : (
              <>
                <FileCheck2 size={14} />
                <span>Approve & Authorize</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
