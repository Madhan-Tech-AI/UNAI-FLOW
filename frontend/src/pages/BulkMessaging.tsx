import React, { useState, useEffect } from 'react';
import {
  Send,
  Plus,
  RefreshCw,
  Play,
  StopCircle,
  FileText,
  Image as ImageIcon,
  Video,
  Eye
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

export default function BulkMessaging() {
  const [campaigns, setCampaigns] = useState<CampaignItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Create Campaign Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [campName, setCampName] = useState('');
  const [campDesc, setCampDesc] = useState('');
  const [msgType, setMsgType] = useState<'text' | 'image' | 'video' | 'poll'>('text');
  const [textBody, setTextBody] = useState('');
  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaCaption, setMediaCaption] = useState('');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['Option 1', 'Option 2']);
  const [recipientsRaw, setRecipientsRaw] = useState('');
  const [ratePerSec, setRatePerSec] = useState<number>(1.0);
  const [launchImmediate, setLaunchImmediate] = useState(true);

  // Recipient drilldown modal
  const [activeCampaign, setActiveCampaign] = useState<CampaignItem | null>(null);
  const [recipients, setRecipients] = useState<RecipientItem[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientStatusFilter, setRecipientStatusFilter] = useState<string>('all');

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

    // Parse recipient JIDs
    const lines = recipientsRaw.split('\n');
    const parsedRecipients: any[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // support CSV format: "jid, name"
      if (trimmed.includes(',')) {
        const [jid, name] = trimmed.split(',').map((s) => s.trim());
        if (jid) parsedRecipients.push({ recipient_jid: jid, recipient_name: name });
      } else {
        parsedRecipients.push({ recipient_jid: trimmed });
      }
    }

    if (parsedRecipients.length === 0) {
      alert('Please provide at least one valid recipient JID.');
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
    setPollQuestion('');
    setPollOptions(['Option 1', 'Option 2']);
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

  return (
    <div style={{ padding: '2rem 2.5rem', maxWidth: '1400px', margin: '0 auto' }}>
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
                  placeholder="e.g. October Product Updates Broadcast"
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
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
                  {[
                    { id: 'text', label: 'Text Message', icon: FileText },
                    { id: 'image', label: 'Image + Caption', icon: ImageIcon },
                    { id: 'video', label: 'Video Broadcast', icon: Video }
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
                    placeholder="Hello {{name}}! We are delighted to share our latest product update with you."
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

              {(msgType === 'image' || msgType === 'video') && (
                <div style={{ marginBottom: '1.25rem' }}>
                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                    Media URL * (Direct public URL)
                  </label>
                  <input
                    type="url"
                    placeholder="https://example.com/assets/banner.png"
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

                  <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#334155', marginBottom: '0.4rem' }}>
                    Caption (Optional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Check out our latest release..."
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
                <div className="flex items-center justify-between" style={{ marginBottom: '0.4rem' }}>
                  <label style={{ fontSize: '0.85rem', fontWeight: 600, color: '#334155' }}>
                    Recipients (WhatsApp Channel JIDs or Phone JIDs) *
                  </label>
                  <span style={{ fontSize: '0.75rem', color: '#64748b' }}>One per line or "JID, Name"</span>
                </div>
                <textarea
                  rows={5}
                  placeholder={`120363171744447809@newsletter, General Announcement\n120363171744447810@newsletter, VIP Channel`}
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
                      <th style={{ padding: '0.6rem 1rem' }}>RECIPIENT JID</th>
                      <th style={{ padding: '0.6rem 1rem' }}>NAME</th>
                      <th style={{ padding: '0.6rem 1rem' }}>STATUS</th>
                      <th style={{ padding: '0.6rem 1rem' }}>MESSAGE ID / ERROR</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipients.map((r) => (
                      <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '0.6rem 1rem', fontFamily: 'monospace' }}>{r.recipient_jid}</td>
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
