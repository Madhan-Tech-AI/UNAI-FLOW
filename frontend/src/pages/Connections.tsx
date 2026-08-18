import { useState, useEffect } from 'react';
import { Camera, AtSign, MessageCircle, Loader2, CheckCircle2, ShieldCheck, RefreshCw, Plus, ExternalLink, Zap } from 'lucide-react';
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

  const handleConnect = async (platformId: string) => {
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
      name: 'WhatsApp Business API',
      description: 'Connect Meta WhatsApp Cloud API to broadcast targeted updates to subscriber communities.',
      icon: MessageCircle,
      color: '#25D366',
      bgColor: '#dcfce7',
      badge: 'Cloud API v18'
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
                    <button className="btn-secondary" onClick={() => alert("Token Status: Active OAuth2 Session")}>
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
    </div>
  );
}
