import { useState, useEffect } from 'react';
import { Camera, MessageCircle, Loader2, CheckCircle2, ShieldCheck, RefreshCw, Plus, ExternalLink, X, AlertCircle, Building2, Radio } from 'lucide-react';
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

function Twitter({ size = 18, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

export default function Connections() {
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isWaModalOpen, setIsWaModalOpen] = useState(false);
  const [discoveredChannels, setDiscoveredChannels] = useState<any[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<any | null>(null);
  const [savingChannel, setSavingChannel] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [customChannelName, setCustomChannelName] = useState('');
  const [customChannelLink, setCustomChannelLink] = useState('');
  const [showCustomChannelInput, setShowCustomChannelInput] = useState(false);

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

  // Fetch real-time discovered WhatsApp Channels & Accounts
  const fetchDiscoveredChannels = async () => {
    setLoadingChannels(true);
    try {
      const res = await fetchApi('/connections/whatsapp/channels');
      if (res && res.channels && Array.isArray(res.channels)) {
        setDiscoveredChannels(res.channels);
      } else {
        setDiscoveredChannels([]);
      }
    } catch (err) {
      console.error("Failed to load WhatsApp channels:", err);
      setDiscoveredChannels([]);
    } finally {
      setLoadingChannels(false);
    }
  };

  useEffect(() => {
    loadConnections();

    // Check if returning from official WhatsApp/Meta OAuth callback
    const params = new URLSearchParams(window.location.search);
    if (params.get('whatsapp_connected') === 'true' || params.get('select_channel') === 'true') {
      setIsWaModalOpen(true);
      fetchDiscoveredChannels();
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  const handleConnect = async (platformId: string) => {
    try {
      const res = await fetchApi(`/connections/${platformId}/start`, { method: 'POST' });
      if (res.authorization_url) {
        // Redirect directly to the official platform OAuth login endpoint
        window.location.href = res.authorization_url;
      } else {
        alert("Unable to generate authorization URL. Please try again.");
      }
    } catch (err) {
      console.error(`Error connecting to ${platformId}:`, err);
      alert(`Failed to start connection flow for ${platformId}.`);
    }
  };

  const handleSelectChannel = async (channel: any) => {
    setSavingChannel(true);
    try {
      await fetchApi('/connections/whatsapp/select-channel', {
        method: 'POST',
        body: JSON.stringify({
          channel_id: channel.id,
          channel_name: channel.name,
          channel_link: channel.link || '',
        }),
      });
      setSelectedChannel(channel);
      setIsSuccess(true);
      await loadConnections();
      setTimeout(() => {
        setIsWaModalOpen(false);
        setIsSuccess(false);
      }, 1500);
    } catch (err) {
      alert("Failed to save channel selection. Please try again.");
    } finally {
      setSavingChannel(false);
    }
  };

  const handleCustomChannelSubmit = async () => {
    if (!customChannelName.trim()) {
      alert("Please enter a Channel Name");
      return;
    }
    const cleanId = customChannelName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    await handleSelectChannel({
      id: cleanId,
      name: customChannelName.trim(),
      link: customChannelLink.trim(),
    });
  };

  const handleSwitchChannel = () => {
    setIsWaModalOpen(true);
    setShowCustomChannelInput(false);
    fetchDiscoveredChannels();
  };

  const handleDisconnect = async (platformId: string) => {
    if (!confirm(`Are you sure you want to disconnect ${platformId}? This will remove the connection and revoke access.`)) return;
    try {
      await fetchApi(`/connections/${platformId}`, { method: 'DELETE' });
      setConnections(prev => prev.filter(c => c.platform !== platformId));
    } catch (err) {
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
    } catch (err: any) {
      alert(`Failed to test sync for ${platformId}.`);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadConnections();
  };

  const platforms = [
    {
      id: 'whatsapp',
      name: 'WhatsApp',
      subtitle: 'Official WhatsApp Business & Channels',
      icon: <MessageCircle size={22} />,
      description: 'Broadcast updates directly to your WhatsApp Channels and WhatsApp Business audiences.',
      color: '#25D366',
      bgColor: '#dcfce7',
    },
    {
      id: 'instagram',
      name: 'Instagram',
      subtitle: 'Instagram Graph API',
      icon: <Camera size={22} />,
      description: 'Post photos, carousels, and captions to your Instagram Business account.',
      color: '#E1306C',
      bgColor: '#fce7f3',
    },
    {
      id: 'facebook',
      name: 'Facebook Page',
      subtitle: 'Facebook Graph API',
      icon: <Facebook size={22} />,
      description: 'Publish posts and media directly to your Facebook Pages.',
      color: '#1877F2',
      bgColor: '#dbeafe',
    },
    {
      id: 'twitter',
      name: 'Twitter / X',
      subtitle: 'Twitter API v2',
      icon: <Twitter size={20} />,
      description: 'Share tweets and threads with real-time media attachments.',
      color: '#0f172a',
      bgColor: '#f1f5f9',
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
      <div
        className="card flex items-center gap-3 p-4 mb-6"
        style={{ backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }}
      >
        <ShieldCheck size={20} style={{ color: '#16a34a', flexShrink: 0 }} />
        <div>
          <p className="text-sm font-semibold text-main">Official End-to-End OAuth Authentication</p>
          <p className="text-xs text-secondary">All connection tokens are encrypted at rest with AES-256. Permissions are managed directly through official Meta and X APIs.</p>
        </div>
      </div>

      {/* Platform Cards List */}
      <div className="flex flex-col gap-4">
        {platforms.map((platform) => {
          const account = connections.find((c: any) => c.platform === platform.id);
          const connected = Boolean(account) && account?.status !== 'revoked';

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
                    <h4 className="font-bold text-base text-main">{platform.name}</h4>
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
                        <span>Account / Channel: <strong className="text-main">{account.platform_account_name}</strong></span>
                      )}
                      <span>Token Status: <strong className="text-success">Active Session</strong></span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                {connected ? (
                  <>
                    {platform.id === 'whatsapp' && (
                      <button className="btn-secondary" onClick={handleSwitchChannel}>
                        <MessageCircle size={15} style={{ color: '#25D366' }} />
                        <span>Switch Channel</span>
                      </button>
                    )}
                    <button className="btn-secondary" onClick={() => handleTestSync(platform.id)}>
                      <ExternalLink size={15} />
                      <span>Test Sync</span>
                    </button>
                    <button className="btn-secondary" style={{ color: '#ef4444', borderColor: '#fecaca' }} onClick={() => handleDisconnect(platform.id)}>
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button 
                    className="btn-primary" 
                    style={{ backgroundColor: platform.id === 'whatsapp' ? '#25D366' : undefined }}
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

      {/* Add Custom Integration Card */}
      <div
        className="card flex items-center justify-between p-6 mt-4"
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
              backgroundColor: '#f1f5f9',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#64748b'
            }}
          >
            <Plus size={20} />
          </div>
          <div>
            <h4 className="font-bold text-base text-main">Custom Webhook / Connector</h4>
            <p className="text-sm text-secondary mt-0.5">Need a custom social connector or enterprise webhook integration?</p>
          </div>
        </div>

        <button className="btn-secondary" onClick={() => alert("Custom Webhook integration connectors available in Enterprise plan.")}>
          Request Connector
        </button>
      </div>

      {/* Real-Time WhatsApp Channel Discovery & Selection Modal */}
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
              maxWidth: '540px',
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
            {isSuccess ? (
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
                <h4 className="font-bold text-lg text-main">Connected to {selectedChannel?.name || 'WhatsApp Channel'}!</h4>
                <p className="text-sm text-secondary">Your WhatsApp broadcasts will now publish automatically to this channel.</p>
              </div>
            ) : (
              <>
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
                      <h3 className="font-bold text-lg text-main">Select WhatsApp Channel</h3>
                      <p className="text-xs text-secondary">
                        Choose which WhatsApp account or channel to connect
                      </p>
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-main">Available WhatsApp Accounts &amp; Channels</span>
                    <button
                      onClick={fetchDiscoveredChannels}
                      disabled={loadingChannels}
                      className="text-xs text-primary flex items-center gap-1 hover:underline"
                      style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      <RefreshCw size={12} className={loadingChannels ? 'animate-spin' : ''} />
                      <span>Refresh</span>
                    </button>
                  </div>

                  {loadingChannels ? (
                    <div className="flex flex-col items-center justify-center p-8 gap-3">
                      <Loader2 size={32} className="animate-spin" style={{ color: '#25D366' }} />
                      <p className="text-sm text-secondary">Discovering real-time channels from your WhatsApp account...</p>
                    </div>
                  ) : discoveredChannels.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '320px', overflowY: 'auto' }}>
                      {discoveredChannels.map((ch, idx) => (
                        <div
                          key={ch.id || idx}
                          style={{
                            padding: '1rem',
                            borderRadius: '12px',
                            border: '1px solid #e2e8f0',
                            backgroundColor: '#f8fafc',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '1rem'
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              style={{
                                width: '38px',
                                height: '38px',
                                borderRadius: '10px',
                                backgroundColor: ch.type === 'whatsapp_business' ? '#e0f2fe' : '#dcfce7',
                                color: ch.type === 'whatsapp_business' ? '#0284c7' : '#25D366',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {ch.type === 'whatsapp_business' ? <Building2 size={18} /> : <Radio size={18} />}
                            </div>
                            <div>
                              <div className="flex items-center gap-1.5">
                                <p className="font-bold text-sm text-main">{ch.name}</p>
                                {ch.display_number && (
                                  <span className="chip" style={{ fontSize: '0.65rem', padding: '1px 5px', backgroundColor: '#f1f5f9' }}>
                                    {ch.display_number}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-secondary mt-0.5">{ch.description || 'WhatsApp Channel'}</p>
                            </div>
                          </div>

                          <button
                            onClick={() => handleSelectChannel(ch)}
                            disabled={savingChannel}
                            style={{
                              padding: '0.5rem 1rem',
                              backgroundColor: '#25D366',
                              color: '#ffffff',
                              borderRadius: '8px',
                              border: 'none',
                              fontWeight: 600,
                              fontSize: '0.85rem',
                              cursor: savingChannel ? 'wait' : 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.35rem'
                            }}
                          >
                            {savingChannel && selectedChannel?.id === ch.id ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <CheckCircle2 size={14} />
                            )}
                            <span>Connect</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div
                      style={{
                        padding: '1.25rem',
                        borderRadius: '12px',
                        backgroundColor: '#f8fafc',
                        border: '1px dashed #cbd5e1',
                        textAlign: 'center'
                      }}
                    >
                      <AlertCircle size={24} style={{ margin: '0 auto 0.5rem', color: '#64748b' }} />
                      <p className="text-sm font-semibold text-main">No Channels Detected Automatically</p>
                      <p className="text-xs text-secondary mt-1">
                        We authenticated your WhatsApp account, but no public channels or business numbers were detected yet. You can create a channel in WhatsApp or enter your channel details below.
                      </p>
                    </div>
                  )}

                  {/* Connect by Custom Channel Name/Link Input Toggle */}
                  <div style={{ marginTop: '0.5rem' }}>
                    {!showCustomChannelInput ? (
                      <button
                        onClick={() => setShowCustomChannelInput(true)}
                        className="text-xs text-primary hover:underline font-medium"
                        style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        + Connect a WhatsApp Channel by Name / Link
                      </button>
                    ) : (
                      <div style={{ padding: '1rem', borderRadius: '12px', border: '1px solid #cbd5e1', backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        <p className="text-xs font-semibold text-main">Enter WhatsApp Channel Details</p>
                        <input
                          type="text"
                          placeholder="Channel Name (e.g. My Tech Community)"
                          value={customChannelName}
                          onChange={(e) => setCustomChannelName(e.target.value)}
                          style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                        />
                        <input
                          type="text"
                          placeholder="Channel Link (optional, e.g. https://whatsapp.com/channel/...)"
                          value={customChannelLink}
                          onChange={(e) => setCustomChannelLink(e.target.value)}
                          style={{ padding: '0.5rem 0.75rem', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '0.85rem' }}
                        />
                        <div className="flex items-center gap-2 justify-end">
                          <button
                            onClick={() => setShowCustomChannelInput(false)}
                            className="text-xs text-secondary hover:underline"
                            style={{ background: 'none', border: 'none', cursor: 'pointer' }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={handleCustomChannelSubmit}
                            disabled={savingChannel || !customChannelName.trim()}
                            style={{
                              padding: '0.4rem 0.85rem',
                              backgroundColor: '#25D366',
                              color: 'white',
                              borderRadius: '6px',
                              border: 'none',
                              fontSize: '0.85rem',
                              fontWeight: 600,
                              cursor: 'pointer'
                            }}
                          >
                            Connect
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
