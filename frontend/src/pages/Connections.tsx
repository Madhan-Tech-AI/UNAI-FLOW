import { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, Loader2, CheckCircle2, ShieldCheck, RefreshCw, Plus, ExternalLink, MessageCircle, XCircle, Clock } from 'lucide-react';
import { fetchApi } from '../lib/apiClient';

function Facebook({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

function Twitter({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export default function Connections() {
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  // ── WhatsApp Modal State ──
  const [isWaModalOpen, setIsWaModalOpen] = useState(false);
  const [waState, setWaState] = useState('CREATING');
  const [waQrCode, setWaQrCode] = useState<string | null>(null);
  const [waQrTimer, setWaQrTimer] = useState(30);
  const [waError, setWaError] = useState('');
  const waSessionRef = useRef<string | null>(null);
  const waPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopWaPolling = useCallback(() => {
    if (waPollRef.current) { clearInterval(waPollRef.current); waPollRef.current = null; }
    if (waTimerRef.current) { clearInterval(waTimerRef.current); waTimerRef.current = null; }
  }, []);

  // ── Cleanup on unmount ──
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopWaPolling();
    };
  }, [stopWaPolling]);

  // ── Load connections from Supabase ──
  const loadConnections = async () => {
    try {
      const res = await fetchApi('/connections');
      if (mountedRef.current) setConnections(res.connections || []);
    } catch {
      if (mountedRef.current) setConnections([]);
    } finally {
      if (mountedRef.current) { setLoading(false); setRefreshing(false); }
    }
  };

  useEffect(() => {
    loadConnections();
  }, []);

  // ── WhatsApp In-Page Connection Handlers ──
  const startWhatsAppConnection = async () => {
    setIsWaModalOpen(true);
    setWaState('INITIALIZING');
    setWaQrCode(null);
    setWaError('');
    setWaQrTimer(30);

    try {
      const res = await fetchApi('/api/whatsapp/connect', { method: 'POST', body: JSON.stringify({}) });
      const data = res?.data;
      if (data?.session_identifier) {
        waSessionRef.current = data.session_identifier;
      }

      if (data?.status === 'CONNECTED' || data?.status === 'READY') {
        setWaState('CONNECTED');
        loadConnections();
        setTimeout(() => setIsWaModalOpen(false), 1200);
        return;
      }

      // Start polling
      stopWaPolling();
      const poll = async () => {
        if (!waSessionRef.current || !mountedRef.current) return;
        try {
          const statusRes = await fetchApi(`/api/whatsapp/status?session_identifier=${waSessionRef.current}`);
          const sData = statusRes?.data;
          if (!sData) return;

          setWaState(sData.status);

          if (sData.pairing && sData.status === 'WAITING_FOR_SCAN') {
            setWaQrCode(sData.pairing);
          }

          if (sData.status === 'CONNECTED' || sData.status === 'READY' || sData.status === 'AUTHENTICATED') {
            stopWaPolling();
            loadConnections();
            setTimeout(() => setIsWaModalOpen(false), 1500);
          }

          if (sData.status === 'ERROR') {
            stopWaPolling();
            setWaError(sData.error || 'Connection failed.');
          }
        } catch (e: any) {
          // Retry next tick
        }
      };

      waPollRef.current = setInterval(poll, 4000);
      poll();

      // Countdown timer
      waTimerRef.current = setInterval(() => {
        setWaQrTimer(prev => (prev <= 1 ? 30 : prev - 1));
      }, 1000);

    } catch (err: any) {
      setWaState('ERROR');
      setWaError(err.message || 'Failed to start WhatsApp connection.');
    }
  };

  // ── Handlers ──
  const handleConnect = async (platformId: string) => {
    if (platformId === 'whatsapp') {
      startWhatsAppConnection();
      return;
    }

    try {
      const res = await fetchApi(`/connections/${platformId}/start`, { method: 'POST' });
      if (res.authorization_url) {
        window.location.href = res.authorization_url;
      } else {
        alert("Unable to generate authorization URL. Please try again.");
      }
    } catch (err) {
      console.error(`Error connecting to ${platformId}:`, err);
      alert(`Failed to start connection flow for ${platformId}.`);
    }
  };

  const handleDisconnect = async (platformId: string) => {
    if (!confirm(`Are you sure you want to disconnect ${platformId}?`)) return;
    try {
      if (platformId === 'whatsapp') {
        const waConn = connections.find(c => c.platform === 'whatsapp');
        if (waConn?.platform_account_id) {
          try {
            await fetchApi('/api/whatsapp/disconnect', {
              method: 'POST',
              body: JSON.stringify({ session_identifier: waConn.platform_account_id }),
            });
          } catch (e) {}
        }
      }
      await fetchApi(`/connections/${platformId}`, { method: 'DELETE' });
      setConnections(prev => prev.filter(c => c.platform !== platformId));
    } catch {
      alert("Failed to disconnect platform.");
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

  const handleRefresh = () => { setRefreshing(true); loadConnections(); };

  // ── Platform definitions ──
  const platforms = [
    {
      id: 'whatsapp', name: 'WhatsApp Channels', subtitle: 'WhatsApp Channel API',
      icon: <MessageCircle size={22} />,
      description: 'Connect your WhatsApp account to publish to Channels.',
      color: '#25D366', bgColor: '#dcfce7',
    },
    {
      id: 'instagram', name: 'Instagram', subtitle: 'Instagram Graph API',
      icon: <Camera size={22} />,
      description: 'Post photos, carousels, and captions to your Instagram Business account.',
      color: '#E1306C', bgColor: '#fce7f3',
    },
    {
      id: 'facebook', name: 'Facebook Page', subtitle: 'Facebook Graph API',
      icon: <Facebook size={22} />,
      description: 'Publish posts and media directly to your Facebook Pages.',
      color: '#1877F2', bgColor: '#dbeafe',
    },
    {
      id: 'twitter', name: 'Twitter / X', subtitle: 'Twitter API v2',
      icon: <Twitter size={20} />,
      description: 'Share tweets and threads with real-time media attachments.',
      color: '#0f172a', bgColor: '#f1f5f9',
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}>
        <Loader2 size={32} className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem 1.5rem' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-main">Connections</h1>
          <p className="text-sm text-secondary mt-1">Manage your official social media and messaging channels.</p>
        </div>
        <button className="btn-secondary" onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} />
          <span>Refresh</span>
        </button>
      </div>

      {/* Security Banner */}
      <div className="card flex items-center gap-3 p-4 mb-6" style={{ backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }}>
        <ShieldCheck size={20} style={{ color: '#16a34a', flexShrink: 0 }} />
        <div>
          <p className="text-sm font-semibold text-main">Official End-to-End Encrypted Connections</p>
          <p className="text-xs text-secondary">All connection tokens and sessions are encrypted at rest with AES-256.</p>
        </div>
      </div>

      {/* Platform Cards */}
      <div className="flex flex-col gap-4">
        {platforms.map((platform) => {
          const account = connections.find((c: any) => c.platform === platform.id);
          const connected = Boolean(account) && account?.status !== 'revoked';

          return (
            <div key={platform.id} className="card flex items-center justify-between p-5"
              style={{ borderLeft: `4px solid ${connected ? platform.color : '#e2e8f0'}`, transition: 'border-color 0.2s ease' }}>
              <div className="flex items-center gap-4">
                <div style={{
                  width: '44px', height: '44px', borderRadius: '12px',
                  backgroundColor: platform.bgColor, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: platform.color, flexShrink: 0,
                }}>
                  {platform.icon}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="font-bold text-base text-main">{platform.name}</h4>
                    {connected && <span className="chip chip-success"><CheckCircle2 size={12} /> Connected</span>}
                  </div>
                  <p className="text-sm text-secondary mt-1">{platform.description}</p>
                  {connected && (
                    <div className="flex items-center gap-4 mt-3 text-xs text-muted">
                      {account?.platform_account_name && (
                        <span>Account: <strong className="text-main">{account.platform_account_name}</strong></span>
                      )}
                      <span>Status: <strong className="text-success">Active</strong></span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                {connected ? (
                  <>
                    <button className="btn-secondary" onClick={() => handleTestSync(platform.id)}>
                      <ExternalLink size={15} /><span>Test Sync</span>
                    </button>
                    <button className="btn-secondary" style={{ color: '#ef4444', borderColor: '#fecaca' }} onClick={() => handleDisconnect(platform.id)}>
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button className="btn-primary"
                    style={{ backgroundColor: platform.id === 'whatsapp' ? '#25D366' : undefined }}
                    onClick={() => handleConnect(platform.id)}>
                    <Plus size={16} /><span>Connect Channel</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* WhatsApp Connection Modal */}
      {isWaModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden p-6 relative">
            <button
              onClick={() => { setIsWaModalOpen(false); stopWaPolling(); }}
              className="absolute top-4 right-4 text-gray-500 hover:bg-gray-100 p-1 rounded">
              ✕
            </button>

            <h3 className="text-lg font-bold text-center mb-1">Connect WhatsApp</h3>
            <p className="text-xs text-gray-500 text-center mb-4">
              Open WhatsApp → Settings → Linked Devices → Link a Device
            </p>

            {(waState === 'INITIALIZING' || waState === 'CREATING') && (
              <div className="flex flex-col items-center py-8">
                <Loader2 size={36} className="animate-spin mb-3" style={{ color: '#25D366' }} />
                <p className="text-sm text-gray-600">Generating secure QR code...</p>
              </div>
            )}

            {waState === 'WAITING_FOR_SCAN' && (
              <div className="flex flex-col items-center">
                <div className="p-2 border-2 rounded-xl mb-3" style={{ width: 220, height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {waQrCode ? (
                    <img src={waQrCode} alt="WhatsApp QR Code" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <Loader2 className="animate-spin" style={{ color: '#25D366' }} />
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs text-gray-500 mb-2">
                  <Clock size={12} /> Refreshes in {waQrTimer}s
                </div>
              </div>
            )}

            {(waState === 'CONNECTED' || waState === 'READY' || waState === 'AUTHENTICATED') && (
              <div className="text-center py-6">
                <CheckCircle2 size={44} className="mx-auto mb-2" style={{ color: '#25D366' }} />
                <h4 className="font-bold text-base text-green-700 mb-1">Connected Successfully!</h4>
                <p className="text-xs text-gray-500">Your WhatsApp Channel is now linked.</p>
              </div>
            )}

            {waState === 'ERROR' && (
              <div className="text-center py-4">
                <XCircle size={36} className="mx-auto mb-2 text-red-500" />
                <p className="text-sm font-semibold text-red-600 mb-1">Connection Failed</p>
                <p className="text-xs text-gray-500 mb-3">{waError}</p>
                <button onClick={startWhatsAppConnection} className="px-4 py-1.5 text-xs text-white rounded" style={{ backgroundColor: '#25D366' }}>
                  Retry
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Custom Integration */}
      <div className="card flex items-center justify-between p-6 mt-4"
        style={{ borderStyle: 'dashed', borderColor: '#cbd5e1', backgroundColor: '#f8fafc' }}>
        <div className="flex items-center gap-4">
          <div style={{ width: '44px', height: '44px', borderRadius: '12px', backgroundColor: '#f1f5f9',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }}>
            <Plus size={20} />
          </div>
          <div>
            <h4 className="font-bold text-base text-main">Custom Webhook / Connector</h4>
            <p className="text-sm text-secondary mt-0.5">Need a custom social connector or enterprise webhook integration?</p>
          </div>
        </div>
        <button className="btn-secondary" onClick={() => alert("Custom Webhook connectors available in Enterprise plan.")}>
          Request Connector
        </button>
      </div>

    </div>
  );
}

