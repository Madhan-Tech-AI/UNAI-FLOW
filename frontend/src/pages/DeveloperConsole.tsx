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
  Send,
  AppWindow,
  Settings,
  Eye,
  EyeOff,
  AlertTriangle
} from 'lucide-react';
import { fetchApi } from '../lib/apiClient';

interface ApplicationItem {
  id: string;
  client_id: string;
  name: string;
  description?: string;
  environment: string;
  status: string;
  default_instance_id?: string;
  scopes: string[];
  api_key_count: number;
  webhook_count: number;
  webhook_secret?: string;
  created_at: string;
  updated_at?: string;
}

interface ApiKeyItem {
  id: string;
  name: string;
  description?: string;
  prefix: string;
  scopes: string[];
  environment: string;
  rate_limit_override?: number;
  application_id?: string;
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
  const [activeTab, setActiveTab] = useState<'apps' | 'keys' | 'webhooks' | 'usage' | 'quickstart'>('apps');

  // Applications state
  const [apps, setApps] = useState<ApplicationItem[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [creatingApp, setCreatingApp] = useState(false);
  const [createAppError, setCreateAppError] = useState<string | null>(null);
  const [showCreateAppModal, setShowCreateAppModal] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [newAppDesc, setNewAppDesc] = useState('');
  const [newAppEnv, setNewAppEnv] = useState<'live' | 'test'>('live');
  const [newAppScopes, setNewAppScopes] = useState<string[]>([
    'instances:read', 'channels:read', 'messages:send',
    'campaigns:read', 'campaigns:write', 'usage:read',
    'webhooks:read', 'webhooks:manage'
  ]);
  const [newlyCreatedApp, setNewlyCreatedApp] = useState<{
    client_id: string;
    raw_api_key: string;
    webhook_secret: string;
    name: string;
  } | null>(null);
  const [copiedAppCred, setCopiedAppCred] = useState<string | null>(null);
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

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
    loadApps();
    loadKeys();
    loadWebhooks();
    loadUsage();
  }, []);

  useEffect(() => {
    loadUsage();
  }, [usagePeriod]);

  const loadApps = async () => {
    setAppsLoading(true);
    try {
      const data = await fetchApi('/v1/applications');
      if (Array.isArray(data)) setApps(data);
    } catch (err) {
      console.error('Failed to load applications:', err);
    } finally {
      setAppsLoading(false);
    }
  };

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

  const handleCreateApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppName.trim()) return;
    setCreatingApp(true);
    setCreateAppError(null);
    try {
      const idempotencyKey = `app_create_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const res = await fetchApi('/v1/applications', {
        method: 'POST',
        headers: {
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          name: newAppName.trim(),
          description: newAppDesc.trim() || undefined,
          environment: newAppEnv,
          scopes: newAppScopes,
          idempotency_key: idempotencyKey,
        })
      });
      setNewlyCreatedApp({
        client_id: res.client_id,
        raw_api_key: res.raw_api_key,
        webhook_secret: res.webhook_secret,
        name: res.name,
      });

      // Optimistically add the newly created application to state immediately
      setApps((prev) => [
        {
          id: res.id,
          client_id: res.client_id,
          name: res.name,
          description: res.description,
          environment: res.environment,
          status: res.status || 'active',
          scopes: res.scopes || [],
          api_key_count: res.api_key_count || 1,
          webhook_count: res.webhook_count || 0,
          webhook_secret: res.webhook_secret,
          created_at: res.created_at || new Date().toISOString(),
          updated_at: res.updated_at || new Date().toISOString(),
        },
        ...prev.filter((a) => a.id !== res.id)
      ]);

      setShowCreateAppModal(false);
      setNewAppName('');
      setNewAppDesc('');
      setCreateAppError(null);
      loadApps();
    } catch (err: any) {
      setCreateAppError(err?.message || 'Failed to create application');
    } finally {
      setCreatingApp(false);
    }
  };

  const handleSuspendApp = async (id: string, name: string) => {
    if (!confirm(`Suspend application "${name}"? All its API keys will be revoked immediately.`)) return;
    try {
      await fetchApi(`/v1/applications/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'suspended' })
      });
      loadApps();
    } catch (err: any) {
      alert(err?.message || 'Failed to suspend application');
    }
  };

  const handleDeleteApp = async (id: string, name: string) => {
    if (!confirm(`Permanently revoke application "${name}"? This cannot be undone.`)) return;
    try {
      await fetchApi(`/v1/applications/${id}`, { method: 'DELETE' });
      loadApps();
    } catch (err: any) {
      alert(err?.message || 'Failed to delete application');
    }
  };

  const handleRegenerateAppKey = async (id: string, name: string) => {
    if (!confirm(`Regenerate API key for "${name}"? The old key will stop working immediately.`)) return;
    try {
      const res = await fetchApi(`/v1/applications/${id}/regenerate-key`, { method: 'POST' });
      setNewlyCreatedApp({
        client_id: '',
        raw_api_key: res.raw_key,
        webhook_secret: '',
        name: `${name} (Regenerated Key)`,
      });
    } catch (err: any) {
      alert(err?.message || 'Failed to regenerate key');
    }
  };

  const copyAppCredential = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedAppCred(label);
    setTimeout(() => setCopiedAppCred(null), 2000);
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
              if (activeTab === 'apps') setShowCreateAppModal(true);
              else if (activeTab === 'keys') setShowCreateKeyModal(true);
              else if (activeTab === 'webhooks') setShowCreateWebhookModal(true);
              else setActiveTab('apps');
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
            <Plus size={18} /> {activeTab === 'apps' ? 'New Application' : activeTab === 'webhooks' ? 'New Webhook' : 'Create API Key'}
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
          { id: 'apps', label: 'Applications', icon: AppWindow, count: apps.length },
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
      {/* TAB 0: APPLICATIONS */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'apps' && (
        <div>
          {/* One-time Credentials Banner */}
          {newlyCreatedApp && (
            <div
              style={{
                backgroundColor: '#f0fdf4',
                border: '1px solid #bbf7d0',
                borderRadius: '12px',
                padding: '1.5rem',
                marginBottom: '1.5rem',
                boxShadow: '0 4px 12px rgba(34, 197, 94, 0.1)'
              }}
            >
              <div className="flex items-center justify-between" style={{ marginBottom: '0.75rem' }}>
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={20} color="#16a34a" />
                  <span style={{ fontWeight: 700, color: '#15803d', fontSize: '1rem' }}>
                    Application "{newlyCreatedApp.name}" Created
                  </span>
                </div>
                <button
                  onClick={() => setNewlyCreatedApp(null)}
                  style={{ color: '#64748b', fontWeight: 600, fontSize: '0.85rem' }}
                >
                  Dismiss
                </button>
              </div>
              <p style={{ color: '#166534', fontSize: '0.85rem', marginBottom: '1rem' }}>
                ⚠️ Copy these credentials now — the API key will <strong>never</strong> be shown again.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {newlyCreatedApp.client_id && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ color: '#374151', fontWeight: 600, minWidth: '120px', fontSize: '0.85rem' }}>Client ID:</span>
                    <code style={{ backgroundColor: '#ecfdf5', padding: '0.5rem 0.75rem', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.85rem', flex: 1 }}>
                      {newlyCreatedApp.client_id}
                    </code>
                    <button onClick={() => copyAppCredential(newlyCreatedApp.client_id, 'client_id')} style={{ padding: '0.3rem', color: copiedAppCred === 'client_id' ? '#16a34a' : '#64748b' }}>
                      {copiedAppCred === 'client_id' ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ color: '#374151', fontWeight: 600, minWidth: '120px', fontSize: '0.85rem' }}>API Key:</span>
                  <code style={{ backgroundColor: '#fef3c7', padding: '0.5rem 0.75rem', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.85rem', flex: 1, color: '#92400e' }}>
                    {newlyCreatedApp.raw_api_key}
                  </code>
                  <button onClick={() => copyAppCredential(newlyCreatedApp.raw_api_key, 'api_key')} style={{ padding: '0.3rem', color: copiedAppCred === 'api_key' ? '#16a34a' : '#64748b' }}>
                    {copiedAppCred === 'api_key' ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
                {newlyCreatedApp.webhook_secret && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ color: '#374151', fontWeight: 600, minWidth: '120px', fontSize: '0.85rem' }}>Webhook Secret:</span>
                    <code style={{ backgroundColor: '#ecfdf5', padding: '0.5rem 0.75rem', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.85rem', flex: 1 }}>
                      {newlyCreatedApp.webhook_secret}
                    </code>
                    <button onClick={() => copyAppCredential(newlyCreatedApp.webhook_secret, 'webhook_secret')} style={{ padding: '0.3rem', color: copiedAppCred === 'webhook_secret' ? '#16a34a' : '#64748b' }}>
                      {copiedAppCred === 'webhook_secret' ? <Check size={16} /> : <Copy size={16} />}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Application Cards */}
          {appsLoading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>Loading applications...</div>
          ) : apps.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '4rem 2rem',
                backgroundColor: '#f8fafc',
                borderRadius: '16px',
                border: '2px dashed #e2e8f0'
              }}
            >
              <AppWindow size={48} color="#94a3b8" style={{ marginBottom: '1rem', margin: '0 auto 1rem' }} />
              <h3 style={{ color: '#1e293b', fontWeight: 700, fontSize: '1.25rem', marginBottom: '0.5rem' }}>No Applications Yet</h3>
              <p style={{ color: '#64748b', maxWidth: '400px', margin: '0 auto 1.5rem' }}>
                Create your first application to generate API credentials for your CRM, ERP, or external integrations.
              </p>
              <button
                onClick={() => setShowCreateAppModal(true)}
                style={{
                  background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
                  color: '#fff',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '10px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
              >
                <Plus size={18} /> Create Application
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '1rem' }}>
              {apps.map((app) => (
                <div
                  key={app.id}
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '14px',
                    padding: '1.5rem',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                    transition: 'box-shadow 0.15s',
                  }}
                >
                  <div className="flex items-center justify-between" style={{ marginBottom: '0.75rem' }}>
                    <div className="flex items-center gap-3">
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '10px',
                          background: app.status === 'active'
                            ? 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)'
                            : 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <AppWindow size={20} color="#fff" />
                      </div>
                      <div>
                        <h3 style={{ fontWeight: 700, fontSize: '1.05rem', color: '#1e293b', margin: 0 }}>{app.name}</h3>
                        {app.description && (
                          <p style={{ color: '#64748b', fontSize: '0.8rem', margin: 0 }}>{app.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        style={{
                          backgroundColor: app.status === 'active' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                          color: app.status === 'active' ? '#16a34a' : '#dc2626',
                          padding: '0.2rem 0.6rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          textTransform: 'uppercase' as const
                        }}
                      >
                        {app.status}
                      </span>
                      <span
                        style={{
                          backgroundColor: app.environment === 'live' ? 'rgba(37, 99, 235, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                          color: app.environment === 'live' ? '#2563eb' : '#d97706',
                          padding: '0.2rem 0.6rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 600
                        }}
                      >
                        {app.environment.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '2rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#64748b' }}>
                    <div>
                      <span style={{ fontWeight: 600, color: '#374151' }}>Client ID: </span>
                      <code style={{ fontSize: '0.8rem', backgroundColor: '#f1f5f9', padding: '0.15rem 0.4rem', borderRadius: '4px' }}>{app.client_id}</code>
                    </div>
                    <div><Key size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> {app.api_key_count} key{app.api_key_count !== 1 ? 's' : ''}</div>
                    <div><Webhook size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> {app.webhook_count} webhook{app.webhook_count !== 1 ? 's' : ''}</div>
                    <div style={{ marginLeft: 'auto', fontSize: '0.8rem' }}>Created {new Date(app.created_at).toLocaleDateString()}</div>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={() => setExpandedAppId(expandedAppId === app.id ? null : app.id)}
                      style={{
                        padding: '0.5rem 0.85rem',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        backgroundColor: '#f1f5f9',
                        color: '#475569',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem'
                      }}
                    >
                      <Settings size={14} /> {expandedAppId === app.id ? 'Hide Details' : 'View Details'}
                    </button>
                    <button
                      onClick={() => handleRegenerateAppKey(app.id, app.name)}
                      style={{
                        padding: '0.5rem 0.85rem',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        backgroundColor: '#eff6ff',
                        color: '#2563eb',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem'
                      }}
                    >
                      <RefreshCw size={14} /> Regenerate Key
                    </button>
                    {app.status === 'active' && (
                      <button
                        onClick={() => handleSuspendApp(app.id, app.name)}
                        style={{
                          padding: '0.5rem 0.85rem',
                          borderRadius: '8px',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          backgroundColor: '#fef2f2',
                          color: '#dc2626',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem'
                        }}
                      >
                        <AlertTriangle size={14} /> Suspend
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteApp(app.id, app.name)}
                      style={{
                        padding: '0.5rem 0.85rem',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        backgroundColor: '#fef2f2',
                        color: '#dc2626',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        marginLeft: 'auto'
                      }}
                    >
                      <Trash2 size={14} /> Revoke
                    </button>
                  </div>

                  {/* Expanded Details */}
                  {expandedAppId === app.id && (
                    <div
                      style={{
                        marginTop: '1rem',
                        padding: '1.25rem',
                        backgroundColor: '#f8fafc',
                        borderRadius: '10px',
                        border: '1px solid #e2e8f0'
                      }}
                    >
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b', marginBottom: '0.75rem' }}>Application Credentials</h4>
                      <div style={{ display: 'grid', gap: '0.5rem', fontSize: '0.85rem' }}>
                        <div className="flex items-center gap-2">
                          <span style={{ fontWeight: 600, color: '#374151', minWidth: '120px' }}>Client ID</span>
                          <code style={{ backgroundColor: '#e2e8f0', padding: '0.3rem 0.6rem', borderRadius: '6px', fontFamily: 'monospace', flex: 1 }}>
                            {app.client_id}
                          </code>
                          <button onClick={() => copyAppCredential(app.client_id, `cid-${app.id}`)} style={{ padding: '0.2rem', color: copiedAppCred === `cid-${app.id}` ? '#16a34a' : '#94a3b8' }}>
                            {copiedAppCred === `cid-${app.id}` ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span style={{ fontWeight: 600, color: '#374151', minWidth: '120px' }}>Webhook Secret</span>
                          <code style={{ backgroundColor: '#e2e8f0', padding: '0.3rem 0.6rem', borderRadius: '6px', fontFamily: 'monospace', flex: 1 }}>
                            {showSecrets[app.id] ? (app.webhook_secret || '—') : '••••••••••••••••••'}
                          </code>
                          <button onClick={() => setShowSecrets(p => ({...p, [app.id]: !p[app.id]}))} style={{ padding: '0.2rem', color: '#94a3b8' }}>
                            {showSecrets[app.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span style={{ fontWeight: 600, color: '#374151', minWidth: '120px' }}>Scopes</span>
                          <div className="flex gap-1 flex-wrap">
                            {(app.scopes || []).map((s) => (
                              <span key={s} style={{ backgroundColor: '#dbeafe', color: '#1e40af', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>{s}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Create Application Modal */}
      {showCreateAppModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            backdropFilter: 'blur(4px)'
          }}
          onClick={() => setShowCreateAppModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '2rem',
              width: '500px',
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
            }}
          >
            <h2 style={{ fontWeight: 800, fontSize: '1.25rem', color: '#0f172a', marginBottom: '1.5rem' }}>Create Application</h2>
            <form onSubmit={handleCreateApp}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#374151', display: 'block', marginBottom: '0.4rem' }}>Application Name *</label>
                <input
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  placeholder="e.g. Zoho CRM Integration"
                  style={{ width: '100%', padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '10px', fontSize: '0.9rem' }}
                  required
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#374151', display: 'block', marginBottom: '0.4rem' }}>Description</label>
                <input
                  value={newAppDesc}
                  onChange={(e) => setNewAppDesc(e.target.value)}
                  placeholder="Optional — what is this integration for?"
                  style={{ width: '100%', padding: '0.75rem', border: '1px solid #d1d5db', borderRadius: '10px', fontSize: '0.9rem' }}
                />
              </div>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#374151', display: 'block', marginBottom: '0.4rem' }}>Environment</label>
                <div className="flex gap-2">
                  {(['live', 'test'] as const).map((env) => (
                    <button
                      key={env}
                      type="button"
                      onClick={() => setNewAppEnv(env)}
                      style={{
                        padding: '0.5rem 1.25rem',
                        borderRadius: '8px',
                        fontSize: '0.85rem',
                        fontWeight: 600,
                        border: '2px solid',
                        borderColor: newAppEnv === env ? '#2563eb' : '#d1d5db',
                        backgroundColor: newAppEnv === env ? '#eff6ff' : '#ffffff',
                        color: newAppEnv === env ? '#2563eb' : '#6b7280',
                      }}
                    >
                      {env === 'live' ? '🟢 Live' : '🟡 Test'}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#374151', display: 'block', marginBottom: '0.5rem' }}>Permissions</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                  {['messages:send', 'campaigns:read', 'campaigns:write', 'instances:read', 'channels:read', 'usage:read', 'webhooks:read', 'webhooks:manage'].map((s) => (
                    <label key={s} className="flex items-center gap-2" style={{ fontSize: '0.8rem', color: '#374151' }}>
                      <input
                        type="checkbox"
                        checked={newAppScopes.includes(s)}
                        onChange={() => {
                          setNewAppScopes((prev) =>
                            prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                          );
                        }}
                      />
                      <code style={{ fontSize: '0.75rem' }}>{s}</code>
                    </label>
                  ))}
                </div>
              </div>
              {createAppError && (
                <div
                  style={{
                    marginBottom: '1rem',
                    padding: '0.75rem 1rem',
                    borderRadius: '10px',
                    backgroundColor: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#b91c1c',
                    fontSize: '0.85rem',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.5rem',
                  }}
                >
                  <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '0.15rem' }} />
                  <div>
                    <strong style={{ display: 'block', fontWeight: 700 }}>Application Creation Failed</strong>
                    <span>{createAppError}</span>
                  </div>
                </div>
              )}

              <div className="flex gap-3" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateAppModal(false);
                    setCreateAppError(null);
                  }}
                  style={{ padding: '0.65rem 1.25rem', borderRadius: '10px', fontWeight: 600, fontSize: '0.875rem', backgroundColor: '#f1f5f9', color: '#475569' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingApp}
                  style={{
                    padding: '0.65rem 1.25rem',
                    borderRadius: '10px',
                    fontWeight: 600,
                    fontSize: '0.875rem',
                    background: creatingApp
                      ? 'linear-gradient(135deg, #93c5fd 0%, #bfdbfe 100%)'
                      : 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
                    color: '#fff',
                    boxShadow: creatingApp ? 'none' : '0 4px 12px rgba(37, 99, 235, 0.3)',
                    cursor: creatingApp ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    transition: 'all 0.2s ease',
                  }}
                >
                  {creatingApp && (
                    <svg width="16" height="16" viewBox="0 0 24 24" style={{ animation: 'spin 1s linear infinite' }}>
                      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" fill="none" strokeDasharray="31.4" strokeLinecap="round" />
                    </svg>
                  )}
                  {creatingApp ? 'Creating...' : 'Create Application'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

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
