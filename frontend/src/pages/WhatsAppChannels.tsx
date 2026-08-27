import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Loader2,
  CheckCircle2,
  ShieldCheck,
  RefreshCw,
  Plus,
  MessageCircle,
  AlertTriangle,
  XCircle,
  Wifi,
  WifiOff,
  Clock,
  Link2,
  Phone,
} from 'lucide-react';
import { fetchApi, API_BASE_URL } from '../lib/apiClient';
import { supabase } from '../lib/supabaseClient';

// ── Constants ──
const POLL_INTERVAL_MS = 2000; // Snappy 2s polling to match localhost responsiveness
const MAX_POLL_COUNT = 300;     // 10 minutes max connection window

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

// ── Production-Safe Diagnostic Logger ──
const log = (tag: string, data: any) => {
  const prefix = `%c[UNAI-WA] ${tag}`;
  const style = tag.includes('ERROR') || tag.includes('FAILED') ? 'color:#ef4444;font-weight:bold'
    : tag.includes('QR') ? 'color:#25D366;font-weight:bold'
    : tag.includes('AUTH') ? 'color:#f59e0b;font-weight:bold'
    : tag.includes('CONNECTED') || tag.includes('SUCCESS') ? 'color:#16a34a;font-weight:bold'
    : 'color:#3b82f6;font-weight:bold';
  console.log(prefix, style, data);
};

export default function WhatsAppChannels() {
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const mountedRef = useRef(true);

  // ── Connection State ──
  const [waState, setWaState] = useState<SessionStatus>('CREATING');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrExpiresIn, setQrExpiresIn] = useState(30);
  const [waError, setWaError] = useState('');
  const [waErrorCode, setWaErrorCode] = useState('');
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealth | null>(null);
  const [channelName, setChannelName] = useState('');

  // ── Connected Account State ──
  const [account, setAccount] = useState<ConnectedAccount | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [existingSessions, setExistingSessions] = useState<any[]>([]);

  // ── Refs ──
  const sessionRef = useRef<string | null>(null);
  const pollCountRef = useRef(0);
  const isPollingRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const realtimeChannelRef = useRef<any>(null);

  // ── Cleanup ──
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
      stopQrTimer();
      stopQrAutoRefresh();
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
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    isPollingRef.current = false;
  }, []);

  const stopQrTimer = useCallback(() => {
    if (qrTimerRef.current) { clearInterval(qrTimerRef.current); qrTimerRef.current = null; }
  }, []);

  const stopQrAutoRefresh = useCallback(() => {
    if (qrRefreshRef.current) { clearInterval(qrRefreshRef.current); qrRefreshRef.current = null; }
  }, []);

  const unsubscribeRealtime = useCallback(() => {
    if (realtimeChannelRef.current) { supabase.removeChannel(realtimeChannelRef.current); realtimeChannelRef.current = null; }
  }, []);

  // ── Load existing sessions ──
  const loadExistingSessions = async () => {
    try {
      const res = await fetchApi('/api/whatsapp/sessions');
      const data = res?.data || [];

      setExistingSessions(data);
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
        log('LOADED', { status: 'CONNECTED', session: connected.session_identifier });
      } else {
        // Only reset to list view if we didn't already have an active account in session
        if (!sessionRef.current) {
          setAccount(null);
          setViewMode('list');
          log('LOADED', { status: 'NO_ACTIVE_SESSION' });
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
      if (mountedRef.current) setGatewayHealth(res);
      log('HEALTH', res);
      return res;
    } catch {
      const fallback: GatewayHealth = { ok: false, error: 'Gateway unreachable' };
      if (mountedRef.current) setGatewayHealth(fallback);
      log('HEALTH.ERROR', fallback);
      return fallback;
    }
  };

  // ── QR Timer ──
  const startQrTimer = useCallback(() => {
    stopQrTimer();
    setQrExpiresIn(30);
    qrTimerRef.current = setInterval(() => {
      setQrExpiresIn((prev) => {
        if (prev <= 1) { stopQrTimer(); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, [stopQrTimer]);

  const pollStatusRef = useRef<(() => Promise<void>) | null>(null);

  // ── Poll Status ──
  const pollStatus = useCallback(async () => {
    if (!sessionRef.current || !mountedRef.current) return;
    if (isPollingRef.current) return; // Prevent concurrent overlapping requests

    isPollingRef.current = true;
    pollCountRef.current += 1;
    if (pollCountRef.current > MAX_POLL_COUNT) {
      stopPolling();
      stopQrAutoRefresh();
      setWaState('ERROR');
      setWaError('Connection timed out. Please try again.');
      setWaErrorCode('TIMEOUT');
      log('SESSION_FAILED', { reason: 'TIMEOUT', polls: pollCountRef.current });
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
      
      log('STATUS_POLL', {
        status: newStatus,
        hasPairing: Boolean(data.pairing),
        pollCount: pollCountRef.current,
        sessionId: sessionRef.current,
      });

      setWaState((prev) => {
        if (newStatus !== prev) {
          log('STATUS_CHANGED', { from: prev, to: newStatus });
        }
        return newStatus;
      });

      // Surface gateway errors if any
      if (data.gateway_error && !data.gateway_reachable) {
        setWaError(`Gateway: ${data.gateway_error}`);
        log('GATEWAY_ERROR', data.gateway_error);
      }

      // Handle QR delivery unconditionally whenever pairing data is present
      if (data.pairing) {
        setQrCode(data.pairing);
        setWaState((prev) => {
          if (prev !== 'CONNECTED' && prev !== 'READY' && prev !== 'AUTHENTICATING' && prev !== 'AUTHENTICATED') {
            return 'WAITING_FOR_SCAN';
          }
          return prev;
        });
        startQrTimer();
        log('QR_AVAILABLE', { type: 'qr', length: data.pairing.length });
      } else if (newStatus === 'INITIALIZING' || newStatus === 'WAITING_FOR_SCAN') {
        log('QR_204_NOT_READY', { status: newStatus });
      }

      // Handle intermediate scan/authenticating state
      if (newStatus === 'AUTHENTICATING' || newStatus === 'SYNCING') {
        log('AUTHENTICATING', { session: sessionRef.current, status: newStatus });
        // Keep polling actively — do NOT terminate or timeout
      }

      // Handle final authentication / ready
      if (newStatus === 'CONNECTED' || newStatus === 'READY' || newStatus === 'AUTHENTICATED') {
        isTerminal = true;
        stopPolling();
        stopQrTimer();
        stopQrAutoRefresh();

        const userInfo = data.session || {};
        const phone = userInfo.phone_number;
        const profilePictureUrl = userInfo.profile_picture_url ||
          data.session?.profile_picture_url ||
          (data as any)?.userInfo?.profilePictureUrl;
        log('AUTHENTICATED', { phone, profilePictureUrl: Boolean(profilePictureUrl), session: sessionRef.current });

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

        log('CONNECTED', {
          id: phone,
          name: userInfo.display_name,
          session: sessionRef.current,
        });

        // Transition to dashboard smoothly
        setTimeout(() => {
          if (mountedRef.current) setViewMode('dashboard');
        }, 1200);
      }

      // Handle terminal errors
      if (newStatus === 'ERROR') {
        isTerminal = true;
        stopPolling();
        stopQrTimer();
        stopQrAutoRefresh();
        setWaError(data.error || data.gateway_error || 'Connection failed.');
        log('SESSION_FAILED', { error: data.error || data.gateway_error });
      }
    } catch (e: any) {
      log('POLL_ERROR', e.message);
    } finally {
      isPollingRef.current = false;
      // Schedule next poll cleanly only if not terminal and still active
      if (mountedRef.current && sessionRef.current && !isTerminal) {
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        pollTimerRef.current = setTimeout(() => {
          if (pollStatusRef.current) pollStatusRef.current();
        }, POLL_INTERVAL_MS);
      }
    }
  }, [startQrTimer, stopPolling, stopQrTimer, stopQrAutoRefresh]);

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
          log('REALTIME', { status: newStatus });
          setWaState(newStatus);
          if (['CONNECTED', 'READY', 'AUTHENTICATED', 'AUTHENTICATING'].includes(newStatus)) {
            pollStatusRef.current?.();
          }
          if (newStatus === 'WAITING_FOR_SCAN') {
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
    stopQrAutoRefresh();
    pollCountRef.current = 0; // Only reset counter for brand-new connection attempt!

    setViewMode('connecting');
    setWaState('INITIALIZING');
    setQrCode(null);
    setWaError('');
    setWaErrorCode('');

    log('API_BASE_URL', { url: API_BASE_URL });
    log('SESSION_CREATE', { channelName });

    const health = await checkGatewayHealth();
    if (!health.ok) {
      setWaState('ERROR');
      setWaError(`WhatsApp gateway unavailable. ${health.error || 'Start the gateway service.'}`);
      setWaErrorCode('WHATSAPP_GATEWAY_UNAVAILABLE');
      log('SESSION_FAILED', { code: 'GATEWAY_UNAVAILABLE' });
      return;
    }

    try {
      const res = await fetchApi('/api/whatsapp/connect', {
        method: 'POST',
        body: JSON.stringify(sessionRef.current ? { session_identifier: sessionRef.current } : {}),
      });

      const data = res.data;
      log('SESSION_ID', { sessionId: data?.session_identifier, initialStatus: data?.status });

      if (!data) { setWaState('ERROR'); setWaError('No response.'); return; }

      if (data.code === 'WHATSAPP_GATEWAY_UNAVAILABLE') {
        setWaState('ERROR'); setWaError(data.error); setWaErrorCode(data.code);
        return;
      }

      if (data.session_identifier) sessionRef.current = data.session_identifier;
      setWaState(data.status || 'INITIALIZING');

      if (data.status === 'CONNECTED' || data.status === 'READY') {
        setViewMode('dashboard');
        return;
      }

      // Subscribe + start single polling loop
      if (sessionRef.current) subscribeRealtime(sessionRef.current);
      startPolling();

    } catch (e: any) {
      setWaState('ERROR');
      setWaError(e.message || 'Connection failed.');
      log('SESSION_FAILED', { error: e.message });
    }
  };

  const handleRefreshQR = async () => {
    log('QR_POLL', { manual: true, session: sessionRef.current });
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
    if (!confirm('Disconnect WhatsApp session?')) return;
    try {
      if (sessionRef.current) {
        await fetchApi('/api/whatsapp/disconnect', {
          method: 'POST',
          body: JSON.stringify({ session_identifier: sessionRef.current }),
        });
      }
      log('DISCONNECTED', { session: sessionRef.current });
      setAccount(null);
      setViewMode('list');
      setWaState('DISCONNECTED');
      sessionRef.current = null;
      loadExistingSessions();
    } catch {
      alert('Failed to disconnect.');
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    log('COPIED', { label });
  };

  // ── Helpers ──
  const getStatusDisplay = (status: SessionStatus) => {
    const map: Record<string, { label: string; color: string; icon: any; code: number }> = {
      CREATING: { label: 'Creating...', color: '#6b7280', icon: Loader2, code: 0 },
      INITIALIZING: { label: 'Preparing QR code...', color: '#3b82f6', icon: Loader2, code: 1 },
      WAITING_FOR_SCAN: { label: 'Scan QR Code', color: '#25D366', icon: MessageCircle, code: 3 },
      PAIRING: { label: 'Pairing...', color: '#f59e0b', icon: Loader2, code: 2 },
      AUTHENTICATING: { label: 'Authenticating...', color: '#f59e0b', icon: Loader2, code: 4 },
      AUTHENTICATED: { label: 'Authenticated!', color: '#16a34a', icon: CheckCircle2, code: 4 },
      SYNCING: { label: 'Syncing...', color: '#3b82f6', icon: Loader2, code: 2 },
      READY: { label: 'Connected', color: '#16a34a', icon: CheckCircle2, code: 5 },
      CONNECTED: { label: 'Connected', color: '#16a34a', icon: CheckCircle2, code: 5 },
      DISCONNECTED: { label: 'Disconnected', color: '#ef4444', icon: WifiOff, code: 0 },
      RECONNECTING: { label: 'Reconnecting...', color: '#f59e0b', icon: RefreshCw, code: 2 },
      EXPIRED: { label: 'QR Expired', color: '#f59e0b', icon: Clock, code: 0 },
      ERROR: { label: 'Error', color: '#ef4444', icon: XCircle, code: 0 },
    };
    return map[status] || map.ERROR;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}>
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // VIEW: Connected Dashboard (like Whapi.cloud)
  // ═══════════════════════════════════════════════════════
  if (viewMode === 'dashboard' && account) {
    return <DashboardView
      account={account}
      gatewayHealth={gatewayHealth}
      onDisconnect={handleDisconnect}
      onRefresh={() => { log('REFRESH_STATUS', {}); checkGatewayHealth(); loadExistingSessions(); }}
      copyToClipboard={copyToClipboard}
      showToken={showToken}
      setShowToken={setShowToken}
    />;
  }

  // ═══════════════════════════════════════════════════════
  // VIEW: Connecting (QR Code / Status)
  // ═══════════════════════════════════════════════════════
  if (viewMode === 'connecting') {
    const display = getStatusDisplay(waState);
    const StatusIcon = display.icon;

    return (
      <div style={{ maxWidth: '500px', margin: '0 auto', padding: '2rem 1.5rem' }}>
        <button onClick={() => { setViewMode('list'); stopPolling(); stopQrTimer(); stopQrAutoRefresh(); unsubscribeRealtime(); }}
          className="text-sm text-secondary hover:text-main mb-4 flex items-center gap-1">
          ← Back
        </button>

        <div className="card p-6">
          <h2 className="text-xl font-bold text-center mb-1">Connect WhatsApp</h2>
          <p className="text-sm text-secondary text-center mb-5">
            {channelName || 'WhatsApp Channel'}
          </p>

          {/* Gateway Status */}
          <div className="flex items-center justify-center gap-2 mb-4 p-2 rounded-lg" style={{
            backgroundColor: gatewayHealth?.ok ? '#f0fdf4' : '#fef2f2',
            border: `1px solid ${gatewayHealth?.ok ? '#bbf7d0' : '#fecaca'}`,
          }}>
            {gatewayHealth?.ok ? <Wifi size={14} style={{ color: '#16a34a' }} /> : <WifiOff size={14} style={{ color: '#ef4444' }} />}
            <span className="text-xs">Gateway: <strong>{gatewayHealth?.ok ? 'Online' : 'Offline'}</strong></span>
          </div>

          {/* Status Badge */}
          <div className="flex items-center justify-center gap-2 mb-4" style={{ color: display.color }}>
            <StatusIcon size={16} className={['CREATING', 'INITIALIZING', 'PAIRING', 'SYNCING', 'RECONNECTING'].includes(waState) ? 'animate-spin' : ''} />
            <span className="text-sm font-semibold">{display.label}</span>
          </div>

          {/* INITIALIZING */}
          {(waState === 'INITIALIZING' || waState === 'CREATING') && (
            <div className="text-center py-8">
              <Loader2 size={40} className="animate-spin mx-auto mb-4" style={{ color: '#25D366' }} />
              <p className="text-sm text-gray-600">Generating QR code...</p>
              <p className="text-xs text-gray-400 mt-1">This may take up to 30 seconds for cold starts.</p>
            </div>
          )}

          {/* QR CODE */}
          {waState === 'WAITING_FOR_SCAN' && (
            <div className="flex flex-col items-center">
              <p className="text-xs text-gray-500 mb-3">
                Open WhatsApp → Settings → Linked Devices → Link a Device
              </p>

              <div className="p-3 rounded-xl mb-3" style={{
                backgroundColor: '#fff', border: '2px solid #e5e7eb',
                width: 240, height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {qrCode ? (
                  <img src={qrCode} alt="QR Code" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                ) : (
                  <div className="text-center">
                    <Loader2 className="animate-spin mx-auto mb-2" style={{ color: '#25D366' }} />
                    <p className="text-xs text-gray-400">Loading QR...</p>
                  </div>
                )}
              </div>

              {/* Timer */}
              <div className="flex items-center gap-1 mb-3">
                <Clock size={12} style={{ color: qrExpiresIn < 10 ? '#ef4444' : '#6b7280' }} />
                <span className="text-xs" style={{ color: qrExpiresIn < 10 ? '#ef4444' : '#6b7280' }}>
                  Refreshes in {qrExpiresIn}s
                </span>
              </div>

              <button onClick={handleRefreshQR} className="text-xs px-3 py-1.5 rounded border hover:bg-gray-50 flex items-center gap-1">
                <RefreshCw size={12} /> Refresh QR
              </button>
            </div>
          )}

          {/* AUTHENTICATING / AUTHENTICATED / SYNCING */}
          {(waState === 'AUTHENTICATING' || waState === 'AUTHENTICATED' || waState === 'SYNCING') && (
            <div className="text-center py-8">
              <CheckCircle2 size={48} className="mx-auto mb-3" style={{ color: '#25D366' }} />
              <p className="font-bold text-lg mb-1">QR Code Scanned!</p>
              <p className="text-sm text-gray-600">Authenticating & synchronizing session with WhatsApp...</p>
              <Loader2 size={20} className="animate-spin mx-auto mt-3" style={{ color: '#25D366' }} />
            </div>
          )}

          {/* EXPIRED */}
          {waState === 'EXPIRED' && (
            <div className="text-center py-6">
              <AlertTriangle size={40} className="mx-auto mb-3" style={{ color: '#f59e0b' }} />
              <p className="font-medium mb-3">QR code expired</p>
              <button onClick={handleRefreshQR} className="px-4 py-2 text-white rounded text-sm" style={{ backgroundColor: '#25D366' }}>
                Generate New QR
              </button>
            </div>
          )}

          {/* ERROR */}
          {waState === 'ERROR' && (
            <div className="text-center py-6">
              <XCircle size={40} className="mx-auto mb-3" style={{ color: '#ef4444' }} />
              <p className="font-medium text-red-600 mb-1">
                {waErrorCode === 'WHATSAPP_GATEWAY_UNAVAILABLE' ? 'Gateway Unavailable' : waErrorCode === 'TIMEOUT' ? 'Connection Timed Out' : 'Connection Failed'}
              </p>
              <p className="text-xs text-gray-500 mb-4">{waError}</p>
              <div className="flex gap-2 justify-center">
                <button onClick={handleStartConnection} className="px-4 py-2 text-white rounded text-sm" style={{ backgroundColor: '#25D366' }}>Retry</button>
                <button onClick={() => setViewMode('list')} className="px-4 py-2 border rounded text-sm">Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════
  // VIEW: Channel List (Default)
  // ═══════════════════════════════════════════════════════
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-main">WhatsApp Channels</h1>
          <p className="text-sm text-secondary mt-1">Connect your WhatsApp account to publish to Channels.</p>
        </div>
      </div>

      {/* Security Banner */}
      <div className="card flex items-center gap-3 p-4 mb-6" style={{ backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }}>
        <ShieldCheck size={20} style={{ color: '#16a34a', flexShrink: 0 }} />
        <div>
          <p className="text-sm font-semibold text-main">End-to-End Encrypted</p>
          <p className="text-xs text-secondary">All sessions are encrypted at rest with AES-256.</p>
        </div>
      </div>

      {/* Existing Connected Sessions */}
      {existingSessions.filter(s => s.status === 'CONNECTED' || s.status === 'READY').map((session) => (
        <div key={session.id} className="card p-5 mb-4 cursor-pointer hover:shadow-md transition-shadow"
          style={{ borderLeft: '4px solid #25D366' }}
          onClick={() => {
            sessionRef.current = session.session_identifier;
            setAccount({
              phone: session.phone_number,
              name: session.phone_number ? `+${session.phone_number}` : 'WhatsApp Account',
              profilePictureUrl: session.profile_picture_url || undefined,
              sessionId: session.id,
              sessionIdentifier: session.session_identifier,
              connectedAt: session.last_connected_at || session.updated_at,
              apiUrl: `${window.location.origin}/api/whatsapp/v1`,
              apiToken: `whp_live_${session.session_identifier?.slice(5, 21)}`,
              webhookUrl: `${window.location.origin}/webhooks/whatsapp`,
            });
            setViewMode('dashboard');
          }}>
          <div className="flex items-center gap-4">
            {session.profile_picture_url ? (
              <img src={session.profile_picture_url} alt="Profile" style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', border: '2px solid #bbf7d0' }} />
            ) : (
              <div style={{ width: 44, height: 44, borderRadius: '50%', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <MessageCircle size={22} style={{ color: '#25D366' }} />
              </div>
            )}
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold">{session.phone_number ? `+${session.phone_number}` : 'WhatsApp Channel'}</span>
                <span className="chip chip-success" style={{ fontSize: 10 }}><CheckCircle2 size={10} /> Connected</span>
              </div>
              <p className="text-xs text-secondary mt-0.5">{session.session_identifier}</p>
            </div>
            <span className="text-xs text-secondary">View Dashboard →</span>
          </div>
        </div>
      ))}

      {/* New Channel Card */}
      <div className="card p-6" style={{ borderStyle: 'dashed', borderColor: '#25D366', backgroundColor: '#fafffe' }}>
        <h3 className="font-bold mb-3 flex items-center gap-2">
          <Plus size={18} style={{ color: '#25D366' }} /> New WhatsApp Channel
        </h3>
        <div className="mb-3">
          <label className="block text-sm font-medium mb-1">Channel Name</label>
          <input type="text" className="w-full px-3 py-2 border rounded-lg text-sm"
            placeholder="My WhatsApp Channel"
            value={channelName} onChange={(e) => setChannelName(e.target.value)} />
        </div>
        <button
          className="w-full py-2.5 text-white rounded-lg font-medium flex items-center justify-center gap-2"
          style={{ backgroundColor: '#25D366' }}
          onClick={() => {
            checkGatewayHealth().then(() => handleStartConnection());
          }}>
          <MessageCircle size={18} /> Create & Connect
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// DashboardView Component (Simplified: Direct Channel Management)
// ═══════════════════════════════════════════════════════
function DashboardView({ account, onDisconnect, onRefresh }: {
  account: any;
  gatewayHealth?: any;
  onDisconnect: () => void;
  onRefresh: () => void;
  copyToClipboard?: (text: string, label: string) => void;
  showToken?: boolean;
  setShowToken?: (v: boolean) => void;
}) {
  const [channels, setChannels] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem(`wa_channels_${account?.sessionIdentifier}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [channelLinkInput, setChannelLinkInput] = useState('');
  const [resolvingLink, setResolvingLink] = useState(false);
  const [resolveError, setResolveError] = useState('');

  const saveChannelsList = (updated: any[]) => {
    setChannels(updated);
    try {
      localStorage.setItem(`wa_channels_${account?.sessionIdentifier}`, JSON.stringify(updated));
    } catch {}
  };

  const loadPersistedAndDiscoverChannels = async () => {
    setLoadingChannels(true);
    try {
      // 1. Load from DB first for instant display
      const dbRes = await fetchApi('/api/channels/user-channels');
      if (dbRes?.data && dbRes.data.length > 0) {
        const mapped = dbRes.data.map((c: any) => ({
          id: c.channel_id || c.id,
          name: c.name || 'WhatsApp Channel',
          role: c.role || 'ADMIN',
          pictureUrl: c.picture_url,
          subscribers_count: c.followers || 0,
          description: c.description || '',
          isSelected: c.is_selected || false
        }));
        saveChannelsList(mapped);
        const sel = mapped.find((m: any) => m.isSelected);
        if (sel) setSelectedChannelId(sel.id);
        else if (mapped.length > 0) setSelectedChannelId(mapped[0].id);
      }

      // 2. Discover / sync with gateway in background
      if (account?.sessionIdentifier) {
        const res = await fetchApi(`/api/channels/discover?session_identifier=${account.sessionIdentifier}`);
        const data = res?.data || [];
        if (data.length > 0) {
          saveChannelsList(data);
          if (!selectedChannelId) setSelectedChannelId(data[0].id);
        }
      }
    } catch (e: any) {
      console.error('[UNAI-WA] CHANNELS_LOAD_ERROR', e);
    } finally {
      setLoadingChannels(false);
    }
  };

  useEffect(() => {
    loadPersistedAndDiscoverChannels();
  }, [account?.sessionIdentifier]);

  const discoverChannels = async () => {
    if (!account?.sessionIdentifier) return;
    setLoadingChannels(true);
    console.log('%c[UNAI-WA] CHANNELS_REFRESH', 'color:#25D366;font-weight:bold', { session: account.sessionIdentifier });
    try {
      // 1. Fetch latest channels from DB
      const dbRes = await fetchApi('/api/channels/user-channels');
      if (dbRes?.data && dbRes.data.length > 0) {
        const mapped = dbRes.data.map((c: any) => ({
          id: c.channel_id || c.id,
          name: c.name || c.channel_name || 'WhatsApp Channel',
          role: c.role || 'ADMIN',
          pictureUrl: c.picture_url || c.pictureUrl,
          subscribers_count: c.followers || c.subscribers_count || 0,
          description: c.description || '',
          isSelected: c.is_selected || c.selected || false
        }));
        saveChannelsList(mapped);
        const sel = mapped.find((m: any) => m.isSelected);
        if (sel) setSelectedChannelId(sel.id);
        else if (!selectedChannelId && mapped.length > 0) setSelectedChannelId(mapped[0].id);
      }

      // 2. Discover from gateway
      const res = await fetchApi(`/api/channels/discover?session_identifier=${account.sessionIdentifier}`);
      const data = res?.data || [];
      if (data.length > 0) {
        saveChannelsList(data);
        if (!selectedChannelId) setSelectedChannelId(data[0].id);
      }
    } catch (e: any) {
      console.error('[UNAI-WA] CHANNELS_ERROR', e);
    } finally {
      setLoadingChannels(false);
    }
  };

  const handleLinkChannel = async () => {
    const input = channelLinkInput.trim();
    if (!input) return;
    setResolvingLink(true);
    setResolveError('');

    log('CHANNEL_RESOLVE_REQUEST', { input, session: account.sessionIdentifier, apiBase: API_BASE_URL });
    try {
      const res = await fetchApi('/api/channels/resolve', {
        method: 'POST',
        body: JSON.stringify({
          session_identifier: account.sessionIdentifier,
          link_or_code: input,
        }),
      });

      const newCh = res?.data;
      if (newCh) {
        log('CHANNEL_RESOLVE_SUCCESS', newCh);
        const existingWithoutThis = channels.filter(c => c.id !== newCh.id);
        const updated = [newCh, ...existingWithoutThis];
        saveChannelsList(updated);
        setSelectedChannelId(newCh.id);
        setChannelLinkInput('');
      } else {
        setResolveError('Channel not found. Please verify the URL or invite code.');
      }
    } catch (e: any) {
      log('CHANNEL_RESOLVE_FAILED', { error: e.message });
      setResolveError(e.message || 'Failed to link channel. Make sure your WhatsApp account has access.');
    } finally {
      setResolvingLink(false);
    }
  };

  const handleSelectChannel = async (ch: any) => {
    const chId = ch.id || ch.jid || ch.channel_id;
    setSelectedChannelId(chId);
    try {
      if (ch.id && typeof ch.id === 'string' && !ch.id.includes('@')) {
        await fetchApi(`/api/channels/${ch.id}/select`, { method: 'POST' });
      }
    } catch (e) {
      console.log('Channel select local update');
    }
  };

  const getProfileImageUrl = (url?: string) => {
    if (!url) return '';
    if (url.includes('pps.whatsapp.net') || url.includes('mmg.whatsapp.net')) {
      return `${API_BASE_URL}/api/channels/picture-proxy?url=${encodeURIComponent(url)}`;
    }
    return url;
  };

  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-main">WhatsApp Channel</h1>
          <p className="text-sm text-secondary mt-1">Channel ID: {account.sessionIdentifier}</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => { onRefresh(); discoverChannels(); }}>
            <RefreshCw size={15} /> <span>Refresh</span>
          </button>
          <button className="btn-secondary" style={{ color: '#ef4444', borderColor: '#fecaca' }} onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
      </div>

      {/* Connected Account Status Banner */}
      <div className="card p-4 mb-6" style={{ backgroundColor: '#ffffff', borderLeft: '4px solid #25D366' }}>
        <div className="flex items-center gap-3">
          {account.profilePictureUrl ? (
            <img
              src={getProfileImageUrl(account.profilePictureUrl)}
              alt="Profile"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', border: '2px solid #bbf7d0' }}
            />
          ) : (
            <div style={{ width: 48, height: 48, borderRadius: '50%', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MessageCircle size={24} style={{ color: '#25D366' }} />
            </div>
          )}
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg text-main">{account.phone ? `+${account.phone}` : (account.name || 'WhatsApp Account')}</span>
              <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>● Online</span>
            </div>
            {account.phone && (
              <div className="flex items-center gap-1 text-sm text-secondary mt-0.5">
                <Phone size={13} /> <span>+{account.phone}</span>
              </div>
            )}
            <p className="text-xs text-muted mt-1">
              Connected {account.connectedAt ? new Date(account.connectedAt).toLocaleString() : 'just now'}
            </p>
          </div>
        </div>
      </div>

      {/* Link Channel by URL or Invite Code */}
      <div className="card p-5 mb-6" style={{ backgroundColor: '#fafffe', border: '1px solid #bbf7d0' }}>
        <h4 className="font-bold text-sm text-main mb-1 flex items-center gap-2">
          <Link2 size={16} style={{ color: '#25D366' }} /> Link Channel by Invite Link or Code
        </h4>
        <p className="text-xs text-secondary mb-3">
          Paste your channel's public link (e.g. <code>https://whatsapp.com/channel/0029VbDxqHz6hENhNBcZM31M</code>) to import and publish to it immediately.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            className="flex-1 px-3 py-2 border rounded-lg text-sm bg-white"
            placeholder="https://whatsapp.com/channel/0029VbDxqHz6hENhNBcZM31M"
            value={channelLinkInput}
            onChange={(e) => setChannelLinkInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleLinkChannel(); }}
          />
          <button
            onClick={handleLinkChannel}
            disabled={resolvingLink || !channelLinkInput.trim()}
            className="px-4 py-2 text-white rounded-lg text-sm font-medium flex items-center gap-1.5 disabled:opacity-50"
            style={{ backgroundColor: '#25D366' }}>
            {resolvingLink ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            <span>+ Link Channel</span>
          </button>
        </div>
        {resolveError && (
          <p className="text-xs text-red-600 mt-2">{resolveError}</p>
        )}
      </div>

      {/* Your WhatsApp Channels List */}
      <div className="card p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-main">Your WhatsApp Channels</h3>
          <button
            onClick={discoverChannels}
            disabled={loadingChannels}
            className="px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50 flex items-center gap-1.5 font-medium"
            style={{ borderColor: '#e2e8f0' }}
          >
            <RefreshCw size={12} className={loadingChannels ? 'animate-spin' : ''} />
            <span>{loadingChannels ? 'Discovering...' : 'Auto-Discover'}</span>
          </button>
        </div>

        {loadingChannels && channels.length === 0 ? (
          <div className="text-center py-8">
            <Loader2 size={28} className="animate-spin mx-auto mb-2" style={{ color: '#25D366' }} />
            <p className="text-sm text-gray-500">Discovering your WhatsApp Channels...</p>
          </div>
        ) : channels.length === 0 ? (
          <div className="text-center py-8">
            <MessageCircle size={36} className="mx-auto mb-3" style={{ color: '#cbd5e1' }} />
            <p className="text-sm text-gray-600 font-medium mb-1">No channels linked yet.</p>
            <p className="text-xs text-gray-400 max-w-md mx-auto">
              Paste your channel link above or click "Auto-Discover" to automatically load channels you administer.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {channels.map((ch: any, idx: number) => {
              const chId = ch.id || ch.jid || ch.channel_id || `channel_${idx}`;
              const isSelected = selectedChannelId === chId;
              const picUrl = getProfileImageUrl(ch.pictureUrl || ch.picture_url || ch.picture);

              return (
                <div
                  key={chId}
                  className="flex items-center gap-3.5 p-3.5 rounded-xl border transition-all"
                  style={{
                    borderColor: isSelected ? '#25D366' : '#e2e8f0',
                    backgroundColor: isSelected ? '#f0fdf4' : '#ffffff',
                    boxShadow: isSelected ? '0 1px 3px rgba(37,211,102,0.1)' : 'none',
                  }}
                  onClick={() => handleSelectChannel(ch)}
                >
                  {picUrl ? (
                    <img
                      src={picUrl}
                      alt={ch.name || 'Channel'}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                        const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                        if (fallback) fallback.style.display = 'flex';
                      }}
                      style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, border: '1px solid #dcfce7' }}
                    />
                  ) : null}
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      backgroundColor: '#dcfce7',
                      display: picUrl ? 'none' : 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <MessageCircle size={20} style={{ color: '#25D366' }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-main truncate">{ch.name || ch.subject || 'WhatsApp Channel'}</span>
                      {ch.role && (
                        <span
                          className="chip"
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 6px',
                            backgroundColor: '#dcfce7',
                            color: '#166534',
                            borderRadius: '4px',
                          }}
                        >
                          {String(ch.role).toUpperCase()}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-secondary truncate mt-0.5">
                      {ch.id || ch.jid || ch.channel_id}
                    </div>
                  </div>

                  <div className="text-xs text-secondary font-medium mr-2">
                    {ch.subscribers_count || ch.followers || 0} subscribers
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); handleSelectChannel(ch); }}
                    className="text-xs font-semibold px-2.5 py-1 rounded"
                    style={{
                      color: isSelected ? '#16a34a' : '#25D366',
                      backgroundColor: isSelected ? '#dcfce7' : 'transparent',
                    }}
                  >
                    {isSelected ? '✓ Selected' : 'Select →'}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

