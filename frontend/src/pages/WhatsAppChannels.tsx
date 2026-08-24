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
  Copy,
  Eye,
  EyeOff,
  Settings,
  Activity,
  Key,
  Link2,
  Phone,
} from 'lucide-react';
import { fetchApi } from '../lib/apiClient';
import { supabase } from '../lib/supabaseClient';

// ── Constants ──
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_COUNT = 60;
const QR_REFRESH_INTERVAL = 30000; // Auto-refresh QR every 30s

// ── Types ──
type ViewMode = 'list' | 'connecting' | 'dashboard';
type SessionStatus =
  | 'CREATING' | 'INITIALIZING' | 'WAITING_FOR_SCAN' | 'PAIRING'
  | 'AUTHENTICATED' | 'SYNCING' | 'READY' | 'CONNECTED'
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
  sessionId?: string;
  sessionIdentifier?: string;
  connectedAt?: string;
  apiUrl?: string;
  apiToken?: string;
  webhookUrl?: string;
}

// ── Console Logger ──
const log = (tag: string, data: any) => {
  const prefix = `%c[UNAI-WA] ${tag}`;
  const style = tag.includes('ERROR') ? 'color:#ef4444;font-weight:bold'
    : tag.includes('QR') ? 'color:#25D366;font-weight:bold'
    : tag.includes('AUTH') ? 'color:#f59e0b;font-weight:bold'
    : tag.includes('CONNECTED') ? 'color:#16a34a;font-weight:bold'
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
    if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
    pollCountRef.current = 0;
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
          sessionId: connected.id,
          sessionIdentifier: connected.session_identifier,
          connectedAt: connected.last_connected_at || connected.updated_at,
          apiUrl: `${window.location.origin}/api/whatsapp/v1`,
          apiToken: `whp_live_${connected.session_identifier?.slice(5, 21)}`,
          webhookUrl: `${window.location.origin}/webhooks/whatsapp`,
        });
        setViewMode('dashboard');
        log('LOADED', { status: 'CONNECTED', session: connected.session_identifier });
      } else {
        setAccount(null);
        setViewMode('list');
        sessionRef.current = null;
        log('LOADED', { status: 'NO_ACTIVE_SESSION' });
      }
    } catch (e) {
      console.error('Failed to load sessions:', e);
      setAccount(null);
      setViewMode('list');
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

    pollCountRef.current += 1;
    if (pollCountRef.current > MAX_POLL_COUNT) {
      stopPolling();
      stopQrAutoRefresh();
      setWaState('ERROR');
      setWaError('Connection timed out after 5 minutes.');
      setWaErrorCode('TIMEOUT');
      log('ERROR', { reason: 'TIMEOUT', polls: pollCountRef.current });
      return;
    }

    try {
      const res = await fetchApi(`/api/whatsapp/status?session_identifier=${sessionRef.current}`);
      if (!mountedRef.current) return;

      const data = res.data;
      if (!data) return;

      const newStatus = data.status as SessionStatus;
      
      log('POLL_TICK', { status: newStatus, hasPairing: Boolean(data.pairing), pollCount: pollCountRef.current });

      setWaState((prev) => {
        if (newStatus !== prev) {
          log('STATUS_CHANGED', { from: prev, to: newStatus });
        }
        return newStatus;
      });

      // Log health status like Whapi
      const statusCode = newStatus === 'WAITING_FOR_SCAN' ? 3
        : newStatus === 'AUTHENTICATED' || newStatus === 'CONNECTED' ? 4
        : newStatus === 'ERROR' ? 0
        : 1;
      log('health.status', { code: statusCode, text: newStatus });

      // Surface gateway errors
      if (data.gateway_error && !data.gateway_reachable) {
        setWaError(`Gateway: ${data.gateway_error}`);
        log('GATEWAY_ERROR', data.gateway_error);
      }

      // Handle QR delivery unconditionally whenever pairing data is present
      if (data.pairing) {
        setQrCode(data.pairing);
        setWaState((prev) => {
          if (prev !== 'CONNECTED' && prev !== 'READY' && prev !== 'AUTHENTICATED') {
            return 'WAITING_FOR_SCAN';
          }
          return prev;
        });
        startQrTimer();
        log('QR', { status: 'OK', type: 'qr', hasData: true, length: data.pairing.length });
      }

      // Handle authentication
      if (newStatus === 'CONNECTED' || newStatus === 'READY' || newStatus === 'AUTHENTICATED') {
        stopPolling();
        stopQrTimer();
        stopQrAutoRefresh();

        const userInfo = data.session || {};
        const phone = userInfo.phone_number;
        log('AUTH', { status: 'AUTHENTICATED', phone });

        setAccount({
          phone: phone,
          name: phone ? `+${phone}` : 'WhatsApp Account',
          sessionId: userInfo.id,
          sessionIdentifier: sessionRef.current!,
          connectedAt: new Date().toISOString(),
          apiUrl: `${window.location.origin}/api/whatsapp/v1`,
          apiToken: `whp_live_${sessionRef.current?.slice(5, 21)}`,
          webhookUrl: `${window.location.origin}/webhooks/whatsapp`,
        });

        log('CONNECTED', {
          id: phone,
          name: userInfo.display_name,
          is_business: false,
          session: sessionRef.current,
        });

        // Transition to dashboard after a brief delay
        setTimeout(() => {
          if (mountedRef.current) setViewMode('dashboard');
        }, 1200);
      }

      // Handle errors
      if (newStatus === 'ERROR') {
        stopPolling();
        stopQrTimer();
        stopQrAutoRefresh();
        setWaError(data.error || data.gateway_error || 'Connection failed.');
        log('ERROR', { error: data.error || data.gateway_error });
      }
    } catch (e: any) {
      log('POLL_ERROR', e.message);
    }
  }, [startQrTimer, stopPolling, stopQrTimer, stopQrAutoRefresh]);

  useEffect(() => {
    pollStatusRef.current = pollStatus;
  }, [pollStatus]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollCountRef.current = 0;
    pollIntervalRef.current = setInterval(() => {
      if (pollStatusRef.current) pollStatusRef.current();
    }, POLL_INTERVAL_MS);
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
          if (['CONNECTED', 'READY', 'AUTHENTICATED'].includes(newStatus)) {
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
    setViewMode('connecting');
    setWaState('INITIALIZING');
    setQrCode(null);
    setWaError('');
    setWaErrorCode('');

    log('SESSION_CREATE', { channelName });

    const health = await checkGatewayHealth();
    if (!health.ok) {
      setWaState('ERROR');
      setWaError(`WhatsApp gateway unavailable. ${health.error || 'Start the gateway service.'}`);
      setWaErrorCode('WHATSAPP_GATEWAY_UNAVAILABLE');
      log('ERROR', { code: 'GATEWAY_UNAVAILABLE' });
      return;
    }

    try {
      const res = await fetchApi('/api/whatsapp/connect', {
        method: 'POST',
        body: JSON.stringify(sessionRef.current ? { session_identifier: sessionRef.current } : {}),
      });

      const data = res.data;
      log('SESSION_RESPONSE', data);

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

      // Subscribe + poll
      if (sessionRef.current) subscribeRealtime(sessionRef.current);
      startPolling();

      // Auto-refresh QR every 30s
      qrRefreshRef.current = setInterval(() => {
        if (mountedRef.current && sessionRef.current) {
          log('QR_AUTO_REFRESH', { interval: '30s' });
          pollStatus();
        }
      }, QR_REFRESH_INTERVAL);

    } catch (e: any) {
      setWaState('ERROR');
      setWaError(e.message || 'Connection failed.');
      log('ERROR', e.message);
    }
  };

  const handleRefreshQR = async () => {
    log('QR_REFRESH', { manual: true });
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
      INITIALIZING: { label: 'Initializing...', color: '#3b82f6', icon: Loader2, code: 1 },
      WAITING_FOR_SCAN: { label: 'Scan QR Code', color: '#25D366', icon: MessageCircle, code: 3 },
      PAIRING: { label: 'Pairing...', color: '#f59e0b', icon: Loader2, code: 2 },
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

          {/* AUTHENTICATED */}
          {(waState === 'AUTHENTICATED' || waState === 'SYNCING') && (
            <div className="text-center py-8">
              <CheckCircle2 size={48} className="mx-auto mb-3" style={{ color: '#25D366' }} />
              <p className="font-bold text-lg mb-1">QR Scanned!</p>
              <p className="text-sm text-gray-600">Setting up your channel...</p>
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
            <div style={{ width: 44, height: 44, borderRadius: '50%', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MessageCircle size={22} style={{ color: '#25D366' }} />
            </div>
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
// DashboardView Component
// ═══════════════════════════════════════════════════════
function DashboardView({ account, gatewayHealth, onDisconnect, onRefresh, copyToClipboard, showToken, setShowToken }: {
  account: any;
  gatewayHealth: any;
  onDisconnect: () => void;
  onRefresh: () => void;
  copyToClipboard: (text: string, label: string) => void;
  showToken: boolean;
  setShowToken: (v: boolean) => void;
}) {
  const [channels, setChannels] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem(`wa_channels_${account?.sessionIdentifier}`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [selectedChannel, setSelectedChannel] = useState<any>(null);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [channelLinkInput, setChannelLinkInput] = useState('');
  const [resolvingLink, setResolvingLink] = useState(false);
  const [resolveError, setResolveError] = useState('');
  const [publishText, setPublishText] = useState('');
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'channels' | 'publish'>('overview');

  useEffect(() => {
    onRefresh();
    discoverChannels();
  }, []);

  const saveChannelsList = (updated: any[]) => {
    setChannels(updated);
    try {
      localStorage.setItem(`wa_channels_${account?.sessionIdentifier}`, JSON.stringify(updated));
    } catch {}
  };

  const discoverChannels = async () => {
    setLoadingChannels(true);
    console.log('%c[UNAI-WA] CHANNELS_DISCOVER', 'color:#25D366;font-weight:bold', { session: account.sessionIdentifier });
    try {
      const res = await fetchApi(`/api/channels/discover?session_identifier=${account.sessionIdentifier}`);
      const data = res?.data || [];
      console.log('%c[UNAI-WA] CHANNELS_FOUND', 'color:#25D366;font-weight:bold', { count: data.length, channels: data });
      if (data.length > 0) {
        saveChannelsList(data);
        if (!selectedChannel) setSelectedChannel(data[0]);
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

    console.log('%c[UNAI-WA] RESOLVE_CHANNEL', 'color:#25D366;font-weight:bold', { input });
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
        console.log('%c[UNAI-WA] RESOLVE_CHANNEL_SUCCESS', 'color:#16a34a;font-weight:bold', newCh);
        const existingWithoutThis = channels.filter(c => c.id !== newCh.id);
        const updated = [newCh, ...existingWithoutThis];
        saveChannelsList(updated);
        setSelectedChannel(newCh);
        setChannelLinkInput('');
        setActiveTab('publish');
      } else {
        setResolveError('Channel not found. Please verify the URL.');
      }
    } catch (e: any) {
      console.error('[UNAI-WA] RESOLVE_CHANNEL_ERROR', e);
      setResolveError(e.message || 'Failed to link channel. Make sure your WhatsApp account has access.');
    } finally {
      setResolvingLink(false);
    }
  };

  const handlePublish = async () => {
    if (!publishText.trim() || !selectedChannel) return;
    setPublishing(true);
    setPublishResult(null);

    const channelJid = selectedChannel.id || selectedChannel.jid || selectedChannel.newsletter_id;
    console.log('%c[UNAI-WA] PUBLISH', 'color:#f59e0b;font-weight:bold', {
      channel: channelJid,
      channelName: selectedChannel.name,
      text: publishText.slice(0, 50),
      type: 'text',
    });

    try {
      const res = await fetchApi('/api/channels/publish-direct', {
        method: 'POST',
        body: JSON.stringify({
          session_identifier: account.sessionIdentifier,
          channel_jid: channelJid,
          type: 'text',
          text: publishText,
        }),
      });
      console.log('%c[UNAI-WA] PUBLISH_SUCCESS', 'color:#16a34a;font-weight:bold', res);
      setPublishResult({ success: true, data: res.data });
      setPublishText('');
    } catch (e: any) {
      console.error('[UNAI-WA] PUBLISH_FAILED', e);
      setPublishResult({ success: false, error: e.message });
    } finally {
      setPublishing(false);
    }
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
          <button className="btn-secondary" onClick={onRefresh}>
            <RefreshCw size={15} /> <span>Refresh</span>
          </button>
          <button className="btn-secondary" style={{ color: '#ef4444', borderColor: '#fecaca' }} onClick={onDisconnect}>
            Disconnect
          </button>
        </div>
      </div>

      {/* Status Banner */}
      <div className="card p-4 mb-4" style={{ backgroundColor: '#f0fdf4', borderLeft: '4px solid #25D366' }}>
        <div className="flex items-center gap-3">
          <div style={{ width: 48, height: 48, borderRadius: '50%', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CheckCircle2 size={24} style={{ color: '#25D366' }} />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-lg text-main">{account.name || 'WhatsApp Account'}</span>
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

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-4 p-1 rounded-lg" style={{ backgroundColor: '#f1f5f9' }}>
        {(['overview', 'channels', 'publish'] as const).map((tab) => (
          <button key={tab} onClick={() => { setActiveTab(tab); if (tab === 'channels' && channels.length === 0) discoverChannels(); }}
            className="flex-1 py-2 px-3 rounded-md text-sm font-medium transition-all"
            style={{
              backgroundColor: activeTab === tab ? '#fff' : 'transparent',
              color: activeTab === tab ? '#111' : '#6b7280',
              boxShadow: activeTab === tab ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            }}>
            {tab === 'overview' ? '📊 Overview' : tab === 'channels' ? '📢 Channels' : '✍️ Publish'}
          </button>
        ))}
      </div>

      {/* ── TAB: Overview ── */}
      {activeTab === 'overview' && (
        <>
          <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Link2 size={16} style={{ color: '#3b82f6' }} />
                <span className="text-sm font-semibold">API URL</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs p-2 rounded" style={{ backgroundColor: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {account.apiUrl}
                </code>
                <button onClick={() => copyToClipboard(account.apiUrl, 'API URL')} className="p-1.5 rounded hover:bg-gray-100"><Copy size={14} /></button>
              </div>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Key size={16} style={{ color: '#f59e0b' }} />
                <span className="text-sm font-semibold">API Token</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs p-2 rounded" style={{ backgroundColor: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {showToken ? account.apiToken : '••••••••••••••••••••••'}
                </code>
                <button onClick={() => setShowToken(!showToken)} className="p-1.5 rounded hover:bg-gray-100">
                  {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button onClick={() => copyToClipboard(account.apiToken, 'Token')} className="p-1.5 rounded hover:bg-gray-100"><Copy size={14} /></button>
              </div>
            </div>
          </div>
          <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity size={16} style={{ color: '#8b5cf6' }} />
                <span className="text-sm font-semibold">Webhook URL</span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs p-2 rounded" style={{ backgroundColor: '#f1f5f9', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {account.webhookUrl}
                </code>
                <button onClick={() => copyToClipboard(account.webhookUrl, 'Webhook')} className="p-1.5 rounded hover:bg-gray-100"><Copy size={14} /></button>
              </div>
            </div>
            <div className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <Settings size={16} style={{ color: '#6b7280' }} />
                <span className="text-sm font-semibold">Session</span>
              </div>
              <div className="text-xs text-secondary space-y-1">
                <div className="flex justify-between"><span>Session</span><code>{account.sessionIdentifier?.slice(0, 20)}...</code></div>
                <div className="flex justify-between"><span>Provider</span><span>WhatsApp Web (Baileys)</span></div>
                <div className="flex justify-between"><span>Gateway</span><span style={{ color: gatewayHealth?.ok ? '#16a34a' : '#ef4444' }}>{gatewayHealth?.ok ? '● Online' : '○ Offline'}</span></div>
              </div>
            </div>
          </div>
          <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr 1fr 1fr' }}>
            {[
              { label: 'Status', value: 'Active', color: '#16a34a', icon: Wifi },
              { label: 'Messages', value: '0', color: '#3b82f6', icon: MessageCircle },
              { label: 'Requests', value: '0', color: '#8b5cf6', icon: Activity },
              { label: 'Uptime', value: gatewayHealth?.ok ? `${Math.floor((gatewayHealth as any)?.uptime_seconds / 60 || 0)}m` : '-', color: '#f59e0b', icon: Clock },
            ].map((s) => (
              <div key={s.label} className="card p-4 text-center">
                <s.icon size={20} className="mx-auto mb-2" style={{ color: s.color }} />
                <div className="text-lg font-bold">{s.value}</div>
                <div className="text-xs text-secondary">{s.label}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── TAB: Channels ── */}
      {activeTab === 'channels' && (
        <div className="space-y-4">
          {/* Link Channel by URL */}
          <div className="card p-5" style={{ backgroundColor: '#fafffe', border: '1px solid #bbf7d0' }}>
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
                <span>Link Channel</span>
              </button>
            </div>
            {resolveError && (
              <p className="text-xs text-red-600 mt-2">{resolveError}</p>
            )}
          </div>

          {/* Channels List */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold">Your WhatsApp Channels</h3>
              <button onClick={discoverChannels} disabled={loadingChannels}
                className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50 flex items-center gap-1">
                <RefreshCw size={12} className={loadingChannels ? 'animate-spin' : ''} />
                {loadingChannels ? 'Discovering...' : 'Auto-Discover'}
              </button>
            </div>

            {loadingChannels && channels.length === 0 ? (
              <div className="text-center py-8">
                <Loader2 size={24} className="animate-spin mx-auto mb-2" style={{ color: '#25D366' }} />
                <p className="text-sm text-gray-500">Discovering your WhatsApp Channels...</p>
              </div>
            ) : channels.length === 0 ? (
              <div className="text-center py-8">
                <MessageCircle size={32} className="mx-auto mb-3" style={{ color: '#d1d5db' }} />
                <p className="text-sm text-gray-500 mb-1">No channels linked yet.</p>
                <p className="text-xs text-gray-400 mb-3">Paste your channel link above or click "Auto-Discover" to find channels you own or administer.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {channels.map((ch: any, idx: number) => (
                  <div key={ch.id || idx}
                    className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all hover:shadow-sm"
                    style={{
                      borderColor: selectedChannel?.id === ch.id ? '#25D366' : '#e5e7eb',
                      backgroundColor: selectedChannel?.id === ch.id ? '#f0fdf4' : '#fff',
                    }}
                    onClick={() => { setSelectedChannel(ch); setActiveTab('publish'); }}>
                    <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <MessageCircle size={16} style={{ color: '#25D366' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm truncate">{ch.name || ch.subject || `Channel ${idx + 1}`}</span>
                        {ch.role && <span className="chip chip-success" style={{ fontSize: 9 }}>{ch.role.toUpperCase()}</span>}
                      </div>
                      <div className="text-xs text-gray-500 truncate">{ch.id || ch.jid || ch.newsletter_id}</div>
                    </div>
                    <div className="text-xs text-gray-400">{ch.subscribers_count || ch.followers || 0} subscribers</div>
                    <span className="text-xs text-green-600 font-medium">Select →</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB: Publish ── */}
      {activeTab === 'publish' && (
        <div className="card p-5">
          <h3 className="font-bold mb-4">Publish to Channel</h3>

          {!selectedChannel ? (
            <div className="text-center py-8">
              <p className="text-sm text-gray-500 mb-3">Select a channel first</p>
              <button onClick={() => { setActiveTab('channels'); if (channels.length === 0) discoverChannels(); }}
                className="px-4 py-2 text-sm text-white rounded" style={{ backgroundColor: '#25D366' }}>
                Discover Channels
              </button>
            </div>
          ) : (
            <>
              {/* Selected Channel */}
              <div className="flex items-center gap-3 p-3 rounded-lg mb-4" style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', backgroundColor: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <MessageCircle size={16} style={{ color: '#25D366' }} />
                </div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">{selectedChannel.name || selectedChannel.subject || 'Channel'}</div>
                  <div className="text-xs text-gray-500">{selectedChannel.id || selectedChannel.jid}</div>
                </div>
                <button onClick={() => setActiveTab('channels')} className="text-xs text-blue-600 hover:underline">Change</button>
              </div>

              {/* Composer */}
              <div className="mb-3">
                <label className="block text-sm font-medium mb-1">Message</label>
                <textarea
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  rows={4}
                  placeholder="Type your message to publish to this channel..."
                  value={publishText}
                  onChange={(e) => setPublishText(e.target.value)}
                />
              </div>

              <button onClick={handlePublish} disabled={publishing || !publishText.trim()}
                className="w-full py-2.5 text-white rounded-lg font-medium flex items-center justify-center gap-2 disabled:opacity-50"
                style={{ backgroundColor: '#25D366' }}>
                {publishing ? <><Loader2 size={16} className="animate-spin" /> Publishing...</> : <><MessageCircle size={16} /> Publish to Channel</>}
              </button>

              {/* Result */}
              {publishResult && (
                <div className="mt-3 p-3 rounded-lg text-sm" style={{
                  backgroundColor: publishResult.success ? '#f0fdf4' : '#fef2f2',
                  border: `1px solid ${publishResult.success ? '#bbf7d0' : '#fecaca'}`,
                }}>
                  {publishResult.success ? (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 size={16} style={{ color: '#16a34a' }} />
                      <span className="text-green-700">Published successfully!</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <XCircle size={16} style={{ color: '#ef4444' }} />
                      <span className="text-red-700">{publishResult.error || 'Publish failed'}</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
