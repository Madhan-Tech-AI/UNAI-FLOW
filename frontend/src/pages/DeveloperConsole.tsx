import React, { useState, useEffect } from 'react';
import {
  Key,
  Webhook,
  BarChart3,
  Code2,
  Plus,
  Trash2,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  Activity,
  Radio,
  Zap,
  CheckCircle2,
  Send
} from 'lucide-react';
import { fetchApi } from '../lib/apiClient';

interface ApiKeyItem {
  id: string;
  name: string;
  description?: string;
  prefix: string;
  scopes: string[];
  environment: string;
  rate_limit_override?: number;
  last_used_at?: string;
  expires_at?: string;
  created_at: string;
}

interface WebhookItem {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  consecutive_failures: number;
  last_triggered_at?: string;
  created_at: string;
}

interface UsageSummary {
  period_type: string;
  total_requests: number;
  total_messages_sent: number;
  total_messages_failed: number;
  total_campaigns: number;
  active_api_keys: number;
  active_webhooks: number;
  periods: Array<{
    period: string;
    total_requests: number;
    successful_requests: number;
    failed_requests: number;
    avg_latency_ms?: number;
  }>;
}

interface MessageStats {
  total_sent: number;
  total_delivered: number;
  total_failed: number;
  delivery_rate: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
}

interface EndpointStat {
  path: string;
  method: string;
  total_requests: number;
  avg_latency_ms?: number;
  error_rate: number;
}

export default function DeveloperConsole() {
  const [activeTab, setActiveTab] = useState<'keys' | 'webhooks' | 'usage' | 'quickstart'>('keys');

  // Keys state
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [showCreateKeyModal, setShowCreateKeyModal] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyEnv, setNewKeyEnv] = useState<'live' | 'test'>('live');
  const [newKeyDesc, setNewKeyDesc] = useState('');
  const [newKeyRateLimit, setNewKeyRateLimit] = useState<string>('');
  const [newKeyScopes, setNewKeyScopes] = useState<string[]>([
    'instances:read',
    'channels:read',
    'messages:send',
    'campaigns:read',
    'campaigns:write',
    'usage:read'
  ]);
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<{ raw_key: string; name: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);

  // Webhooks state
  const [webhooks, setWebhooks] = useState<WebhookItem[]>([]);
  const [webhooksLoading, setWebhooksLoading] = useState(false);
  const [showCreateWebhookModal, setShowCreateWebhookModal] = useState(false);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>([
    'message.sent',
    'message.failed',
    'campaign.launched',
    'campaign.completed'
  ]);
  const [createdWebhookSecret, setCreatedWebhookSecret] = useState<string | null>(null);

  // Usage state
  const [usagePeriod, setUsagePeriod] = useState<'day' | 'week' | 'month'>('day');
  const [usageSummary, setUsageSummary] = useState<UsageSummary | null>(null);
  const [messageStats, setMessageStats] = useState<MessageStats | null>(null);
  const [endpointStats, setEndpointStats] = useState<EndpointStat[]>([]);
  const [usageLoading, setUsageLoading] = useState(false);

  // Quickstart state
  const [codeLang, setCodeLang] = useState<'curl' | 'node' | 'python'>('curl');
  const [copiedCode, setCopiedCode] = useState(false);

  // Initial Load
  useEffect(() => {
    loadKeys();
    loadWebhooks();
    loadUsage();
  }, []);

  useEffect(() => {
    loadUsage();
  }, [usagePeriod]);

  const loadKeys = async () => {
    setKeysLoading(true);
    try {
      const data = await fetchApi('/v1/api-keys');
      if (Array.isArray(data)) setKeys(data);
    } catch (err) {
      console.error('Failed to load API keys:', err);
    } finally {
      setKeysLoading(false);
    }
  };

  const loadWebhooks = async () => {
    setWebhooksLoading(true);
    try {
      const data = await fetchApi('/v1/webhooks');
      if (Array.isArray(data)) setWebhooks(data);
    } catch (err) {
      console.error('Failed to load webhooks:', err);
    } finally {
      setWebhooksLoading(false);
    }
  };

  const loadUsage = async () => {
    setUsageLoading(true);
    try {
      const [sum, msgs, eps] = await Promise.all([
        fetchApi(`/v1/usage/summary?period_type=${usagePeriod}`),
        fetchApi('/v1/usage/messages'),
        fetchApi('/v1/usage/endpoints')
      ]);
      setUsageSummary(sum);
      setMessageStats(msgs);
      if (eps?.endpoints) setEndpointStats(eps.endpoints);
    } catch (err) {
      console.error('Failed to load usage analytics:', err);
    } finally {
      setUsageLoading(false);
    }
  };

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;

    try {
      const payload: any = {
        name: newKeyName,
        environment: newKeyEnv,
        scopes: newKeyScopes,
        description: newKeyDesc || undefined,
        rate_limit_override: newKeyRateLimit ? parseInt(newKeyRateLimit, 10) : undefined
      };
      const res = await fetchApi('/v1/api-keys', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      setNewlyCreatedKey({ raw_key: res.raw_key, name: res.name });
      setShowCreateKeyModal(false);
      setNewKeyName('');
      setNewKeyDesc('');
      setNewKeyRateLimit('');
      loadKeys();
    } catch (err: any) {
      alert(err?.message || 'Failed to create API key');
    }
  };

  const handleRevokeKey = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to revoke API key "${name}"? This action cannot be undone and integrations using it will stop working immediately.`)) return;
    try {
      await fetchApi(`/v1/api-keys/${id}`, { method: 'DELETE' });
      loadKeys();
    } catch (err: any) {
      alert(err?.message || 'Failed to revoke API key');
    }
  };

  const handleRotateKey = async (id: string) => {
    if (!confirm('Rotating this key will immediately revoke the old key and create a new replacement. Continue?')) return;
    try {
      const res = await fetchApi(`/v1/api-keys/${id}/rotate`, { method: 'POST' });
      setNewlyCreatedKey({ raw_key: res.raw_key, name: res.name });
      loadKeys();
    } catch (err: any) {
      alert(err?.message || 'Failed to rotate key');
    }
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWebhookUrl.trim()) return;

    try {
      const res = await fetchApi('/v1/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          url: newWebhookUrl,
          events: newWebhookEvents
        })
      });
      setCreatedWebhookSecret(res.secret);
      setShowCreateWebhookModal(false);
      setNewWebhookUrl('');
      loadWebhooks();
    } catch (err: any) {
      alert(err?.message || 'Failed to register webhook');
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    if (!confirm('Are you sure you want to remove this webhook endpoint?')) return;
    try {
      await fetchApi(`/v1/webhooks/${id}`, { method: 'DELETE' });
      loadWebhooks();
    } catch (err: any) {
      alert(err?.message || 'Failed to delete webhook');
    }
  };

  const copyToClipboard = (text: string, isCode = false) => {
    navigator.clipboard.writeText(text);
    if (isCode) {
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } else {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }
  };

  // Sample code snippets
  const sampleKey = keys.length > 0 ? `${keys[0].prefix}****************` : 'wa_live_xxxxxxxxxxxxxxxxxxxxxx';
  const getQuickstartCode = () => {
    if (codeLang === 'curl') {
      return `# 1. Send an individual WhatsApp message
curl -X POST "https://unai-flow-backend-w4al.onrender.com/v1/messages/text" \\
  -H "Authorization: Bearer ${sampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "120363171744447809@newsletter",
    "body": "Hello from our backend integration via UNAI FLOW!"
  }'

# 2. Create and Launch a Bulk Messaging Campaign
curl -X POST "https://unai-flow-backend-w4al.onrender.com/v1/campaigns" \\
  -H "Authorization: Bearer ${sampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "Product Launch Announcement",
    "message_type": "text",
    "message_payload": { "body": "Exciting news! Our new service is live at {{link}}" },
    "recipients": [
      { "recipient_jid": "120363171744447809@newsletter", "variables": { "link": "https://example.com" } }
    ],
    "messages_per_second": 2.0
  }'`;
    }

    if (codeLang === 'node') {
      return `import axios from 'axios';

const UNAI_API_KEY = process.env.UNAI_API_KEY || '${sampleKey}';
const client = axios.create({
  baseURL: 'https://unai-flow-backend-w4al.onrender.com/v1',
  headers: {
    'Authorization': \`Bearer \${UNAI_API_KEY}\`,
    'Content-Type': 'application/json'
  }
});

// Send single message
async function sendMessage() {
  const res = await client.post('/messages/text', {
    to: '120363171744447809@newsletter',
    body: 'Automated notification from our CRM'
  });
  console.log('Message dispatched:', res.data);
}

// Check campaign status
async function checkCampaign(campaignId) {
  const res = await client.get(\`/campaigns/\${campaignId}\`);
  console.log('Campaign Progress:', res.data.delivered_count, '/', res.data.total_recipients);
}

sendMessage();`;
    }

    return `import requests

UNAI_API_KEY = "${sampleKey}"
BASE_URL = "https://unai-flow-backend-w4al.onrender.com/v1"

headers = {
    "Authorization": f"Bearer {UNAI_API_KEY}",
    "Content-Type": "application/json"
}

# Send WhatsApp Broadcast
payload = {
    "to": "120363171744447809@newsletter",
    "body": "Daily analytics report ready for download."
}

response = requests.post(f"{BASE_URL}/messages/text", json=payload, headers=headers)
print("Response:", response.json())`;
  };

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
          borderRadius: '16px',
          padding: '2rem 2.5rem',
          color: '#ffffff',
          marginBottom: '2rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.3)',
          border: '1px solid rgba(255, 255, 255, 0.08)'
        }}
      >
        <div>
          <div className="flex items-center gap-2" style={{ marginBottom: '0.5rem' }}>
            <span
              style={{
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                color: '#60a5fa',
                padding: '0.2rem 0.6rem',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '0.05em'
              }}
            >
              DEVELOPER PLATFORM
            </span>
            <span
              style={{
                backgroundColor: 'rgba(34, 197, 94, 0.2)',
                color: '#4ade80',
                padding: '0.2rem 0.6rem',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <Radio size={12} className="animate-pulse" /> REST API v1 Live
            </span>
          </div>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 800, letterSpacing: '-0.03em', margin: 0 }}>
            WhatsApp Developer Console
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginTop: '0.4rem', maxWidth: '650px' }}>
            Integrate UNAI FLOW as your business's WhatsApp messaging gateway. Generate API keys, configure webhooks, trigger bulk broadcasts, and inspect real-time request metrics.
          </p>
        </div>

        <div className="flex gap-3">
          <a
            href="https://unai-flow-backend-w4al.onrender.com/docs"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
              color: '#ffffff',
              padding: '0.75rem 1.25rem',
              borderRadius: '10px',
              fontSize: '0.875rem',
              fontWeight: 600,
              border: '1px solid rgba(255, 255, 255, 0.15)',
              transition: 'all 0.2s'
            }}
          >
            <ExternalLink size={16} /> Swagger API Docs
          </a>
          <button
            onClick={() => {
              if (activeTab === 'keys') setShowCreateKeyModal(true);
              else if (activeTab === 'webhooks') setShowCreateWebhookModal(true);
              else setActiveTab('keys');
            }}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
              color: '#ffffff',
              padding: '0.75rem 1.25rem',
              borderRadius: '10px',
              fontSize: '0.875rem',
              fontWeight: 600,
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.4)'
            }}
          >
            <Plus size={18} /> {activeTab === 'webhooks' ? 'New Webhook' : 'Create API Key'}
          </button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid #e2e8f0',
          marginBottom: '2rem'
        }}
      >
        {[
          { id: 'keys', label: 'API Keys', icon: Key, count: keys.length },
          { id: 'webhooks', label: 'Webhooks & Events', icon: Webhook, count: webhooks.length },
          { id: 'usage', label: 'Usage & Analytics', icon: BarChart3 },
          { id: 'quickstart', label: 'Quickstart & SDKs', icon: Code2 }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.6rem',
                padding: '0.875rem 1.25rem',
                borderBottom: isActive ? '3px solid #2563eb' : '3px solid transparent',
                color: isActive ? '#2563eb' : '#64748b',
                fontWeight: isActive ? 700 : 500,
                fontSize: '0.95rem',
                background: 'none',
                transition: 'all 0.15s',
                marginBottom: '-1px'
              }}
            >
              <Icon size={18} />
              {tab.label}
              {tab.count !== undefined && (
                <span
                  style={{
                    backgroundColor: isActive ? '#eff6ff' : '#f1f5f9',
                    color: isActive ? '#2563eb' : '#64748b',
                    padding: '0.15rem 0.5rem',
                    borderRadius: '999px',
                    fontSize: '0.75rem',
                    fontWeight: 600
                  }}
                >
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* TAB 1: API KEYS */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'keys' && (
        <div>
          {/* Secret Key Alert / Success Banner */}
          {newlyCreatedKey && (
            <div
              style={{
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '12px',
                padding: '1.25rem 1.5rem',
                marginBottom: '1.5rem',
                boxShadow: '0 4px 12px rgba(34, 197, 94, 0.1)'
              }}
            >
              <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
                <div className="flex items-center gap-2" style={{ color: '#15803d', fontWeight: 700, fontSize: '0.95rem' }}>
                  <ShieldCheck size={20} /> API Key Created: "{newlyCreatedKey.name}"
                </div>
                <button
                  onClick={() => setNewlyCreatedKey(null)}
                  style={{ color: '#64748b', fontSize: '0.8rem', fontWeight: 600 }}
                >
                  Dismiss
                </button>
              </div>
              <p style={{ color: '#166534', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                Make sure to copy your API secret now. <strong>You will not be able to see it again!</strong>
              </p>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: '#ffffff',
                  border: '1px solid #86efac',
                  borderRadius: '8px',
                  padding: '0.5rem 1rem',
                  gap: '0.75rem'
                }}
              >
                <code style={{ fontFamily: 'monospace', color: '#0f172a', fontWeight: 600, flex: 1, wordBreak: 'break-all' }}>
                  {newlyCreatedKey.raw_key}
                </code>
                <button
                  onClick={() => copyToClipboard(newlyCreatedKey.raw_key)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    backgroundColor: '#16a34a',
                    color: '#ffffff',
                    padding: '0.4rem 0.8rem',
                    borderRadius: '6px',
                    fontSize: '0.8rem',
                    fontWeight: 600
                  }}
                >
                  {copiedKey ? <Check size={14} /> : <Copy size={14} />}
                  {copiedKey ? 'Copied!' : 'Copy Secret'}
                </button>
              </div>
            </div>
          )}

          {/* Keys Table Card */}
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)'
            }}
          >
            <div
              style={{
                padding: '1.25rem 1.5rem',
                borderBottom: '1px solid #f1f5f9',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>Active API Keys</h3>
                <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0.2rem 0 0 0' }}>
                  Keys authenticate your backend or CRM requests to the UNAI FLOW public API.
                </p>
              </div>
              <button
                onClick={loadKeys}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  color: '#64748b',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}
              >
                <RefreshCw size={14} className={keysLoading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>

            {keys.length === 0 ? (
              <div style={{ padding: '3.5rem', textAlign: 'center' }}>
                <Key size={40} style={{ color: '#94a3b8', margin: '0 auto 1rem auto' }} />
                <h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>No API keys yet</h4>
                <p style={{ color: '#64748b', fontSize: '0.9rem', maxWidth: '400px', margin: '0.5rem auto 1.5rem auto' }}>
                  Create an API key to connect your CRM, custom backend, or Zapier to UNAI FLOW.
                </p>
                <button
                  onClick={() => setShowCreateKeyModal(true)}
                  style={{
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    padding: '0.6rem 1.25rem',
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                    fontWeight: 600
                  }}
                >
                  Create Your First Key
                </button>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '0.875rem 1.5rem', fontWeight: 600 }}>KEY NAME & DETAILS</th>
                    <th style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>PREFIX</th>
                    <th style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>ENVIRONMENT</th>
                    <th style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>SCOPES</th>
                    <th style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>RATE LIMIT</th>
                    <th style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>LAST USED</th>
                    <th style={{ padding: '0.875rem 1.5rem', fontWeight: 600, textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => (
                    <tr key={k.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '1rem 1.5rem' }}>
                        <div style={{ fontWeight: 700, color: '#0f172a' }}>{k.name}</div>
                        {k.description && (
                          <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.15rem' }}>{k.description}</div>
                        )}
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                          Created: {new Date(k.created_at).toLocaleDateString()}
                        </div>
                      </td>
                      <td style={{ padding: '1rem 1rem' }}>
                        <code style={{ fontFamily: 'monospace', backgroundColor: '#f1f5f9', padding: '0.2rem 0.4rem', borderRadius: '4px', color: '#334155' }}>
                          {k.prefix}...
                        </code>
                      </td>
                      <td style={{ padding: '1rem 1rem' }}>
                        <span
                          style={{
                            padding: '0.2rem 0.5rem',
                            borderRadius: '999px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            backgroundColor: k.environment === 'live' ? '#dcfce7' : '#fef9c3',
                            color: k.environment === 'live' ? '#15803d' : '#854d0e'
                          }}
                        >
                          {k.environment}
                        </span>
                      </td>
                      <td style={{ padding: '1rem 1rem' }}>
                        <div className="flex flex-wrap gap-1" style={{ maxWidth: '240px' }}>
                          {k.scopes.map((s) => (
                            <span
                              key={s}
                              style={{
                                fontSize: '0.7rem',
                                backgroundColor: '#f1f5f9',
                                color: '#475569',
                                padding: '0.1rem 0.4rem',
                                borderRadius: '4px'
                              }}
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: '1rem 1rem', color: '#475569' }}>
                        {k.rate_limit_override ? `${k.rate_limit_override} req/min` : '100 req/min (default)'}
                      </td>
                      <td style={{ padding: '1rem 1rem', color: '#64748b' }}>
                        {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : 'Never'}
                      </td>
                      <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleRotateKey(k.id)}
                            title="Rotate Key"
                            style={{
                              padding: '0.35rem 0.65rem',
                              borderRadius: '6px',
                              border: '1px solid #cbd5e1',
                              color: '#334155',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <RefreshCw size={12} /> Rotate
                          </button>
                          <button
                            onClick={() => handleRevokeKey(k.id, k.name)}
                            title="Revoke Key"
                            style={{
                              padding: '0.35rem 0.65rem',
                              borderRadius: '6px',
                              backgroundColor: '#fee2e2',
                              color: '#b91c1c',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <Trash2 size={12} /> Revoke
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* TAB 2: WEBHOOKS */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'webhooks' && (
        <div>
          {createdWebhookSecret && (
            <div
              style={{
                backgroundColor: '#eff6ff',
                border: '1px solid #bfdbfe',
                borderRadius: '12px',
                padding: '1.25rem 1.5rem',
                marginBottom: '1.5rem'
              }}
            >
              <div className="flex items-center justify-between" style={{ marginBottom: '0.4rem' }}>
                <div className="flex items-center gap-2" style={{ color: '#1d4ed8', fontWeight: 700 }}>
                  <ShieldCheck size={20} /> Webhook Endpoint Registered!
                </div>
                <button onClick={() => setCreatedWebhookSecret(null)} style={{ color: '#64748b', fontSize: '0.8rem' }}>
                  Dismiss
                </button>
              </div>
              <p style={{ color: '#1e40af', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                Use this signing secret to verify the HMAC-SHA256 signature in the <code>X-Webhook-Signature</code> header:
              </p>
              <code style={{ fontFamily: 'monospace', backgroundColor: '#ffffff', padding: '0.4rem 0.8rem', borderRadius: '6px', border: '1px solid #93c5fd', color: '#1e3a8a', fontWeight: 600 }}>
                {createdWebhookSecret}
              </code>
            </div>
          )}

          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)'
            }}
          >
            <div
              style={{
                padding: '1.25rem 1.5rem',
                borderBottom: '1px solid #f1f5f9',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center'
              }}
            >
              <div>
                <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0, color: '#0f172a' }}>Configured Webhook Endpoints</h3>
                <p style={{ fontSize: '0.85rem', color: '#64748b', margin: '0.2rem 0 0 0' }}>
                  Receive real-time notifications when WhatsApp messages are delivered, fail, or when campaigns finish.
                </p>
              </div>
              <button
                onClick={loadWebhooks}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  color: '#64748b',
                  fontSize: '0.85rem',
                  fontWeight: 600
                }}
              >
                <RefreshCw size={14} className={webhooksLoading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>

            {webhooks.length === 0 ? (
              <div style={{ padding: '3.5rem', textAlign: 'center' }}>
                <Webhook size={40} style={{ color: '#94a3b8', margin: '0 auto 1rem auto' }} />
                <h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>No webhooks registered</h4>
                <p style={{ color: '#64748b', fontSize: '0.9rem', maxWidth: '420px', margin: '0.5rem auto 1.5rem auto' }}>
                  Register an HTTPS endpoint to automatically receive webhook deliveries with HMAC-SHA256 signature verification.
                </p>
                <button
                  onClick={() => setShowCreateWebhookModal(true)}
                  style={{
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    padding: '0.6rem 1.25rem',
                    borderRadius: '8px',
                    fontSize: '0.875rem',
                    fontWeight: 600
                  }}
                >
                  Register Webhook URL
                </button>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '0.875rem 1.5rem', fontWeight: 600 }}>ENDPOINT URL</th>
                    <th style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>STATUS</th>
                    <th style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>SUBSCRIBED EVENTS</th>
                    <th style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>LAST TRIGGERED</th>
                    <th style={{ padding: '0.875rem 1.5rem', fontWeight: 600, textAlign: 'right' }}>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {webhooks.map((w) => (
                    <tr key={w.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '1rem 1.5rem' }}>
                        <code style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0f172a' }}>{w.url}</code>
                        {w.consecutive_failures > 0 && (
                          <div style={{ color: '#dc2626', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                            ⚠️ {w.consecutive_failures} consecutive delivery failures
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '1rem 1rem' }}>
                        <span
                          style={{
                            padding: '0.2rem 0.5rem',
                            borderRadius: '999px',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            backgroundColor: w.enabled ? '#dcfce7' : '#fee2e2',
                            color: w.enabled ? '#15803d' : '#b91c1c'
                          }}
                        >
                          {w.enabled ? 'ACTIVE' : 'DISABLED'}
                        </span>
                      </td>
                      <td style={{ padding: '1rem 1rem' }}>
                        <div className="flex flex-wrap gap-1" style={{ maxWidth: '280px' }}>
                          {w.events.map((e) => (
                            <span
                              key={e}
                              style={{
                                fontSize: '0.7rem',
                                backgroundColor: '#f1f5f9',
                                color: '#475569',
                                padding: '0.1rem 0.4rem',
                                borderRadius: '4px'
                              }}
                            >
                              {e}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td style={{ padding: '1rem 1rem', color: '#64748b' }}>
                        {w.last_triggered_at ? new Date(w.last_triggered_at).toLocaleString() : 'Never'}
                      </td>
                      <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>
                        <button
                          onClick={() => handleDeleteWebhook(w.id)}
                          style={{
                            padding: '0.35rem 0.65rem',
                            borderRadius: '6px',
                            backgroundColor: '#fee2e2',
                            color: '#b91c1c',
                            fontSize: '0.75rem',
                            fontWeight: 600
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* TAB 3: USAGE & ANALYTICS */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'usage' && (
        <div>
          {/* Controls */}
          <div className="flex items-center justify-between" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: 0 }}>
              Platform Usage & Performance
            </h3>
            <div className="flex items-center gap-3">
              <button
                onClick={loadUsage}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  color: '#64748b',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  padding: '0.35rem 0.75rem',
                  borderRadius: '8px'
                }}
              >
                <RefreshCw size={14} className={usageLoading ? 'animate-spin' : ''} /> Refresh
              </button>
              <div
                style={{
                  display: 'flex',
                  backgroundColor: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  padding: '0.2rem'
                }}
              >
                {(['day', 'week', 'month'] as const).map((p) => (
                  <button
                    key={p}
                    onClick={() => setUsagePeriod(p)}
                    style={{
                      padding: '0.35rem 0.85rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      textTransform: 'capitalize',
                      backgroundColor: usagePeriod === p ? '#2563eb' : 'transparent',
                      color: usagePeriod === p ? '#ffffff' : '#64748b'
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Metric Cards Grid */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '1.25rem',
              marginBottom: '2rem'
            }}
          >
            <div
              style={{
                backgroundColor: '#ffffff',
                padding: '1.5rem',
                borderRadius: '14px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)'
              }}
            >
              <div className="flex items-center justify-between" style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: 600 }}>
                API REQUESTS (30D)
                <Activity size={18} style={{ color: '#3b82f6' }} />
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: '#0f172a', marginTop: '0.5rem' }}>
                {usageSummary?.total_requests.toLocaleString() || 0}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#16a34a', marginTop: '0.25rem' }}>
                Across all registered API keys
              </div>
            </div>

            <div
              style={{
                backgroundColor: '#ffffff',
                padding: '1.5rem',
                borderRadius: '14px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)'
              }}
            >
              <div className="flex items-center justify-between" style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: 600 }}>
                MESSAGES SENT
                <Send size={18} style={{ color: '#10b981' }} />
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: '#0f172a', marginTop: '0.5rem' }}>
                {messageStats?.total_sent.toLocaleString() || 0}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                Delivered: {messageStats?.total_delivered.toLocaleString() || 0}
              </div>
            </div>

            <div
              style={{
                backgroundColor: '#ffffff',
                padding: '1.5rem',
                borderRadius: '14px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)'
              }}
            >
              <div className="flex items-center justify-between" style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: 600 }}>
                DELIVERY SUCCESS RATE
                <CheckCircle2 size={18} style={{ color: '#8b5cf6' }} />
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: '#0f172a', marginTop: '0.5rem' }}>
                {messageStats?.delivery_rate || 100}%
              </div>
              <div style={{ fontSize: '0.8rem', color: '#dc2626', marginTop: '0.25rem' }}>
                Failed: {messageStats?.total_failed || 0}
              </div>
            </div>

            <div
              style={{
                backgroundColor: '#ffffff',
                padding: '1.5rem',
                borderRadius: '14px',
                border: '1px solid #e2e8f0',
                boxShadow: '0 2px 6px rgba(15, 23, 42, 0.03)'
              }}
            >
              <div className="flex items-center justify-between" style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: 600 }}>
                CAMPAIGNS DISPATCHED
                <Zap size={18} style={{ color: '#f59e0b' }} />
              </div>
              <div style={{ fontSize: '2rem', fontWeight: 800, color: '#0f172a', marginTop: '0.5rem' }}>
                {usageSummary?.total_campaigns || 0}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.25rem' }}>
                Active keys: {usageSummary?.active_api_keys || 0}
              </div>
            </div>
          </div>

          {/* Endpoints Table */}
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)'
            }}
          >
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid #f1f5f9' }}>
              <h4 style={{ margin: 0, fontWeight: 700, fontSize: '0.95rem' }}>Traffic Breakdown by Endpoint</h4>
            </div>
            {endpointStats.length === 0 ? (
              <div style={{ padding: '2.5rem', textAlign: 'center', color: '#64748b' }}>
                No API calls logged yet. Use the Quickstart guide to send your first request!
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                    <th style={{ padding: '0.875rem 1.5rem', fontWeight: 600 }}>METHOD & PATH</th>
                    <th style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>TOTAL REQUESTS</th>
                    <th style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>AVG LATENCY</th>
                    <th style={{ padding: '0.875rem 1.5rem', fontWeight: 600 }}>ERROR RATE</th>
                  </tr>
                </thead>
                <tbody>
                  {endpointStats.map((ep, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '0.875rem 1.5rem' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '0.15rem 0.4rem',
                            borderRadius: '4px',
                            fontWeight: 700,
                            fontSize: '0.7rem',
                            marginRight: '0.6rem',
                            backgroundColor: ep.method === 'POST' ? '#dbeafe' : '#e0e7ff',
                            color: ep.method === 'POST' ? '#1d4ed8' : '#3730a3'
                          }}
                        >
                          {ep.method}
                        </span>
                        <code style={{ fontFamily: 'monospace', fontWeight: 600 }}>{ep.path}</code>
                      </td>
                      <td style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>{ep.total_requests}</td>
                      <td style={{ padding: '0.875rem 1rem', color: '#64748b' }}>
                        {ep.avg_latency_ms ? `${ep.avg_latency_ms} ms` : 'N/A'}
                      </td>
                      <td style={{ padding: '0.875rem 1.5rem' }}>
                        <span style={{ color: ep.error_rate > 0 ? '#dc2626' : '#16a34a', fontWeight: 600 }}>
                          {ep.error_rate}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* TAB 4: QUICKSTART & INTEGRATION */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'quickstart' && (
        <div>
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              padding: '2rem',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)'
            }}
          >
            <div className="flex items-center justify-between" style={{ marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ margin: 0, fontWeight: 700, fontSize: '1.1rem' }}>Developer Quickstart Guide</h3>
                <p style={{ margin: '0.25rem 0 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                  Connect your CRM or backend in less than 5 minutes using these code snippets.
                </p>
              </div>

              {/* Language Switcher */}
              <div
                style={{
                  display: 'flex',
                  backgroundColor: '#f1f5f9',
                  borderRadius: '8px',
                  padding: '0.2rem'
                }}
              >
                {(['curl', 'node', 'python'] as const).map((lang) => (
                  <button
                    key={lang}
                    onClick={() => setCodeLang(lang)}
                    style={{
                      padding: '0.4rem 1rem',
                      borderRadius: '6px',
                      fontSize: '0.8rem',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      backgroundColor: codeLang === lang ? '#0f172a' : 'transparent',
                      color: codeLang === lang ? '#ffffff' : '#64748b'
                    }}
                  >
                    {lang === 'node' ? 'Node.js' : lang}
                  </button>
                ))}
              </div>
            </div>

            {/* Code Block Container */}
            <div
              style={{
                backgroundColor: '#0f172a',
                borderRadius: '10px',
                overflow: 'hidden',
                position: 'relative',
                border: '1px solid #334155'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '0.75rem 1.25rem',
                  borderBottom: '1px solid #1e293b',
                  backgroundColor: '#09101d'
                }}
              >
                <div className="flex items-center gap-2">
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#ef4444' }} />
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#eab308' }} />
                  <span style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: '#22c55e' }} />
                  <span style={{ marginLeft: '0.5rem', color: '#64748b', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                    UNAI FLOW WhatsApp REST API
                  </span>
                </div>
                <button
                  onClick={() => copyToClipboard(getQuickstartCode(), true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    color: '#94a3b8',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    padding: '0.25rem 0.5rem',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)'
                  }}
                >
                  {copiedCode ? <Check size={12} style={{ color: '#22c55e' }} /> : <Copy size={12} />}
                  {copiedCode ? 'Copied' : 'Copy Code'}
                </button>
              </div>

              <pre
                style={{
                  margin: 0,
                  padding: '1.5rem',
                  color: '#e2e8f0',
                  fontFamily: 'Consolas, Monaco, "Courier New", monospace',
                  fontSize: '0.875rem',
                  lineHeight: '1.6',
                  overflowX: 'auto'
                }}
              >
                {getQuickstartCode()}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL: CREATE API KEY */}
      {/* ───────────────────────────────────────────────────────────── */}
      {showCreateKeyModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            backdropFilter: 'blur(4px)'
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '2rem',
              width: '100%',
              maxWidth: '520px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              border: '1px solid #e2e8f0'
            }}
          >
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 0.5rem 0', color: '#0f172a' }}>
              Create Developer API Key
            </h3>
            <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '0 0 1.5rem 0' }}>
              Issue a secure HMAC API key for your backend services to interact with WhatsApp.
            </p>

            <form onSubmit={handleCreateKey}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                  Key Label / Name *
                </label>
                <input
                  type="text"
                  placeholder="e.g. Production Backend / CRM Integration"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                  Environment
                </label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '0.875rem' }}>
                    <input
                      type="radio"
                      name="env"
                      checked={newKeyEnv === 'live'}
                      onChange={() => setNewKeyEnv('live')}
                    />
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>Live (Production)</span>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>- wa_live_...</span>
                  </label>
                  <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '0.875rem' }}>
                    <input
                      type="radio"
                      name="env"
                      checked={newKeyEnv === 'test'}
                      onChange={() => setNewKeyEnv('test')}
                    />
                    <span style={{ fontWeight: 600, color: '#0f172a' }}>Test (Sandbox)</span>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>- wa_test_...</span>
                  </label>
                </div>
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                  Rate Limit Override (Optional)
                </label>
                <input
                  type="number"
                  placeholder="Leave empty for default (100 req/min)"
                  value={newKeyRateLimit}
                  onChange={(e) => setNewKeyRateLimit(e.target.value)}
                  min={10}
                  max={5000}
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                  Permission Scopes
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                  {[
                    { id: 'messages:send', label: 'Send Messages' },
                    { id: 'campaigns:write', label: 'Create Campaigns' },
                    { id: 'campaigns:read', label: 'Read Campaigns' },
                    { id: 'channels:read', label: 'Read Channels' },
                    { id: 'instances:read', label: 'Read Instances' },
                    { id: 'usage:read', label: 'Read Analytics' }
                  ].map((sc) => (
                    <label key={sc.id} className="flex items-center gap-2" style={{ fontSize: '0.8rem', color: '#475569' }}>
                      <input
                        type="checkbox"
                        checked={newKeyScopes.includes(sc.id)}
                        onChange={(e) => {
                          if (e.target.checked) setNewKeyScopes([...newKeyScopes, sc.id]);
                          else setNewKeyScopes(newKeyScopes.filter((x) => x !== sc.id));
                        }}
                      />
                      {sc.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateKeyModal(false)}
                  style={{
                    padding: '0.65rem 1.25rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    color: '#64748b',
                    fontWeight: 600,
                    fontSize: '0.875rem'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '0.65rem 1.25rem',
                    borderRadius: '8px',
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    fontWeight: 600,
                    fontSize: '0.875rem'
                  }}
                >
                  Create Key
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL: CREATE WEBHOOK */}
      {/* ───────────────────────────────────────────────────────────── */}
      {showCreateWebhookModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            backdropFilter: 'blur(4px)'
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '2rem',
              width: '100%',
              maxWidth: '520px',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              border: '1px solid #e2e8f0'
            }}
          >
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 0.5rem 0', color: '#0f172a' }}>
              Register Webhook Endpoint
            </h3>
            <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '0 0 1.5rem 0' }}>
              Enter an HTTPS URL that accepts POST requests. We'll sign payloads with HMAC-SHA256.
            </p>

            <form onSubmit={handleCreateWebhook}>
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                  Webhook URL (HTTPS) *
                </label>
                <input
                  type="url"
                  placeholder="https://api.yourdomain.com/webhooks/unai"
                  value={newWebhookUrl}
                  onChange={(e) => setNewWebhookUrl(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem',
                    outline: 'none'
                  }}
                />
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                  Subscribed Events
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '0.6rem' }}>
                  {[
                    { id: 'message.sent', label: 'message.sent — Delivery successful' },
                    { id: 'message.failed', label: 'message.failed — Delivery error' },
                    { id: 'campaign.launched', label: 'campaign.launched — Campaign queued' },
                    { id: 'campaign.completed', label: 'campaign.completed — All recipients processed' },
                    { id: 'campaign.cancelled', label: 'campaign.cancelled — Campaign halted' }
                  ].map((ev) => (
                    <label key={ev.id} className="flex items-center gap-2" style={{ fontSize: '0.85rem', color: '#334155' }}>
                      <input
                        type="checkbox"
                        checked={newWebhookEvents.includes(ev.id)}
                        onChange={(e) => {
                          if (e.target.checked) setNewWebhookEvents([...newWebhookEvents, ev.id]);
                          else setNewWebhookEvents(newWebhookEvents.filter((x) => x !== ev.id));
                        }}
                      />
                      <code>{ev.label}</code>
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateWebhookModal(false)}
                  style={{
                    padding: '0.65rem 1.25rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    color: '#64748b',
                    fontWeight: 600,
                    fontSize: '0.875rem'
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  style={{
                    padding: '0.65rem 1.25rem',
                    borderRadius: '8px',
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    fontWeight: 600,
                    fontSize: '0.875rem'
                  }}
                >
                  Register Webhook
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
