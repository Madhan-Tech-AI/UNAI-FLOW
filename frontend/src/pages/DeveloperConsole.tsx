import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  AlertTriangle,
  Smartphone,
  Phone,
  Lock,
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
  client_secret_preview?: string;
  oauth_client_id?: string;
  whatsapp_number?: string;
  whatsapp_session_id?: string;
  last_used_at?: string;
  created_at: string;
  updated_at?: string;
}

interface WhatsAppSessionItem {
  id: string;
  session_identifier: string;
  phone_number?: string;
  status: string;
  profile_picture_url?: string;
  last_connected_at?: string;
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

interface DiagnosticResult {
  status: string;
  app_id: string;
  name: string;
  environment: string;
  is_active: boolean;
  auth_valid: boolean;
  scopes: string[];
  whatsapp_number?: string;
  whatsapp_connected: boolean;
  latency_ms: number;
  timestamp: string;
  checks: Record<string, string>;
}

export default function DeveloperConsole() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'apps' | 'keys' | 'webhooks' | 'whatsapp' | 'usage' | 'quickstart'>('apps');

  // Applications state
  const [apps, setApps] = useState<ApplicationItem[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [creatingApp, setCreatingApp] = useState(false);
  const [createAppError, setCreateAppError] = useState<string | null>(null);
  const [showCreateAppModal, setShowCreateAppModal] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [newAppDesc, setNewAppDesc] = useState('');
  const [newAppEnv, setNewAppEnv] = useState<'live' | 'test'>('live');
  const [newAppWhatsAppNumber, setNewAppWhatsAppNumber] = useState('');
  const [newAppWhatsAppSessionId, setNewAppWhatsAppSessionId] = useState('');
  const [customPhoneInput, setCustomPhoneInput] = useState(false);
  const [newAppScopes, setNewAppScopes] = useState<string[]>([
    'instances:read', 'channels:read', 'messages:send',
    'campaigns:read', 'campaigns:write', 'usage:read',
    'webhooks:read', 'webhooks:manage'
  ]);
  const [newlyCreatedApp, setNewlyCreatedApp] = useState<{
    id?: string;
    client_id: string;
    client_secret?: string;
    raw_api_key: string;
    webhook_secret: string;
    oauth_client_id?: string;
    oauth_client_secret?: string;
    whatsapp_number?: string;
    name: string;
  } | null>(null);
  const [copiedAppCred, setCopiedAppCred] = useState<string | null>(null);
  const [expandedAppId, setExpandedAppId] = useState<string | null>(null);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  // Secret Rotation State
  const [rotatedSecretModal, setRotatedSecretModal] = useState<{
    appName: string;
    clientSecret: string;
    preview: string;
  } | null>(null);

  // Diagnostic Test State
  const [testingAppId, setTestingAppId] = useState<string | null>(null);
  const [diagnosticModalData, setDiagnosticModalData] = useState<DiagnosticResult | null>(null);

  // WhatsApp Sessions State
  const [whatsappSessions, setWhatsappSessions] = useState<WhatsAppSessionItem[]>([]);
  const [whatsappLoading, setWhatsappLoading] = useState(false);
  const [gatewayStatus, setGatewayStatus] = useState<any>(null);

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
  // messageStats removed
  // endpointStats removed
  const [usageLoading, setUsageLoading] = useState(false);

  // Quickstart state
  const [codeLang, setCodeLang] = useState<'curl' | 'node' | 'python' | 'crm'>('crm');
  const [copiedCode, setCopiedCode] = useState(false);

  // Live Test Bench State
  const [testApiKey, setTestApiKey] = useState<string>('');
  const [testRecipient, setTestRecipient] = useState<string>('');
  const [testMessage, setTestMessage] = useState<string>('Hello! This is a live test message from UNAI FLOW Developer API.');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Initial Load
  useEffect(() => {
    loadApps();
    loadKeys();
    loadWebhooks();
    loadWhatsAppSessions();
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

  const loadWhatsAppSessions = async () => {
    setWhatsappLoading(true);
    try {
      const [sessRes, gwRes] = await Promise.all([
        fetchApi('/api/whatsapp/sessions').catch(() => null),
        fetchApi('/v1/whatsapp/status').catch(() => null)
      ]);
      if (sessRes?.data && Array.isArray(sessRes.data)) {
        setWhatsappSessions(sessRes.data);
      }
      if (gwRes) {
        setGatewayStatus(gwRes);
      }
    } catch (err) {
      console.error('Failed to load WhatsApp status:', err);
    } finally {
      setWhatsappLoading(false);
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
      const sum = await fetchApi(`/v1/usage/summary?period_type=${usagePeriod}`);
      setUsageSummary(sum);
      // setMessageStats
      // setEndpointStats
    } catch (err) {
      console.error('Failed to load usage analytics:', err);
    } finally {
      setUsageLoading(false);
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
          whatsapp_number: newAppWhatsAppNumber.trim() || undefined,
          whatsapp_session_id: newAppWhatsAppSessionId.trim() || undefined,
          idempotency_key: idempotencyKey,
        })
      });

      setNewlyCreatedApp({
        id: res.id,
        client_id: res.client_id,
        client_secret: res.client_secret,
        raw_api_key: res.raw_api_key,
        webhook_secret: res.webhook_secret,
        oauth_client_id: res.oauth_client_id,
        oauth_client_secret: res.oauth_client_secret,
        whatsapp_number: res.whatsapp_number || newAppWhatsAppNumber,
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
          client_secret_preview: res.client_secret_preview,
          oauth_client_id: res.oauth_client_id,
          whatsapp_number: res.whatsapp_number,
          whatsapp_session_id: res.whatsapp_session_id,
          last_used_at: undefined,
          created_at: res.created_at || new Date().toISOString(),
          updated_at: res.updated_at || new Date().toISOString(),
        },
        ...prev.filter((a) => a.id !== res.id)
      ]);

      setShowCreateAppModal(false);
      setNewAppName('');
      setNewAppDesc('');
      setNewAppWhatsAppNumber('');
      setNewAppWhatsAppSessionId('');
      setCustomPhoneInput(false);
      setCreateAppError(null);
      loadApps();
    } catch (err: any) {
      setCreateAppError(err?.message || 'Failed to create application');
    } finally {
      setCreatingApp(false);
    }
  };

  const handleTestConnection = async (appId: string) => {
    setTestingAppId(appId);
    try {
      const res = await fetchApi(`/v1/applications/${appId}/test-connection`, {
        method: 'POST'
      });
      setDiagnosticModalData(res);
    } catch (err: any) {
      alert(`Diagnostic test failed: ${err?.message || 'Unknown network error'}`);
    } finally {
      setTestingAppId(null);
    }
  };

  const handleRegenerateAppSecret = async (id: string, name: string) => {
    if (!confirm(`Rotate Client Secret for "${name}"? The previous secret will immediately stop working.`)) return;
    try {
      const res = await fetchApi(`/v1/applications/${id}/regenerate-secret`, { method: 'POST' });
      setRotatedSecretModal({
        appName: name,
        clientSecret: res.client_secret,
        preview: res.client_secret_preview,
      });
      loadApps();
    } catch (err: any) {
      alert(err?.message || 'Failed to rotate client secret');
    }
  };

  const handleSuspendApp = async (id: string, name: string) => {
    if (!confirm(`Suspend application "${name}"? All its API keys and credentials will be suspended.`)) return;
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

  const handleActivateApp = async (id: string, _name?: string) => {
    try {
      await fetchApi(`/v1/applications/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'active' })
      });
      loadApps();
    } catch (err: any) {
      alert(err?.message || 'Failed to activate application');
    }
  };

  const handleDeleteApp = async (id: string, name: string) => {
    if (!confirm(`Permanently revoke application "${name}"? This action cannot be undone.`)) return;
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
    if (!confirm(`Are you sure you want to revoke API key "${name}"? Integrations using it will stop working immediately.`)) return;
    try {
      await fetchApi(`/v1/api-keys/${id}`, { method: 'DELETE' });
      loadKeys();
    } catch (err: any) {
      alert(err?.message || 'Failed to revoke API key');
    }
  };

  const handleRotateKey = async (id: string) => {
    if (!confirm('Rotating this key will immediately revoke the old key and create a replacement. Continue?')) return;
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

  // Sample credentials for Quickstart
  const sampleClientId = apps.length > 0 ? apps[0].client_id : 'app_live_8f3d4a1b0c9e2f5';
  const sampleKey = keys.length > 0 ? `${keys[0].prefix}****************` : 'wa_live_xxxxxxxxxxxxxxxxxxxxxx';
  const sampleWhatsApp = apps.find(a => a.whatsapp_number)?.whatsapp_number || '919876543210';

  // Auto-populate test recipient with connected phone number
  useEffect(() => {
    if (!testRecipient) {
      const activeNumber = gatewayStatus?.phone_number || apps.find(a => a.whatsapp_number)?.whatsapp_number || whatsappSessions.find(s => s.phone_number)?.phone_number;
      if (activeNumber) {
        setTestRecipient(activeNumber.startsWith('+') ? activeNumber : `+${activeNumber}`);
      }
    }
    const activeCreatedRawKey = newlyCreatedApp?.raw_api_key || newlyCreatedKey?.raw_key;
    if (!testApiKey && activeCreatedRawKey) {
      setTestApiKey(activeCreatedRawKey);
    }
  }, [gatewayStatus, apps, whatsappSessions, newlyCreatedApp, newlyCreatedKey]);

  const handleSendLiveTest = async () => {
    setTestSending(true);
    setTestResult(null);
    setTestError(null);

    const activeCreatedRawKey = newlyCreatedApp?.raw_api_key || newlyCreatedKey?.raw_key;
    const apiKey = testApiKey.trim() || activeCreatedRawKey || '';
    if (!apiKey) {
      setTestError('Please enter your Primary API Key (starts with wa_live_).');
      setTestSending(false);
      return;
    }

    if (!testRecipient.trim()) {
      setTestError('Please enter at least one recipient mobile phone number.');
      setTestSending(false);
      return;
    }

    const recipients = testRecipient.split(/[,;\n]+/).map(r => r.trim()).filter(Boolean);

    try {
      const payload: any = {
        to: recipients.length === 1 ? recipients[0] : recipients,
        message: testMessage.trim(),
        message_type: 'text',
      };

      const res = await fetchApi('/v1/messages/send', {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
        },
        body: JSON.stringify(payload),
      });

      setTestResult(res);
    } catch (err: any) {
      setTestError(err.message || 'Failed to dispatch live WhatsApp message.');
    } finally {
      setTestSending(false);
    }
  };

  const getQuickstartCode = () => {
    if (codeLang === 'crm') {
      const activeCreatedRawKey = newlyCreatedApp?.raw_api_key || newlyCreatedKey?.raw_key;
      const activeKeyDisplay = testApiKey || (activeCreatedRawKey ? activeCreatedRawKey : sampleKey);
      return `/* ================================================================
   EXTERNAL CRM & SAAS PLATFORM INTEGRATION GUIDE
   Works with Vekkalam CRM, Zoho, HubSpot, Zapier, Make, and Custom Backends
================================================================ */

1. API ENDPOINT SPECIFICATION
   --------------------------
   Method: POST
   URL:    https://unai-flow-backend-w4al.onrender.com/v1/messages/send
   Headers:
     Content-Type: application/json
     X-API-Key:    ${activeKeyDisplay}

2. SINGLE DIRECT NOTIFICATION (Order Confirmation / Alert)
   --------------------------------------------------------
   HTTP POST https://unai-flow-backend-w4al.onrender.com/v1/messages/send
   Headers:
     X-API-Key: ${activeKeyDisplay}
     Content-Type: application/json
   Body:
   {
     "to": "+${sampleWhatsApp}",
     "message": "Dear Customer, your request has been confirmed!",
     "message_type": "text"
   }

3. BULK BROADCAST CAMPAIGN (Multiple Leads / Customers)
   ----------------------------------------------------
   HTTP POST https://unai-flow-backend-w4al.onrender.com/v1/messages/send
   Headers:
     X-API-Key: ${activeKeyDisplay}
     Content-Type: application/json
   Body:
   {
     "campaign_name": "CRM Lead Broadcast",
     "to": [
       "+919876543210",
       "+919876543211",
       "+919876543212"
     ],
     "message": "Hello! Check out our exclusive new offer available today.",
     "message_type": "text"
   }

4. CRM ENVIRONMENT VARIABLES (Recommended for SaaS Backends)
   ----------------------------------------------------------
   UNAI_FLOW_API_URL=https://unai-flow-backend-w4al.onrender.com/v1
   UNAI_FLOW_API_KEY=${activeKeyDisplay}
   UNAI_FLOW_WHATSAPP_SENDER=+${sampleWhatsApp}`;
    }
    if (codeLang === 'curl') {
      return `# ================================================================
# 1. VERIFY APPLICATION & WHATSAPP CONNECTION HEALTH
# ================================================================
curl -X GET "https://unai-flow-backend-w4al.onrender.com/v1/auth/verify" \\
  -H "X-Client-ID: ${sampleClientId}" \\
  -H "X-Client-Secret: YOUR_CLIENT_SECRET"

# Or authenticate using Bearer API Key:
curl -X GET "https://unai-flow-backend-w4al.onrender.com/v1/whatsapp/status" \\
  -H "Authorization: Bearer ${sampleKey}"

# ================================================================
# 2. SEND SINGLE DIRECT WHATSAPP MESSAGE
# ================================================================
curl -X POST "https://unai-flow-backend-w4al.onrender.com/v1/messages/send" \\
  -H "X-Client-ID: ${sampleClientId}" \\
  -H "X-Client-Secret: YOUR_CLIENT_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{
    "to": "+${sampleWhatsApp}",
    "text": "Hello from your CRM! Your payment receipt #1042 is confirmed."
  }'

# ================================================================
# 3. DISPATCH PERSONALIZED BULK CAMPAIGN TO RECIPIENTS
# ================================================================
curl -X POST "https://unai-flow-backend-w4al.onrender.com/v1/messages/send" \\
  -H "Authorization: Bearer ${sampleKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "campaign_name": "VIP Customer Broadcast",
    "text": "Hello {{name}}, your monthly report is available at {{link}}",
    "recipients": [
      { "recipient_jid": "919876543210@s.whatsapp.net", "variables": { "name": "Raj", "link": "https://crm.example.com/r/1" } },
      { "recipient_jid": "919876543211@s.whatsapp.net", "variables": { "name": "Ananya", "link": "https://crm.example.com/r/2" } }
    ],
    "messages_per_second": 2.0
  }'`;
    }

    if (codeLang === 'node') {
      return `// Node.js (ES Module / TypeScript / Axios / Fetch)
import axios from 'axios';

const UNAI_CLIENT_ID = process.env.UNAI_CLIENT_ID || '${sampleClientId}';
const UNAI_CLIENT_SECRET = process.env.UNAI_CLIENT_SECRET || 'YOUR_CLIENT_SECRET';
const BASE_URL = 'https://unai-flow-backend-w4al.onrender.com/v1';

const client = axios.create({
  baseURL: BASE_URL,
  headers: {
    'X-Client-ID': UNAI_CLIENT_ID,
    'X-Client-Secret': UNAI_CLIENT_SECRET,
    'Content-Type': 'application/json'
  },
  timeout: 15000
});

// 1. Verify Authentication & WhatsApp Device Health
async function checkConnection() {
  const res = await client.get('/auth/verify');
  console.log('UNAI Platform Status:', res.data);
  // res.data -> { status: "active", whatsapp_number: "+${sampleWhatsApp}", scopes: [...] }
}

// 2. Dispatch a Realtime Notification (Single Message)
async function sendNotification(recipientPhone, messageText) {
  const response = await client.post('/messages/send', {
    to: recipientPhone, // e.g. "+919876543210"
    text: messageText
  });
  console.log('Message Dispatched:', response.data);
  return response.data;
}

// 3. Dispatch Bulk WhatsApp Campaign
async function sendBulkBroadcast(campaignName, recipients) {
  const response = await client.post('/messages/send', {
    campaign_name: campaignName,
    text: 'Hello {{name}}, your balance is {{balance}}.',
    recipients: recipients,
    messages_per_second: 2.0
  });
  console.log('Campaign Launched:', response.data.campaign_id);
  return response.data;
}

// Execute demo
checkConnection().catch(console.error);`;
    }

    return `# Python 3.9+ (requests)
import os
import requests

CLIENT_ID = os.getenv("UNAI_CLIENT_ID", "${sampleClientId}")
CLIENT_SECRET = os.getenv("UNAI_CLIENT_SECRET", "YOUR_CLIENT_SECRET")
BASE_URL = "https://unai-flow-backend-w4al.onrender.com/v1"

headers = {
    "X-Client-ID": CLIENT_ID,
    "X-Client-Secret": CLIENT_SECRET,
    "Content-Type": "application/json"
}

# 1. Health & Connection Check
def verify_connection():
    res = requests.get(f"{BASE_URL}/auth/verify", headers=headers, timeout=10)
    res.raise_for_status()
    print("UNAI Flow Status:", res.json())

# 2. Dispatch Single WhatsApp Message
def send_whatsapp_message(to_number: str, message: str):
    payload = {
        "to": to_number,
        "text": message
    }
    res = requests.post(f"{BASE_URL}/messages/send", json=payload, headers=headers, timeout=15)
    res.raise_for_status()
    print("Sent:", res.json())
    return res.json()

# 3. Dispatch Bulk Personalized Campaign
def launch_bulk_campaign():
    payload = {
        "campaign_name": "Monthly Statements",
        "text": "Hi {{name}}, your receipt for invoice #{{invoice}} is ready.",
        "recipients": [
            {"recipient_jid": "919876543210@s.whatsapp.net", "variables": {"name": "Suresh", "invoice": "INV-102"}},
            {"recipient_jid": "919876543211@s.whatsapp.net", "variables": {"name": "Meera", "invoice": "INV-103"}}
        ],
        "messages_per_second": 2.0
    }
    res = requests.post(f"{BASE_URL}/messages/send", json=payload, headers=headers)
    print("Campaign Launched:", res.json())

if __name__ == "__main__":
    verify_connection()`;
  };

  const connectedSessionCount = whatsappSessions.filter(
    s => s.status === 'CONNECTED' || s.status === 'READY'
  ).length;

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
            {connectedSessionCount > 0 && (
              <span
                style={{
                  backgroundColor: 'rgba(168, 85, 247, 0.2)',
                  color: '#c084fc',
                  padding: '0.2rem 0.6rem',
                  borderRadius: '6px',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <Smartphone size={12} /> {connectedSessionCount} WhatsApp Device{connectedSessionCount !== 1 ? 's' : ''} Online
              </span>
            )}
          </div>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 800, letterSpacing: '-0.03em', margin: 0 }}>
            WhatsApp Developer Console
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginTop: '0.4rem', maxWidth: '700px' }}>
            Integrate UNAI FLOW as your business's WhatsApp messaging gateway. Issue CRM Client Credentials, associate authenticated phone numbers, trigger bulk broadcasts, and inspect real-time connection health.
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
              else if (activeTab === 'whatsapp') navigate('/whatsapp-channels');
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
            <Plus size={18} /> {activeTab === 'apps' ? 'New Application' : activeTab === 'webhooks' ? 'New Webhook' : activeTab === 'whatsapp' ? 'Connect Device' : 'Create API Key'}
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
          { id: 'whatsapp', label: 'WhatsApp Numbers', icon: Smartphone, count: connectedSessionCount },
          { id: 'keys', label: 'API Keys', icon: Key, count: keys.length },
          { id: 'webhooks', label: 'Webhooks & Events', icon: Webhook, count: webhooks.length },
          { id: 'usage', label: 'Usage & Analytics', icon: BarChart3 },
          { id: 'quickstart', label: 'Quickstart & CRM SDKs', icon: Code2 }
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
                marginBottom: '-1px',
                cursor: 'pointer'
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
          {/* One-time Credentials Banner Modal / Callout */}
          {newlyCreatedApp && (
            <div
              style={{
                backgroundColor: '#f0fdf4',
                border: '1px solid #86efac',
                borderRadius: '14px',
                padding: '1.75rem',
                marginBottom: '1.75rem',
                boxShadow: '0 8px 24px rgba(34, 197, 94, 0.12)'
              }}
            >
              <div className="flex items-center justify-between" style={{ marginBottom: '0.75rem' }}>
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={22} color="#16a34a" />
                  <span style={{ fontWeight: 800, color: '#15803d', fontSize: '1.1rem' }}>
                    Application "{newlyCreatedApp.name}" Created Successfully!
                  </span>
                </div>
                <button
                  onClick={() => setNewlyCreatedApp(null)}
                  style={{
                    color: '#64748b',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    padding: '0.35rem 0.75rem',
                    borderRadius: '6px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #d1d5db'
                  }}
                >
                  Dismiss
                </button>
              </div>

              <div
                style={{
                  backgroundColor: '#fef3c7',
                  border: '1px solid #fde68a',
                  borderRadius: '8px',
                  padding: '0.75rem 1rem',
                  marginBottom: '1.25rem',
                  fontSize: '0.85rem',
                  color: '#92400e',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem'
                }}
              >
                <AlertTriangle size={18} style={{ flexShrink: 0 }} />
                <span>
                  <strong>Important Security Notice:</strong> Store your <strong>Client Secret</strong> and <strong>API Key</strong> immediately in your CRM environment variables. For security reasons, they will <strong>never</strong> be displayed again!
                </span>
              </div>

              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {newlyCreatedApp.id && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ color: '#374151', fontWeight: 600, minWidth: '160px', fontSize: '0.85rem' }}>Application ID:</span>
                    <code style={{ backgroundColor: '#ffffff', border: '1px solid #d1d5db', padding: '0.5rem 0.75rem', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.85rem', flex: 1 }}>
                      {newlyCreatedApp.id}
                    </code>
                    <button
                      onClick={() => copyAppCredential(newlyCreatedApp.id!, 'app_id')}
                      style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', backgroundColor: '#ffffff', border: '1px solid #d1d5db', color: copiedAppCred === 'app_id' ? '#16a34a' : '#475569', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600 }}
                    >
                      {copiedAppCred === 'app_id' ? <Check size={14} /> : <Copy size={14} />} {copiedAppCred === 'app_id' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}

                {newlyCreatedApp.client_id && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ color: '#374151', fontWeight: 600, minWidth: '160px', fontSize: '0.85rem' }}>Client ID:</span>
                    <code style={{ backgroundColor: '#ffffff', border: '1px solid #d1d5db', padding: '0.5rem 0.75rem', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.85rem', flex: 1, color: '#1e40af', fontWeight: 600 }}>
                      {newlyCreatedApp.client_id}
                    </code>
                    <button
                      onClick={() => copyAppCredential(newlyCreatedApp.client_id, 'client_id')}
                      style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', backgroundColor: '#ffffff', border: '1px solid #d1d5db', color: copiedAppCred === 'client_id' ? '#16a34a' : '#475569', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600 }}
                    >
                      {copiedAppCred === 'client_id' ? <Check size={14} /> : <Copy size={14} />} {copiedAppCred === 'client_id' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}

                {newlyCreatedApp.client_secret && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ color: '#374151', fontWeight: 700, minWidth: '160px', fontSize: '0.85rem' }}>Client Secret (One-Time):</span>
                    <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <code style={{ backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', padding: '0.5rem 0.75rem', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.85rem', width: '100%', color: '#065f46', fontWeight: 700 }}>
                        {showSecrets['new_secret'] ? newlyCreatedApp.client_secret : '••••••••••••••••••••••••••••••••••••••••••••••••'}
                      </code>
                      <button
                        onClick={() => setShowSecrets(p => ({ ...p, new_secret: !p['new_secret'] }))}
                        style={{ position: 'absolute', right: '8px', background: 'none', border: 'none', color: '#64748b', cursor: 'pointer' }}
                      >
                        {showSecrets['new_secret'] ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <button
                      onClick={() => copyAppCredential(newlyCreatedApp.client_secret!, 'client_secret')}
                      style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', backgroundColor: '#15803d', color: '#ffffff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                    >
                      {copiedAppCred === 'client_secret' ? <Check size={14} /> : <Copy size={14} />} {copiedAppCred === 'client_secret' ? 'Copied' : 'Copy Secret'}
                    </button>
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ color: '#374151', fontWeight: 700, minWidth: '160px', fontSize: '0.85rem' }}>Primary API Key:</span>
                  <code style={{ backgroundColor: '#fef3c7', border: '1px solid #fde68a', padding: '0.5rem 0.75rem', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.85rem', flex: 1, color: '#92400e', fontWeight: 600 }}>
                    {newlyCreatedApp.raw_api_key}
                  </code>
                  <button
                    onClick={() => copyAppCredential(newlyCreatedApp.raw_api_key, 'api_key')}
                    style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', backgroundColor: '#d97706', color: '#ffffff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {copiedAppCred === 'api_key' ? <Check size={14} /> : <Copy size={14} />} {copiedAppCred === 'api_key' ? 'Copied' : 'Copy Key'}
                  </button>
                </div>

                {newlyCreatedApp.whatsapp_number && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ color: '#374151', fontWeight: 600, minWidth: '160px', fontSize: '0.85rem' }}>WhatsApp Sender:</span>
                    <code style={{ backgroundColor: '#ffffff', border: '1px solid #d1d5db', padding: '0.5rem 0.75rem', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.85rem', flex: 1, color: '#047857', fontWeight: 600 }}>
                      +{newlyCreatedApp.whatsapp_number.replace(/^\+/, '')}
                    </code>
                    <button
                      onClick={() => copyAppCredential(newlyCreatedApp.whatsapp_number!, 'wa_num')}
                      style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', backgroundColor: '#ffffff', border: '1px solid #d1d5db', color: copiedAppCred === 'wa_num' ? '#16a34a' : '#475569', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600 }}
                    >
                      {copiedAppCred === 'wa_num' ? <Check size={14} /> : <Copy size={14} />} {copiedAppCred === 'wa_num' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}

                {newlyCreatedApp.webhook_secret && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ color: '#374151', fontWeight: 600, minWidth: '160px', fontSize: '0.85rem' }}>Webhook Secret:</span>
                    <code style={{ backgroundColor: '#ffffff', border: '1px solid #d1d5db', padding: '0.5rem 0.75rem', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.85rem', flex: 1 }}>
                      {newlyCreatedApp.webhook_secret}
                    </code>
                    <button
                      onClick={() => copyAppCredential(newlyCreatedApp.webhook_secret, 'webhook_secret')}
                      style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', backgroundColor: '#ffffff', border: '1px solid #d1d5db', color: copiedAppCred === 'webhook_secret' ? '#16a34a' : '#475569', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600 }}
                    >
                      {copiedAppCred === 'webhook_secret' ? <Check size={14} /> : <Copy size={14} />} {copiedAppCred === 'webhook_secret' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Rotated Secret Success Callout */}
          {rotatedSecretModal && (
            <div
              style={{
                backgroundColor: '#eff6ff',
                border: '1px solid #93c5fd',
                borderRadius: '14px',
                padding: '1.5rem',
                marginBottom: '1.5rem',
                boxShadow: '0 4px 14px rgba(37, 99, 235, 0.1)'
              }}
            >
              <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
                <div className="flex items-center gap-2">
                  <ShieldCheck size={20} color="#2563eb" />
                  <span style={{ fontWeight: 700, color: '#1e40af', fontSize: '1rem' }}>
                    Client Secret Rotated for "{rotatedSecretModal.appName}"
                  </span>
                </div>
                <button
                  onClick={() => setRotatedSecretModal(null)}
                  style={{ color: '#64748b', fontSize: '0.85rem', fontWeight: 600 }}
                >
                  Dismiss
                </button>
              </div>
              <p style={{ color: '#1e3a8a', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
                Make sure to copy the new secret now. Update your CRM configuration immediately:
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <code style={{ backgroundColor: '#ffffff', border: '1px solid #bfdbfe', padding: '0.5rem 0.75rem', borderRadius: '8px', fontFamily: 'monospace', fontSize: '0.85rem', flex: 1, color: '#1e40af', fontWeight: 700 }}>
                  {rotatedSecretModal.clientSecret}
                </code>
                <button
                  onClick={() => copyAppCredential(rotatedSecretModal.clientSecret, 'rotated_secret')}
                  style={{ padding: '0.4rem 0.85rem', borderRadius: '6px', backgroundColor: '#2563eb', color: '#ffffff', border: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}
                >
                  {copiedAppCred === 'rotated_secret' ? <Check size={14} /> : <Copy size={14} />} {copiedAppCred === 'rotated_secret' ? 'Copied' : 'Copy Secret'}
                </button>
              </div>
            </div>
          )}

          {/* Application Cards List */}
          {appsLoading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
              <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 0.75rem' }} />
              Loading applications...
            </div>
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
              <h3 style={{ color: '#1e293b', fontWeight: 700, fontSize: '1.25rem', marginBottom: '0.5rem' }}>No Applications Configured</h3>
              <p style={{ color: '#64748b', maxWidth: '440px', margin: '0 auto 1.5rem', fontSize: '0.9rem' }}>
                Create your first developer application to generate CRM credentials, pair your authenticated WhatsApp mobile number, and initiate automated messaging.
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
                  gap: '0.5rem',
                  cursor: 'pointer'
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
                          width: '42px',
                          height: '42px',
                          borderRadius: '10px',
                          background: app.status === 'active'
                            ? 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)'
                            : 'linear-gradient(135deg, #ef4444 0%, #f87171 100%)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#fff',
                          fontWeight: 700
                        }}
                      >
                        <AppWindow size={22} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 style={{ fontWeight: 800, fontSize: '1.1rem', color: '#0f172a', margin: 0 }}>{app.name}</h3>
                          {app.whatsapp_number ? (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px',
                                backgroundColor: '#dcfce7',
                                color: '#15803d',
                                padding: '0.15rem 0.55rem',
                                borderRadius: '999px',
                                fontSize: '0.75rem',
                                fontWeight: 700
                              }}
                            >
                              <Smartphone size={12} /> +{app.whatsapp_number.replace(/^\+/, '')}
                            </span>
                          ) : (
                            <span
                              style={{
                                backgroundColor: '#f1f5f9',
                                color: '#64748b',
                                padding: '0.15rem 0.5rem',
                                borderRadius: '999px',
                                fontSize: '0.75rem',
                                fontWeight: 500
                              }}
                            >
                              No WhatsApp linked
                            </span>
                          )}
                        </div>
                        {app.description && (
                          <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0.2rem 0 0 0' }}>{app.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        style={{
                          backgroundColor: app.status === 'active' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                          color: app.status === 'active' ? '#16a34a' : '#dc2626',
                          padding: '0.25rem 0.65rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          textTransform: 'uppercase' as const
                        }}
                      >
                        {app.status}
                      </span>
                      <span
                        style={{
                          backgroundColor: app.environment === 'live' ? 'rgba(37, 99, 235, 0.1)' : 'rgba(245, 158, 11, 0.1)',
                          color: app.environment === 'live' ? '#2563eb' : '#d97706',
                          padding: '0.25rem 0.65rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 700
                        }}
                      >
                        {app.environment.toUpperCase()}
                      </span>
                    </div>
                  </div>

                  {/* Metadata Row */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#64748b', alignItems: 'center' }}>
                    <div>
                      <span style={{ fontWeight: 600, color: '#374151' }}>Client ID: </span>
                      <code style={{ fontSize: '0.8rem', backgroundColor: '#f1f5f9', padding: '0.2rem 0.5rem', borderRadius: '4px', color: '#1e293b' }}>{app.client_id}</code>
                    </div>
                    {app.client_secret_preview && (
                      <div>
                        <span style={{ fontWeight: 600, color: '#374151' }}>Secret: </span>
                        <code style={{ fontSize: '0.8rem', backgroundColor: '#f1f5f9', padding: '0.2rem 0.5rem', borderRadius: '4px', color: '#64748b' }}>{app.client_secret_preview}</code>
                      </div>
                    )}
                    <div>
                      <Key size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                      {app.api_key_count} key{app.api_key_count !== 1 ? 's' : ''}
                    </div>
                    <div>
                      <Webhook size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                      {app.webhook_count} webhook{app.webhook_count !== 1 ? 's' : ''}
                    </div>
                    <div>
                      <Activity size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: '4px' }} />
                      Last Active: {app.last_used_at ? new Date(app.last_used_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never used'}
                    </div>
                    <div style={{ marginLeft: 'auto', fontSize: '0.8rem', color: '#94a3b8' }}>
                      Created {new Date(app.created_at).toLocaleDateString()}
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-wrap gap-2 items-center">
                    {/* Live Diagnostic Button */}
                    <button
                      onClick={() => handleTestConnection(app.id)}
                      disabled={testingAppId === app.id}
                      style={{
                        padding: '0.5rem 0.85rem',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        backgroundColor: '#eff6ff',
                        color: '#2563eb',
                        border: '1px solid #bfdbfe',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        cursor: 'pointer'
                      }}
                    >
                      <Zap size={14} className={testingAppId === app.id ? 'animate-spin' : ''} />
                      {testingAppId === app.id ? 'Testing...' : 'Test Connection'}
                    </button>

                    <button
                      onClick={() => handleRegenerateAppSecret(app.id, app.name)}
                      style={{
                        padding: '0.5rem 0.85rem',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        backgroundColor: '#f8fafc',
                        color: '#334155',
                        border: '1px solid #cbd5e1',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        cursor: 'pointer'
                      }}
                    >
                      <Lock size={14} /> Rotate Secret
                    </button>

                    <button
                      onClick={() => handleRegenerateAppKey(app.id, app.name)}
                      style={{
                        padding: '0.5rem 0.85rem',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        backgroundColor: '#f8fafc',
                        color: '#334155',
                        border: '1px solid #cbd5e1',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        cursor: 'pointer'
                      }}
                    >
                      <RefreshCw size={14} /> Regenerate Key
                    </button>

                    <button
                      onClick={() => setExpandedAppId(expandedAppId === app.id ? null : app.id)}
                      style={{
                        padding: '0.5rem 0.85rem',
                        borderRadius: '8px',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        backgroundColor: '#f1f5f9',
                        color: '#475569',
                        border: '1px solid #e2e8f0',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        cursor: 'pointer'
                      }}
                    >
                      <Settings size={14} /> {expandedAppId === app.id ? 'Hide Details' : 'View Details'}
                    </button>

                    {app.status === 'active' ? (
                      <button
                        onClick={() => handleSuspendApp(app.id, app.name)}
                        style={{
                          padding: '0.5rem 0.85rem',
                          borderRadius: '8px',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          backgroundColor: '#fef2f2',
                          color: '#dc2626',
                          border: '1px solid #fecaca',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          cursor: 'pointer'
                        }}
                      >
                        <AlertTriangle size={14} /> Suspend
                      </button>
                    ) : (
                      <button
                        onClick={() => handleActivateApp(app.id, app.name)}
                        style={{
                          padding: '0.5rem 0.85rem',
                          borderRadius: '8px',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          backgroundColor: '#f0fdf4',
                          color: '#15803d',
                          border: '1px solid #bbf7d0',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.4rem',
                          cursor: 'pointer'
                        }}
                      >
                        <CheckCircle2 size={14} /> Activate
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
                        border: '1px solid #fecaca',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        marginLeft: 'auto',
                        cursor: 'pointer'
                      }}
                    >
                      <Trash2 size={14} /> Revoke
                    </button>
                  </div>

                  {/* Expanded Credentials & Details Drawer */}
                  {expandedAppId === app.id && (
                    <div
                      style={{
                        marginTop: '1.25rem',
                        padding: '1.25rem',
                        backgroundColor: '#f8fafc',
                        borderRadius: '10px',
                        border: '1px solid #e2e8f0'
                      }}
                    >
                      <h4 style={{ fontWeight: 700, fontSize: '0.9rem', color: '#1e293b', marginBottom: '0.75rem' }}>
                        Application Configuration & Permissions
                      </h4>
                      <div style={{ display: 'grid', gap: '0.6rem', fontSize: '0.85rem' }}>
                        <div className="flex items-center gap-2">
                          <span style={{ fontWeight: 600, color: '#374151', minWidth: '150px' }}>Application ID</span>
                          <code style={{ backgroundColor: '#e2e8f0', padding: '0.3rem 0.6rem', borderRadius: '6px', fontFamily: 'monospace', flex: 1 }}>
                            {app.id}
                          </code>
                          <button onClick={() => copyAppCredential(app.id, `aid-${app.id}`)} style={{ padding: '0.2rem', color: copiedAppCred === `aid-${app.id}` ? '#16a34a' : '#94a3b8' }}>
                            {copiedAppCred === `aid-${app.id}` ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <span style={{ fontWeight: 600, color: '#374151', minWidth: '150px' }}>Client ID</span>
                          <code style={{ backgroundColor: '#e2e8f0', padding: '0.3rem 0.6rem', borderRadius: '6px', fontFamily: 'monospace', flex: 1 }}>
                            {app.client_id}
                          </code>
                          <button onClick={() => copyAppCredential(app.client_id, `cid-${app.id}`)} style={{ padding: '0.2rem', color: copiedAppCred === `cid-${app.id}` ? '#16a34a' : '#94a3b8' }}>
                            {copiedAppCred === `cid-${app.id}` ? <Check size={14} /> : <Copy size={14} />}
                          </button>
                        </div>

                        <div className="flex items-center gap-2">
                          <span style={{ fontWeight: 600, color: '#374151', minWidth: '150px' }}>Associated WhatsApp</span>
                          <span style={{ flex: 1, color: app.whatsapp_number ? '#15803d' : '#64748b', fontWeight: app.whatsapp_number ? 700 : 400 }}>
                            {app.whatsapp_number ? `+${app.whatsapp_number.replace(/^\+/, '')}` : 'Not configured (falls back to default connected instance)'}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span style={{ fontWeight: 600, color: '#374151', minWidth: '150px' }}>Webhook Signing Secret</span>
                          <code style={{ backgroundColor: '#e2e8f0', padding: '0.3rem 0.6rem', borderRadius: '6px', fontFamily: 'monospace', flex: 1 }}>
                            {showSecrets[app.id] ? (app.webhook_secret || '—') : '••••••••••••••••••••••••'}
                          </code>
                          <button onClick={() => setShowSecrets(p => ({ ...p, [app.id]: !p[app.id] }))} style={{ padding: '0.2rem', color: '#64748b', cursor: 'pointer' }}>
                            {showSecrets[app.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                          </button>
                          {app.webhook_secret && (
                            <button onClick={() => copyAppCredential(app.webhook_secret!, `wh-${app.id}`)} style={{ padding: '0.2rem', color: copiedAppCred === `wh-${app.id}` ? '#16a34a' : '#94a3b8' }}>
                              {copiedAppCred === `wh-${app.id}` ? <Check size={14} /> : <Copy size={14} />}
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <span style={{ fontWeight: 600, color: '#374151', minWidth: '150px' }}>Authorized Scopes</span>
                          <div className="flex gap-1 flex-wrap">
                            {(app.scopes || []).map((s) => (
                              <span key={s} style={{ backgroundColor: '#dbeafe', color: '#1e40af', padding: '0.15rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600 }}>
                                {s}
                              </span>
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

      {/* ───────────────────────────────────────────────────────────── */}
      {/* TAB 1: WHATSAPP NUMBERS & GATEWAY STATUS */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'whatsapp' && (
        <div>
          {/* Gateway Status Header */}
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              padding: '1.5rem',
              marginBottom: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)'
            }}
          >
            <div>
              <div className="flex items-center gap-2">
                <span style={{ fontWeight: 700, fontSize: '1.05rem', color: '#0f172a' }}>
                  WhatsApp Gateway Engine Status
                </span>
                <span
                  style={{
                    backgroundColor: gatewayStatus?.connected ? '#dcfce7' : '#f1f5f9',
                    color: gatewayStatus?.connected ? '#15803d' : '#64748b',
                    padding: '0.2rem 0.6rem',
                    borderRadius: '999px',
                    fontSize: '0.75rem',
                    fontWeight: 700
                  }}
                >
                  {gatewayStatus?.connected ? 'ONLINE' : 'ACTIVE / IDLE'}
                </span>
              </div>
              <p style={{ margin: '0.25rem 0 0 0', color: '#64748b', fontSize: '0.85rem' }}>
                All messages sent via Developer Applications and CRM integrations route through authenticated WhatsApp sessions below.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={loadWhatsAppSessions}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.6rem 1rem',
                  borderRadius: '8px',
                  backgroundColor: '#f1f5f9',
                  color: '#475569',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  border: '1px solid #e2e8f0',
                  cursor: 'pointer'
                }}
              >
                <RefreshCw size={14} className={whatsappLoading ? 'animate-spin' : ''} /> Refresh Devices
              </button>
              <button
                onClick={() => navigate('/whatsapp-channels')}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  padding: '0.6rem 1.25rem',
                  borderRadius: '8px',
                  backgroundColor: '#2563eb',
                  color: '#ffffff',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                <Smartphone size={16} /> Connect / Scan QR Code
              </button>
            </div>
          </div>

          {/* WhatsApp Sessions Grid */}
          {whatsappSessions.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '4rem 2rem',
                backgroundColor: '#f8fafc',
                borderRadius: '16px',
                border: '2px dashed #e2e8f0'
              }}
            >
              <Smartphone size={48} color="#94a3b8" style={{ margin: '0 auto 1rem' }} />
              <h3 style={{ color: '#1e293b', fontWeight: 700, fontSize: '1.25rem', marginBottom: '0.5rem' }}>
                No WhatsApp Numbers Connected
              </h3>
              <p style={{ color: '#64748b', maxWidth: '420px', margin: '0 auto 1.5rem', fontSize: '0.9rem' }}>
                Pair a WhatsApp mobile phone with UNAI FLOW to allow your CRM and external systems to broadcast messages.
              </p>
              <button
                onClick={() => navigate('/whatsapp-channels')}
                style={{
                  background: 'linear-gradient(135deg, #16a34a 0%, #22c55e 100%)',
                  color: '#fff',
                  padding: '0.75rem 1.5rem',
                  borderRadius: '10px',
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  cursor: 'pointer'
                }}
              >
                <Smartphone size={18} /> Connect WhatsApp Account
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '1.25rem' }}>
              {whatsappSessions.map((session) => {
                const isConnected = session.status === 'CONNECTED' || session.status === 'READY';
                const linkedApps = apps.filter(
                  a => a.whatsapp_number && session.phone_number &&
                       a.whatsapp_number.replace(/\D/g, '') === session.phone_number.replace(/\D/g, '')
                );

                return (
                  <div
                    key={session.id}
                    style={{
                      backgroundColor: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: '14px',
                      padding: '1.5rem',
                      boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)'
                    }}
                  >
                    <div className="flex items-center justify-between" style={{ marginBottom: '1rem' }}>
                      <div className="flex items-center gap-3">
                        <div
                          style={{
                            width: '42px',
                            height: '42px',
                            borderRadius: '50%',
                            backgroundColor: isConnected ? '#dcfce7' : '#f1f5f9',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: isConnected ? '#15803d' : '#64748b'
                          }}
                        >
                          <Phone size={20} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#0f172a' }}>
                            {session.phone_number ? `+${session.phone_number.replace(/^\+/, '')}` : 'WhatsApp Session'}
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: 'monospace' }}>
                            {session.session_identifier?.slice(0, 18)}...
                          </div>
                        </div>
                      </div>
                      <span
                        style={{
                          backgroundColor: isConnected ? '#dcfce7' : '#fee2e2',
                          color: isConnected ? '#15803d' : '#b91c1c',
                          padding: '0.2rem 0.6rem',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          fontWeight: 700
                        }}
                      >
                        {isConnected ? 'ONLINE' : session.status}
                      </span>
                    </div>

                    <div style={{ padding: '0.75rem', backgroundColor: '#f8fafc', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.8rem' }}>
                      <div style={{ color: '#475569', marginBottom: '0.25rem', fontWeight: 600 }}>
                        Linked Developer Applications:
                      </div>
                      {linkedApps.length > 0 ? (
                        <div className="flex gap-1 flex-wrap">
                          {linkedApps.map(a => (
                            <span key={a.id} style={{ backgroundColor: '#dbeafe', color: '#1e40af', padding: '0.15rem 0.45rem', borderRadius: '4px', fontWeight: 600 }}>
                              {a.name}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span style={{ color: '#94a3b8' }}>Available for assignment to any Application</span>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() => navigate('/whatsapp-channels')}
                        style={{
                          flex: 1,
                          padding: '0.5rem',
                          borderRadius: '8px',
                          backgroundColor: '#f1f5f9',
                          color: '#334155',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          border: '1px solid #e2e8f0',
                          cursor: 'pointer'
                        }}
                      >
                        Manage Session
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* TAB 2: API KEYS */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'keys' && (
        <div>
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
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  {copiedKey ? <Check size={14} /> : <Copy size={14} />}
                  {copiedKey ? 'Copied!' : 'Copy Secret'}
                </button>
              </div>
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
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none'
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
                    fontWeight: 600,
                    cursor: 'pointer'
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
                              gap: '4px',
                              cursor: 'pointer',
                              background: '#fff'
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
                              gap: '4px',
                              cursor: 'pointer',
                              border: 'none'
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
      {/* TAB 3: WEBHOOKS */}
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
                <button onClick={() => setCreatedWebhookSecret(null)} style={{ color: '#64748b', fontSize: '0.8rem', cursor: 'pointer', background: 'none', border: 'none' }}>
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
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none'
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
                    fontWeight: 600,
                    cursor: 'pointer'
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
                            fontWeight: 600,
                            cursor: 'pointer',
                            border: 'none'
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
      {/* TAB 4: USAGE & ANALYTICS */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'usage' && (
        <div>
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
                  borderRadius: '8px',
                  cursor: 'pointer'
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
                      color: usagePeriod === p ? '#ffffff' : '#64748b',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '1rem',
              marginBottom: '1.5rem'
            }}
          >
            {[
              { label: 'Total API Requests', value: usageSummary?.total_requests ?? 0, icon: Activity, color: '#2563eb' },
              { label: 'Messages Dispatched', value: usageSummary?.total_messages_sent ?? 0, icon: Send, color: '#16a34a' },
              { label: 'Delivery Failures', value: usageSummary?.total_messages_failed ?? 0, icon: AlertTriangle, color: '#dc2626' },
              { label: 'Bulk Campaigns Executed', value: usageSummary?.total_campaigns ?? 0, icon: Zap, color: '#9333ea' }
            ].map((m, idx) => {
              const Icon = m.icon;
              return (
                <div
                  key={idx}
                  style={{
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: '12px',
                    padding: '1.25rem',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                  }}
                >
                  <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
                    <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#64748b' }}>{m.label}</span>
                    <Icon size={18} color={m.color} />
                  </div>
                  <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a' }}>
                    {m.value.toLocaleString()}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* TAB 5: QUICKSTART & CRM INTEGRATION GUIDE */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeTab === 'quickstart' && (
        <div>
          {/* ───────────────────────────────────────────────────────────── */}
          {/* LIVE TEST BENCH & CRM SIMULATOR */}
          {/* ───────────────────────────────────────────────────────────── */}
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              padding: '1.75rem',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)',
              marginBottom: '2rem'
            }}
          >
            <div className="flex items-center justify-between" style={{ marginBottom: '1.25rem', borderBottom: '1px solid #f1f5f9', paddingBottom: '1rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <div className="flex items-center gap-2">
                  <h3 style={{ margin: 0, fontWeight: 800, fontSize: '1.2rem', color: '#0f172a' }}>
                    Live WhatsApp API Test Bench
                  </h3>
                  <span style={{ backgroundColor: '#ecfdf5', color: '#059669', fontSize: '0.75rem', fontWeight: 700, padding: '0.2rem 0.6rem', borderRadius: '6px' }}>
                    Real-time CRM Simulator
                  </span>
                </div>
                <p style={{ margin: '0.35rem 0 0 0', color: '#64748b', fontSize: '0.875rem' }}>
                  Test sending realtime WhatsApp single or bulk messages using your production API Key directly to your phone—zero terminal required!
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Connected Sender:</span>
                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: '#0f172a', backgroundColor: '#f8fafc', padding: '0.3rem 0.65rem', borderRadius: '6px', border: '1px solid #e2e8f0', display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                  <Smartphone size={14} style={{ color: '#16a34a' }} />
                  {gatewayStatus?.phone_number || sampleWhatsApp ? `+${(gatewayStatus?.phone_number || sampleWhatsApp).replace(/^\+/, '')}` : 'Not connected'}
                </span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
              {/* Left Column: Form */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <div className="flex items-center justify-between" style={{ marginBottom: '0.35rem' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
                      Primary API Key (X-API-Key)
                    </label>
                    {(newlyCreatedApp?.raw_api_key || newlyCreatedKey?.raw_key) && !testApiKey && (
                      <button
                        onClick={() => setTestApiKey(newlyCreatedApp?.raw_api_key || newlyCreatedKey?.raw_key || '')}
                        style={{ fontSize: '0.75rem', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                      >
                        Use generated key
                      </button>
                    )}
                  </div>
                  <input
                    type="text"
                    value={testApiKey}
                    onChange={(e) => setTestApiKey(e.target.value)}
                    placeholder="wa_live_..."
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontFamily: 'monospace',
                      fontSize: '0.85rem',
                      backgroundColor: '#f8fafc'
                    }}
                  />
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.725rem', color: '#94a3b8' }}>
                    Paste your Primary API Key copied from your Application modal (starts with <code>wa_live_</code>).
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between" style={{ marginBottom: '0.35rem' }}>
                    <label style={{ fontSize: '0.8rem', fontWeight: 700, color: '#334155' }}>
                      Recipient Mobile Number(s)
                    </label>
                    <button
                      onClick={() => {
                        const num = gatewayStatus?.phone_number || sampleWhatsApp;
                        if (num) setTestRecipient(num.startsWith('+') ? num : `+${num}`);
                      }}
                      style={{ fontSize: '0.75rem', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                    >
                      Use Connected WhatsApp (+{(gatewayStatus?.phone_number || sampleWhatsApp).replace(/^\+/, '')})
                    </button>
                  </div>
                  <input
                    type="text"
                    value={testRecipient}
                    onChange={(e) => setTestRecipient(e.target.value)}
                    placeholder="+919342745299 (or separate multiple with commas for bulk broadcast)"
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.875rem'
                    }}
                  />
                  <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.725rem', color: '#94a3b8' }}>
                    Single recipient sends directly; multiple comma-separated numbers automatically launch a bulk broadcast campaign.
                  </p>
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: '0.35rem' }}>
                    Message Content
                  </label>
                  <textarea
                    rows={3}
                    value={testMessage}
                    onChange={(e) => setTestMessage(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.875rem',
                      fontFamily: 'inherit',
                      resize: 'vertical'
                    }}
                  />
                </div>

                <div>
                  <button
                    onClick={handleSendLiveTest}
                    disabled={testSending}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      padding: '0.75rem 1.5rem',
                      backgroundColor: testSending ? '#94a3b8' : '#2563eb',
                      color: '#ffffff',
                      borderRadius: '8px',
                      fontWeight: 700,
                      fontSize: '0.9rem',
                      border: 'none',
                      cursor: testSending ? 'not-allowed' : 'pointer',
                      transition: 'background-color 0.2s',
                      boxShadow: '0 2px 4px rgba(37, 99, 235, 0.2)'
                    }}
                  >
                    {testSending ? (
                      <>
                        <RefreshCw size={16} className="animate-spin" />
                        Dispatching to WhatsApp...
                      </>
                    ) : (
                      <>
                        <Send size={16} />
                        Send Live WhatsApp Message
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Right Column: Live Result & API Call Preview */}
              <div style={{ backgroundColor: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0', padding: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ borderBottom: '1px solid #e2e8f0', paddingBottom: '0.75rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', color: '#64748b' }}>Live Dispatch Result</span>
                </div>

                {testError && (
                  <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '0.85rem' }}>
                    <div className="flex items-center gap-2" style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.85rem' }}>
                      <AlertTriangle size={16} /> Error Sending Message
                    </div>
                    <p style={{ margin: '0.35rem 0 0 0', color: '#b91c1c', fontSize: '0.8rem' }}>{testError}</p>
                  </div>
                )}

                {testResult && (
                  <div style={{ backgroundColor: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '0.85rem' }}>
                    <div className="flex items-center gap-2" style={{ color: '#059669', fontWeight: 700, fontSize: '0.85rem' }}>
                      <CheckCircle2 size={16} /> Message Dispatched to WhatsApp!
                    </div>
                    <div style={{ marginTop: '0.5rem', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.35rem 0.75rem', fontSize: '0.8rem', color: '#065f46' }}>
                      <span style={{ fontWeight: 600 }}>Mode:</span>
                      <span style={{ textTransform: 'uppercase', fontWeight: 700 }}>{testResult.mode || 'single'}</span>
                      <span style={{ fontWeight: 600 }}>Status:</span>
                      <span style={{ fontWeight: 700 }}>{testResult.status || 'queued'}</span>
                      {testResult.job_id && (
                        <>
                          <span style={{ fontWeight: 600 }}>Job ID:</span>
                          <span style={{ fontFamily: 'monospace' }}>{testResult.job_id}</span>
                        </>
                      )}
                      {testResult.campaign_id && (
                        <>
                          <span style={{ fontWeight: 600 }}>Campaign ID:</span>
                          <span style={{ fontFamily: 'monospace' }}>{testResult.campaign_id}</span>
                        </>
                      )}
                      <span style={{ fontWeight: 600 }}>Recipients:</span>
                      <span>{testResult.total_recipients || 1}</span>
                    </div>
                    <p style={{ margin: '0.5rem 0 0 0', color: '#047857', fontSize: '0.75rem', fontWeight: 600 }}>
                      Check WhatsApp on your phone! The message has been processed by your connected account.
                    </p>
                  </div>
                )}

                {!testResult && !testError && (
                  <div style={{ color: '#94a3b8', fontSize: '0.825rem', textAlign: 'center', padding: '1rem 0' }}>
                    Click "Send Live WhatsApp Message" above to dispatch a real message and view the response payload here.
                  </div>
                )}

                {/* HTTP Request Preview */}
                <div style={{ marginTop: 'auto', borderTop: '1px solid #e2e8f0', paddingTop: '0.75rem' }}>
                  <div className="flex items-center justify-between" style={{ marginBottom: '0.35rem' }}>
                    <span style={{ fontSize: '0.725rem', fontWeight: 700, color: '#64748b' }}>CRM HTTP Request Preview</span>
                    <span style={{ fontSize: '0.7rem', color: '#16a34a', fontWeight: 700, backgroundColor: '#dcfce7', padding: '0.1rem 0.4rem', borderRadius: '4px' }}>POST</span>
                  </div>
                  <pre style={{ margin: 0, padding: '0.65rem', borderRadius: '6px', backgroundColor: '#0f172a', color: '#94a3b8', fontSize: '0.725rem', overflowX: 'auto', fontFamily: 'monospace' }}>
{`POST /v1/messages/send
Host: unai-flow-backend-w4al.onrender.com
X-API-Key: ${testApiKey ? testApiKey.slice(0, 14) + '...' : 'wa_live_...'}
Content-Type: application/json

${JSON.stringify({ to: testRecipient ? (testRecipient.includes(',') ? testRecipient.split(',').map(r => r.trim()) : testRecipient) : '+919876543210', message: testMessage, message_type: 'text' }, null, 2)}`}
                  </pre>
                </div>
              </div>
            </div>
          </div>

          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '14px',
              border: '1px solid #e2e8f0',
              padding: '2rem',
              boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)'
            }}
          >
            <div className="flex items-center justify-between" style={{ marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <h3 style={{ margin: 0, fontWeight: 800, fontSize: '1.2rem', color: '#0f172a' }}>CRM & Developer Integration Guide</h3>
                <p style={{ margin: '0.25rem 0 0 0', color: '#64748b', fontSize: '0.9rem' }}>
                  Connect your CRM, Edge Functions, HubSpot, or backend in minutes using Client Credentials or API Keys.
                </p>
              </div>

              {/* Language Switcher */}
              <div
                style={{
                  display: 'flex',
                  backgroundColor: '#f1f5f9',
                  borderRadius: '8px',
                  padding: '0.2rem',
                  flexWrap: 'wrap',
                  gap: '0.25rem'
                }}
              >
                {(['crm', 'curl', 'node', 'python'] as const).map((lang) => (
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
                      color: codeLang === lang ? '#ffffff' : '#64748b',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    {lang === 'crm' ? 'CRM & Webhooks' : lang === 'node' ? 'Node.js' : lang}
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
                  <span style={{ marginLeft: '0.5rem', color: '#94a3b8', fontSize: '0.75rem', fontFamily: 'monospace' }}>
                    UNAI FLOW WhatsApp Platform API
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
                    padding: '0.35rem 0.65rem',
                    borderRadius: '4px',
                    backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    border: 'none',
                    cursor: 'pointer'
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
                  fontSize: '0.85rem',
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
      {/* MODAL: CREATE APPLICATION */}
      {/* ───────────────────────────────────────────────────────────── */}
      {showCreateAppModal && (
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
          onClick={() => setShowCreateAppModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '2rem',
              width: '100%',
              maxWidth: '560px',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
            }}
          >
            <div className="flex items-center justify-between" style={{ marginBottom: '1.25rem' }}>
              <div>
                <h2 style={{ fontWeight: 800, fontSize: '1.3rem', color: '#0f172a', margin: 0 }}>
                  Create Developer Application
                </h2>
                <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0.2rem 0 0 0' }}>
                  Generate Client Credentials and pair an authenticated WhatsApp number for your CRM.
                </p>
              </div>
            </div>

            <form onSubmit={handleCreateApp}>
              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#374151', display: 'block', marginBottom: '0.4rem' }}>
                  Application Name *
                </label>
                <input
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  placeholder="e.g. Vekkalam CRM Integration / Zoho Automation"
                  style={{ width: '100%', padding: '0.7rem 0.85rem', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '0.9rem', outline: 'none' }}
                  required
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#374151', display: 'block', marginBottom: '0.4rem' }}>
                  Description (Optional)
                </label>
                <input
                  value={newAppDesc}
                  onChange={(e) => setNewAppDesc(e.target.value)}
                  placeholder="e.g. Dispatches customer lead notices and invoices"
                  style={{ width: '100%', padding: '0.7rem 0.85rem', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '0.9rem', outline: 'none' }}
                />
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#374151', display: 'block', marginBottom: '0.4rem' }}>
                  Environment
                </label>
                <div className="flex gap-3">
                  {(['live', 'test'] as const).map((env) => (
                    <button
                      key={env}
                      type="button"
                      onClick={() => setNewAppEnv(env)}
                      style={{
                        padding: '0.5rem 1.25rem',
                        borderRadius: '8px',
                        fontSize: '0.85rem',
                        fontWeight: 700,
                        border: '2px solid',
                        borderColor: newAppEnv === env ? '#2563eb' : '#e2e8f0',
                        backgroundColor: newAppEnv === env ? '#eff6ff' : '#ffffff',
                        color: newAppEnv === env ? '#2563eb' : '#64748b',
                        cursor: 'pointer'
                      }}
                    >
                      {env === 'live' ? '🟢 Live (Production)' : '🟡 Test (Sandbox)'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Associated WhatsApp Number Picker */}
              <div style={{ marginBottom: '1.25rem' }}>
                <div className="flex items-center justify-between" style={{ marginBottom: '0.4rem' }}>
                  <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#374151' }}>
                    Associated WhatsApp Mobile Number
                  </label>
                  <button
                    type="button"
                    onClick={() => setCustomPhoneInput(!customPhoneInput)}
                    style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                  >
                    {customPhoneInput ? 'Choose from connected sessions' : 'Enter custom number'}
                  </button>
                </div>

                {!customPhoneInput ? (
                  <select
                    value={newAppWhatsAppSessionId}
                    onChange={(e) => {
                      const sessId = e.target.value;
                      setNewAppWhatsAppSessionId(sessId);
                      const found = whatsappSessions.find(s => s.session_identifier === sessId || s.id === sessId);
                      if (found?.phone_number) {
                        setNewAppWhatsAppNumber(found.phone_number);
                      } else {
                        setNewAppWhatsAppNumber('');
                      }
                    }}
                    style={{ width: '100%', padding: '0.7rem 0.85rem', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '0.9rem', outline: 'none', backgroundColor: '#fff' }}
                  >
                    <option value="">Default Instance (Select device below or leave unlinked)</option>
                    {whatsappSessions.map((s) => {
                      const isOnline = s.status === 'CONNECTED' || s.status === 'READY';
                      return (
                        <option key={s.id} value={s.session_identifier || s.id}>
                          {isOnline ? '🟢' : '⚪'} +{s.phone_number || s.id} ({s.status})
                        </option>
                      );
                    })}
                  </select>
                ) : (
                  <input
                    type="text"
                    placeholder="e.g. +919876543210"
                    value={newAppWhatsAppNumber}
                    onChange={(e) => setNewAppWhatsAppNumber(e.target.value)}
                    style={{ width: '100%', padding: '0.7rem 0.85rem', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '0.9rem', outline: 'none' }}
                  />
                )}
                <span style={{ fontSize: '0.75rem', color: '#64748b', display: 'block', marginTop: '0.25rem' }}>
                  Messages dispatched using this Application's credentials will be sent from this WhatsApp number.
                </span>
              </div>

              {/* Scopes */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={{ fontWeight: 600, fontSize: '0.85rem', color: '#374151', display: 'block', marginBottom: '0.5rem' }}>
                  Application Permissions & Scopes
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                  {['messages:send', 'campaigns:read', 'campaigns:write', 'instances:read', 'channels:read', 'usage:read', 'webhooks:read', 'webhooks:manage'].map((s) => (
                    <label key={s} className="flex items-center gap-2" style={{ fontSize: '0.8rem', color: '#374151', cursor: 'pointer' }}>
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
                    borderRadius: '8px',
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
                    <strong style={{ display: 'block', fontWeight: 700 }}>Creation Failed</strong>
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
                  style={{ padding: '0.65rem 1.25rem', borderRadius: '8px', fontWeight: 600, fontSize: '0.875rem', backgroundColor: '#f1f5f9', color: '#475569', border: 'none', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingApp}
                  style={{
                    padding: '0.65rem 1.25rem',
                    borderRadius: '8px',
                    fontWeight: 700,
                    fontSize: '0.875rem',
                    background: creatingApp
                      ? '#93c5fd'
                      : 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
                    color: '#fff',
                    border: 'none',
                    cursor: creatingApp ? 'not-allowed' : 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  {creatingApp ? 'Generating Credentials...' : 'Create Application'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL: LIVE DIAGNOSTIC CONNECTION TEST */}
      {/* ───────────────────────────────────────────────────────────── */}
      {diagnosticModalData && (
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
          onClick={() => setDiagnosticModalData(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '2rem',
              width: '100%',
              maxWidth: '560px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.2)'
            }}
          >
            <div className="flex items-center justify-between" style={{ marginBottom: '1.25rem' }}>
              <div className="flex items-center gap-2">
                <Activity size={22} color="#2563eb" />
                <h3 style={{ fontWeight: 800, fontSize: '1.2rem', color: '#0f172a', margin: 0 }}>
                  Diagnostic Connection Report
                </h3>
              </div>
              <span
                style={{
                  backgroundColor: diagnosticModalData.status === 'healthy' ? '#dcfce7' : diagnosticModalData.status === 'warning' ? '#fef3c7' : '#fee2e2',
                  color: diagnosticModalData.status === 'healthy' ? '#15803d' : diagnosticModalData.status === 'warning' ? '#92400e' : '#b91c1c',
                  padding: '0.25rem 0.65rem',
                  borderRadius: '999px',
                  fontSize: '0.75rem',
                  fontWeight: 800,
                  textTransform: 'uppercase'
                }}
              >
                {diagnosticModalData.status}
              </span>
            </div>

            <div style={{ display: 'grid', gap: '0.75rem', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                <span style={{ color: '#64748b' }}>Application Status:</span>
                <span style={{ fontWeight: 700, color: diagnosticModalData.is_active ? '#15803d' : '#dc2626' }}>
                  {diagnosticModalData.is_active ? 'Active' : 'Suspended'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                <span style={{ color: '#64748b' }}>Credentials & Auth:</span>
                <span style={{ fontWeight: 700, color: diagnosticModalData.auth_valid ? '#15803d' : '#dc2626' }}>
                  {diagnosticModalData.auth_valid ? 'Valid & Ready (PASS)' : 'Invalid'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                <span style={{ color: '#64748b' }}>Associated WhatsApp:</span>
                <span style={{ fontWeight: 700, color: diagnosticModalData.whatsapp_connected ? '#15803d' : '#d97706' }}>
                  {diagnosticModalData.whatsapp_number ? `+${diagnosticModalData.whatsapp_number.replace(/^\+/, '')}` : 'Default / Not Set'} {diagnosticModalData.whatsapp_connected ? '(Ready)' : '(Device Offline)'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                <span style={{ color: '#64748b' }}>Roundtrip Latency:</span>
                <span style={{ fontWeight: 700, color: '#0f172a', fontFamily: 'monospace' }}>
                  {diagnosticModalData.latency_ms} ms
                </span>
              </div>
            </div>

            {!diagnosticModalData.whatsapp_connected && (
              <div
                style={{
                  backgroundColor: '#fffbeb',
                  border: '1px solid #fef3c7',
                  borderRadius: '8px',
                  padding: '0.75rem 1rem',
                  marginBottom: '1.5rem',
                  fontSize: '0.85rem',
                  color: '#92400e'
                }}
              >
                ⚠️ <strong>WhatsApp Device Offline:</strong> Your application credentials are authenticated, but the associated WhatsApp number is not actively connected to the gateway. Go to the WhatsApp tab to pair the device.
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={() => setDiagnosticModalData(null)}
                style={{
                  padding: '0.65rem 1.5rem',
                  borderRadius: '8px',
                  backgroundColor: '#0f172a',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                Close Report
              </button>
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
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    background: '#fff'
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
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    border: 'none'
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
                    <label key={ev.id} className="flex items-center gap-2" style={{ fontSize: '0.85rem', color: '#334155', cursor: 'pointer' }}>
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
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    background: '#fff'
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
                    fontSize: '0.875rem',
                    cursor: 'pointer',
                    border: 'none'
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
