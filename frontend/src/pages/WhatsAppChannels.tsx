import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Loader2,
  CheckCircle2,
  ShieldCheck,
  RefreshCw,
  Plus,
  ExternalLink,
  MessageCircle,
  AlertTriangle,
  XCircle,
  Wifi,
  WifiOff,
  Clock,
  QrCode,
} from 'lucide-react';
import { fetchApi } from '../lib/apiClient';
import { supabase } from '../lib/supabaseClient';

// ── Constants ──
const POLL_INTERVAL_MS = 6000; // 6-second fallback polling
const MAX_POLL_COUNT = 50; // Stop after ~5 minutes
const QR_EXPIRE_SECONDS = 55; // Show expiry slightly before actual 60s

// ── Types ──
type WizardStep = 'start' | 'connecting' | 'channels' | 'confirm' | 'success';
type SessionStatus =
  | 'CREATING'
  | 'INITIALIZING'
  | 'WAITING_FOR_SCAN'
  | 'PAIRING'
  | 'AUTHENTICATED'
  | 'SYNCING'
  | 'READY'
  | 'CONNECTED'
  | 'DISCONNECTED'
  | 'RECONNECTING'
  | 'EXPIRED'
  | 'ERROR';

interface GatewayHealth {
  ok: boolean;
  gateway_url?: string;
  service?: string;
  status?: string;
  version?: string;
  active_sessions?: number;
  error?: string;
}

export default function WhatsAppChannels() {
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  // ── Modal / Wizard State ──
  const [isWaModalOpen, setIsWaModalOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>('start');
  const [waState, setWaState] = useState<SessionStatus>('CREATING');
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrExpiresIn, setQrExpiresIn] = useState<number>(QR_EXPIRE_SECONDS);
  const [channels, setChannels] = useState<any[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<any>(null);
  const [waError, setWaError] = useState('');
  const [waErrorCode, setWaErrorCode] = useState('');
  const [gatewayHealth, setGatewayHealth] = useState<GatewayHealth | null>(null);
  const [channelName, setChannelName] = useState('');
  const [channelDescription, setChannelDescription] = useState('');

  // ── Refs ──
  const sessionRef = useRef<string | null>(null);
  const pollCountRef = useRef(0);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const qrTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const realtimeChannelRef = useRef<any>(null);

  // ── Cleanup on unmount ──
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopPolling();
      stopQrTimer();
      unsubscribeRealtime();
    };
  }, []);

  // ── Utility Functions ──

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    pollCountRef.current = 0;
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


  // ── Gateway Health Check ──
  const checkGatewayHealth = async (): Promise<GatewayHealth> => {
    try {
      const res = await fetchApi('/api/whatsapp/gateway/health');
      if (mountedRef.current) setGatewayHealth(res);
      return res;
    } catch {
      const fallback: GatewayHealth = { ok: false, error: 'Failed to check gateway health' };
      if (mountedRef.current) setGatewayHealth(fallback);
      return fallback;
    }
  };

  // ── QR Expiration Timer ──
  const startQrTimer = useCallback(() => {
    stopQrTimer();
    setQrExpiresIn(QR_EXPIRE_SECONDS);
    qrTimerRef.current = setInterval(() => {
      setQrExpiresIn((prev) => {
        if (prev <= 1) {
          stopQrTimer();
          setQrCode(null);
          setWaState('EXPIRED');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [stopQrTimer]);

  // ── Poll Session Status (Fallback) ──
  const pollStatus = useCallback(async () => {
    if (!sessionRef.current || !mountedRef.current) return;

    pollCountRef.current += 1;
    if (pollCountRef.current > MAX_POLL_COUNT) {
      stopPolling();
      if (mountedRef.current) {
        setWaState('ERROR');
        setWaError('Connection timed out. The gateway may be unavailable.');
        setWaErrorCode('TIMEOUT');
      }
      return;
    }

    try {
      const res = await fetchApi(
        `/api/whatsapp/status?session_identifier=${sessionRef.current}`
      );
      if (!mountedRef.current) return;

      const data = res.data;
      if (!data) return;

      const newStatus = data.status as SessionStatus;
      setWaState(newStatus);

      // Surface gateway errors
      if (data.gateway_error && !data.gateway_reachable) {
        setWaError(`Gateway: ${data.gateway_error}`);
      }

      // Handle QR delivery
      if (data.pairing && newStatus === 'WAITING_FOR_SCAN') {
        setQrCode(data.pairing);
        startQrTimer();
        setWizardStep('connecting');
      }

      // Handle authentication
      if (newStatus === 'CONNECTED' || newStatus === 'READY' || newStatus === 'AUTHENTICATED') {
        stopPolling();
        stopQrTimer();
        setWizardStep('channels');
        loadWaChannels();
      }

      // Handle errors
      if (newStatus === 'ERROR') {
        stopPolling();
        stopQrTimer();
        setWaError(data.error || data.gateway_error || 'Connection failed.');
      }
    } catch {
      // Ignore individual poll errors — will retry on next tick
    }
  }, [startQrTimer, stopPolling, stopQrTimer]);

  const startPolling = useCallback(() => {
    stopPolling();
    pollCountRef.current = 0;
    pollIntervalRef.current = setInterval(pollStatus, POLL_INTERVAL_MS);
    // Also do an immediate poll
    pollStatus();
  }, [pollStatus, stopPolling]);

  // ── Supabase Realtime Subscription ──
  const subscribeRealtime = useCallback(
    (sessionIdentifier: string) => {
      unsubscribeRealtime();

      const channel = supabase
        .channel(`wa-session-${sessionIdentifier}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'whatsapp_sessions',
            filter: `session_identifier=eq.${sessionIdentifier}`,
          },
          (payload: any) => {
            if (!mountedRef.current) return;

            const newRow = payload.new;
            const newStatus = newRow?.status as SessionStatus;
            if (!newStatus) return;

            setWaState(newStatus);

            if (
              newStatus === 'CONNECTED' ||
              newStatus === 'READY' ||
              newStatus === 'AUTHENTICATED'
            ) {
              stopPolling();
              stopQrTimer();
              setWizardStep('channels');
              loadWaChannels();
            }

            if (newStatus === 'WAITING_FOR_SCAN') {
              setWizardStep('connecting');
              // QR data comes from polling /status (not stored in DB for security)
              // Trigger an immediate poll to fetch QR
              pollStatus();
            }

            if (newStatus === 'ERROR' || newStatus === 'DISCONNECTED') {
              stopPolling();
              stopQrTimer();
            }
          }
        )
        .subscribe();

      realtimeChannelRef.current = channel;
    },
    [unsubscribeRealtime, stopPolling, stopQrTimer, pollStatus]
  );

  // ── Channel Loading ──
  const loadWaChannels = async () => {
    try {
      const res = await fetchApi('/api/channels');
      if (mountedRef.current && res.data) setChannels(res.data);
    } catch (e) {
      console.error('Failed to load channels:', e);
    }
  };

  // ── Connection Wizard Handlers ──

  const handleStartChannel = async () => {
    setWizardStep('connecting');
    setWaState('INITIALIZING');
    setQrCode(null);
    setWaError('');
    setWaErrorCode('');

    // Check gateway health first
    const health = await checkGatewayHealth();
    if (!health.ok) {
      setWaState('ERROR');
      setWaError(
        `WhatsApp gateway is currently unavailable. ${health.error || ''}`
      );
      setWaErrorCode('WHATSAPP_GATEWAY_UNAVAILABLE');
      return;
    }

    try {
      const res = await fetchApi('/api/whatsapp/connect', {
        method: 'POST',
        body: JSON.stringify(
          sessionRef.current
            ? { session_identifier: sessionRef.current }
            : {}
        ),
      });

      const data = res.data;
      if (!data) {
        setWaState('ERROR');
        setWaError('No response from server.');
        return;
      }

      // Store session identifier
      if (data.session_identifier) {
        sessionRef.current = data.session_identifier;
      }

      // Check for gateway unavailable error
      if (data.code === 'WHATSAPP_GATEWAY_UNAVAILABLE') {
        setWaState('ERROR');
        setWaError(data.error || 'WhatsApp gateway is currently unavailable.');
        setWaErrorCode(data.code);
        return;
      }

      if (data.code === 'WHATSAPP_SESSION_CREATE_FAILED') {
        setWaState('ERROR');
        setWaError(data.error || 'Failed to create WhatsApp session.');
        setWaErrorCode(data.code);
        return;
      }

      setWaState(data.status || 'INITIALIZING');

      if (data.status === 'WAITING_FOR_SCAN' && data.pairing) {
        setQrCode(data.pairing);
        startQrTimer();
      } else if (data.status === 'CONNECTED' || data.status === 'READY') {
        setWizardStep('channels');
        loadWaChannels();
        return;
      }

      // Subscribe to realtime updates
      if (sessionRef.current) {
        subscribeRealtime(sessionRef.current);
      }
      // Start fallback polling
      startPolling();
    } catch (e: any) {
      setWaState('ERROR');
      setWaError(e.message || 'Failed to connect. Please try again.');
    }
  };

  const handleRefreshQR = async () => {
    setWaState('INITIALIZING');
    setQrCode(null);
    stopQrTimer();

    // Trigger reconnect by calling connect again with same session
    try {
      const res = await fetchApi('/api/whatsapp/connect', {
        method: 'POST',
        body: JSON.stringify({ session_identifier: sessionRef.current }),
      });
      const data = res.data;
      if (data?.status === 'WAITING_FOR_SCAN' && data.pairing) {
        setWaState('WAITING_FOR_SCAN');
        setQrCode(data.pairing);
        startQrTimer();
      } else {
        setWaState(data?.status || 'INITIALIZING');
        startPolling();
      }
    } catch (e: any) {
      setWaState('ERROR');
      setWaError(e.message || 'Failed to refresh QR code.');
    }
  };

  const handleSyncChannels = async () => {
    try {
      setWaState('SYNCING');
      const res = await fetchApi('/api/channels/sync', {
        method: 'POST',
        body: JSON.stringify({ session_identifier: sessionRef.current }),
      });
      if (mountedRef.current && res.data) setChannels(res.data);
      setWaState('CONNECTED');
    } catch {
      setWaState('ERROR');
      setWaError('Failed to sync channels.');
    }
  };

  const handleSelectChannel = async (ch: any) => {
    try {
      await fetchApi(`/api/channels/${ch.id}/select`, {
        method: 'POST',
        body: JSON.stringify({ session_identifier: sessionRef.current }),
      });
      setSelectedChannel(ch);
      setWizardStep('confirm');
    } catch {
      setWaError('Failed to select channel.');
    }
  };

  const handleFinish = () => {
    setWizardStep('success');
    loadConnections();
  };

  const handleCloseModal = () => {
    setIsWaModalOpen(false);
    stopPolling();
    stopQrTimer();
    unsubscribeRealtime();
  };

  // ── Load connections from Supabase ──
  const loadConnections = async () => {
    try {
      const res = await fetchApi('/connections');
      if (mountedRef.current) setConnections(res.connections || []);
    } catch {
      if (mountedRef.current) setConnections([]);
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    loadConnections();
  }, []);

  // ── Handlers ──
  const handleConnect = (platformId: string) => {
    if (platformId === 'whatsapp') {
      setIsWaModalOpen(true);
      setWizardStep('start');
      setWaState('CREATING');
      setQrCode(null);
      setWaError('');
      setWaErrorCode('');
      setChannelName('');
      setChannelDescription('');
      checkGatewayHealth();
    }
  };

  const handleDisconnect = async (platformId: string) => {
    if (!confirm(`Are you sure you want to disconnect ${platformId}?`)) return;
    try {
      if (platformId === 'whatsapp' && sessionRef.current) {
        await fetchApi('/api/whatsapp/disconnect', {
          method: 'POST',
          body: JSON.stringify({ session_identifier: sessionRef.current }),
        });
      }
      await fetchApi(`/connections/${platformId}`, { method: 'DELETE' });
      setConnections((prev) => prev.filter((c) => c.platform !== platformId));
    } catch {
      alert('Failed to disconnect platform.');
    }
  };

  const handleTestSync = async (platformId: string) => {
    try {
      const res = await fetchApi(`/connections/${platformId}/test`);
      if (res.success) {
        alert(`✅ ${res.message || `Test sync succeeded for ${platformId}!`}`);
      } else {
        alert(`⚠️ ${res.message || 'Test sync issue. Please reconnect.'}`);
      }
    } catch {
      alert(`Failed to test sync for ${platformId}.`);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadConnections();
  };

  // ── Platform definitions ──
  const platforms = [
    {
      id: 'whatsapp',
      name: 'WhatsApp Channels',
      subtitle: 'WhatsApp Official API',
      icon: <MessageCircle size={22} />,
      description:
        'Connect your WhatsApp account to publish to Channels.',
      color: '#25D366',
      bgColor: '#dcfce7',
    },
  ];

  if (loading) {
    return (
      <div
        className="flex items-center justify-center"
        style={{ minHeight: '60vh' }}
      >
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  // ── Status Display Helper ──
  const getStatusDisplay = (status: SessionStatus) => {
    const map: Record<string, { label: string; color: string; icon: any }> = {
      CREATING: { label: 'Creating session...', color: '#6b7280', icon: Loader2 },
      INITIALIZING: { label: 'Initializing secure session...', color: '#3b82f6', icon: Loader2 },
      WAITING_FOR_SCAN: { label: 'Scan QR Code', color: '#16a34a', icon: QrCode },
      PAIRING: { label: 'Pairing device...', color: '#f59e0b', icon: Loader2 },
      AUTHENTICATED: { label: 'Authenticated!', color: '#16a34a', icon: CheckCircle2 },
      SYNCING: { label: 'Syncing channels...', color: '#3b82f6', icon: Loader2 },
      READY: { label: 'Connected & Ready', color: '#16a34a', icon: CheckCircle2 },
      CONNECTED: { label: 'Connected', color: '#16a34a', icon: CheckCircle2 },
      DISCONNECTED: { label: 'Disconnected', color: '#ef4444', icon: WifiOff },
      RECONNECTING: { label: 'Reconnecting...', color: '#f59e0b', icon: RefreshCw },
      EXPIRED: { label: 'QR Code Expired', color: '#f59e0b', icon: Clock },
      ERROR: { label: 'Error', color: '#ef4444', icon: XCircle },
    };
    return map[status] || map.ERROR;
  };

  return (
    <div
      className="container"
      style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-main">WhatsApp Channels</h1>
          <p className="text-sm text-secondary mt-1">
            Manage your dedicated WhatsApp Channel API gateway.
          </p>
        </div>
        <button
          className="btn-secondary"
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Security Banner */}
      <div
        className="card flex items-center gap-3 p-4 mb-6"
        style={{ backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }}
      >
        <ShieldCheck size={20} style={{ color: '#16a34a', flexShrink: 0 }} />
        <div>
          <p className="text-sm font-semibold text-main">
            Official End-to-End Encrypted Connections
          </p>
          <p className="text-xs text-secondary">
            All connection tokens and sessions are encrypted at rest with
            AES-256.
          </p>
        </div>
      </div>

      {/* Platform Cards */}
      <div className="flex flex-col gap-4">
        {platforms.map((platform) => {
          const account = connections.find(
            (c: any) => c.platform === platform.id
          );
          const connected =
            Boolean(account) && account?.status !== 'revoked';

          return (
            <div
              key={platform.id}
              className="card flex items-center justify-between p-5"
              style={{
                borderLeft: `4px solid ${connected ? platform.color : '#e2e8f0'}`,
                transition: 'border-color 0.2s ease',
              }}
            >
              <div className="flex items-center gap-4">
                <div
                  style={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '12px',
                    backgroundColor: platform.bgColor,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: platform.color,
                    flexShrink: 0,
                  }}
                >
                  {platform.icon}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-base text-main">
                      {platform.name}
                    </h4>
                    {connected && (
                      <span className="chip chip-success">
                        <CheckCircle2 size={12} /> Connected
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-secondary mt-1">
                    {platform.description}
                  </p>
                  {connected && (
                    <div className="flex items-center gap-4 mt-3 text-xs text-muted">
                      {account?.platform_account_name && (
                        <span>
                          Channel:{' '}
                          <strong className="text-main">
                            {account.platform_account_name}
                          </strong>
                        </span>
                      )}
                      <span>
                        Status:{' '}
                        <strong className="text-success">Active</strong>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                {connected ? (
                  <>
                    <button
                      className="btn-secondary"
                      onClick={() => handleTestSync(platform.id)}
                    >
                      <ExternalLink size={15} />
                      <span>Test Sync</span>
                    </button>
                    <button
                      className="btn-secondary"
                      style={{
                        color: '#ef4444',
                        borderColor: '#fecaca',
                      }}
                      onClick={() => handleDisconnect(platform.id)}
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    className="btn-primary"
                    disabled={isWaModalOpen}
                    style={{
                      backgroundColor:
                        platform.id === 'whatsapp'
                          ? '#25D366'
                          : undefined,
                    }}
                    onClick={() => handleConnect(platform.id)}
                  >
                    <Plus size={16} />
                    <span>Connect Channel</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ═══════════════════════════════════════════════════════════ */}
      {/* WhatsApp Connection Wizard Modal                          */}
      {/* ═══════════════════════════════════════════════════════════ */}
      {isWaModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden relative"
            style={{ maxHeight: '90vh', overflowY: 'auto' }}
          >
            {/* Close button */}
            <button
              onClick={handleCloseModal}
              className="absolute top-4 right-4 text-gray-500 hover:bg-gray-100 p-1 rounded z-10"
            >
              ×
            </button>

            {/* Progress Steps */}
            <div
              className="flex items-center justify-center gap-2 p-4 border-b"
              style={{ backgroundColor: '#fafafa' }}
            >
              {['Start', 'Connect', 'Channels', 'Done'].map((label, idx) => {
                const stepOrder: WizardStep[] = [
                  'start',
                  'connecting',
                  'channels',
                  'success',
                ];
                const currentIdx = stepOrder.indexOf(wizardStep);
                const isConfirm = wizardStep === 'confirm';
                const effectiveIdx = isConfirm ? 2 : currentIdx;
                const isActive = idx <= effectiveIdx;
                return (
                  <div key={label} className="flex items-center gap-1">
                    <div
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 11,
                        fontWeight: 700,
                        backgroundColor: isActive
                          ? '#25D366'
                          : '#e5e7eb',
                        color: isActive ? '#fff' : '#9ca3af',
                        transition: 'all 0.2s',
                      }}
                    >
                      {idx + 1}
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        color: isActive ? '#111' : '#9ca3af',
                        fontWeight: isActive ? 600 : 400,
                      }}
                    >
                      {label}
                    </span>
                    {idx < 3 && (
                      <div
                        style={{
                          width: 20,
                          height: 2,
                          backgroundColor: isActive
                            ? '#25D366'
                            : '#e5e7eb',
                          transition: 'all 0.2s',
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="p-6">
              {/* ── STEP 1: Start Channel ── */}
              {wizardStep === 'start' && (
                <div>
                  <h2 className="text-xl font-bold mb-4">Start Channel</h2>

                  {/* Gateway health indicator */}
                  <div
                    className="flex items-center gap-2 p-3 rounded-lg mb-4"
                    style={{
                      backgroundColor: gatewayHealth?.ok
                        ? '#f0fdf4'
                        : '#fef2f2',
                      border: `1px solid ${gatewayHealth?.ok ? '#bbf7d0' : '#fecaca'}`,
                    }}
                  >
                    {gatewayHealth?.ok ? (
                      <Wifi size={16} style={{ color: '#16a34a' }} />
                    ) : (
                      <WifiOff size={16} style={{ color: '#ef4444' }} />
                    )}
                    <span className="text-xs">
                      Gateway:{' '}
                      <strong>
                        {gatewayHealth?.ok
                          ? `Online (${gatewayHealth.gateway_url?.includes('localhost') ? 'Local' : 'Cloud'})`
                          : 'Unavailable'}
                      </strong>
                    </span>
                  </div>

                  <div className="flex flex-col gap-3 mb-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Channel Name
                      </label>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        placeholder="My WhatsApp Channel"
                        value={channelName}
                        onChange={(e) => setChannelName(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1">
                        Description (optional)
                      </label>
                      <input
                        type="text"
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                        placeholder="Channel description"
                        value={channelDescription}
                        onChange={(e) =>
                          setChannelDescription(e.target.value)
                        }
                      />
                    </div>
                  </div>

                  <button
                    className="w-full py-2.5 text-white rounded-lg font-medium"
                    style={{ backgroundColor: '#25D366' }}
                    onClick={handleStartChannel}
                    disabled={!gatewayHealth?.ok}
                  >
                    Create & Connect
                  </button>

                  {!gatewayHealth?.ok && (
                    <p className="text-xs text-red-500 mt-2 text-center">
                      Gateway must be online to connect. Please start the
                      WhatsApp gateway service.
                    </p>
                  )}
                </div>
              )}

              {/* ── STEP 2: Channel Connection (QR / Status) ── */}
              {wizardStep === 'connecting' && (
                <div className="text-center">
                  <h2 className="text-xl font-bold mb-4">
                    Channel Connection
                  </h2>

                  {/* Status indicator */}
                  {(() => {
                    const display = getStatusDisplay(waState);
                    const Icon = display.icon;
                    return (
                      <div
                        className="flex items-center justify-center gap-2 mb-4"
                        style={{ color: display.color }}
                      >
                        <Icon
                          size={16}
                          className={
                            [
                              'CREATING',
                              'INITIALIZING',
                              'PAIRING',
                              'SYNCING',
                              'RECONNECTING',
                            ].includes(waState)
                              ? 'animate-spin'
                              : ''
                          }
                        />
                        <span className="text-sm font-medium">
                          {display.label}
                        </span>
                      </div>
                    );
                  })()}

                  {/* INITIALIZING state */}
                  {waState === 'INITIALIZING' && (
                    <div className="flex flex-col items-center py-6">
                      <Loader2
                        size={32}
                        className="animate-spin mb-4"
                        style={{ color: '#25D366' }}
                      />
                      <p className="text-sm text-gray-600">
                        Waiting for QR code from WhatsApp...
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        This may take up to 30 seconds if the gateway is
                        cold-starting.
                      </p>
                    </div>
                  )}

                  {/* WAITING_FOR_SCAN — QR Display */}
                  {waState === 'WAITING_FOR_SCAN' && (
                    <div className="flex flex-col items-center">
                      <p className="mb-3 text-sm text-gray-600">
                        Scan this QR code with WhatsApp → Linked Devices
                      </p>
                      <div
                        className="p-4 rounded-lg mb-3 flex items-center justify-center"
                        style={{
                          backgroundColor: '#f9fafb',
                          width: 220,
                          height: 220,
                        }}
                      >
                        {qrCode ? (
                          <img
                            src={qrCode}
                            alt="WhatsApp QR Code"
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'contain',
                            }}
                          />
                        ) : (
                          <Loader2 className="animate-spin" />
                        )}
                      </div>

                      {/* QR expiry timer */}
                      <div className="flex items-center gap-1 mb-3">
                        <Clock size={12} style={{ color: '#f59e0b' }} />
                        <span
                          className="text-xs"
                          style={{
                            color:
                              qrExpiresIn < 15 ? '#ef4444' : '#6b7280',
                          }}
                        >
                          Expires in {qrExpiresIn}s
                        </span>
                      </div>

                      <button
                        className="text-xs text-green-600 hover:underline"
                        onClick={handleRefreshQR}
                      >
                        Refresh QR Code
                      </button>
                    </div>
                  )}

                  {/* PAIRING / AUTHENTICATING */}
                  {waState === 'PAIRING' && (
                    <div className="flex flex-col items-center py-6">
                      <Loader2
                        size={32}
                        className="animate-spin mb-4"
                        style={{ color: '#25D366' }}
                      />
                      <p className="font-semibold mb-1">QR Code Scanned!</p>
                      <p className="text-sm text-gray-600 text-center px-4">
                        Authenticating and synchronizing session with
                        WhatsApp. This can take up to 30-45 seconds...
                      </p>
                    </div>
                  )}

                  {/* EXPIRED */}
                  {waState === 'EXPIRED' && (
                    <div className="py-4">
                      <AlertTriangle
                        size={32}
                        className="mx-auto mb-3"
                        style={{ color: '#f59e0b' }}
                      />
                      <p className="text-sm font-medium mb-3">
                        QR code expired.
                      </p>
                      <button
                        onClick={handleRefreshQR}
                        className="px-4 py-2 text-sm text-white rounded"
                        style={{ backgroundColor: '#25D366' }}
                      >
                        Generate New QR
                      </button>
                    </div>
                  )}

                  {/* ERROR */}
                  {waState === 'ERROR' && (
                    <div className="py-4">
                      <XCircle
                        size={32}
                        className="mx-auto mb-3"
                        style={{ color: '#ef4444' }}
                      />
                      <p className="text-sm text-red-600 mb-1 font-medium">
                        {waErrorCode === 'WHATSAPP_GATEWAY_UNAVAILABLE'
                          ? 'WhatsApp gateway unavailable'
                          : waErrorCode === 'TIMEOUT'
                            ? 'Connection timed out'
                            : 'Connection failed'}
                      </p>
                      <p className="text-xs text-gray-500 mb-3">
                        {waError}
                      </p>
                      <div className="flex gap-2 justify-center">
                        <button
                          onClick={handleStartChannel}
                          className="px-4 py-2 text-sm text-white rounded"
                          style={{ backgroundColor: '#25D366' }}
                        >
                          Retry
                        </button>
                        <button
                          onClick={handleCloseModal}
                          className="px-4 py-2 text-sm border rounded"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── STEP 3: Confirm Details / Select Channel ── */}
              {(wizardStep === 'channels' || wizardStep === 'confirm') && (
                <div>
                  <h2 className="text-xl font-bold mb-4">
                    {wizardStep === 'confirm'
                      ? 'Confirm Details'
                      : 'Select Channel'}
                  </h2>

                  {wizardStep === 'confirm' && selectedChannel && (
                    <div className="mb-4">
                      <div
                        className="p-4 rounded-lg"
                        style={{
                          backgroundColor: '#f0fdf4',
                          border: '1px solid #bbf7d0',
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <div
                            style={{
                              width: 40,
                              height: 40,
                              borderRadius: '50%',
                              backgroundColor: '#dcfce7',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            <MessageCircle
                              size={20}
                              style={{ color: '#25D366' }}
                            />
                          </div>
                          <div>
                            <p className="font-semibold text-sm">
                              {selectedChannel.name}
                            </p>
                            <p className="text-xs text-gray-500">
                              {selectedChannel.followers || 0} followers
                            </p>
                            <p className="text-xs text-green-600">
                              ● Connected
                            </p>
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={handleFinish}
                        className="w-full mt-4 py-2.5 text-white rounded-lg font-medium"
                        style={{ backgroundColor: '#25D366' }}
                      >
                        Finish Setup
                      </button>
                    </div>
                  )}

                  {wizardStep === 'channels' && (
                    <>
                      {waState === 'SYNCING' ? (
                        <div className="flex flex-col items-center py-8">
                          <Loader2
                            size={32}
                            className="animate-spin mb-4"
                            style={{ color: '#25D366' }}
                          />
                          <p>Syncing your channels...</p>
                        </div>
                      ) : (
                        <>
                          <p className="text-sm mb-4">
                            Choose the WhatsApp Channel to publish to.
                          </p>
                          {channels.length === 0 ? (
                            <div className="text-center py-4 text-sm text-gray-500">
                              No channels found. Make sure you administer
                              at least one WhatsApp Channel.
                            </div>
                          ) : (
                            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto mb-4">
                              {channels.map((ch) => (
                                <button
                                  key={ch.id}
                                  onClick={() => handleSelectChannel(ch)}
                                  className="text-left p-3 border rounded hover:border-green-500 focus:outline-none focus:ring focus:ring-green-200 transition-colors"
                                >
                                  <div className="font-semibold text-sm">
                                    {ch.name}
                                  </div>
                                  <div className="text-xs text-gray-500">
                                    {ch.followers || ch.subscribers_count || 0}{' '}
                                    followers
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                          <button
                            onClick={handleSyncChannels}
                            className="w-full py-2 text-green-600 border border-green-600 rounded hover:bg-green-50 text-sm"
                          >
                            Sync Channels
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── STEP 4: Success ── */}
              {wizardStep === 'success' && (
                <div className="text-center py-6">
                  <CheckCircle2
                    size={48}
                    className="mx-auto mb-4"
                    style={{ color: '#25D366' }}
                  />
                  <h2 className="text-xl font-bold mb-2">
                    Connected!
                  </h2>
                  <p className="text-gray-600 mb-6">
                    You can now publish to{' '}
                    {selectedChannel?.name || 'your WhatsApp Channel'}.
                  </p>
                  <button
                    onClick={handleCloseModal}
                    className="w-full py-2.5 text-white rounded-lg font-medium"
                    style={{ backgroundColor: '#25D366' }}
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
