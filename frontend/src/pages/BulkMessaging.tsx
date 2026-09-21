import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Send,
  Plus,
  RefreshCw,
  Play,
  StopCircle,
  FileText,
  Image as ImageIcon,
  Video,
  Eye,
  Upload,
  Phone,
  Users,
  Wifi,
  Link2,
  CheckCircle2,
  Loader2,
  QrCode,
  Paperclip,
  LogOut,
  Smartphone
} from 'lucide-react';
import { fetchApi } from '../lib/apiClient';


interface CampaignItem {
  id: string;
  name: string;
  description?: string;
  message_type: string;
  message_payload: any;
  status: string;
  total_recipients: number;
  queued_count: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  messages_per_second: number;
  created_at: string;
  launched_at?: string;
  completed_at?: string;
}

interface RecipientItem {
  id: string;
  recipient_jid: string;
  recipient_name?: string;
  status: string;
  provider_message_id?: string;
  error_message?: string;
  retry_count: number;
  sent_at?: string;
  delivered_at?: string;
  failed_at?: string;
}

// Bulk API base URL — points to deployed Render WhatsApp Bulk service
function getBulkApiUrl(): string {
  if (typeof window !== 'undefined' && (window as any).__BULK_API_URL__) {
    return (window as any).__BULK_API_URL__;
  }
  const envUrl = (import.meta as any).env?.VITE_WHATSAPP_BULK_API_URL;
  if (envUrl) return envUrl;
  return 'https://unai-whatsapp-bulk-api.onrender.com';
}


type BulkConnectionStep = 'choose' | 'connecting' | 'connected';

interface BulkAccountInfo {
  phone?: string;
  name?: string;
  jid?: string;
  profilePictureUrl?: string;
  connectionId?: string;
}

export default function BulkMessaging() {
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // ── WhatsApp Connection Gate State ──
  const [connectionStep, setConnectionStep] = useState<BulkConnectionStep>('choose');
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [bulkConnectionId, setBulkConnectionId] = useState<string | null>(null);
  const [bulkAccount, setBulkAccount] = useState<BulkAccountInfo | null>(null);
  const [qrCodeUrl, setQrCodeUrl] = useState<string | null>(null);
  const [waStatus, setWaStatus] = useState<string>('DISCONNECTED');
  const [connectionError, setConnectionError] = useState('');
  const qrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  // Create Campaign Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [campName, setCampName] = useState('');
  const [campDesc, setCampDesc] = useState('');
  const [msgType, setMsgType] = useState<'text' | 'image' | 'video' | 'document' | 'poll'>('text');
  const [textBody, setTextBody] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaCaption, setMediaCaption] = useState('');
  const [docFilename, setDocFilename] = useState('');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [recipientsRaw, setRecipientsRaw] = useState('');
  const [defaultCountryCode, setDefaultCountryCode] = useState('+91');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [ratePerSec, setRatePerSec] = useState<number>(1.0);
  const [launchImmediate, setLaunchImmediate] = useState(true);

  // Recipient drilldown modal
  const [activeCampaign, setActiveCampaign] = useState<CampaignItem | null>(null);
  const [recipients, setRecipients] = useState<RecipientItem[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientStatusFilter, setRecipientStatusFilter] = useState<string>('all');

  // ── LocalStorage persistence keys ──
  const LS_KEY_CONNECTION = 'unai_bulk_wa_connection';

  const saveConnectionToStorage = (connId: string, account: BulkAccountInfo) => {
    try {
      localStorage.setItem(LS_KEY_CONNECTION, JSON.stringify({ connectionId: connId, account, savedAt: Date.now() }));
    } catch {}
  };

  const clearConnectionFromStorage = () => {
    try { localStorage.removeItem(LS_KEY_CONNECTION); } catch {}
  };

  const loadConnectionFromStorage = (): { connectionId: string; account: BulkAccountInfo } | null => {
    try {
      const raw = localStorage.getItem(LS_KEY_CONNECTION);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.connectionId && parsed?.account) return parsed;
    } catch {}
    return null;
  };

  // ── WhatsApp Connection Logic ──
  useEffect(() => {
    mountedRef.current = true;
    checkExistingConnection();
    return () => {
      mountedRef.current = false;
      if (qrPollRef.current) clearInterval(qrPollRef.current);
      // NOTE: We do NOT disconnect on unmount — session persists until explicit Disconnect
    };
  }, []);

  const checkExistingConnection = async () => {
    setConnectionLoading(true);

    // 1. Check localStorage for a previously saved connection
    const saved = loadConnectionFromStorage();
    if (saved) {
      // Verify it's still valid by checking the backend sessions
      try {
        const sessRes = await fetchApi('/api/whatsapp/sessions');
        const sessions = sessRes?.data || [];
        const connected = sessions.find((s: any) => s.status === 'CONNECTED' || s.status === 'READY');
        if (connected) {
          // Session is still active — restore from saved state
          setBulkConnectionId(saved.connectionId);
          setBulkAccount({
            phone: connected.phone_number || saved.account.phone,
            name: connected.phone_number ? `+${connected.phone_number}` : (saved.account.name || 'WhatsApp Account'),
            profilePictureUrl: connected.profile_picture_url || saved.account.profilePictureUrl,
            connectionId: saved.connectionId,
            jid: saved.account.jid,
          });
          setWaStatus('CONNECTED');
          setConnectionStep('connected');
          setConnectionLoading(false);
          return;
        }
      } catch {}

      // Fallback: try the bulk API directly with the saved connection ID
      try {
        const bulkUrl = getBulkApiUrl();
        const statusRes = await fetch(`${bulkUrl}/v1/bulk/${saved.connectionId}/status`);
        const statusData = await statusRes.json();
        if (statusData.isReady && statusData.status === 'CONNECTED') {
          setBulkConnectionId(saved.connectionId);
          setBulkAccount({
            phone: statusData.userInfo?.phone || saved.account.phone,
            name: statusData.userInfo?.name || saved.account.name,
            profilePictureUrl: statusData.userInfo?.profilePictureUrl || saved.account.profilePictureUrl,
            jid: statusData.userInfo?.jid,
            connectionId: saved.connectionId,
          });
          setWaStatus('CONNECTED');
          setConnectionStep('connected');
          setConnectionLoading(false);
          return;
        }
      } catch {}
    }

    // 2. No saved connection — check backend sessions for any connected WhatsApp
    try {
      const sessRes = await fetchApi('/api/whatsapp/sessions');
      const sessions = sessRes?.data || [];
      const connected = sessions.find((s: any) => s.status === 'CONNECTED' || s.status === 'READY');
      if (connected) {
        const connId = connected.session_identifier || 'default';
        const acct: BulkAccountInfo = {
          phone: connected.phone_number,
          name: connected.phone_number ? `+${connected.phone_number}` : 'WhatsApp Account',
          profilePictureUrl: connected.profile_picture_url || undefined,
          connectionId: connId,
        };
        setBulkConnectionId(connId);
        setBulkAccount(acct);
        setWaStatus('CONNECTED');
        setConnectionStep('connected');
        saveConnectionToStorage(connId, acct);
        setConnectionLoading(false);
        return;
      }
    } catch {}

    // 3. Check bulk API for any active sessions
    try {
      const bulkUrl = getBulkApiUrl();
      const healthRes = await fetch(`${bulkUrl}/health`);
      if (healthRes.ok) {
        const health = await healthRes.json();
        if (health.active_sessions > 0) {
          const candidateIds = ['default', 'default_primary_session'];
          for (const connId of candidateIds) {
            try {
              const statusRes = await fetch(`${bulkUrl}/v1/bulk/${connId}/status`);
              const statusData = await statusRes.json();
              if (statusData.isReady && statusData.status === 'CONNECTED') {
                const acct: BulkAccountInfo = {
                  phone: statusData.userInfo?.phone,
                  name: statusData.userInfo?.name,
                  profilePictureUrl: statusData.userInfo?.profilePictureUrl,
                  jid: statusData.userInfo?.jid,
                  connectionId: connId,
                };
                setBulkConnectionId(connId);
                setBulkAccount(acct);
                setWaStatus('CONNECTED');
                setConnectionStep('connected');
                saveConnectionToStorage(connId, acct);
                setConnectionLoading(false);
                return;
              }
            } catch {}
          }
        }
      }
    } catch {}

    setConnectionLoading(false);
  };

  const startNewConnection = async () => {
    setConnectionStep('connecting');
    setConnectionError('');
    try {
      const bulkUrl = getBulkApiUrl();
      const connId = `bulk_${Date.now()}`;
      const res = await fetch(`${bulkUrl}/v1/bulk/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: connId }),
      });
      const data = await res.json();
      setBulkConnectionId(data.connectionId || connId);

      if (data.isReady) {
        setWaStatus('CONNECTED');
        setConnectionStep('connected');
        return;
      }

      // Start QR polling
      startQrPolling(data.connectionId || connId);
    } catch (err: any) {
      setConnectionError(err.message || 'Failed to connect to bulk messaging service');
      setConnectionStep('choose');
    }
  };

  const useExistingConnection = async () => {
    setConnectionStep('connecting');
    setConnectionError('');
    try {
      // Fetch existing connected sessions from the backend (same as WhatsApp Channels page)
      const sessRes = await fetchApi('/api/whatsapp/sessions');
      const sessions = sessRes?.data || [];
      const connected = sessions.find((s: any) => s.status === 'CONNECTED' || s.status === 'READY');

      if (connected) {
        // Found an existing connected session — use it directly
        const connId = connected.session_identifier || 'default';
        const acct: BulkAccountInfo = {
          phone: connected.phone_number,
          name: connected.phone_number ? `+${connected.phone_number}` : 'WhatsApp Account',
          profilePictureUrl: connected.profile_picture_url || undefined,
          connectionId: connId,
        };
        setBulkConnectionId(connId);
        setBulkAccount(acct);
        setWaStatus('CONNECTED');
        setConnectionStep('connected');
        saveConnectionToStorage(connId, acct);

        // Also initialize it on the bulk API so message sending works
        const bulkUrl = getBulkApiUrl();
        try {
          await fetch(`${bulkUrl}/v1/bulk/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ connectionId: connId }),
          });
        } catch {}

        return;
      }

      // No existing connection found
      setConnectionError('No existing WhatsApp connection found. Please connect WhatsApp on the WhatsApp Channels page first, or link a new account.');
      setConnectionStep('choose');
    } catch (err: any) {
      setConnectionError('Could not check existing connections. Please try linking a new account.');
      setConnectionStep('choose');
    }
  };

  const startQrPolling = (connId: string) => {
    if (qrPollRef.current) clearInterval(qrPollRef.current);
    const bulkUrl = getBulkApiUrl();
    let pollCount = 0;

    const poll = async () => {
      if (!mountedRef.current || pollCount > 150) {
        if (qrPollRef.current) clearInterval(qrPollRef.current);
        return;
      }
      pollCount++;

      try {
        // Check status
        const statusRes = await fetch(`${bulkUrl}/v1/bulk/${connId}/status`);
        const statusData = await statusRes.json();

        if (statusData.isReady && statusData.status === 'CONNECTED') {
          if (qrPollRef.current) clearInterval(qrPollRef.current);
          const acct: BulkAccountInfo = {
            phone: statusData.userInfo?.phone,
            name: statusData.userInfo?.name,
            profilePictureUrl: statusData.userInfo?.profilePictureUrl,
            jid: statusData.userInfo?.jid,
            connectionId: connId,
          };
          setBulkAccount(acct);
          setWaStatus('CONNECTED');
          setConnectionStep('connected');
          setQrCodeUrl(null);
          saveConnectionToStorage(connId, acct);
          return;
        }

        setWaStatus(statusData.status || 'WAITING');

        // Get QR code
        if (statusData.hasQR || statusData.status === 'QR_READY') {
          setQrCodeUrl(`${bulkUrl}/v1/bulk/${connId}/qr?t=${Date.now()}`);
        }
      } catch {}
    };

    poll();
    qrPollRef.current = setInterval(poll, 2000);
  };

  const handleDisconnect = async () => {
    if (!bulkConnectionId) return;
    try {
      const bulkUrl = getBulkApiUrl();
      await fetch(`${bulkUrl}/v1/bulk/${bulkConnectionId}/disconnect`, { method: 'POST' });
    } catch {}
    clearConnectionFromStorage();
    setBulkConnectionId(null);
    setBulkAccount(null);
    setWaStatus('DISCONNECTED');
    setConnectionStep('choose');
    setQrCodeUrl(null);
  };


  // File Upload Handler (CSV / TXT)
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      const lines = content.split(/\r\n|\n/);
      const parsedLines: string[] = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^(phone|mobile|number|recipient|contact|jid)/i.test(trimmed)) continue;

        let parts = [trimmed];
        if (trimmed.includes(',')) parts = trimmed.split(',');
        else if (trimmed.includes(';')) parts = trimmed.split(';');
        else if (trimmed.includes('\t')) parts = trimmed.split('\t');

        let rawPhone = parts[0]?.trim() || '';
        let name = parts[1]?.trim() || '';

        const digits0 = rawPhone.replace(/\D/g, '');
        const digits1 = name.replace(/\D/g, '');
        if (digits0.length < 7 && digits1.length >= 7) {
          const temp = rawPhone;
          rawPhone = name;
          name = temp;
        }

        if (rawPhone) {
          parsedLines.push(name ? `${rawPhone}, ${name}` : rawPhone);
        }
      }

      if (parsedLines.length > 0) {
        setRecipientsRaw((prev) => (prev ? `${prev.trim()}\n${parsedLines.join('\n')}` : parsedLines.join('\n')));
      }
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  // Dynamic Recipient Statistics
  const recipientStats = useMemo(() => {
    const lines = recipientsRaw.split('\n').map((l) => l.trim()).filter(Boolean);
    let mobileCount = 0;
    let channelCount = 0;
    for (const l of lines) {
      if (l.includes('@newsletter')) {
        channelCount++;
      } else {
        const digits = l.split(',')[0].replace(/\D/g, '');
        if (digits.length >= 7) mobileCount++;
      }
    }
    return { total: lines.length, mobileCount, channelCount };
  }, [recipientsRaw]);

  useEffect(() => {
    loadCampaigns();
  }, [statusFilter]);

  // Polling for active campaigns
  useEffect(() => {
    const hasActive = campaigns.some((c) => c.status === 'queued' || c.status === 'sending');
    if (!hasActive) return;

    const interval = setInterval(() => {
      loadCampaigns(true);
      if (activeCampaign) {
        loadRecipients(activeCampaign.id);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [campaigns, activeCampaign]);

  const loadCampaigns = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const url = statusFilter === 'all'
        ? '/v1/campaigns?page_size=50'
        : `/v1/campaigns?status=${statusFilter}&page_size=50`;
      const res = await fetchApi(url);
      if (res?.campaigns) setCampaigns(res.campaigns);
    } catch (err) {
      console.error('Failed to load campaigns:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadRecipients = async (campaignId: string) => {
    setRecipientsLoading(true);
    try {
      const url = recipientStatusFilter === 'all'
        ? `/v1/campaigns/${campaignId}/recipients?page_size=100`
        : `/v1/campaigns/${campaignId}/recipients?status=${recipientStatusFilter}&page_size=100`;
      const res = await fetchApi(url);
      if (res?.recipients) setRecipients(res.recipients);
    } catch (err) {
      console.error('Failed to load recipients:', err);
    } finally {
      setRecipientsLoading(false);
    }
  };

  const handleOpenRecipients = (camp: CampaignItem) => {
    setActiveCampaign(camp);
    loadRecipients(camp.id);
  };

  const handleLaunch = async (campaignId: string) => {
    try {
      await fetchApi(`/v1/campaigns/${campaignId}/launch`, { method: 'POST' });
      loadCampaigns();
    } catch (err: any) {
      alert(err?.message || 'Failed to launch campaign');
    }
  };

  const handleCancel = async (campaignId: string) => {
    if (!confirm('Are you sure you want to stop this campaign? Queued recipients will be cancelled.')) return;
    try {
      await fetchApi(`/v1/campaigns/${campaignId}/cancel`, { method: 'POST' });
      loadCampaigns();
    } catch (err: any) {
      alert(err?.message || 'Failed to cancel campaign');
    }
  };

  const handleCreateCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!campName.trim() || !recipientsRaw.trim()) return;

    // Parse recipient phone numbers or channel JIDs
    const lines = recipientsRaw.split('\n');
    const parsedRecipients: any[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      let rawTarget = trimmed;
      let name: string | undefined = undefined;

      // support CSV format: "phone/jid, name"
      if (trimmed.includes(',')) {
        const parts = trimmed.split(',');
        rawTarget = parts[0].trim();
        name = parts.slice(1).join(',').trim() || undefined;
      }

      // Check if it's a mobile phone number vs WhatsApp channel JID
      if (!rawTarget.includes('@newsletter')) {
        let cleaned = rawTarget.replace(/[^\d+]/g, '');
        if (!cleaned.startsWith('+')) {
          const digitsOnly = cleaned.replace(/\D/g, '');
          if (digitsOnly.length === 10 && defaultCountryCode) {
            cleaned = `${defaultCountryCode}${digitsOnly}`;
          } else if (digitsOnly.length > 0) {
            cleaned = `+${digitsOnly}`;
          }
        }
        if (cleaned) rawTarget = cleaned;
      }

      if (rawTarget) {
        parsedRecipients.push({
          recipient_jid: rawTarget,
          ...(name ? { recipient_name: name } : {})
        });
      }
    }

    if (parsedRecipients.length === 0) {
      alert('Please provide at least one valid recipient phone number or channel JID.');
      return;
    }

    // Build payload
    let payloadContent: any = {};
    if (msgType === 'text') {
      payloadContent = { body: textBody };
    } else if (msgType === 'image') {
      payloadContent = { media_url: mediaUrl, caption: mediaCaption };
    } else if (msgType === 'video') {
      payloadContent = { media_url: mediaUrl, caption: mediaCaption };
    } else if (msgType === 'document') {
      payloadContent = { media_url: mediaUrl, caption: mediaCaption, filename: docFilename || undefined };
    } else if (msgType === 'poll') {
      payloadContent = { question: pollQuestion, options: pollOptions.filter((o) => o.trim()) };
    }

    setCreating(true);
    try {
      // 1. Create campaign
      const created = await fetchApi('/v1/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: campName,
          description: campDesc || undefined,
          message_type: msgType,
          message_payload: payloadContent,
          recipients: parsedRecipients,
          messages_per_second: ratePerSec
        })
      });

      // 2. Launch if requested
      if (launchImmediate && created?.id) {
        await fetchApi(`/v1/campaigns/${created.id}/launch`, { method: 'POST' });
      }

      setShowCreateModal(false);
      resetForm();
      loadCampaigns();
    } catch (err: any) {
      alert(err?.message || 'Failed to create campaign');
    } finally {
      setCreating(false);
    }
  };

  const resetForm = () => {
    setCampName('');
    setCampDesc('');
    setMsgType('text');
    setTextBody('');
    setMediaUrl('');
    setMediaCaption('');
    setDocFilename('');
    setPollQuestion('');
    setPollOptions(['', '']);
    setRecipientsRaw('');
    setRatePerSec(1.0);
    setLaunchImmediate(true);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return { bg: '#dcfce7', text: '#15803d', label: 'COMPLETED' };
      case 'sending':
        return { bg: '#dbeafe', text: '#1d4ed8', label: 'SENDING' };
      case 'queued':
        return { bg: '#fef3c7', text: '#b45309', label: 'QUEUED' };
      case 'draft':
        return { bg: '#f1f5f9', text: '#475569', label: 'DRAFT' };
      case 'cancelled':
        return { bg: '#fee2e2', text: '#b91c1c', label: 'CANCELLED' };
      case 'partial_failure':
        return { bg: '#ffedd5', text: '#c2410c', label: 'PARTIAL FAILURE' };
      case 'failed':
        return { bg: '#fee2e2', text: '#b91c1c', label: 'FAILED' };
      default:
        return { bg: '#f1f5f9', text: '#64748b', label: status.toUpperCase() };
    }
  };

  // ── Connection Gate: Show before campaign management ──
  if (connectionLoading) {
    return (
      <div style={{ padding: '2rem 2.5rem', maxWidth: '1400px', margin: '0 auto' }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: '60vh', gap: '1.5rem'
        }}>
          <Loader2 size={48} style={{ color: '#2563eb', animation: 'spin 1s linear infinite' }} />
          <p style={{ color: '#64748b', fontSize: '1rem' }}>Checking WhatsApp connection...</p>
        </div>
      </div>
    );
  }

  if (connectionStep === 'choose') {
    return (
      <div style={{ padding: '2rem 2.5rem', maxWidth: '900px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{
          background: 'linear-gradient(135deg, #09101d 0%, #1e293b 100%)',
          borderRadius: '16px', padding: '2.5rem', color: '#fff', marginBottom: '2rem',
          boxShadow: '0 10px 25px -5px rgba(15, 23, 42, 0.3)', border: '1px solid rgba(255,255,255,0.08)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
            <span style={{
              backgroundColor: 'rgba(37, 99, 235, 0.25)', color: '#60a5fa',
              padding: '0.2rem 0.6rem', borderRadius: '6px', fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em'
            }}>WHATSAPP BULK DISPATCH</span>
          </div>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 800, letterSpacing: '-0.03em', margin: 0 }}>
            Connect WhatsApp Account
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginTop: '0.5rem', maxWidth: '600px' }}>
            Link your WhatsApp account to start sending bulk messages. Choose an existing connection or link a new account.
          </p>
        </div>

        {connectionError && (
          <div style={{
            backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '12px',
            padding: '1rem 1.25rem', marginBottom: '1.5rem', color: '#b91c1c', fontSize: '0.9rem'
          }}>
            {connectionError}
          </div>
        )}

        {/* Connection Options */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          {/* Option 1: Existing Connection */}
          <button
            onClick={useExistingConnection}
            style={{
              background: '#ffffff', border: '2px solid #e2e8f0', borderRadius: '16px',
              padding: '2.5rem 2rem', textAlign: 'center', cursor: 'pointer',
              transition: 'all 0.2s ease', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: '1rem'
            }}
            onMouseOver={(e) => { e.currentTarget.style.borderColor = '#22c55e'; e.currentTarget.style.boxShadow = '0 8px 25px rgba(34, 197, 94, 0.15)'; }}
            onMouseOut={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <div style={{
              width: '64px', height: '64px', borderRadius: '16px',
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 6px 16px rgba(34, 197, 94, 0.35)'
            }}>
              <Wifi size={28} color="#fff" />
            </div>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.4rem 0' }}>
                Use Existing Connection
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                Use your already linked WhatsApp account from WhatsApp Channels
              </p>
            </div>
          </button>

          {/* Option 2: Link New Account */}
          <button
            onClick={startNewConnection}
            style={{
              background: '#ffffff', border: '2px solid #e2e8f0', borderRadius: '16px',
              padding: '2.5rem 2rem', textAlign: 'center', cursor: 'pointer',
              transition: 'all 0.2s ease', display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: '1rem'
            }}
            onMouseOver={(e) => { e.currentTarget.style.borderColor = '#2563eb'; e.currentTarget.style.boxShadow = '0 8px 25px rgba(37, 99, 235, 0.15)'; }}
            onMouseOut={(e) => { e.currentTarget.style.borderColor = '#e2e8f0'; e.currentTarget.style.boxShadow = 'none'; }}
          >
            <div style={{
              width: '64px', height: '64px', borderRadius: '16px',
              background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 6px 16px rgba(37, 99, 235, 0.35)'
            }}>
              <Link2 size={28} color="#fff" />
            </div>
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#0f172a', margin: '0 0 0.4rem 0' }}>
                Link New WhatsApp Account
              </h3>
              <p style={{ fontSize: '0.85rem', color: '#64748b', margin: 0, lineHeight: 1.5 }}>
                Scan QR code to connect a new WhatsApp account for bulk messaging
              </p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  if (connectionStep === 'connecting') {
    return (
      <div style={{ padding: '2rem 2.5rem', maxWidth: '700px', margin: '0 auto' }}>
        <div style={{
          background: '#ffffff', borderRadius: '16px', border: '1px solid #e2e8f0',
          padding: '3rem', textAlign: 'center', boxShadow: '0 4px 16px rgba(15, 23, 42, 0.06)'
        }}>
          <div style={{
            width: '80px', height: '80px', borderRadius: '20px',
            background: 'linear-gradient(135deg, #2563eb 0%, #8b5cf6 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 1.5rem', boxShadow: '0 8px 20px rgba(37, 99, 235, 0.3)'
          }}>
            <Smartphone size={36} color="#fff" />
          </div>

          <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#0f172a', margin: '0 0 0.5rem 0' }}>
            Scan QR Code with WhatsApp
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.95rem', marginBottom: '2rem', maxWidth: '400px', margin: '0 auto 2rem' }}>
            Open WhatsApp on your phone → Linked Devices → Link a Device → Point camera at QR code
          </p>

          {/* QR Code Display */}
          <div style={{
            width: '300px', height: '300px', margin: '0 auto 2rem',
            backgroundColor: '#f8fafc', borderRadius: '16px', border: '2px dashed #cbd5e1',
            display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden'
          }}>
            {qrCodeUrl ? (
              <img
                src={qrCodeUrl}
                alt="WhatsApp QR Code"
                style={{ width: '280px', height: '280px', objectFit: 'contain' }}
                onError={() => {}}
              />
            ) : (
              <div style={{ textAlign: 'center', color: '#94a3b8' }}>
                <Loader2 size={40} style={{ animation: 'spin 1s linear infinite', marginBottom: '0.75rem' }} />
                <p style={{ fontSize: '0.9rem' }}>Generating QR Code...</p>
              </div>
            )}
          </div>

          {/* Status indicator */}
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
            backgroundColor: waStatus === 'QR_READY' ? '#eff6ff' : '#f8fafc',
            padding: '0.5rem 1rem', borderRadius: '8px', fontSize: '0.85rem',
            color: waStatus === 'QR_READY' ? '#2563eb' : '#64748b', fontWeight: 600
          }}>
            {waStatus === 'QR_READY' ? <QrCode size={16} /> : <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} />}
            {waStatus === 'QR_READY' ? 'Waiting for scan...' : waStatus === 'CONNECTED' ? 'Connected!' : `Status: ${waStatus}`}
          </div>

          <div style={{ marginTop: '2rem' }}>
            <button
              onClick={() => {
                if (qrPollRef.current) clearInterval(qrPollRef.current);
                setConnectionStep('choose');
                setQrCodeUrl(null);
              }}
              style={{
                backgroundColor: 'transparent', color: '#64748b', border: '1px solid #e2e8f0',
                padding: '0.6rem 1.5rem', borderRadius: '8px', fontSize: '0.875rem', fontWeight: 600, cursor: 'pointer'
              }}
            >
              ← Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Connected Account Status Bar */}
      {bulkAccount && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px',
          padding: '0.75rem 1.25rem', marginBottom: '1.25rem'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <CheckCircle2 size={20} style={{ color: '#16a34a' }} />
            <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#15803d' }}>WhatsApp Connected</span>
            {bulkAccount.phone && (
              <span style={{ fontSize: '0.85rem', color: '#166534', backgroundColor: '#dcfce7', padding: '0.15rem 0.6rem', borderRadius: '6px', fontWeight: 500 }}>
                +{bulkAccount.phone}
              </span>
            )}
            {bulkAccount.name && (
              <span style={{ fontSize: '0.85rem', color: '#475569' }}>({bulkAccount.name})</span>
            )}
          </div>
          <button
            onClick={handleDisconnect}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
              backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px',
              padding: '0.4rem 0.85rem', fontSize: '0.8rem', fontWeight: 600, color: '#64748b', cursor: 'pointer'
            }}
          >
            <LogOut size={14} /> Disconnect
          </button>
        </div>
      )}

      {/* Header Banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, #09101d 0%, #1e293b 100%)',
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
                backgroundColor: 'rgba(37, 99, 235, 0.25)',
                color: '#60a5fa',
                padding: '0.2rem 0.6rem',
                borderRadius: '6px',
                fontSize: '0.75rem',
                fontWeight: 700,
                letterSpacing: '0.05em'
              }}
            >
              WHATSAPP BULK DISPATCH
            </span>
          </div>
          <h1 style={{ fontSize: '1.875rem', fontWeight: 800, letterSpacing: '-0.03em', margin: 0 }}>
            Bulk Messaging Campaigns
          </h1>
          <p style={{ color: '#94a3b8', fontSize: '0.95rem', marginTop: '0.4rem', maxWidth: '650px' }}>
            Send personalized WhatsApp broadcasts across channels and audiences with automated queuing, real-time delivery monitoring, and rate limiting.
          </p>
        </div>

        <div className="flex gap-3">
          <button
            onClick={() => loadCampaigns()}
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
              border: '1px solid rgba(255, 255, 255, 0.15)'
            }}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
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
            <Plus size={18} /> New Campaign
          </button>
        </div>
      </div>

      {/* Filter Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid #e2e8f0',
          marginBottom: '2rem'
        }}
      >
        {['all', 'sending', 'queued', 'draft', 'completed', 'cancelled'].map((tab) => {
          const isActive = statusFilter === tab;
          return (
            <button
              key={tab}
              onClick={() => setStatusFilter(tab)}
              style={{
                padding: '0.75rem 1.25rem',
                borderBottom: isActive ? '3px solid #2563eb' : '3px solid transparent',
                color: isActive ? '#2563eb' : '#64748b',
                fontWeight: isActive ? 700 : 500,
                fontSize: '0.9rem',
                textTransform: 'capitalize',
                background: 'none',
                marginBottom: '-1px'
              }}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {/* Campaigns Table */}
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '14px',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(15, 23, 42, 0.04)'
        }}
      >
        {campaigns.length === 0 ? (
          <div style={{ padding: '3.5rem', textAlign: 'center' }}>
            <Send size={40} style={{ color: '#94a3b8', margin: '0 auto 1rem auto' }} />
            <h4 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' }}>No campaigns found</h4>
            <p style={{ color: '#64748b', fontSize: '0.9rem', maxWidth: '400px', margin: '0.5rem auto 1.5rem auto' }}>
              Create your first WhatsApp bulk campaign or change the status filter above.
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              style={{
                backgroundColor: '#2563eb',
                color: '#ffffff',
                padding: '0.6rem 1.25rem',
                borderRadius: '8px',
                fontSize: '0.875rem',
                fontWeight: 600
              }}
            >
              Create Campaign
            </button>
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ backgroundColor: '#f8fafc', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '0.875rem 1.5rem', fontWeight: 600 }}>CAMPAIGN NAME</th>
                <th style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>TYPE</th>
                <th style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>STATUS</th>
                <th style={{ padding: '0.875rem 1.5rem', fontWeight: 600 }}>PROGRESS & DELIVERIES</th>
                <th style={{ padding: '0.875rem 1rem', fontWeight: 600 }}>DISPATCH RATE</th>
                <th style={{ padding: '0.875rem 1.5rem', fontWeight: 600, textAlign: 'right' }}>ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const badge = getStatusBadge(c.status);
                const deliveredTotal = c.delivered_count + c.sent_count;
                const pct = c.total_recipients > 0 ? Math.round((deliveredTotal / c.total_recipients) * 100) : 0;

                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '1rem 1.5rem' }}>
                      <div style={{ fontWeight: 700, color: '#0f172a' }}>{c.name}</div>
                      {c.description && (
                        <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '0.15rem' }}>{c.description}</div>
                      )}
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                        Created {new Date(c.created_at).toLocaleDateString()}
                      </div>
                    </td>
                    <td style={{ padding: '1rem 1rem' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '0.3rem',
                          backgroundColor: '#f1f5f9',
                          padding: '0.2rem 0.5rem',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          color: '#475569'
                        }}
                      >
                        {c.message_type === 'text' && <FileText size={12} />}
                        {c.message_type === 'image' && <ImageIcon size={12} />}
                        {c.message_type === 'video' && <Video size={12} />}
                        {c.message_type}
                      </span>
                    </td>
                    <td style={{ padding: '1rem 1rem' }}>
                      <span
                        style={{
                          padding: '0.25rem 0.6rem',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          backgroundColor: badge.bg,
                          color: badge.text
                        }}
                      >
                        {badge.label}
                      </span>
                    </td>
                    <td style={{ padding: '1rem 1.5rem', minWidth: '220px' }}>
                      <div className="flex items-center justify-between" style={{ fontSize: '0.8rem', color: '#334155', marginBottom: '0.3rem' }}>
                        <span>
                          <strong>{deliveredTotal}</strong> / {c.total_recipients} delivered
                        </span>
                        <span style={{ fontWeight: 700 }}>{pct}%</span>
                      </div>
                      <div style={{ height: '6px', backgroundColor: '#e2e8f0', borderRadius: '999px', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${pct}%`,
                            backgroundColor: c.failed_count > 0 ? '#f59e0b' : '#2563eb',
                            borderRadius: '999px',
                            transition: 'width 0.3s'
                          }}
                        />
                      </div>
                      {c.failed_count > 0 && (
                        <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: '0.25rem' }}>
                          ⚠️ {c.failed_count} failed
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '1rem 1rem', color: '#64748b' }}>
                      {c.messages_per_second || 1.0} msg/sec
                    </td>
                    <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>
                      <div className="flex items-center justify-end gap-2">
                        {c.status === 'draft' && (
                          <button
                            onClick={() => handleLaunch(c.id)}
                            style={{
                              padding: '0.4rem 0.75rem',
                              borderRadius: '6px',
                              backgroundColor: '#2563eb',
                              color: '#ffffff',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}
                          >
                            <Play size={12} /> Launch
                          </button>
                        )}
                        {(c.status === 'queued' || c.status === 'sending') && (
                          <button
                            onClick={() => handleCancel(c.id)}
                            style={{
                              padding: '0.4rem 0.75rem',
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
                            <StopCircle size={12} /> Halt
                          </button>
                        )}
                        <button
                          onClick={() => handleOpenRecipients(c)}
                          style={{
                            padding: '0.4rem 0.75rem',
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
                          <Eye size={12} /> Recipients
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL: CREATE CAMPAIGN */}
      {/* ───────────────────────────────────────────────────────────── */}
      {showCreateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            backdropFilter: 'blur(4px)',
            overflowY: 'auto',
            padding: '2rem 1rem'
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '2rem',
              width: '100%',
              maxWidth: '680px',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              border: '1px solid #e2e8f0'
            }}
          >
            <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 0.4rem 0', color: '#0f172a' }}>
              Create WhatsApp Bulk Campaign
            </h3>
            <p style={{ color: '#64748b', fontSize: '0.875rem', margin: '0 0 1.5rem 0' }}>
              Compose your broadcast message, target recipients, and schedule immediate or staged delivery.
            </p>

            <form onSubmit={handleCreateCampaign}>
              {/* Campaign Name */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                  Campaign Name *
                </label>
                <input
                  type="text"
                  placeholder="Enter campaign name (e.g. Product Updates Broadcast)"
                  value={campName}
                  onChange={(e) => setCampName(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.9rem'
                  }}
                />
              </div>

              {/* Message Type Selector */}
              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                  Message Type
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
                  {[
                    { id: 'text', label: 'Text', icon: FileText },
                    { id: 'image', label: 'Image', icon: ImageIcon },
                    { id: 'video', label: 'Video', icon: Video },
                    { id: 'document', label: 'Document', icon: Paperclip }
                  ].map((t) => {
                    const Icon = t.icon;
                    const isSel = msgType === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setMsgType(t.id as any)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '0.5rem',
                          padding: '0.65rem',
                          borderRadius: '8px',
                          border: isSel ? '2px solid #2563eb' : '1px solid #cbd5e1',
                          backgroundColor: isSel ? '#eff6ff' : '#ffffff',
                          color: isSel ? '#2563eb' : '#475569',
                          fontWeight: 600,
                          fontSize: '0.85rem'
                        }}
                      >
                        <Icon size={16} /> {t.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Message Composer */}
              {msgType === 'text' && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                    Message Body * (Supports template variables like <code>{'{{name}}'}</code>)
                  </label>
                  <textarea
                    rows={4}
                    placeholder="Enter broadcast message body... Supports {{name}} template variables."
                    value={textBody}
                    onChange={(e) => setTextBody(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.9rem',
                      fontFamily: 'inherit'
                    }}
                  />
                </div>
              )}

              {(msgType === 'image' || msgType === 'video' || msgType === 'document') && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                    {msgType === 'document' ? 'Document URL * (Direct public URL to PDF, DOCX, etc.)' : 'Media URL * (Direct public URL)'}
                  </label>
                  <input
                    type="url"
                    placeholder={msgType === 'document' ? 'https://your-domain.com/path/to/report.pdf' : 'https://your-domain.com/path/to/media.png'}
                    value={mediaUrl}
                    onChange={(e) => setMediaUrl(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.9rem',
                      marginBottom: '0.75rem'
                    }}
                  />

                  {msgType === 'document' && (
                    <>
                      <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                        Filename (Optional — e.g. "report.pdf")
                      </label>
                      <input
                        type="text"
                        placeholder="report.pdf"
                        value={docFilename}
                        onChange={(e) => setDocFilename(e.target.value)}
                        style={{
                          width: '100%',
                          padding: '0.65rem 0.85rem',
                          borderRadius: '8px',
                          border: '1px solid #cbd5e1',
                          fontSize: '0.9rem',
                          marginBottom: '0.75rem'
                        }}
                      />
                    </>
                  )}

                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                    Caption (Optional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Enter optional caption..."
                    value={mediaCaption}
                    onChange={(e) => setMediaCaption(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.65rem 0.85rem',
                      borderRadius: '8px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.9rem',
                      fontFamily: 'inherit'
                    }}
                  />
                </div>
              )}

              {/* Recipients Input */}
              <div style={{ marginBottom: '1.25rem' }}>
                <input
                  type="file"
                  ref={fileInputRef}
                  accept=".csv,.txt"
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
                <div className="flex items-center justify-between" style={{ marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                    Recipients (Mobile Numbers or WhatsApp Channels) *
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex items-center gap-1"
                      style={{
                        fontSize: '0.78rem',
                        color: '#2563eb',
                        backgroundColor: '#eff6ff',
                        border: '1px solid #bfdbfe',
                        borderRadius: '6px',
                        padding: '0.25rem 0.6rem',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                      title="Upload CSV or TXT file with phone numbers and names"
                    >
                      <Upload size={13} /> Upload CSV / TXT
                    </button>
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>One per line</span>
                  </div>
                </div>

                {/* Country Code Helper */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    backgroundColor: '#f8fafc',
                    padding: '0.4rem 0.65rem',
                    borderRadius: '6px',
                    border: '1px solid #e2e8f0',
                    marginBottom: '0.5rem',
                    fontSize: '0.78rem',
                    color: '#475569'
                  }}
                >
                  <span className="flex items-center gap-1">
                    <Phone size={13} style={{ color: '#2563eb' }} /> Default Country Code for 10-digit numbers:
                  </span>
                  <select
                    value={defaultCountryCode}
                    onChange={(e) => setDefaultCountryCode(e.target.value)}
                    style={{
                      padding: '0.2rem 0.5rem',
                      borderRadius: '4px',
                      border: '1px solid #cbd5e1',
                      fontSize: '0.78rem',
                      backgroundColor: '#ffffff',
                      color: '#0f172a',
                      fontWeight: 500
                    }}
                  >
                    <option value="+91">+91 (India)</option>
                    <option value="+1">+1 (US / Canada)</option>
                    <option value="+44">+44 (UK)</option>
                    <option value="+971">+971 (UAE)</option>
                    <option value="+65">+65 (Singapore)</option>
                    <option value="+61">+61 (Australia)</option>
                    <option value="">None (Already has Country Code)</option>
                  </select>
                </div>

                <textarea
                  rows={5}
                  placeholder={`Enter recipient phone numbers or channel JIDs, one per line:\n+1234567890\n+1234567890, Contact Name\n120363...@newsletter, Channel Broadcast`}
                  value={recipientsRaw}
                  onChange={(e) => setRecipientsRaw(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '0.65rem 0.85rem',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.85rem',
                    fontFamily: 'monospace'
                  }}
                />

                {/* Recipient Statistics Chips */}
                {recipientStats.total > 0 && (
                  <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                    {recipientStats.mobileCount > 0 && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: '#15803d',
                          backgroundColor: '#dcfce7',
                          padding: '0.2rem 0.55rem',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          fontWeight: 600
                        }}
                      >
                        <Phone size={12} /> {recipientStats.mobileCount} Mobile Phone{recipientStats.mobileCount > 1 ? 's' : ''}
                      </span>
                    )}
                    {recipientStats.channelCount > 0 && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: '#4338ca',
                          backgroundColor: '#e0e7ff',
                          padding: '0.2rem 0.55rem',
                          borderRadius: '999px',
                          fontSize: '0.75rem',
                          fontWeight: 600
                        }}
                      >
                        <Users size={12} /> {recipientStats.channelCount} Channel{recipientStats.channelCount > 1 ? 's' : ''}
                      </span>
                    )}
                    <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                      Total: {recipientStats.total} recipient{recipientStats.total > 1 ? 's' : ''}
                    </span>
                  </div>
                )}
              </div>

              {/* Rate Limit Slider */}
              <div style={{ marginBottom: '1.5rem' }}>
                <div className="flex items-center justify-between" style={{ marginBottom: '0.4rem' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                    Dispatch Speed Limit
                  </label>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#2563eb' }}>
                    {ratePerSec} messages / sec
                  </span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="10.0"
                  step="0.2"
                  value={ratePerSec}
                  onChange={(e) => setRatePerSec(parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                />
                <div className="flex justify-between" style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.2rem' }}>
                  <span>0.2 msg/s (Gentle)</span>
                  <span>1.0 msg/s (Standard)</span>
                  <span>10.0 msg/s (High Volume)</span>
                </div>
              </div>

              {/* Launch Immediately Option */}
              <div style={{ marginBottom: '1.5rem' }}>
                <label className="flex items-center gap-2" style={{ cursor: 'pointer', fontSize: '0.9rem', color: '#0f172a' }}>
                  <input
                    type="checkbox"
                    checked={launchImmediate}
                    onChange={(e) => setLaunchImmediate(e.target.checked)}
                  />
                  <strong>Launch immediately</strong> (Campaign worker will begin dispatching queued recipients)
                </label>
              </div>

              {/* Actions */}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
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
                  disabled={creating}
                  style={{
                    padding: '0.65rem 1.5rem',
                    borderRadius: '8px',
                    backgroundColor: '#2563eb',
                    color: '#ffffff',
                    fontWeight: 600,
                    fontSize: '0.875rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                >
                  {creating ? <RefreshCw size={16} className="animate-spin" /> : <Send size={16} />}
                  {launchImmediate ? 'Create & Launch' : 'Save as Draft'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* MODAL: RECIPIENTS DRILLDOWN */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeCampaign && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            backdropFilter: 'blur(4px)',
            padding: '2rem 1rem'
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: '16px',
              padding: '2rem',
              width: '100%',
              maxWidth: '840px',
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
              border: '1px solid #e2e8f0'
            }}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between" style={{ marginBottom: '1rem' }}>
              <div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: '#0f172a' }}>
                  Campaign Recipients: {activeCampaign.name}
                </h3>
                <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0.2rem 0 0 0' }}>
                  Total: {activeCampaign.total_recipients} | Delivered: {activeCampaign.delivered_count} | Failed: {activeCampaign.failed_count}
                </p>
              </div>
              <button
                onClick={() => setActiveCampaign(null)}
                style={{
                  padding: '0.4rem 0.8rem',
                  borderRadius: '6px',
                  border: '1px solid #cbd5e1',
                  color: '#64748b',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                Close
              </button>
            </div>

            {/* Recipient Filter Pills */}
            <div className="flex gap-2" style={{ marginBottom: '1rem' }}>
              {['all', 'delivered', 'sending', 'queued', 'failed'].map((st) => (
                <button
                  key={st}
                  onClick={() => {
                    setRecipientStatusFilter(st);
                    loadRecipients(activeCampaign.id);
                  }}
                  style={{
                    padding: '0.25rem 0.65rem',
                    borderRadius: '999px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    textTransform: 'capitalize',
                    backgroundColor: recipientStatusFilter === st ? '#2563eb' : '#f1f5f9',
                    color: recipientStatusFilter === st ? '#ffffff' : '#64748b'
                  }}
                >
                  {st}
                </button>
              ))}
            </div>

            {/* Table */}
            <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
              {recipientsLoading ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                  Loading recipient statuses...
                </div>
              ) : recipients.length === 0 ? (
                <div style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
                  No recipients match this filter.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', color: '#64748b', borderBottom: '1px solid #e2e8f0' }}>
                      <th style={{ padding: '0.6rem 1rem' }}>RECIPIENT (PHONE / CHANNEL)</th>
                      <th style={{ padding: '0.6rem 1rem' }}>NAME</th>
                      <th style={{ padding: '0.6rem 1rem' }}>STATUS</th>
                      <th style={{ padding: '0.6rem 1rem' }}>MESSAGE ID / ERROR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipients.map((r) => (
                      <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.6rem 1rem', fontFamily: 'monospace' }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            {r.recipient_jid.includes('@newsletter') ? (
                              <span title="WhatsApp Channel" style={{ display: 'inline-flex' }}>
                                <Users size={13} style={{ color: '#6366f1' }} />
                              </span>
                            ) : (
                              <span title="Mobile Phone" style={{ display: 'inline-flex' }}>
                                <Phone size={13} style={{ color: '#16a34a' }} />
                              </span>
                            )}
                            {r.recipient_jid}
                          </span>
                        </td>
                        <td style={{ padding: '0.6rem 1rem', color: '#334155' }}>{r.recipient_name || '-'}</td>
                        <td style={{ padding: '0.6rem 1rem' }}>
                          <span
                            style={{
                              padding: '0.15rem 0.4rem',
                              borderRadius: '4px',
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              backgroundColor:
                                r.status === 'delivered'
                                  ? '#dcfce7'
                                  : r.status === 'failed'
                                  ? '#fee2e2'
                                  : '#f1f5f9',
                              color:
                                r.status === 'delivered'
                                  ? '#15803d'
                                  : r.status === 'failed'
                                  ? '#b91c1c'
                                  : '#475569'
                            }}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td style={{ padding: '0.6rem 1rem', color: r.error_message ? '#dc2626' : '#64748b' }}>
                          {r.provider_message_id || r.error_message || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
