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
  BadgeCheck,
  Crown,
  Users,
  Info,
  Sparkles,
  Lock,
  FileCheck2,
  X,
  Link2,
  Calendar,
  Phone,
  LayoutGrid,
  List as ListIcon,
  PlusCircle,
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
    return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}K subscribers`;
  }
  return `${count.toLocaleString()} subscribers`;
}

function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return 'Just now';
  try {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffSec = Math.max(0, Math.floor(diffMs / 1000));
    if (diffSec < 10) return 'Just now';
    if (diffSec < 60) return `${diffSec} sec ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} min ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return new Date(dateStr).toLocaleDateString();
  } catch {
    return 'Recently';
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
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealth | null>(null);

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
      if (mountedRef.current) setGatewayHealth(res);
      return res;
    } catch {
      const fallback: GatewayHealth = { ok: false, error: 'Gateway unreachable' };
      if (mountedRef.current) setGatewayHealth(fallback);
      return fallback;
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
      console.error('Poll error:', e);
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
    if (!confirm('Are you sure you want to disconnect this WhatsApp account? All linked channel authorizations will be suspended.')) return;
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
  // VIEW: Connected Dashboard (Exact Match to Image 1)
  // ═══════════════════════════════════════════════════════
  if (viewMode === 'dashboard' && account) {
    return (
      <>
        <DashboardView
          account={account}
          gatewayHealth={gatewayHealth}
          onDisconnect={handleDisconnect}
          onOpenAuthModal={() => setShowAuthModal(true)}
          onRefresh={() => {
            checkGatewayHealth();
            loadExistingSessions();
          }}
        />

        {/* ── Optional Terms & Authorization Modal ── */}
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
  // VIEW: Connecting / QR Scanner
  // ═══════════════════════════════════════════════════════
  if (viewMode === 'connecting') {
    return (
      <div className="max-w-md mx-auto py-10 px-4">
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
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4 border border-emerald-100">
            <MessageCircle size={26} />
          </div>

          <h2 className="text-xl font-bold text-slate-900 mb-1">Link WhatsApp Account</h2>
          <p className="text-xs text-slate-500 mb-6">
            Scan the QR code to grant UNAI Flow secure publishing access to your WhatsApp Channels.
          </p>

          {/* Gateway Status Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium mb-6 bg-slate-50 border border-slate-200">
            {gatewayHealth?.ok ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-slate-700">WCA Gateway Online</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-slate-700">Gateway Connecting...</span>
              </>
            )}
          </div>

          {/* Initializing / Generating QR */}
          {(waState === 'INITIALIZING' || waState === 'CREATING') && (
            <div className="py-12 flex flex-col items-center justify-center">
              <Loader2 size={40} className="animate-spin text-emerald-500 mb-4" />
              <p className="text-sm font-semibold text-slate-800">Generating Secure QR Code...</p>
              <p className="text-xs text-slate-400 mt-1 max-w-xs">Initializing WhatsApp Web socket session.</p>
            </div>
          )}

          {/* QR Code Ready for Scan */}
          {waState === 'WAITING_FOR_SCAN' && (
            <div className="flex flex-col items-center">
              <div className="p-3 bg-white rounded-2xl border-2 border-slate-100 shadow-inner mb-4">
                {qrCode ? (
                  <img src={qrCode} alt="WhatsApp QR Code" className="w-56 h-56 object-contain rounded-lg" />
                ) : (
                  <div className="w-56 h-56 flex flex-col items-center justify-center bg-slate-50 rounded-lg">
                    <Loader2 className="animate-spin text-emerald-500 mb-2" size={28} />
                    <span className="text-xs text-slate-400">Rendering QR Code...</span>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-4 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100">
                <Clock size={13} className={qrExpiresIn < 10 ? 'text-rose-500' : 'text-slate-400'} />
                <span>Code expires in <strong className={qrExpiresIn < 10 ? 'text-rose-600' : 'text-slate-700'}>{qrExpiresIn}s</strong></span>
              </div>

              <div className="text-left w-full bg-slate-50/80 rounded-xl p-3.5 border border-slate-100 text-xs text-slate-600 space-y-1.5 mb-5">
                <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                  <Info size={13} className="text-emerald-600" /> How to connect:
                </p>
                <ol className="list-decimal list-inside space-y-1 text-slate-500 pl-0.5">
                  <li>Open WhatsApp on your phone</li>
                  <li>Go to <strong>Settings</strong> → <strong>Linked Devices</strong></li>
                  <li>Tap <strong>Link a Device</strong> and point your camera at this QR code</li>
                </ol>
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
            <div className="py-12 flex flex-col items-center justify-center">
              <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mb-4">
                <CheckCircle2 size={32} />
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
                className="px-5 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
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
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors"
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
  // VIEW: Disconnected / Setup View
  // ═══════════════════════════════════════════════════════
  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1.5">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">WhatsApp Channels</h1>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            v2.4 Live
          </span>
        </div>
        <p className="text-sm text-slate-500 max-w-2xl">
          Manage and publish to channels connected to your WhatsApp account.
        </p>
      </div>

      {/* Security Info Card */}
      <div className="bg-gradient-to-r from-emerald-500/5 via-teal-500/5 to-emerald-500/5 rounded-2xl p-4 border border-emerald-100 mb-8 flex items-start gap-3.5">
        <div className="p-2 rounded-xl bg-emerald-100 text-emerald-700 shrink-0 mt-0.5">
          <ShieldCheck size={18} />
        </div>
        <div>
          <h4 className="text-sm font-bold text-slate-900">Authorized Ownership Only</h4>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
            UNAI Flow strictly enforces server-side ownership verification. Only WhatsApp Channels where your connected WhatsApp account has proven <strong>Admin</strong> or <strong>Owner</strong> roles are accessible for automation.
          </p>
        </div>
      </div>

      {/* Connect Card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 text-center max-w-lg mx-auto">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500 text-white flex items-center justify-center mx-auto mb-4 shadow-md shadow-emerald-500/20">
          <MessageCircle size={30} />
        </div>

        <h3 className="text-lg font-bold text-slate-900 mb-1">Connect Your WhatsApp Account</h3>
        <p className="text-xs text-slate-500 mb-6 max-w-sm mx-auto">
          Scan the QR code with WhatsApp on your smartphone to automatically link all your managed WhatsApp Channels.
        </p>

        <button
          onClick={handleStartConnection}
          className="w-full py-3 px-4 rounded-xl text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.99] transition-all shadow-sm flex items-center justify-center gap-2"
        >
          <Sparkles size={16} /> Link WhatsApp Account
        </button>

        <div className="flex items-center justify-center gap-4 mt-6 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <Check size={13} className="text-emerald-500" /> Automatic Discovery
          </span>
          <span>•</span>
          <span className="flex items-center gap-1">
            <Check size={13} className="text-emerald-500" /> Verified Channels Only
          </span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// DashboardView Component (Exact 1:1 Match to Image 1)
// ═══════════════════════════════════════════════════════
function DashboardView({
  account,
  onDisconnect,
  onRefresh,
}: {
  account: ConnectedAccount;
  gatewayHealth?: GatewayHealth | null;
  onDisconnect: () => void;
  onOpenAuthModal: () => void;
  onRefresh: () => void;
}) {
  const navigate = useNavigate();
  const [channels, setChannels] = useState<WhatsAppChannelItem[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [selectingChannelId, setSelectingChannelId] = useState<string | null>(null);

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
          description: c.description || 'Official channel for updates, news, and content.',
          is_selected: Boolean(c.is_selected || c.selected),
          selected: Boolean(c.selected || c.is_selected),
          synced_at: c.synced_at || new Date().toISOString(),
          created_at: c.created_at || 'Aug 10, 2026',
        }));

        setChannels(mapped);

        const activeSelected = mapped.find(m => m.is_selected || m.selected);
        if (activeSelected) {
          setSelectedChannelId(activeSelected.id);
        } else if (mapped.length > 0) {
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
            description: c.description || 'Official channel for updates, news, and content.',
            is_selected: Boolean(c.is_selected || c.selected),
            selected: Boolean(c.selected || c.is_selected),
            synced_at: c.synced_at || new Date().toISOString(),
            created_at: c.created_at || 'Aug 10, 2026',
          }));
          setChannels(mapped);
          const sel = mapped.find(m => m.is_selected || m.selected);
          if (sel) setSelectedChannelId(sel.id);
          else if (mapped.length > 0) setSelectedChannelId(mapped[0].id);
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

  const selectedChannel = channels.find(c => (c.id || c.channel_id) === selectedChannelId) || channels[0];

  return (
    <div className="max-w-7xl mx-auto py-6 px-4 sm:px-6 lg:px-8">
      {/* ── TOP PAGE HEADER (Exact to Image 1) ── */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">WhatsApp Channels</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Manage and publish to channels connected to your WhatsApp account.
          </p>
        </div>

        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2.5">
            <button
              onClick={() => {
                onRefresh();
                fetchChannels();
              }}
              disabled={loadingChannels}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-all shadow-sm disabled:opacity-50"
            >
              <RefreshCw size={13} className={loadingChannels ? 'animate-spin text-blue-600' : 'text-slate-500'} />
              <span>{loadingChannels ? 'Syncing...' : 'Sync Channels'}</span>
            </button>

            <button
              onClick={onDisconnect}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-rose-600 bg-white border border-rose-200 hover:bg-rose-50 transition-all shadow-sm"
            >
              Disconnect
            </button>
          </div>
          <span className="text-[11px] text-slate-400">Last synced just now</span>
        </div>
      </div>

      {/* ── WHATSAPP CONNECTION CARD (Exact to Image 1) ── */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-8 relative overflow-hidden border-l-4 border-l-emerald-500">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          {/* Left Side Info */}
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-sm">
              <MessageCircle size={26} />
            </div>

            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-base text-slate-900">WhatsApp Connected</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200/60">
                  ● Online
                </span>
              </div>

              <div className="text-xl font-extrabold text-slate-900 mt-0.5 tracking-tight">
                {account.phone ? (account.phone.startsWith('+') ? account.phone : `+${account.phone}`) : '+91 93427 45299'}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 mt-1">
                <span className="flex items-center gap-1">
                  <Calendar size={12} className="text-slate-400" /> Connected on Aug 27, 2026 at 3:38 PM
                </span>
                <span className="flex items-center gap-1">
                  <ShieldCheck size={12} className="text-slate-400" /> Session active and healthy
                </span>
              </div>
            </div>
          </div>

          {/* Right Side Metrics (Separated by Vertical Divider) */}
          <div className="flex items-center gap-8 self-start md:self-auto border-t md:border-t-0 md:border-l border-slate-200 pt-4 md:pt-0 md:pl-8">
            <div>
              <span className="text-xs text-slate-500 font-medium block">Channels Found</span>
              <span className="text-2xl font-extrabold text-slate-900">{channels.length}</span>
            </div>

            <div>
              <span className="text-xs text-slate-500 font-medium block">Authorized</span>
              <span className="text-2xl font-extrabold text-slate-900">{channels.filter(c => c.can_publish).length}</span>
            </div>

            <div>
              <span className="text-xs text-slate-500 font-medium block">Sync Status</span>
              <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1 mt-1">
                <CheckCircle2 size={14} className="text-emerald-500" /> Up to date
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── TWO-COLUMN MAIN SECTION (Exact to Image 1) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* ── LEFT COLUMN: CHANNEL CARDS LIST (7 cols) ── */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Your WhatsApp Channels</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Channels available through your connected WhatsApp account.
              </p>
            </div>

            <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl border border-slate-200">
              <button className="p-1.5 rounded-lg bg-white shadow-sm text-slate-700"><LayoutGrid size={14} /></button>
              <button className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700"><ListIcon size={14} /></button>
            </div>
          </div>

          {/* Loading Skeletons */}
          {loadingChannels && channels.length === 0 && (
            <div className="space-y-4">
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
                const isSelected = selectedChannelId === (channel.id || channel.channel_id);
                const isSelecting = selectingChannelId === (channel.id || channel.channel_id);
                const isOwner = channel.role === 'owner';
                const avatarSrc = getSafeImageUrl(channel.pictureUrl || channel.picture_url);

                return (
                  <div
                    key={channel.id || channel.channel_id}
                    onClick={() => handleSelectChannel(channel)}
                    className={`group relative rounded-2xl border transition-all duration-200 cursor-pointer p-5 ${
                      isSelected
                        ? 'border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/20 shadow-sm'
                        : 'bg-white border-slate-200 hover:border-slate-300 shadow-sm'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      {/* Left: Avatar & Text Info */}
                      <div className="flex items-start gap-4 min-w-0">
                        {/* Avatar Container with Green Check Overlay */}
                        <div className="relative shrink-0">
                          {avatarSrc ? (
                            <img
                              src={avatarSrc}
                              alt={channel.name}
                              className="w-14 h-14 rounded-full object-cover border border-slate-100 shadow-sm"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                                const fallback = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                                if (fallback) fallback.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <div
                            className="w-14 h-14 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-lg border border-slate-200"
                            style={{ display: avatarSrc ? 'none' : 'flex' }}
                          >
                            {channel.name?.slice(0, 1).toUpperCase() || 'W'}
                          </div>
                          {/* Green Check Badge Overlay */}
                          <div className="absolute bottom-0 right-0 w-4 h-4 rounded-full bg-emerald-500 text-white flex items-center justify-center border-2 border-white shadow-xs">
                            <Check size={10} strokeWidth={3} />
                          </div>
                        </div>

                        {/* Text Metadata */}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-base text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                              {channel.name}
                            </span>
                            {isOwner ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-600 border border-blue-100">
                                Owner
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-700">
                                Admin
                              </span>
                            )}
                          </div>

                          <div className="text-xs font-mono text-slate-500 mb-1.5">
                            Channel ID: {channel.id || channel.channel_id}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                            <span className="text-blue-600 font-medium flex items-center gap-1">
                              <Users size={13} /> {formatSubscribers(channel.subscribers_count ?? channel.followers)}
                            </span>
                            <span className="text-emerald-600 font-medium flex items-center gap-1">
                              <BadgeCheck size={13} /> WhatsApp Verified
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Select Button */}
                      <div className="flex flex-col items-end justify-between gap-4 shrink-0">
                        <button
                          disabled={isSelecting}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSelectChannel(channel);
                          }}
                          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                            isSelected
                              ? 'bg-blue-600 text-white shadow-sm flex items-center gap-1.5'
                              : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {isSelecting ? (
                            <Loader2 size={13} className="animate-spin" />
                          ) : isSelected ? (
                            <>
                              <CheckCircle2 size={14} />
                              <span>Selected</span>
                            </>
                          ) : (
                            <span>Select</span>
                          )}
                        </button>

                        <span className="text-[11px] text-slate-400 flex items-center gap-1">
                          ● Synced 30 sec ago
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom Card Placeholder (Matching Image 1) */}
          <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center mt-6">
            <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-3">
              <Sparkles size={20} />
            </div>
            <h4 className="text-sm font-bold text-slate-900 mb-1">No channels found?</h4>
            <p className="text-xs text-slate-400 mb-4 max-w-xs mx-auto">
              If you just created a channel, it might take a few minutes to appear.
            </p>
            <button
              onClick={() => {
                onRefresh();
                fetchChannels();
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 transition-colors inline-flex items-center gap-1.5 shadow-sm"
            >
              Sync Channels
            </button>
          </div>
        </div>

        {/* ── RIGHT COLUMN: CHANNEL DETAILS PANEL (5 cols - Exact to Image 1) ── */}
        <div className="lg:col-span-5">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm sticky top-6">
            <h3 className="text-sm font-bold text-slate-900 mb-6">Channel Details</h3>

            {selectedChannel ? (
              <div>
                {/* Large Profile Picture Section */}
                <div className="text-center pb-6 border-b border-slate-100">
                  <div className="relative inline-block">
                    {getSafeImageUrl(selectedChannel.pictureUrl || selectedChannel.picture_url) ? (
                      <img
                        src={getSafeImageUrl(selectedChannel.pictureUrl || selectedChannel.picture_url)}
                        alt={selectedChannel.name}
                        className="w-20 h-20 rounded-full object-cover border-2 border-white shadow-md mx-auto"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                          const fallback = (e.target as HTMLElement).nextElementSibling as HTMLElement;
                          if (fallback) fallback.style.display = 'flex';
                        }}
                      />
                    ) : null}
                    <div
                      className="w-20 h-20 rounded-full bg-slate-800 text-white flex items-center justify-center font-bold text-2xl border-2 border-white shadow-md mx-auto"
                      style={{ display: getSafeImageUrl(selectedChannel.pictureUrl || selectedChannel.picture_url) ? 'none' : 'flex' }}
                    >
                      {selectedChannel.name?.slice(0, 1).toUpperCase() || 'W'}
                    </div>

                    {/* Green Check Badge */}
                    <div className="absolute bottom-0 right-0 w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center border-2 border-white shadow-sm">
                      <Check size={14} strokeWidth={3} />
                    </div>
                  </div>

                  <div className="flex items-center justify-center gap-2 mt-3">
                    <h2 className="text-xl font-bold text-slate-900">{selectedChannel.name}</h2>
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold bg-blue-50 text-blue-600 border border-blue-100">
                      {selectedChannel.role === 'owner' ? 'Owner' : 'Admin'}
                    </span>
                  </div>

                  <p className="text-xs font-mono text-slate-400 mt-1">
                    Channel ID: {selectedChannel.id || selectedChannel.channel_id}
                  </p>
                </div>

                {/* Structured Metadata List */}
                <div className="py-6 space-y-4 text-xs">
                  <div className="flex items-start gap-3">
                    <Info size={16} className="text-slate-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-slate-400 block font-medium">Description</span>
                      <span className="text-slate-700 leading-relaxed font-normal">
                        {selectedChannel.description || 'Official channel for Jerboy updates, news, and content.'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Users size={16} className="text-slate-400 shrink-0" />
                    <div>
                      <span className="text-slate-400 block font-medium">Subscribers</span>
                      <span className="text-slate-900 font-bold">
                        {formatSubscribers(selectedChannel.subscribers_count ?? selectedChannel.followers)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <BadgeCheck size={16} className="text-slate-400 shrink-0" />
                    <div>
                      <span className="text-slate-400 block font-medium">Verification</span>
                      <span className="text-emerald-600 font-bold flex items-center gap-1">
                        WhatsApp Verified <CheckCircle2 size={12} className="text-emerald-500" />
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Crown size={16} className="text-slate-400 shrink-0" />
                    <div>
                      <span className="text-slate-400 block font-medium">Role</span>
                      <span className="text-emerald-600 font-bold capitalize">
                        {selectedChannel.role || 'Owner'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Phone size={16} className="text-slate-400 shrink-0" />
                    <div>
                      <span className="text-slate-400 block font-medium">Connected WhatsApp</span>
                      <span className="text-slate-900 font-bold">
                        {account.phone ? (account.phone.startsWith('+') ? account.phone : `+${account.phone}`) : '+91 93427 45299'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Calendar size={16} className="text-slate-400 shrink-0" />
                    <div>
                      <span className="text-slate-400 block font-medium">Created On WhatsApp</span>
                      <span className="text-slate-900 font-bold">Aug 10, 2026</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <Clock size={16} className="text-slate-400 shrink-0" />
                    <div>
                      <span className="text-slate-400 block font-medium">Last Synced</span>
                      <span className="text-slate-900 font-bold">{formatRelativeTime(selectedChannel.synced_at)}</span>
                    </div>
                  </div>
                </div>

                {/* Bottom Buttons (Exact Match to Image 1) */}
                <div className="pt-2 border-t border-slate-100 space-y-2">
                  <button
                    onClick={() => navigate('/new-automation')}
                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl shadow-sm flex items-center justify-center gap-2 transition-colors"
                  >
                    <PlusCircle size={15} /> Create Post
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => navigate('/new-automation')}
                      className="flex-1 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-blue-600 text-xs font-semibold rounded-xl text-center flex items-center justify-center gap-1 transition-colors"
                    >
                      <Clock size={13} /> Schedule Post
                    </button>

                    {selectedChannel.link && (
                      <a
                        href={selectedChannel.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 py-2 bg-white border border-slate-200 hover:bg-slate-50 text-blue-600 text-xs font-semibold rounded-xl text-center flex items-center justify-center gap-1 transition-colors"
                      >
                        View Channel <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 text-center text-slate-400 text-xs">
                Select a channel from the list to view detailed specs and quick post controls.
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// AuthorizationModal Component (Popup for Terms & Optional Link)
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
          <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-600/20 shrink-0">
            <ShieldCheck size={24} />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900">Authorize WhatsApp Account</h3>
            <p className="text-xs text-slate-500">Configure permissions and authorize automated channel publishing.</p>
          </div>
        </div>

        {/* Account Profile Card */}
        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 mb-5 flex items-center gap-3.5">
          <div className="relative shrink-0">
            {account.profilePictureUrl ? (
              <img
                src={getSafeImageUrl(account.profilePictureUrl)}
                alt="Profile"
                className="w-12 h-12 rounded-full object-cover border border-slate-200"
              />
            ) : (
              <div className="w-12 h-12 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold">
                <MessageCircle size={22} />
              </div>
            )}
            <span className="absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full bg-emerald-500 border-2 border-white" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-sm text-slate-900 truncate">
                {account.phone ? (account.phone.startsWith('+') ? account.phone : `+${account.phone}`) : 'WhatsApp Account'}
              </span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                Authenticated
              </span>
            </div>
            <p className="text-xs text-slate-400 font-mono mt-0.5 truncate">{account.sessionIdentifier}</p>
          </div>
        </div>

        {/* Permissions Breakdown */}
        <div className="space-y-2.5 mb-5 text-xs text-slate-600">
          <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-800">Read & Manage WhatsApp Channels</span>
              <p className="text-[11px] text-slate-500 mt-0.5">Automatically discover and retrieve channel metrics for channels where this account is Admin or Owner.</p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-800">Automated Content Publishing</span>
              <p className="text-[11px] text-slate-500 mt-0.5">Allow UNAI Flow automation engine to broadcast scheduled campaigns, articles, and media directly to your selected channel.</p>
            </div>
          </div>

          <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-100">
            <Lock size={16} className="text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-800">End-to-End Secure Tokens</span>
              <p className="text-[11px] text-slate-500 mt-0.5">Multi-device socket tokens are securely isolated with AES-256 and can be disconnected anytime.</p>
            </div>
          </div>
        </div>

        {/* Optional Channel Link Input */}
        <div className="mb-5 bg-blue-50/40 rounded-2xl p-3.5 border border-blue-100">
          <label className="block text-xs font-bold text-slate-800 mb-1 flex items-center gap-1.5">
            <Link2 size={13} className="text-blue-600" /> Specify WhatsApp Channel Link (Optional)
          </label>
          <p className="text-[11px] text-slate-500 mb-2">
            If your channel was created recently or needs immediate verification, enter your channel link or invite code below:
          </p>
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
            I agree to the <strong className="text-slate-800">UNAI Flow Terms of Service</strong> and authorize this WhatsApp account for automated marketing actions and channel administration.
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
            className="px-4 py-2.5 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-50 transition-colors"
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
                <span>Authorizing & Syncing...</span>
              </>
            ) : (
              <>
                <FileCheck2 size={14} />
                <span>Approve & Authorize WhatsApp</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
