import { useState, useEffect } from 'react';
import { Camera, AtSign, MessageCircle, Loader2 } from 'lucide-react';
import { fetchApi } from '../lib/apiClient';

export default function Connections() {
  const [connections, setConnections] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadConnections() {
      try {
        const res = await fetchApi('/connections');
        setConnections(res.connections || []);
      } catch (err) {
        console.error("Failed to load connections:", err);
      } finally {
        setLoading(false);
      }
    }
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

  const platforms = [
    {
      id: 'instagram',
      name: 'Instagram',
      description: 'Connect your Instagram Business account to publish posts.',
      icon: Camera,
      color: '#E1306C'
    },
    {
      id: 'twitter',
      name: 'Twitter / X',
      description: 'Connect your X account to publish tweets and threads.',
      icon: AtSign,
      color: '#000000'
    },
    {
      id: 'whatsapp',
      name: 'WhatsApp Community',
      description: 'Connect your WhatsApp Business API to broadcast to groups.',
      icon: MessageCircle,
      color: '#25D366'
    }
  ];

  if (loading) {
    return (
      <div className="flex justify-center py-12 text-secondary">
        <Loader2 size={24} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-col gap-6">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-bold">Platform Connections</h2>
      </div>

      <div className="flex flex-col gap-4">
        {platforms.map(platform => {
          const Icon = platform.icon;
          const connected = isConnected(platform.id);
          
          return (
            <div key={platform.id} className="card flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div style={{ backgroundColor: `${platform.color}15`, padding: '1rem', borderRadius: '0.5rem', color: platform.color }}>
                  <Icon size={24} />
                </div>
                <div>
                  <h3 className="font-semibold text-lg">{platform.name}</h3>
                  <p className="text-sm text-secondary">{platform.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-4">
                {connected && <span className="chip chip-success">Connected</span>}
                {connected ? (
                  <button className="btn-secondary" onClick={() => handleDisconnect(platform.id)}>Disconnect</button>
                ) : (
                  <button className="btn-primary" onClick={() => handleConnect(platform.id)}>Connect</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
