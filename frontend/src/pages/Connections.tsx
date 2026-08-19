import { useState, useEffect, useRef } from 'react';
import { Camera, MessageCircle, Loader2, CheckCircle2, ShieldCheck, RefreshCw, Plus, ExternalLink, X } from 'lucide-react';
import { fetchApi } from '../lib/apiClient';
import { supabase } from '../lib/supabaseClient';

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

const WCA_DIRECT_URL = 'https://unai-whatsapp-channelapi.onrender.com';
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function Connections() {
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isWaModalOpen, setIsWaModalOpen] = useState(false);
  const [waPaired, setWaPaired] = useState(false);
  const [qrImageUrl, setQrImageUrl] = useState<string | null>(null);
  const [waStatus, setWaStatus] = useState<string>('checking');
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [phoneNumber, setPhoneNumber] = useState<string>('');
  const [phoneSubmitted, setPhoneSubmitted] = useState(false);
  const [phoneError, setPhoneError] = useState<string>('');
  const [usePhoneMode, setUsePhoneMode] = useState(false); // default to fresh QR code mode
  const [isResetting, setIsResetting] = useState(false);
  const qrBlobUrlRef = useRef<string | null>(null);

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

  // Fetch QR image as blob — tries backend proxy first, falls back to direct gateway
  const fetchQrImage = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const response = await fetch(`${API_BASE}/connections/whatsapp/qr-image?t=${Date.now()}`, {
        headers,
      });

      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (contentType.includes('image')) {
          const blob = await response.blob();
          if (qrBlobUrlRef.current) URL.revokeObjectURL(qrBlobUrlRef.current);
          const url = URL.createObjectURL(blob);
          qrBlobUrlRef.current = url;
          setQrImageUrl(url);
          return true;
        }
      }
    } catch {
      // Backend proxy unreachable
    }

    // Fallback: fetch QR directly from WhatsApp gateway
    try {
      const directResp = await fetch(`${WCA_DIRECT_URL}/api/qr?t=${Date.now()}`);
      if (directResp.ok) {
        const contentType = directResp.headers.get('content-type') || '';
        if (contentType.includes('image')) {
          const blob = await directResp.blob();
          if (qrBlobUrlRef.current) URL.revokeObjectURL(qrBlobUrlRef.current);
          const url = URL.createObjectURL(blob);
          qrBlobUrlRef.current = url;
          setQrImageUrl(url);
          return true;
        }
      }
    } catch {
      // Gateway also down or starting
    }

    return false;
  };

  // WhatsApp status poller + QR/code fetcher when modal is open
  useEffect(() => {
    if (!isWaModalOpen) return;

    let interval: any;
    let cancelled = false;

    const checkWaStatus = async () => {
      if (cancelled) return;

      let statusData: any = null;
      try {
        statusData = await fetchApi('/connections/whatsapp/status');
      } catch {
        try {
          const directResp = await fetch(`${WCA_DIRECT_URL}/api/status`);
          if (directResp.ok) statusData = await directResp.json();
        } catch { /* gateway down */ }
      }

      if (cancelled) return;

      const wa = statusData?.whatsapp;
      if (!wa) { setWaStatus('starting'); await fetchQrImage(); return; }

      if (wa.isReady) {
        setWaStatus('connected');
        setWaPaired(true);
        try {
          await fetchApi('/connections/whatsapp/confirm', { method: 'POST' });
          await loadConnections();
        } catch { /* ignore */ }
        setTimeout(() => { if (!cancelled) { setIsWaModalOpen(false); setWaPaired(false); } }, 2000);
        return;
      }

      // Phone pairing code available
      if (wa.pairingCode) {
        setPairingCode(wa.pairingCode);
        setWaStatus('phone_pairing');
        return;
      }

      setWaStatus(wa.state || 'connecting');
      if (wa.state === 'qr_pending' || wa.state === 'connecting') {
        await fetchQrImage();
      }
    };

    checkWaStatus();
    interval = setInterval(checkWaStatus, 4000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      if (qrBlobUrlRef.current) {
        URL.revokeObjectURL(qrBlobUrlRef.current);
        qrBlobUrlRef.current = null;
      }
    };
  }, [isWaModalOpen]);

  const handlePhoneSubmit = async () => {
    if (!phoneNumber.trim()) { setPhoneError('Please enter your phone number'); return; }
    setPhoneError('');
    setPhoneSubmitted(true);
    setPairingCode(null);
    try {
      await fetchApi('/connections/whatsapp/pair-phone', {
        method: 'POST',
        body: JSON.stringify({ phone: phoneNumber.trim() }),
      });
    } catch (err) {
      setPhoneError('Failed to request pairing. Make sure gateway is running.');
      setPhoneSubmitted(false);
    }
  };

  const handleResetSession = async () => {
    setIsResetting(true);
    setQrImageUrl(null);
    setWaStatus('starting');
    try {
      await fetchApi('/connections/whatsapp/reset', { method: 'POST' });
    } catch {
      try {
        await fetch(`${WCA_DIRECT_URL}/api/session/reset`, { method: 'POST' });
      } catch {}
    } finally {
      setTimeout(() => {
        setIsResetting(false);
        fetchQrImage();
      }, 3000);
    }
  };

  const handleConnect = async (platformId: string) => {
    if (platformId === 'whatsapp') {
      setIsWaModalOpen(true);
      setWaPaired(false);
      setQrImageUrl(null);
      setWaStatus('checking');
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
        let res: any = null;
        try {
          res = await fetchApi('/connections/whatsapp/status');
        } catch {
          const directResp = await fetch(`${WCA_DIRECT_URL}/api/status`);
          if (directResp.ok) res = await directResp.json();
        }
        if (res && res.whatsapp && res.whatsapp.isReady) {
          alert(`✅ WhatsApp Channel Status: Connected & Live!\nTarget Channel: Madhan Tech AI`);
        } else {
          alert(`⚠️ WhatsApp Channel status: ${res?.whatsapp?.state || 'Not ready'}. Please click Reconnect.`);
        }
      } catch (err) {
        alert("Failed to test sync with WhatsApp gateway.");
      }
      return;
    }

    try {
      const res = await fetchApi(`/connections/${platformId}/test`);
      if (res.success) {
        alert(`✅ Test sync succeeded for ${platformId}!`);
      } else {
        alert(`⚠️ Test sync issue: ${res.message || 'Unknown error'}`);
      }
    } catch (err) {
      alert(`Failed to test sync for ${platformId}.`);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    loadConnections();
  };

  const platforms = [
    {
      id: 'instagram',
      name: 'Instagram',
      icon: <Camera size={22} />,
      description: 'Post photos, carousels, and stories to your Instagram Business account.',
      color: '#E1306C',
      bgColor: '#fce7f3',
    },
    {
      id: 'facebook',
      name: 'Facebook Page',
      icon: <Facebook size={22} />,
      description: 'Publish posts and media directly to your Facebook Page.',
      color: '#1877F2',
      bgColor: '#dbeafe',
    },
    {
      id: 'whatsapp',
      name: 'WhatsApp Channel Broadcast',
      icon: <MessageCircle size={22} />,
      description: 'Broadcast updates to your WhatsApp Channel subscribers.',
      color: '#25D366',
      bgColor: '#dcfce7',
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
          <p className="text-sm text-secondary mt-1">Manage your social media platform connections.</p>
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
          <p className="text-sm font-semibold text-main">End-to-End Encrypted Connections</p>
          <p className="text-xs text-secondary">All OAuth tokens are encrypted at rest using AES-256. Tokens are never stored in plain text.</p>
        </div>
      </div>

      {/* Platform Cards */}
      <div className="flex flex-col gap-4">
        {platforms.map((platform) => {
          const account = connections.find((c: any) => c.platform === platform.id);
          const connected = Boolean(account);
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

      {/* WhatsApp QR Pairing Modal */}
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
                  <p className="text-xs text-secondary">Pair channel: Madhan Tech AI</p>
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
                    padding: '1.25rem',
                    borderRadius: '16px',
                    border: '1px solid #e2e8f0'
                  }}
                >
                  {usePhoneMode ? (
                    /* Phone Pairing UI */
                    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
                      {pairingCode ? (
                        <>
                          <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
                            <p className="font-semibold text-main mb-1">Enter this code on your phone</p>
                            <p className="text-sm text-secondary">WhatsApp &gt; Linked Devices &gt; Link with phone number</p>
                          </div>
                          <div style={{
                            display: 'flex',
                            gap: '0.5rem',
                            fontSize: '2rem',
                            fontWeight: 'bold',
                            letterSpacing: '4px',
                            color: '#0f172a',
                            backgroundColor: '#fff',
                            padding: '1rem 2rem',
                            borderRadius: '12px',
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.05)'
                          }}>
                            {pairingCode.slice(0, 4)} - {pairingCode.slice(4, 8)}
                          </div>
                          <p className="text-xs text-amber-600 mt-2 flex items-center gap-1 font-medium">
                            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                            Waiting for you to enter code...
                          </p>
                        </>
                      ) : (
                        <>
                          <div style={{ textAlign: 'center', width: '100%' }}>
                            <p className="font-semibold text-main mb-2">Link with Phone Number</p>
                            <p className="text-xs text-secondary mb-4">Enter the phone number of the WhatsApp account you want to link. Include country code (e.g. +1234567890).</p>
                            
                            <input
                              type="text"
                              placeholder="+1 234 567 8900"
                              value={phoneNumber}
                              onChange={(e) => setPhoneNumber(e.target.value)}
                              disabled={phoneSubmitted}
                              style={{
                                width: '100%',
                                padding: '0.75rem 1rem',
                                borderRadius: '8px',
                                border: '1px solid #cbd5e1',
                                outline: 'none',
                                fontSize: '0.95rem',
                                marginBottom: '0.5rem'
                              }}
                            />
                            {phoneError && <p className="text-xs text-red-500 text-left mb-2">{phoneError}</p>}
                            
                            <button
                              onClick={handlePhoneSubmit}
                              disabled={phoneSubmitted || !phoneNumber.trim()}
                              style={{
                                width: '100%',
                                padding: '0.75rem',
                                backgroundColor: phoneSubmitted ? '#94a3b8' : '#25D366',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontWeight: 600,
                                cursor: phoneSubmitted ? 'not-allowed' : 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '0.5rem'
                              }}
                            >
                              {phoneSubmitted ? (
                                <>
                                  <Loader2 size={16} className="animate-spin" />
                                  Requesting Code...
                                </>
                              ) : (
                                'Get Pairing Code'
                              )}
                            </button>
                            
                            {phoneSubmitted && (
                              <p className="text-xs text-secondary mt-3 flex items-center justify-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                                Gateway is processing request (may take ~30s)...
                              </p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    /* QR Code UI */
                    <>
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
                        }}
                      >
                        {qrImageUrl ? (
                          <img
                            src={qrImageUrl}
                            alt="WhatsApp QR Code"
                            style={{ width: '100%', height: '100%', borderRadius: '8px', objectFit: 'contain' }}
                          />
                        ) : (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '0.75rem',
                              color: '#64748b',
                              fontSize: '0.85rem',
                              textAlign: 'center',
                              padding: '1rem'
                            }}
                          >
                            <Loader2 size={28} className="animate-spin" style={{ color: '#25D366' }} />
                            <span>
                              {waStatus === 'authenticating'
                                ? 'QR Code Scanned! Authenticating with WhatsApp...'
                                : waStatus === 'checking' || waStatus === 'starting'
                                ? 'Waking up WhatsApp gateway...'
                                : waStatus === 'connecting'
                                ? 'Connecting to WhatsApp Web...'
                                : 'Loading QR code...'}
                              <br/>
                              <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
                                {waStatus === 'authenticating'
                                  ? 'Synchronizing session, please wait a few seconds...'
                                  : waStatus === 'checking' || waStatus === 'starting'
                                  ? 'Render free tier may take ~30s to start'
                                  : 'Please wait a moment'}
                              </span>
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between" style={{ width: '100%', fontSize: '0.75rem', color: '#64748b', fontWeight: 500, padding: '0 0.25rem' }}>
                        <div className="flex items-center gap-1.5">
                          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: waStatus === 'authenticating' ? '#3b82f6' : (qrImageUrl ? '#25D366' : '#f59e0b'), display: 'inline-block' }}></span>
                          <span>
                            {waStatus === 'authenticating'
                              ? 'Logging in & syncing...'
                              : (qrImageUrl ? 'QR Ready — Scan now' : 'Gateway starting...')}
                          </span>
                        </div>
                        <a
                          href={WCA_DIRECT_URL}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: '#25D366', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '3px' }}
                        >
                          <span>Open Direct</span>
                          <ExternalLink size={11} />
                        </a>
                      </div>
                    </>
                  )}
                </div>

                {/* Instructions / Toggle */}
                {usePhoneMode ? (
                  <div className="text-center mt-2 flex flex-col gap-2">
                    <button 
                      onClick={() => setUsePhoneMode(false)}
                      className="text-sm font-medium hover:underline"
                      style={{ color: '#25D366', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      Scan QR code instead
                    </button>
                  </div>
                ) : (
                  <div style={{ fontSize: '0.85rem', color: '#475569', lineHeight: '1.6' }}>
                    <p className="font-semibold text-main" style={{ marginBottom: '0.25rem' }}>How to scan:</p>
                    <ol style={{ paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      <li>Open <strong>WhatsApp</strong> on your phone</li>
                      <li>Go to <strong>Settings</strong> or <strong>⋮ (3 dots)</strong> &gt; <strong>Linked Devices</strong></li>
                      <li>Tap <strong>Link a Device</strong> and scan the QR code above</li>
                    </ol>
                    <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-200">
                      <button 
                        onClick={handleResetSession}
                        disabled={isResetting}
                        className="text-xs text-slate-500 hover:text-slate-700 underline"
                        style={{ background: 'none', border: 'none', cursor: isResetting ? 'wait' : 'pointer' }}
                      >
                        {isResetting ? 'Resetting session...' : '🔄 Reset Session / Force Fresh QR'}
                      </button>
                      <button 
                        onClick={() => setUsePhoneMode(true)}
                        className="text-xs font-semibold hover:underline"
                        style={{ color: '#25D366', background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        Link with phone number instead &rarr;
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
