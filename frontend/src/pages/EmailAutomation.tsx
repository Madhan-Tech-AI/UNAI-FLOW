import React, { useState, useEffect, useRef } from 'react';
import {
  Mail,
  Upload,
  Download,
  AlertCircle,
  Send,
  FileSpreadsheet,
  Trash2,
  RefreshCw,
  Plus,
  ArrowRight,
  ArrowLeft,
  Check,
  RotateCcw,
  Smartphone,
  Monitor,
  Ban,
  Search,
  Info,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Link2,
} from 'lucide-react';
import { fetchApi, fetchApiRaw, API_BASE_URL } from '../lib/apiClient';

interface RecipientPreview {
  row_number: number;
  email: string;
  name: string;
  status: 'valid' | 'invalid' | 'duplicate' | 'suppressed';
  reason?: string;
}

interface ValidationSummary {
  total_rows: number;
  valid_count: number;
  invalid_count: number;
  duplicate_count: number;
  suppressed_count: number;
  valid_recipients: Array<{ email: string; name?: string; variables?: Record<string, any> }>;
  preview_records: RecipientPreview[];
  can_send: boolean;
}

interface Campaign {
  id: string;
  name: string;
  subject: string;
  from_email: string;
  from_name: string;
  reply_to?: string;
  html_body: string;
  text_body?: string;
  status: 'draft' | 'queued' | 'sending' | 'completed' | 'partial_failure' | 'failed' | 'cancelled';
  total_recipients: number;
  queued_count: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  bounced_count: number;
  created_at: string;
  started_at?: string;
  completed_at?: string;
}

interface RecipientItem {
  id: string;
  campaign_id: string;
  email: string;
  name?: string;
  status: 'pending' | 'queued' | 'sending' | 'sent' | 'delivered' | 'failed' | 'bounced' | 'complained' | 'cancelled';
  provider_message_id?: string;
  error_message?: string;
  sent_at?: string;
  delivered_at?: string;
  failed_at?: string;
  created_at: string;
}

interface SuppressionItem {
  id: string;
  email: string;
  reason: string;
  notes?: string;
  created_at: string;
}

type TabMode = 'campaigns' | 'create' | 'detail' | 'suppressions';
type CreateStep = 1 | 2 | 3 | 4;

export default function EmailAutomation() {
  const [tab, setTab] = useState<TabMode>('campaigns');
  const [loading, setLoading] = useState(false);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [recipients, setRecipients] = useState<RecipientItem[]>([]);
  const [suppressions, setSuppressions] = useState<SuppressionItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [recipientFilter, setRecipientFilter] = useState<string>('all');
  const [recipientSearch, setRecipientSearch] = useState('');

  // ── Create Wizard State ──
  const [createStep, setCreateStep] = useState<CreateStep>(1);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [validationData, setValidationData] = useState<ValidationSummary | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [previewTabFilter, setPreviewTabFilter] = useState<'all' | 'valid' | 'issues'>('all');

  // Campaign Form State
  const [campaignName, setCampaignName] = useState('');
  const [subject, setSubject] = useState('');
  const [fromName, setFromName] = useState('UNAI Flow');
  const [replyTo, setReplyTo] = useState('');
  const [htmlBody, setHtmlBody] = useState('<p>Hello {{name}},</p><p>We are delighted to invite you to the <strong>UNAI Technology Summit 2026</strong>.</p><p>Regards,<br><strong>UNAI Team</strong></p>');

  // Preview State
  const [selectedPreviewContact, setSelectedPreviewContact] = useState<number>(0);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [renderedPreview, setRenderedPreview] = useState<{ subject: string; html: string; text: string } | null>(null);

  // Send Confirmation Modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [sendingAction, setSendingAction] = useState(false);

  // Manual Suppression Modal
  const [showSuppressionModal, setShowSuppressionModal] = useState(false);
  const [suppressionEmail, setSuppressionEmail] = useState('');
  const [suppressionReason, setSuppressionReason] = useState('unsubscribed');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);

  // ── Initial Load ──
  useEffect(() => {
    loadCampaigns();
  }, []);

  // ── Realtime Polling for Active Campaign ──
  useEffect(() => {
    let timer: any;
    if (tab === 'detail' && selectedCampaign && ['queued', 'sending'].includes(selectedCampaign.status)) {
      timer = setInterval(() => {
        refreshCampaignDetails(selectedCampaign.id);
      }, 2500);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [tab, selectedCampaign]);

  // ── Server-Side Preview Rendering ──
  useEffect(() => {
    if (createStep === 3 && subject && htmlBody) {
      const contact = validationData?.valid_recipients?.[selectedPreviewContact];
      const vars = contact?.variables || { name: contact?.name || 'John' };
      fetchApi('/api/email-campaigns/preview', {
        method: 'POST',
        body: JSON.stringify({ subject, html_body: htmlBody, variables: vars }),
      })
        .then((res) => {
          if (res?.success) {
            setRenderedPreview({ subject: res.subject, html: res.html, text: res.text });
          }
        })
        .catch(() => {});
    }
  }, [createStep, subject, htmlBody, selectedPreviewContact, validationData]);

  const loadCampaigns = async () => {
    setLoading(true);
    try {
      const res = await fetchApi('/api/email-campaigns');
      if (res?.success) {
        setCampaigns(res.campaigns || []);
      }
    } catch (err) {
      console.error('Failed to load campaigns:', err);
    } finally {
      setLoading(false);
    }
  };

  const loadSuppressions = async () => {
    try {
      const res = await fetchApi('/api/email-campaigns/suppressions');
      if (res?.success) {
        setSuppressions(res.suppressions || []);
      }
    } catch (err) {
      console.error('Failed to load suppressions:', err);
    }
  };

  const refreshCampaignDetails = async (campaignId: string) => {
    try {
      const [cRes, rRes] = await Promise.all([
        fetchApi(`/api/email-campaigns/${campaignId}`),
        fetchApi(`/api/email-campaigns/${campaignId}/recipients?limit=100`),
      ]);
      if (cRes?.success) setSelectedCampaign(cRes.campaign);
      if (rRes?.success) setRecipients(rRes.recipients || []);
    } catch (err) {
      console.error('Failed to refresh campaign details:', err);
    }
  };

  const openCampaignDetails = async (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setTab('detail');
    await refreshCampaignDetails(campaign.id);
  };

  // ── Template Download ──
  const handleDownloadTemplate = async () => {
    try {
      const res = await fetchApiRaw('/api/email-campaigns/template');
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'UNAI_Flow_Email_Recipients_Template.xlsx';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      alert('Failed to download template: ' + (err as Error).message);
    }
  };

  // ── Excel File Upload & Validation ──
  const handleFileUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    setUploadedFileName(file.name);

    try {
      const formData = new FormData();
      formData.append('file', file);

      // We use raw fetch with auth header for multipart
      const { data: { session } } = await (await import('../lib/supabaseClient')).supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const res = await fetch(`${API_BASE_URL}/api/email-campaigns/parse-recipients`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.detail || 'Failed to parse Excel file');
      }

      const data = await res.json();
      if (data?.success) {
        setValidationData(data.data);
      }
    } catch (err: any) {
      setUploadError(err.message);
      setValidationData(null);
    } finally {
      setUploading(false);
    }
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleClearFile = () => {
    setValidationData(null);
    setUploadedFileName(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── Rich Text Editor Commands ──
  const applyFormat = (command: string, value: string | undefined = undefined) => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      setHtmlBody(editorRef.current.innerHTML);
    }
  };

  const insertVariable = (variableName: string) => {
    const token = `{{${variableName}}}`;
    document.execCommand('insertText', false, token);
    if (editorRef.current) {
      setHtmlBody(editorRef.current.innerHTML);
    }
  };

  // ── Save Draft or Send ──
  const handleSaveDraft = async () => {
    if (!campaignName.trim()) {
      alert('Please enter a Campaign Name');
      return;
    }
    if (!subject.trim()) {
      alert('Please enter a Subject line');
      return;
    }
    setSendingAction(true);
    try {
      const res = await fetchApi('/api/email-campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: campaignName,
          subject,
          from_name: fromName,
          reply_to: replyTo || undefined,
          html_body: htmlBody,
          recipients: validationData?.valid_recipients || [],
          status: 'draft',
        }),
      });

      if (res?.success) {
        alert('Campaign saved as draft successfully!');
        resetCreateWizard();
        setTab('campaigns');
        loadCampaigns();
      }
    } catch (err: any) {
      alert('Failed to save draft: ' + err.message);
    } finally {
      setSendingAction(false);
    }
  };

  const handleSendCampaign = async () => {
    setSendingAction(true);
    try {
      const res = await fetchApi('/api/email-campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name: campaignName,
          subject,
          from_name: fromName,
          reply_to: replyTo || undefined,
          html_body: htmlBody,
          recipients: validationData?.valid_recipients || [],
          status: 'queued',
        }),
      });

      if (res?.success) {
        setShowConfirmModal(false);
        const newCampaign = res.campaign;
        resetCreateWizard();
        openCampaignDetails(newCampaign);
      }
    } catch (err: any) {
      alert('Failed to launch campaign: ' + err.message);
    } finally {
      setSendingAction(false);
    }
  };

  const handleRetryFailed = async () => {
    if (!selectedCampaign) return;
    try {
      const res = await fetchApi(`/api/email-campaigns/${selectedCampaign.id}/retry-failed`, {
        method: 'POST',
      });
      if (res?.success) {
        alert(`Requeued ${res.requeued_count} failed recipient(s) for delivery.`);
        refreshCampaignDetails(selectedCampaign.id);
      }
    } catch (err: any) {
      alert('Retry error: ' + err.message);
    }
  };

  const handleCancelCampaign = async () => {
    if (!selectedCampaign) return;
    if (!confirm('Are you sure you want to stop sending this campaign? Any queued recipients will be cancelled.')) return;
    try {
      const res = await fetchApi(`/api/email-campaigns/${selectedCampaign.id}/cancel`, {
        method: 'POST',
      });
      if (res?.success) {
        refreshCampaignDetails(selectedCampaign.id);
      }
    } catch (err: any) {
      alert('Cancel error: ' + err.message);
    }
  };

  const handleDeleteCampaign = async (id: string) => {
    if (!confirm('Are you sure you want to delete this campaign?')) return;
    try {
      await fetchApi(`/api/email-campaigns/${id}`, { method: 'DELETE' });
      loadCampaigns();
      if (selectedCampaign?.id === id) {
        setSelectedCampaign(null);
        setTab('campaigns');
      }
    } catch (err: any) {
      alert('Delete error: ' + err.message);
    }
  };

  const resetCreateWizard = () => {
    setCreateStep(1);
    setValidationData(null);
    setUploadedFileName(null);
    setUploadError(null);
    setCampaignName('');
    setSubject('');
    setReplyTo('');
    setHtmlBody('<p>Hello {{name}},</p><p>We are delighted to invite you to the <strong>UNAI Technology Summit 2026</strong>.</p><p>Regards,<br><strong>UNAI Team</strong></p>');
  };

  // ── Calculated KPI Metrics ──
  const totalCampaigns = campaigns.length;
  const totalRecipientsAll = campaigns.reduce((acc, c) => acc + (c.total_recipients || 0), 0);
  const totalDeliveredAll = campaigns.reduce((acc, c) => acc + (c.delivered_count || c.sent_count || 0), 0);
  const totalFailedAll = campaigns.reduce((acc, c) => acc + (c.failed_count || 0), 0);
  const deliveryRate = totalRecipientsAll > 0 ? Math.round((totalDeliveredAll / totalRecipientsAll) * 100) : 100;

  const filteredCampaigns = campaigns.filter((c) => {
    if (statusFilter === 'all') return true;
    return c.status === statusFilter;
  });

  const filteredRecipients = recipients.filter((r) => {
    const matchesStatus = recipientFilter === 'all' || r.status === recipientFilter;
    const matchesSearch = !recipientSearch || r.email.toLowerCase().includes(recipientSearch.toLowerCase()) || (r.name && r.name.toLowerCase().includes(recipientSearch.toLowerCase()));
    return matchesStatus && matchesSearch;
  });

  return (
    <div style={{ padding: '2rem', maxWidth: '1440px', margin: '0 auto', minHeight: '100vh', backgroundColor: 'var(--bg-main)' }}>
      {/* ── Top Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
            <div
              style={{
                width: '42px',
                height: '42px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                boxShadow: '0 6px 16px rgba(37, 99, 235, 0.35)',
              }}
            >
              <Mail size={22} />
            </div>
            <div>
              <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', letterSpacing: '-0.02em', margin: 0 }}>
                Email Automation
              </h1>
              <p style={{ fontSize: '0.925rem', color: 'var(--text-secondary)', margin: 0 }}>
                Create and send personalized bulk email campaigns to your contacts.
              </p>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          {tab === 'campaigns' && (
            <>
              <button
                onClick={() => {
                  setTab('suppressions');
                  loadSuppressions();
                }}
                style={{
                  padding: '0.65rem 1rem',
                  borderRadius: '10px',
                  backgroundColor: '#fff',
                  border: '1px solid var(--border)',
                  color: 'var(--text-secondary)',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  boxShadow: 'var(--shadow-sm)',
                }}
              >
                <Ban size={16} />
                Suppression List
              </button>
              <button
                onClick={() => {
                  resetCreateWizard();
                  setTab('create');
                }}
                style={{
                  padding: '0.65rem 1.25rem',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)',
                }}
              >
                <Plus size={18} />
                Create Campaign
              </button>
            </>
          )}

          {(tab === 'create' || tab === 'detail' || tab === 'suppressions') && (
            <button
              onClick={() => {
                setTab('campaigns');
                loadCampaigns();
              }}
              style={{
                padding: '0.65rem 1.25rem',
                borderRadius: '10px',
                backgroundColor: '#fff',
                border: '1px solid var(--border)',
                color: 'var(--text-main)',
                fontWeight: 600,
                fontSize: '0.875rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
              <ArrowLeft size={16} />
              Back to Campaigns
            </button>
          )}
        </div>
      </div>

      {/* ── KPI Analytics Banner (Visible on Campaigns Tab) ── */}
      {tab === 'campaigns' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
          <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '1.25rem', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
            <span style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', fontWeight: 600 }}>TOTAL CAMPAIGNS</span>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-main)', marginTop: '0.5rem' }}>{totalCampaigns}</div>
          </div>
          <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '1.25rem', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
            <span style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', fontWeight: 600 }}>TOTAL RECIPIENTS</span>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#2563eb', marginTop: '0.5rem' }}>{totalRecipientsAll.toLocaleString()}</div>
          </div>
          <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '1.25rem', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
            <span style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', fontWeight: 600 }}>DELIVERED / ACCEPTED</span>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: '#10b981', marginTop: '0.5rem' }}>
              {totalDeliveredAll.toLocaleString()} <span style={{ fontSize: '0.925rem', fontWeight: 600, color: '#059669' }}>({deliveryRate}%)</span>
            </div>
          </div>
          <div style={{ backgroundColor: '#fff', borderRadius: '16px', padding: '1.25rem', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)' }}>
            <span style={{ fontSize: '0.825rem', color: 'var(--text-secondary)', fontWeight: 600 }}>FAILED / BOUNCED</span>
            <div style={{ fontSize: '1.75rem', fontWeight: 800, color: totalFailedAll > 0 ? '#ef4444' : 'var(--text-secondary)', marginTop: '0.5rem' }}>
              {totalFailedAll.toLocaleString()}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 1: CAMPAIGNS LIST ── */}
      {tab === 'campaigns' && (
        <div style={{ backgroundColor: '#fff', borderRadius: '18px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', overflow: 'hidden' }}>
          {/* Table Header & Filters */}
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0, color: 'var(--text-main)' }}>Campaign History</h2>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {['all', 'draft', 'queued', 'sending', 'completed', 'failed'].map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  style={{
                    padding: '0.4rem 0.8rem',
                    borderRadius: '8px',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    textTransform: 'capitalize',
                    backgroundColor: statusFilter === st ? 'var(--primary)' : '#f1f5f9',
                    color: statusFilter === st ? '#fff' : 'var(--text-secondary)',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  {st}
                </button>
              ))}
              <button
                onClick={loadCampaigns}
                style={{
                  padding: '0.4rem 0.65rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border)',
                  backgroundColor: '#fff',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                }}
                title="Refresh campaigns"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>

          {/* Table Content */}
          {filteredCampaigns.length === 0 ? (
            <div style={{ padding: '4rem 2rem', textAlign: 'center' }}>
              <div style={{ width: '64px', height: '64px', borderRadius: '50%', backgroundColor: '#f1f5f9', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                <Mail size={32} />
              </div>
              <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.5rem' }}>
                No email campaigns found
              </h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', maxWidth: '420px', margin: '0 auto 1.5rem' }}>
                Upload your recipient spreadsheet, write your message with rich personalization tags, and launch your first campaign.
              </p>
              <button
                onClick={() => {
                  resetCreateWizard();
                  setTab('create');
                }}
                style={{
                  padding: '0.65rem 1.25rem',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
                  color: '#fff',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                }}
              >
                Create First Campaign
              </button>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.775rem', textTransform: 'uppercase' }}>
                    <th style={{ padding: '1rem 1.5rem' }}>Campaign</th>
                    <th style={{ padding: '1rem' }}>Recipients</th>
                    <th style={{ padding: '1rem' }}>Sent</th>
                    <th style={{ padding: '1rem' }}>Delivered</th>
                    <th style={{ padding: '1rem' }}>Failed</th>
                    <th style={{ padding: '1rem' }}>Status</th>
                    <th style={{ padding: '1rem' }}>Created</th>
                    <th style={{ padding: '1rem 1.5rem', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCampaigns.map((c) => {
                    const statusColor =
                      c.status === 'completed'
                        ? '#10b981'
                        : c.status === 'sending' || c.status === 'queued'
                        ? '#2563eb'
                        : c.status === 'failed' || c.status === 'partial_failure'
                        ? '#ef4444'
                        : '#64748b';

                    return (
                      <tr
                        key={c.id}
                        onClick={() => openCampaignDetails(c)}
                        style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background-color 0.15s' }}
                        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = '#f8fafc')}
                        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = 'transparent')}
                      >
                        <td style={{ padding: '1rem 1.5rem' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{c.name}</div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.15rem' }}>{c.subject}</div>
                        </td>
                        <td style={{ padding: '1rem', fontWeight: 600 }}>{c.total_recipients.toLocaleString()}</td>
                        <td style={{ padding: '1rem', color: '#2563eb', fontWeight: 600 }}>{c.sent_count.toLocaleString()}</td>
                        <td style={{ padding: '1rem', color: '#10b981', fontWeight: 600 }}>{(c.delivered_count || c.sent_count).toLocaleString()}</td>
                        <td style={{ padding: '1rem', color: c.failed_count > 0 ? '#ef4444' : '#94a3b8', fontWeight: 600 }}>
                          {c.failed_count.toLocaleString()}
                        </td>
                        <td style={{ padding: '1rem' }}>
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '0.35rem',
                              padding: '0.25rem 0.65rem',
                              borderRadius: '20px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              backgroundColor: `${statusColor}15`,
                              color: statusColor,
                              textTransform: 'capitalize',
                            }}
                          >
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: statusColor }} />
                            {c.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td style={{ padding: '1rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                          {new Date(c.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td style={{ padding: '1rem 1.5rem', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                            <button
                              onClick={() => openCampaignDetails(c)}
                              style={{ padding: '0.4rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border)', backgroundColor: '#fff', fontSize: '0.775rem', fontWeight: 600, color: 'var(--text-main)' }}
                            >
                              View
                            </button>
                            {c.status === 'draft' && (
                              <button
                                onClick={() => handleDeleteCampaign(c.id)}
                                style={{ padding: '0.4rem 0.65rem', borderRadius: '6px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#ef4444', fontSize: '0.775rem' }}
                                title="Delete draft"
                              >
                                <Trash2 size={14} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: CREATE CAMPAIGN WIZARD ── */}
      {tab === 'create' && (
        <div>
          {/* Stepper Progress Bar */}
          <div style={{ backgroundColor: '#fff', borderRadius: '18px', padding: '1.25rem 2rem', border: '1px solid var(--border)', boxShadow: 'var(--shadow-sm)', marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {[
              { num: 1, label: 'Upload Recipients' },
              { num: 2, label: 'Compose Message' },
              { num: 3, label: 'Preview Personalization' },
              { num: 4, label: 'Review & Send' },
            ].map((st, i) => {
              const isActive = createStep === st.num;
              const isPast = createStep > st.num;
              return (
                <div key={st.num} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: 1 }}>
                  <div
                    style={{
                      width: '34px',
                      height: '34px',
                      borderRadius: '50%',
                      backgroundColor: isActive ? '#2563eb' : isPast ? '#10b981' : '#f1f5f9',
                      color: isActive || isPast ? '#fff' : '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '0.875rem',
                    }}
                  >
                    {isPast ? <Check size={16} /> : st.num}
                  </div>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontWeight: 600, display: 'block' }}>STEP {st.num}</span>
                    <span style={{ fontSize: '0.9rem', fontWeight: isActive ? 700 : 500, color: isActive ? 'var(--text-main)' : 'var(--text-secondary)' }}>
                      {st.label}
                    </span>
                  </div>
                  {i < 3 && <div style={{ flex: 1, height: '2px', backgroundColor: isPast ? '#10b981' : 'var(--border)', margin: '0 1rem' }} />}
                </div>
              );
            })}
          </div>

          {/* ── Step 1: Upload Recipients ── */}
          {createStep === 1 && (
            <div style={{ backgroundColor: '#fff', borderRadius: '18px', padding: '2rem', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
                    Step 1: Upload Recipient Spreadsheet
                  </h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                    Upload an Excel file (.xlsx) containing contact emails and names.
                  </p>
                </div>
                <button
                  onClick={handleDownloadTemplate}
                  style={{
                    padding: '0.65rem 1rem',
                    borderRadius: '10px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid var(--border)',
                    color: '#2563eb',
                    fontWeight: 600,
                    fontSize: '0.875rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  <Download size={16} />
                  Download Excel Template
                </button>
              </div>

              {/* Upload Drop Zone */}
              {!validationData ? (
                <div
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    border: '2px dashed var(--border)',
                    borderRadius: '16px',
                    padding: '3rem 2rem',
                    textAlign: 'center',
                    backgroundColor: '#f8fafc',
                    cursor: 'pointer',
                    transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = '#2563eb')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = 'var(--border)')}
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept=".xlsx, .xls"
                    style={{ display: 'none' }}
                    onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                  />
                  <div style={{ width: '56px', height: '56px', borderRadius: '50%', backgroundColor: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                    <Upload size={28} />
                  </div>
                  <h3 style={{ fontSize: '1.125rem', fontWeight: 700, color: 'var(--text-main)', marginBottom: '0.25rem' }}>
                    {uploading ? 'Processing & Validating Spreadsheet...' : 'Drop your Excel file here or click to browse'}
                  </h3>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', margin: 0 }}>
                    Supports .xlsx and .xls files up to 10 MB (up to 10,000 recipients).
                  </p>
                  {uploadError && (
                    <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: '#fef2f2', color: '#ef4444', borderRadius: '8px', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                      <AlertCircle size={16} />
                      {uploadError}
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  {/* File Uploaded Header Card */}
                  <div style={{ backgroundColor: '#f8fafc', borderRadius: '12px', padding: '1rem 1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <FileSpreadsheet size={24} color="#10b981" />
                      <div>
                        <span style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '0.925rem' }}>{uploadedFileName}</span>
                        <span style={{ color: '#10b981', fontSize: '0.775rem', display: 'block', fontWeight: 600 }}>Validated successfully by server</span>
                      </div>
                    </div>
                    <button
                      onClick={handleClearFile}
                      style={{ padding: '0.4rem 0.75rem', borderRadius: '6px', border: '1px solid var(--border)', backgroundColor: '#fff', fontSize: '0.8rem', color: '#ef4444', fontWeight: 600 }}
                    >
                      Replace File
                    </button>
                  </div>

                  {/* Summary Counters */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div style={{ backgroundColor: '#eff6ff', borderRadius: '12px', padding: '1rem', textAlign: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: '#1d4ed8', fontWeight: 600 }}>TOTAL ROWS</span>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#1d4ed8', marginTop: '0.25rem' }}>{validationData.total_rows}</div>
                    </div>
                    <div style={{ backgroundColor: '#ecfdf5', borderRadius: '12px', padding: '1rem', textAlign: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: '#047857', fontWeight: 600 }}>VALID EMAILS</span>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#047857', marginTop: '0.25rem' }}>{validationData.valid_count}</div>
                    </div>
                    <div style={{ backgroundColor: '#fef2f2', borderRadius: '12px', padding: '1rem', textAlign: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: '#b91c1c', fontWeight: 600 }}>INVALID SYNTAX</span>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#b91c1c', marginTop: '0.25rem' }}>{validationData.invalid_count}</div>
                    </div>
                    <div style={{ backgroundColor: '#fffbeb', borderRadius: '12px', padding: '1rem', textAlign: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: '#b45309', fontWeight: 600 }}>DUPLICATES</span>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#b45309', marginTop: '0.25rem' }}>{validationData.duplicate_count}</div>
                    </div>
                    <div style={{ backgroundColor: '#f1f5f9', borderRadius: '12px', padding: '1rem', textAlign: 'center' }}>
                      <span style={{ fontSize: '0.75rem', color: '#475569', fontWeight: 600 }}>SUPPRESSED</span>
                      <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#475569', marginTop: '0.25rem' }}>{validationData.suppressed_count}</div>
                    </div>
                  </div>

                  {/* Recipient Preview Table */}
                  <div style={{ border: '1px solid var(--border)', borderRadius: '12px', overflow: 'hidden', marginBottom: '1.5rem' }}>
                    <div style={{ padding: '0.75rem 1rem', backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-main)' }}>Validation Preview (Sample of records)</span>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        {(['all', 'valid', 'issues'] as const).map((pf) => (
                          <button
                            key={pf}
                            onClick={() => setPreviewTabFilter(pf)}
                            style={{
                              padding: '0.25rem 0.65rem',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              fontWeight: 600,
                              textTransform: 'capitalize',
                              backgroundColor: previewTabFilter === pf ? '#2563eb' : '#fff',
                              color: previewTabFilter === pf ? '#fff' : 'var(--text-secondary)',
                              border: '1px solid var(--border)',
                            }}
                          >
                            {pf}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div style={{ maxHeight: '280px', overflowY: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                        <thead>
                          <tr style={{ backgroundColor: '#fff', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                            <th style={{ padding: '0.65rem 1rem' }}>Row</th>
                            <th style={{ padding: '0.65rem 1rem' }}>Name</th>
                            <th style={{ padding: '0.65rem 1rem' }}>Email</th>
                            <th style={{ padding: '0.65rem 1rem' }}>Status</th>
                            <th style={{ padding: '0.65rem 1rem' }}>Details</th>
                          </tr>
                        </thead>
                        <tbody>
                          {validationData.preview_records
                            .filter((r) => {
                              if (previewTabFilter === 'valid') return r.status === 'valid';
                              if (previewTabFilter === 'issues') return r.status !== 'valid';
                              return true;
                            })
                            .map((r, i) => (
                              <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                <td style={{ padding: '0.65rem 1rem', color: 'var(--text-secondary)' }}>#{r.row_number}</td>
                                <td style={{ padding: '0.65rem 1rem', fontWeight: 500 }}>{r.name}</td>
                                <td style={{ padding: '0.65rem 1rem', fontFamily: 'monospace' }}>{r.email}</td>
                                <td style={{ padding: '0.65rem 1rem' }}>
                                  <span
                                    style={{
                                      padding: '0.2rem 0.5rem',
                                      borderRadius: '12px',
                                      fontSize: '0.7rem',
                                      fontWeight: 600,
                                      textTransform: 'capitalize',
                                      backgroundColor:
                                        r.status === 'valid'
                                          ? '#ecfdf5'
                                          : r.status === 'invalid'
                                          ? '#fef2f2'
                                          : r.status === 'duplicate'
                                          ? '#fffbeb'
                                          : '#f1f5f9',
                                      color:
                                        r.status === 'valid'
                                          ? '#059669'
                                          : r.status === 'invalid'
                                          ? '#dc2626'
                                          : r.status === 'duplicate'
                                          ? '#d97706'
                                          : '#64748b',
                                    }}
                                  >
                                    {r.status}
                                  </span>
                                </td>
                                <td style={{ padding: '0.65rem 1rem', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>{r.reason || '—'}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Navigation Buttons */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                    <button
                      disabled={validationData.valid_count === 0}
                      onClick={() => setCreateStep(2)}
                      style={{
                        padding: '0.75rem 1.5rem',
                        borderRadius: '10px',
                        background: validationData.valid_count > 0 ? 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)' : '#cbd5e1',
                        color: '#fff',
                        fontWeight: 600,
                        fontSize: '0.9rem',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        cursor: validationData.valid_count > 0 ? 'pointer' : 'not-allowed',
                      }}
                    >
                      Next: Compose Message
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Step 2: Compose Message ── */}
          {createStep === 2 && (
            <div style={{ backgroundColor: '#fff', borderRadius: '18px', padding: '2rem', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 1.5rem' }}>
                Step 2: Compose Email Content
              </h2>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.25rem', marginBottom: '1.25rem' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.4rem' }}>
                    Campaign Name *
                  </label>
                  <input
                    type="text"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="e.g. UNAI Technology Summit 2026 Invitation"
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid var(--border)', fontSize: '0.9rem' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.4rem' }}>
                    Sender Name
                  </label>
                  <input
                    type="text"
                    value={fromName}
                    onChange={(e) => setFromName(e.target.value)}
                    placeholder="UNAI Flow"
                    style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid var(--border)', fontSize: '0.9rem' }}
                  />
                </div>
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label style={{ display: 'block', fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.4rem' }}>
                  Email Subject Line *
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Exclusive Invitation for {{name}} — UNAI Summit 2026"
                  style={{ width: '100%', padding: '0.75rem', borderRadius: '10px', border: '1px solid var(--border)', fontSize: '0.9rem' }}
                />
                <span style={{ fontSize: '0.775rem', color: 'var(--text-secondary)', marginTop: '0.35rem', display: 'block' }}>
                  Tip: You can include <code>{'{{name}}'}</code> in the subject line for personalized open rates.
                </span>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label style={{ fontSize: '0.825rem', fontWeight: 600, color: 'var(--text-main)' }}>Email Body (Rich Text)</label>
                  <div style={{ display: 'flex', gap: '0.35rem' }}>
                    <span style={{ fontSize: '0.775rem', color: 'var(--text-secondary)', marginRight: '0.5rem', alignSelf: 'center' }}>
                      Insert Variable:
                    </span>
                    {['name', 'email', 'company'].map((v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => insertVariable(v)}
                        style={{
                          padding: '0.25rem 0.5rem',
                          borderRadius: '6px',
                          backgroundColor: '#eff6ff',
                          color: '#2563eb',
                          border: '1px solid #bfdbfe',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                        }}
                      >
                        +{`{{${v}}}`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Editor Toolbar */}
                <div style={{ border: '1px solid var(--border)', borderTopLeftRadius: '10px', borderTopRightRadius: '10px', backgroundColor: '#f8fafc', padding: '0.5rem 0.75rem', display: 'flex', gap: '0.4rem', borderBottom: 'none', flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => applyFormat('bold')} style={{ padding: '0.35rem', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: '#fff' }} title="Bold">
                    <Bold size={15} />
                  </button>
                  <button type="button" onClick={() => applyFormat('italic')} style={{ padding: '0.35rem', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: '#fff' }} title="Italic">
                    <Italic size={15} />
                  </button>
                  <button type="button" onClick={() => applyFormat('underline')} style={{ padding: '0.35rem', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: '#fff' }} title="Underline">
                    <Underline size={15} />
                  </button>
                  <div style={{ width: '1px', backgroundColor: 'var(--border)', margin: '0 0.25rem' }} />
                  <button type="button" onClick={() => applyFormat('formatBlock', '<h1>')} style={{ padding: '0.35rem', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: '#fff' }} title="H1 Heading">
                    <Heading1 size={15} />
                  </button>
                  <button type="button" onClick={() => applyFormat('formatBlock', '<h2>')} style={{ padding: '0.35rem', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: '#fff' }} title="H2 Heading">
                    <Heading2 size={15} />
                  </button>
                  <button type="button" onClick={() => applyFormat('insertUnorderedList')} style={{ padding: '0.35rem', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: '#fff' }} title="Bullet List">
                    <List size={15} />
                  </button>
                  <button type="button" onClick={() => applyFormat('insertOrderedList')} style={{ padding: '0.35rem', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: '#fff' }} title="Numbered List">
                    <ListOrdered size={15} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const url = prompt('Enter URL:');
                      if (url) applyFormat('createLink', url);
                    }}
                    style={{ padding: '0.35rem', borderRadius: '4px', border: '1px solid var(--border)', backgroundColor: '#fff' }}
                    title="Insert Link"
                  >
                    <Link2 size={15} />
                  </button>
                </div>

                {/* Editor Surface */}
                <div
                  ref={editorRef}
                  contentEditable
                  dangerouslySetInnerHTML={{ __html: htmlBody }}
                  onInput={(e) => setHtmlBody((e.target as HTMLElement).innerHTML)}
                  style={{
                    border: '1px solid var(--border)',
                    borderBottomLeftRadius: '10px',
                    borderBottomRightRadius: '10px',
                    padding: '1.25rem',
                    minHeight: '220px',
                    fontSize: '0.95rem',
                    lineHeight: 1.6,
                    backgroundColor: '#fff',
                    outline: 'none',
                  }}
                />
              </div>

              {/* Step Navigation */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setCreateStep(1)}
                  style={{ padding: '0.75rem 1.25rem', borderRadius: '10px', border: '1px solid var(--border)', backgroundColor: '#fff', color: 'var(--text-main)', fontWeight: 600 }}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={!campaignName.trim() || !subject.trim()}
                  onClick={() => setCreateStep(3)}
                  style={{
                    padding: '0.75rem 1.5rem',
                    borderRadius: '10px',
                    background: campaignName.trim() && subject.trim() ? 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)' : '#cbd5e1',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    cursor: campaignName.trim() && subject.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  Next: Preview Personalization
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: Preview Personalization ── */}
          {createStep === 3 && (
            <div style={{ backgroundColor: '#fff', borderRadius: '18px', padding: '2rem', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div>
                  <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
                    Step 3: Preview Rendered Email
                  </h2>
                  <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                    Inspect the exact rendered email with resolved dynamic contact variables.
                  </p>
                </div>

                {/* Recipient Picker & Device Toggle */}
                <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  {validationData && validationData.valid_recipients.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Preview Recipient:</span>
                      <select
                        value={selectedPreviewContact}
                        onChange={(e) => setSelectedPreviewContact(Number(e.target.value))}
                        style={{ padding: '0.4rem 0.75rem', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.825rem' }}
                      >
                        {validationData.valid_recipients.slice(0, 10).map((r, i) => (
                          <option key={i} value={i}>
                            {r.name ? `${r.name} (${r.email})` : r.email}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden' }}>
                    <button
                      onClick={() => setPreviewDevice('desktop')}
                      style={{ padding: '0.4rem 0.65rem', backgroundColor: previewDevice === 'desktop' ? '#2563eb' : '#fff', color: previewDevice === 'desktop' ? '#fff' : 'var(--text-secondary)' }}
                      title="Desktop preview"
                    >
                      <Monitor size={16} />
                    </button>
                    <button
                      onClick={() => setPreviewDevice('mobile')}
                      style={{ padding: '0.4rem 0.65rem', backgroundColor: previewDevice === 'mobile' ? '#2563eb' : '#fff', color: previewDevice === 'mobile' ? '#fff' : 'var(--text-secondary)' }}
                      title="Mobile preview"
                    >
                      <Smartphone size={16} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Rendered Email Mock Window */}
              <div
                style={{
                  margin: '0 auto',
                  maxWidth: previewDevice === 'mobile' ? '380px' : '720px',
                  border: '1px solid var(--border)',
                  borderRadius: '16px',
                  overflow: 'hidden',
                  boxShadow: 'var(--shadow-md)',
                  marginBottom: '2rem',
                }}
              >
                {/* Email Header Bar */}
                <div style={{ backgroundColor: '#f8fafc', padding: '1rem', borderBottom: '1px solid var(--border)', fontSize: '0.825rem' }}>
                  <div style={{ marginBottom: '0.35rem' }}>
                    <strong style={{ color: 'var(--text-secondary)' }}>From: </strong>
                    <span>{fromName} &lt;{fromName.toLowerCase().replace(/\s+/g, '')}@unaiflow.com&gt;</span>
                  </div>
                  <div style={{ marginBottom: '0.35rem' }}>
                    <strong style={{ color: 'var(--text-secondary)' }}>To: </strong>
                    <span>
                      {validationData?.valid_recipients?.[selectedPreviewContact]?.name
                        ? `${validationData.valid_recipients[selectedPreviewContact].name} <${validationData.valid_recipients[selectedPreviewContact].email}>`
                        : validationData?.valid_recipients?.[selectedPreviewContact]?.email || 'recipient@example.com'}
                    </span>
                  </div>
                  <div>
                    <strong style={{ color: 'var(--text-secondary)' }}>Subject: </strong>
                    <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{renderedPreview?.subject || subject}</span>
                  </div>
                </div>

                {/* Email Body Preview Container */}
                <div
                  style={{
                    backgroundColor: '#fff',
                    padding: '2rem',
                    minHeight: '260px',
                    fontSize: '0.95rem',
                    lineHeight: 1.6,
                  }}
                  dangerouslySetInnerHTML={{ __html: renderedPreview?.html || htmlBody }}
                />
              </div>

              {/* Step Navigation */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setCreateStep(2)}
                  style={{ padding: '0.75rem 1.25rem', borderRadius: '10px', border: '1px solid var(--border)', backgroundColor: '#fff', color: 'var(--text-main)', fontWeight: 600 }}
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => setCreateStep(4)}
                  style={{
                    padding: '0.75rem 1.5rem',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
                    color: '#fff',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                  }}
                >
                  Next: Review & Send
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Review & Send ── */}
          {createStep === 4 && (
            <div style={{ backgroundColor: '#fff', borderRadius: '18px', padding: '2rem', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', margin: '0 0 1.5rem' }}>
                Step 4: Campaign Final Review
              </h2>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem', marginBottom: '2rem' }}>
                <div style={{ backgroundColor: '#f8fafc', borderRadius: '12px', padding: '1.25rem', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '0.775rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>CAMPAIGN DETAILS</span>
                  <div style={{ marginTop: '0.75rem', fontSize: '0.9rem' }}>
                    <div style={{ marginBottom: '0.5rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Name: </span>
                      <strong style={{ color: 'var(--text-main)' }}>{campaignName}</strong>
                    </div>
                    <div style={{ marginBottom: '0.5rem' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Subject: </span>
                      <strong style={{ color: 'var(--text-main)' }}>{subject}</strong>
                    </div>
                    <div>
                      <span style={{ color: 'var(--text-secondary)' }}>Sender: </span>
                      <strong style={{ color: 'var(--text-main)' }}>{fromName}</strong>
                    </div>
                  </div>
                </div>

                <div style={{ backgroundColor: '#f8fafc', borderRadius: '12px', padding: '1.25rem', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: '0.775rem', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>RECIPIENT BREAKDOWN</span>
                  <div style={{ marginTop: '0.75rem', fontSize: '0.9rem' }}>
                    <div style={{ marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Valid Recipients to Send:</span>
                      <strong style={{ color: '#10b981' }}>{validationData?.valid_count || 0}</strong>
                    </div>
                    <div style={{ marginBottom: '0.5rem', display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Duplicates Filtered:</span>
                      <strong style={{ color: '#f59e0b' }}>{validationData?.duplicate_count || 0}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>Invalid / Suppressed:</span>
                      <strong style={{ color: '#ef4444' }}>{(validationData?.invalid_count || 0) + (validationData?.suppressed_count || 0)}</strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Delivery Disclaimer */}
              <div style={{ backgroundColor: '#eff6ff', borderRadius: '12px', padding: '1rem 1.25rem', border: '1px solid #bfdbfe', display: 'flex', gap: '0.75rem', alignItems: 'flex-start', marginBottom: '2rem' }}>
                <Info size={20} color="#2563eb" style={{ flexShrink: 0, marginTop: '2px' }} />
                <div style={{ fontSize: '0.85rem', color: '#1e40af', lineHeight: 1.5 }}>
                  <strong>Queue-Based Delivery:</strong> Once you click <em>Send Campaign</em>, recipients will be queued in the background worker and dispatched with rate limiting and idempotency protection. You can track real-time delivery on the campaign details page.
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  type="button"
                  onClick={() => setCreateStep(3)}
                  style={{ padding: '0.75rem 1.25rem', borderRadius: '10px', border: '1px solid var(--border)', backgroundColor: '#fff', color: 'var(--text-main)', fontWeight: 600 }}
                >
                  Back to Preview
                </button>
                <div style={{ display: 'flex', gap: '0.75rem' }}>
                  <button
                    type="button"
                    disabled={sendingAction}
                    onClick={handleSaveDraft}
                    style={{ padding: '0.75rem 1.25rem', borderRadius: '10px', border: '1px solid var(--border)', backgroundColor: '#fff', color: 'var(--text-main)', fontWeight: 600 }}
                  >
                    Save as Draft
                  </button>
                  <button
                    type="button"
                    disabled={sendingAction || !validationData || validationData.valid_count === 0}
                    onClick={() => setShowConfirmModal(true)}
                    style={{
                      padding: '0.75rem 1.75rem',
                      borderRadius: '10px',
                      background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: '0.925rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      boxShadow: '0 4px 14px rgba(37, 99, 235, 0.35)',
                    }}
                  >
                    <Send size={16} />
                    Send Campaign
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB 3: CAMPAIGN DETAILS & REAL-TIME PROGRESS ── */}
      {tab === 'detail' && selectedCampaign && (
        <div>
          {/* Header Card */}
          <div style={{ backgroundColor: '#fff', borderRadius: '18px', padding: '1.75rem 2rem', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>
                    {selectedCampaign.name}
                  </h2>
                  <span
                    style={{
                      padding: '0.2rem 0.65rem',
                      borderRadius: '12px',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                      textTransform: 'capitalize',
                      backgroundColor:
                        selectedCampaign.status === 'completed'
                          ? '#ecfdf5'
                          : selectedCampaign.status === 'sending' || selectedCampaign.status === 'queued'
                          ? '#eff6ff'
                          : '#fef2f2',
                      color:
                        selectedCampaign.status === 'completed'
                          ? '#059669'
                          : selectedCampaign.status === 'sending' || selectedCampaign.status === 'queued'
                          ? '#2563eb'
                          : '#dc2626',
                    }}
                  >
                    {selectedCampaign.status.replace('_', ' ')}
                  </span>
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: '0.35rem 0 0' }}>
                  <strong>Subject: </strong> {selectedCampaign.subject}
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem' }}>
                {selectedCampaign.failed_count > 0 && (
                  <button
                    onClick={handleRetryFailed}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: '8px',
                      backgroundColor: '#fffbeb',
                      border: '1px solid #fde68a',
                      color: '#b45309',
                      fontWeight: 600,
                      fontSize: '0.825rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                    }}
                  >
                    <RotateCcw size={14} />
                    Retry Failed ({selectedCampaign.failed_count})
                  </button>
                )}
                {['queued', 'sending'].includes(selectedCampaign.status) && (
                  <button
                    onClick={handleCancelCampaign}
                    style={{
                      padding: '0.5rem 1rem',
                      borderRadius: '8px',
                      backgroundColor: '#fef2f2',
                      border: '1px solid #fecaca',
                      color: '#ef4444',
                      fontWeight: 600,
                      fontSize: '0.825rem',
                    }}
                  >
                    Cancel Campaign
                  </button>
                )}
                <button
                  onClick={() => refreshCampaignDetails(selectedCampaign.id)}
                  style={{
                    padding: '0.5rem 0.75rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    backgroundColor: '#fff',
                  }}
                  title="Refresh status"
                >
                  <RefreshCw size={15} />
                </button>
              </div>
            </div>

            {/* Live Progress Bar */}
            {selectedCampaign.total_recipients > 0 && (
              <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.825rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                  <span>
                    Sending Progress: {selectedCampaign.sent_count + selectedCampaign.failed_count} / {selectedCampaign.total_recipients} processed
                  </span>
                  <span>
                    {Math.round(((selectedCampaign.sent_count + selectedCampaign.failed_count) / selectedCampaign.total_recipients) * 100)}%
                  </span>
                </div>
                <div style={{ height: '8px', borderRadius: '4px', backgroundColor: '#e2e8f0', overflow: 'hidden', display: 'flex' }}>
                  <div
                    style={{
                      width: `${(selectedCampaign.sent_count / selectedCampaign.total_recipients) * 100}%`,
                      backgroundColor: '#10b981',
                      transition: 'width 0.3s ease',
                    }}
                  />
                  <div
                    style={{
                      width: `${(selectedCampaign.failed_count / selectedCampaign.total_recipients) * 100}%`,
                      backgroundColor: '#ef4444',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            )}

            {/* Metrics Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
              <div style={{ backgroundColor: '#f8fafc', borderRadius: '10px', padding: '0.75rem 1rem' }}>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total Contacts</span>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-main)', marginTop: '0.15rem' }}>
                  {selectedCampaign.total_recipients}
                </div>
              </div>
              <div style={{ backgroundColor: '#eff6ff', borderRadius: '10px', padding: '0.75rem 1rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#1d4ed8' }}>Queued / Sending</span>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1d4ed8', marginTop: '0.15rem' }}>
                  {selectedCampaign.queued_count}
                </div>
              </div>
              <div style={{ backgroundColor: '#ecfdf5', borderRadius: '10px', padding: '0.75rem 1rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#047857' }}>Sent / Delivered</span>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#047857', marginTop: '0.15rem' }}>
                  {selectedCampaign.sent_count}
                </div>
              </div>
              <div style={{ backgroundColor: '#fef2f2', borderRadius: '10px', padding: '0.75rem 1rem' }}>
                <span style={{ fontSize: '0.75rem', color: '#b91c1c' }}>Failed</span>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#b91c1c', marginTop: '0.15rem' }}>
                  {selectedCampaign.failed_count}
                </div>
              </div>
            </div>
          </div>

          {/* Recipients Delivery Table */}
          <div style={{ backgroundColor: '#fff', borderRadius: '18px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', overflow: 'hidden' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>Recipient Delivery Log</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>({filteredRecipients.length} records)</span>
              </div>

              {/* Filter Tabs & Search */}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                  <input
                    type="text"
                    value={recipientSearch}
                    onChange={(e) => setRecipientSearch(e.target.value)}
                    placeholder="Search contact..."
                    style={{ padding: '0.35rem 0.75rem 0.35rem 2rem', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.8rem', width: '160px' }}
                  />
                </div>
                {['all', 'queued', 'sending', 'sent', 'failed'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setRecipientFilter(st)}
                    style={{
                      padding: '0.35rem 0.65rem',
                      borderRadius: '6px',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      textTransform: 'capitalize',
                      backgroundColor: recipientFilter === st ? '#2563eb' : '#f1f5f9',
                      color: recipientFilter === st ? '#fff' : 'var(--text-secondary)',
                      border: 'none',
                    }}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {filteredRecipients.length === 0 ? (
              <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                No recipients match your search filter.
              </div>
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: '420px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.825rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                      <th style={{ padding: '0.75rem 1.25rem' }}>Recipient</th>
                      <th style={{ padding: '0.75rem' }}>Status</th>
                      <th style={{ padding: '0.75rem' }}>Message ID / Error</th>
                      <th style={{ padding: '0.75rem 1.25rem', textAlign: 'right' }}>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecipients.map((r) => {
                      const stColor =
                        r.status === 'sent' || r.status === 'delivered'
                          ? '#10b981'
                          : r.status === 'sending' || r.status === 'queued'
                          ? '#2563eb'
                          : r.status === 'failed' || r.status === 'bounced'
                          ? '#ef4444'
                          : '#64748b';

                      return (
                        <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '0.75rem 1.25rem' }}>
                            <div style={{ fontWeight: 600, color: 'var(--text-main)' }}>{r.name || '—'}</div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.775rem' }}>{r.email}</div>
                          </td>
                          <td style={{ padding: '0.75rem' }}>
                            <span
                              style={{
                                padding: '0.2rem 0.55rem',
                                borderRadius: '12px',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                textTransform: 'capitalize',
                                backgroundColor: `${stColor}15`,
                                color: stColor,
                              }}
                            >
                              {r.status}
                            </span>
                          </td>
                          <td style={{ padding: '0.75rem', maxWidth: '300px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {r.error_message ? (
                              <span style={{ color: '#ef4444' }} title={r.error_message}>
                                {r.error_message}
                              </span>
                            ) : r.provider_message_id ? (
                              <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{r.provider_message_id}</code>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td style={{ padding: '0.75rem 1.25rem', textAlign: 'right', color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                            {r.sent_at || r.failed_at ? new Date(r.sent_at || r.failed_at!).toLocaleTimeString() : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 4: SUPPRESSION LIST ── */}
      {tab === 'suppressions' && (
        <div style={{ backgroundColor: '#fff', borderRadius: '18px', border: '1px solid var(--border)', boxShadow: 'var(--shadow-md)', overflow: 'hidden' }}>
          <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h2 style={{ fontSize: '1.125rem', fontWeight: 700, margin: 0 }}>Suppression List</h2>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
                Contacts on this list (unsubscribed, permanent bounces, complaints) are automatically skipped during campaign sends.
              </p>
            </div>
            <button
              onClick={() => setShowSuppressionModal(true)}
              style={{
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
                color: '#fff',
                fontSize: '0.8rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.4rem',
              }}
            >
              <Plus size={14} />
              Add Suppressed Email
            </button>
          </div>

          {suppressions.length === 0 ? (
            <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              Your suppression list is empty. Any unsubscribed or bounced contacts will appear here.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase' }}>
                  <th style={{ padding: '0.75rem 1.25rem' }}>Email</th>
                  <th style={{ padding: '0.75rem' }}>Reason</th>
                  <th style={{ padding: '0.75rem' }}>Notes</th>
                  <th style={{ padding: '0.75rem' }}>Added Date</th>
                  <th style={{ padding: '0.75rem 1.25rem', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {suppressions.map((s) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '0.75rem 1.25rem', fontWeight: 600 }}>{s.email}</td>
                    <td style={{ padding: '0.75rem' }}>
                      <span style={{ padding: '0.2rem 0.5rem', borderRadius: '8px', fontSize: '0.725rem', fontWeight: 600, textTransform: 'capitalize', backgroundColor: '#f1f5f9' }}>
                        {s.reason}
                      </span>
                    </td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{s.notes || '—'}</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {new Date(s.created_at).toLocaleDateString()}
                    </td>
                    <td style={{ padding: '0.75rem 1.25rem', textAlign: 'right' }}>
                      <button
                        onClick={async () => {
                          if (confirm(`Remove ${s.email} from suppression list?`)) {
                            await fetchApi(`/api/email-campaigns/suppressions/${encodeURIComponent(s.email)}`, { method: 'DELETE' });
                            loadSuppressions();
                          }
                        }}
                        style={{ color: '#ef4444', fontSize: '0.775rem', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 600 }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Confirmation Modal Before Send ── */}
      {showConfirmModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
          }}
        >
          <div style={{ backgroundColor: '#fff', borderRadius: '18px', maxWidth: '480px', width: '100%', padding: '2rem', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', backgroundColor: '#eff6ff', color: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
              <Send size={24} />
            </div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, textAlign: 'center', margin: '0 0 0.5rem', color: 'var(--text-main)' }}>
              Confirm Campaign Launch
            </h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center', lineHeight: 1.5, margin: '0 0 1.5rem' }}>
              You are about to send this campaign to <strong>{validationData?.valid_count.toLocaleString()} recipients</strong>.
              This action will queue emails for immediate delivery and cannot be undone.
            </p>

            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                style={{ padding: '0.65rem 1.25rem', borderRadius: '10px', border: '1px solid var(--border)', backgroundColor: '#fff', color: 'var(--text-main)', fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={sendingAction}
                onClick={handleSendCampaign}
                style={{
                  padding: '0.65rem 1.5rem',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
                  color: '#fff',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                {sendingAction ? 'Queueing Campaign...' : 'Confirm & Launch'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Manual Suppression Modal ── */}
      {showSuppressionModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '1rem',
          }}
        >
          <div style={{ backgroundColor: '#fff', borderRadius: '18px', maxWidth: '440px', width: '100%', padding: '1.75rem', boxShadow: 'var(--shadow-lg)' }}>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: '0 0 1rem', color: 'var(--text-main)' }}>Add Email to Suppression List</h3>
            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>Email Address</label>
              <input
                type="email"
                value={suppressionEmail}
                onChange={(e) => setSuppressionEmail(e.target.value)}
                placeholder="user@example.com"
                style={{ width: '100%', padding: '0.65rem', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.85rem' }}
              />
            </div>
            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: '0.35rem' }}>Reason</label>
              <select
                value={suppressionReason}
                onChange={(e) => setSuppressionReason(e.target.value)}
                style={{ width: '100%', padding: '0.65rem', borderRadius: '8px', border: '1px solid var(--border)', fontSize: '0.85rem' }}
              >
                <option value="unsubscribed">Unsubscribed</option>
                <option value="bounced">Bounced</option>
                <option value="complained">Complained</option>
                <option value="manual">Manual Suppression</option>
              </select>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowSuppressionModal(false)}
                style={{ padding: '0.5rem 1rem', borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: '#fff', fontSize: '0.825rem', fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!suppressionEmail.trim()) return;
                  await fetchApi('/api/email-campaigns/suppressions', {
                    method: 'POST',
                    body: JSON.stringify({ email: suppressionEmail, reason: suppressionReason }),
                  });
                  setSuppressionEmail('');
                  setShowSuppressionModal(false);
                  loadSuppressions();
                }}
                style={{
                  padding: '0.5rem 1.25rem',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)',
                  color: '#fff',
                  fontSize: '0.825rem',
                  fontWeight: 600,
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
