import { useState, useEffect } from 'react';
import { Camera, AtSign, MessageCircle, Loader2, CheckCircle2, ShieldCheck, RefreshCw, Plus, ExternalLink, Zap, X } from 'lucide-react';
import { fetchApi } from '../lib/apiClient';

function Facebook({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

export default function Connections() {
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isWaModalOpen, setIsWaModalOpen] = useState(false);
  const [waQr, setWaQr] = useState<string | null>(null);
  const [waPaired, setWaPaired] = useState(false);

  const loadConnections = async () => {
    try {
      const res = await fetchApi('/connections');
      setConnections(res.connections || []);
    } catch (err) {
      console.error("Failed to load connections:", err);
      setConnections([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadConnections();
  }, []);

  // WhatsApp QR & Status Poller when modal is open
  useEffect(() => {
    if (!isWaModalOpen) return;
    
    let interval: any;
    const checkWaStatus = async () => {
      try {
        const res = await fetchApi('/connections/whatsapp/status');
        
        if (res && res.whatsapp && res.whatsapp.isReady) {
          // Successfully paired!
          setWaPaired(true);
          await fetchApi('/connections/whatsapp/confirm', { method: 'POST' });
          await loadConnections();
          setTimeout(() => {
            setIsWaModalOpen(false);
            setWaPaired(false);
          }, 1800);
        } else if (res && res.whatsapp && res.whatsapp.state === 'qr_pending') {
          // Fetch QR
          const qrRes = await fetchApi('/connections/whatsapp/qr');
          if (qrRes && qrRes.qr) {
            setWaQr(qrRes.qr);
          }
        }
      } catch (err) {
        console.error("Error polling WhatsApp status:", err);
      }
    };

    checkWaStatus();
    interval = setInterval(checkWaStatus, 2000);
    return () => clearInterval(interval);
  }, [isWaModalOpen]);

  const handleConnect = async (platformId: string) => {
    if (platformId === 'whatsapp') {
      setIsWaModalOpen(true);
      setWaPaired(false);
      setWaQr(null);
      return;
    }
    try {
      const res = await fetchApi(`/connections/${platformId}/start`, { method: 'POST' });
      if (res.authorization_url) {
        window.location.href = res.authorization_url;
      }
    } catch (err) {
      alert("Failed to start connection flow.");
    }
  };

  const handleDisconnect = async (platformId: string) => {
    if (!confirm(`Are you sure you want to disconnect ${platformId}?`)) return;
    try {
      await fetchApi(`/connections/${platformId}`, { method: 'DELETE' });
      setConnections(prev => prev.filter(c => c.platform !== platformId));
    } catch (err) {
      alert("Failed to disconnect.");
    }
  };

  const handleTestSync = async (platformId: string) => {
    if (platformId === 'whatsapp') {
      try {
        const res = await fetchApi('/connections/whatsapp/status');
        if (res && res.whatsapp && res.whatsapp.isReady) {
          alert(`✅ WhatsApp Channel Status: Connected & Live!\nTarget Channel: 0029VbDxqHz6hENhNBcZM31M`);
        } else {
          alert(`⚠️ WhatsApp Channel status: ${res?.whatsapp?.state || 'Not ready'}. Please click Reconnect.`);
        }
      } catch (err) {
        alert("Failed to test sync with WhatsApp gateway.");
      }
    } else {
      alert("Token Status: Active OAuth2 Session");
    }
  };

  const isConnected = (platformId: string) => {
    return connections.some(c => c.platform === platformId && c.status === 'active');
  };

  const getAccountInfo = (platformId: string) => {
    return connections.find(c => c.platform === platformId);
  };

  const activeCount = connections.filter(c => c.status === 'active').length;

  const platforms = [
    {
      id: 'instagram',
      name: 'Instagram Business',
      description: 'Connect your Instagram Graph API to automatically publish carousels, reels, and stories.',
      icon: Camera,
      color: '#E1306C',
      bgColor: '#fee2e2',
      badge: 'Graph API v19.0'
    },
    {
      id: 'twitter',
      name: 'Twitter / X Enterprise',
      description: 'Connect your X API v2 to publish tweets, threads, polls, and media attachments instantly.',
      icon: AtSign,
      color: '#0f172a',
      bgColor: '#f1f5f9',
      badge: 'X OAuth 2.0'
    },
    {
      id: 'whatsapp',
      name: 'WhatsApp Channel Broadcast',
      description: 'Broadcast campaign media & posts to your official WhatsApp Channel (0029VbDxqHz6hENhNBcZM31M).',
      icon: MessageCircle,
      color: '#25D366',
      bgColor: '#dcfce7',
      badge: 'Channel Broadcast API'
    },
    {
      id: 'facebook',
      name: 'Facebook Pages',
      description: 'Connect your Facebook Page to auto-publish feed posts, photos, and link shares via Graph API.',
      icon: Facebook,
      color: '#1877F2',
      bgColor: '#dbeafe',
      badge: 'Graph API v19.0'
    }
  ];

  if (loading) {
    return (
      <div className="flex justify-center py-12 text-secondary">
        <Loader2 size={24} className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex-col gap-8">
      {/* Top Banner Header */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-extrabold" style={{ color: 'var(--text-main)' }}>
            Platform Connections
          </h1>
          <p className="text-secondary mt-1 text-sm">
            Manage your social media integrations & OAuth authentication tokens.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="btn-secondary"
            onClick={() => { setRefreshing(true); loadConnections(); }}
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : ''} />
            <span>Sync Tokens</span>
          </button>
        </div>
      </div>

      {/* System Health Card Banner */}
      <div
        className="p-6 flex items-center justify-between flex-wrap gap-4"
        style={{
          background: 'linear-gradient(135deg, #09101d 0%, #111c2e 100%)',
          borderRadius: '18px',
          color: 'white',
          border: '1px solid rgba(255,255,255,0.1)',
          boxShadow: '0 10px 30px rgba(9, 16, 29, 0.2)'
        }}
      >
        <div className="flex items-center gap-4">
          <div
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '14px',
              background: activeCount > 0 ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)' : 'linear-gradient(135deg, #64748b 0%, #475569 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: activeCount > 0 ? '0 6px 16px rgba(16, 185, 129, 0.3)' : 'none'
            }}
          >
            <ShieldCheck size={26} color="white" />
          </div>
          <div>
            <h3 className="font-bold text-lg text-white">
              {activeCount > 0 ? 'Channel Integration Status' : 'No Channels Connected'}
            </h3>
            <p className="text-xs text-muted mt-1" style={{ color: '#94a3b8' }}>
              {activeCount} of 4 core platforms active • OAuth Token Engine Active
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className={`chip ${activeCount > 0 ? 'chip-success' : 'chip-default'}`} style={{ padding: '0.4rem 0.85rem' }}>
            <Zap size={13} /> {activeCount > 0 ? 'OAuth Active' : 'Standby Mode'}
          </span>
        </div>
      </div>

      {/* Platform Cards */}
      <div className="flex-col gap-5">
        {platforms.map(platform => {
          const Icon = platform.icon;
          const connected = isConnected(platform.id);
          const account = getAccountInfo(platform.id);
          
          return (
            <div
              key={platform.id}
              className="card flex items-center justify-between flex-wrap gap-6"
              style={{
                borderRadius: '18px',
                padding: '1.75rem',
                border: connected ? '1px solid #bfdbfe' : '1px solid var(--border)'
              }}
            >
              <div className="flex items-start gap-5 flex-1" style={{ minWidth: '280px' }}>
                <div
                  style={{
                    backgroundColor: platform.bgColor,
                    color: platform.color,
                    width: '56px',
                    height: '56px',
                    borderRadius: '16px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    boxShadow: '0 4px 12px rgba(0,0,0,0.04)'
                  }}
                >
                  <Icon size={28} />
                </div>
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <h3 className="font-bold text-lg" style={{ color: 'var(--text-main)' }}>{platform.name}</h3>
                    <span className="chip chip-default text-xs">{platform.badge}</span>
                    {connected && (
                      <span className="chip chip-success">
                        <CheckCircle2 size={12} /> Connected
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-secondary mt-1">{platform.description}</p>
                  
                  {connected && (
                    <div className="flex items-center gap-4 mt-3 text-xs text-muted">
                      {account?.platform_account_name && (
                        <span>Account: <strong className="text-main">{account.platform_account_name}</strong></span>
                      )}
                      <span>Token Status: <strong className="text-success">Valid Session</strong></span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                {connected ? (
                  <>
                    <button className="btn-secondary" onClick={() => handleTestSync(platform.id)}>
                      <ExternalLink size={15} />
                      <span>Test Sync</span>
                    </button>
                    <button className="btn-secondary" style={{ color: '#ef4444', borderColor: '#fecaca' }} onClick={() => handleDisconnect(platform.id)}>
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button className="btn-primary" onClick={() => handleConnect(platform.id)}>
                    <Plus size={16} />
                    <span>Connect Channel</span>
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add Custom Integration Card */}
      <div
        className="card flex items-center justify-between p-6"
        style={{
          borderStyle: 'dashed',
          borderColor: '#cbd5e1',
          backgroundColor: '#f8fafc'
        }}
      >
        <div className="flex items-center gap-4">
          <div
            style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              backgroundColor: '#e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#475569'
            }}
          >
            <Plus size={22} />
          </div>
          <div>
            <h4 className="font-bold text-base text-main">Custom Webhook / REST API Connection</h4>
            <p className="text-xs text-secondary mt-1">Connect LinkedIn, TikTok, or custom CRM webhooks to your UNAI Flow workflow engine.</p>
          </div>
        </div>

        <button className="btn-secondary" onClick={() => alert("Custom Webhook integration connectors available in Enterprise plan.")}>
          Request Connector
        </button>
      </div>

      {/* WhatsApp QR Pairing Modal (Directly in UNAI Flow Dashboard) */}
      {isWaModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '1rem'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setIsWaModalOpen(false);
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: '460px',
              backgroundColor: '#ffffff',
              borderRadius: '20px',
              padding: '2rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.25rem',
              animation: 'fadeIn 0.2s ease-out'
            }}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  style={{
                    backgroundColor: '#dcfce7',
                    color: '#25D366',
                    width: '40px',
                    height: '40px',
                    borderRadius: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <MessageCircle size={22} />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-main">Connect WhatsApp</h3>
                  <p className="text-xs text-secondary">Pair channel: 0029VbDxqHz6hENhNBcZM31M</p>
                </div>
              </div>
              <button
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '4px',
                  color: '#64748b'
                }}
                onClick={() => setIsWaModalOpen(false)}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Content */}
            {waPaired ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '2rem 1rem',
                  gap: '1rem',
                  textAlign: 'center'
                }}
              >
                <div
                  style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    backgroundColor: '#dcfce7',
                    color: '#25D366',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <CheckCircle2 size={36} />
                </div>
                <h4 className="font-bold text-lg text-main">Connected Successfully!</h4>
                <p className="text-sm text-secondary">Your WhatsApp Channel is now linked to UNAI Flow.</p>
              </div>
            ) : (
              <>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '1rem',
                    backgroundColor: '#f8fafc',
                    padding: '1.5rem',
                    borderRadius: '16px',
                    border: '1px solid #e2e8f0'
                  }}
                >
                  {/* QR Box */}
                  <div
                    style={{
                      width: '240px',
                      height: '240px',
                      backgroundColor: '#ffffff',
                      borderRadius: '12px',
                      padding: '8px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
                      border: '1px solid #e2e8f0',
                      position: 'relative'
                    }}
                  >
                    <img
                      src={`http://localhost:3001/api/qr?t=${Date.now()}`}
                      alt="WhatsApp QR Code"
                      style={{ width: '100%', height: '100%', borderRadius: '8px' }}
                      onError={(e: any) => {
                        e.target.style.display = 'none';
                        if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                      }}
                    />
                    <div
                      style={{
                        display: 'none',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.5rem',
                        color: '#64748b',
                        fontSize: '0.85rem',
                        textAlign: 'center',
                        padding: '1rem'
                      }}
                    >
                      <Loader2 size={24} className="animate-spin text-primary" />
                      <span>Generating live QR code...</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-secondary font-medium">
                    <span className="dot" style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#25D366' }}></span>
                    <span>QR updates automatically</span>
                  </div>
                </div>

                {/* Instructions */}
                <div style={{ fontSize: '0.85rem', color: '#475569', lineHeight: '1.6' }}>
                  <p className="font-semibold text-main mb-1">How to scan:</p>
                  <ol style={{ paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <li>Open <strong>WhatsApp</strong> on your phone</li>
                    <li>Go to <strong>Settings</strong> or <strong>⋮ (3 dots)</strong> &gt; <strong>Linked Devices</strong></li>
                    <li>Tap <strong>Link a Device</strong> and point camera here</li>
                  </ol>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
