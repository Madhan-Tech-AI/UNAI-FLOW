import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { Loader2, Search, Filter, Camera, AtSign, MessageCircle, CheckCircle2, Clock, Sparkles, RefreshCw, MoreVertical, ExternalLink, Inbox } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function AutomationHistory() {
  const [automations, setAutomations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchAutomations = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('automations')
        .select('*')
        .order('created_at', { ascending: false });

      // Also fetch publish logs to determine real status
      const { data: logData } = await supabase
        .from('automation_logs')
        .select('automation_id, event');

      if (!error && data) {
        // Build a set of automation IDs that have been published
        const publishedIds = new Set<string>();
        const demoPublishedIds = new Set<string>();
        
        (logData || []).forEach((log: any) => {
          if (log.event === 'published') publishedIds.add(log.automation_id);
          if (log.event === 'demo_published') demoPublishedIds.add(log.automation_id);
        });

        // Enrich automations with correct status
        const enrichedData = data.map((auto: any) => ({
          ...auto,
          status: publishedIds.has(auto.id)
            ? 'published'
            : demoPublishedIds.has(auto.id)
              ? 'demo_published'
              : (auto.status || 'draft')
        }));

        setAutomations(enrichedData);
      } else {
        setAutomations([]);
      }
    } catch (err) {
      console.error("History fetch error:", err);
      setAutomations([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAutomations();

    // Supabase Realtime subscription for instant live post updates
    const channel = supabase
      .channel('realtime_automation_history')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'automation_logs' }, () => {
        fetchAutomations();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_publish_jobs' }, () => {
        fetchAutomations();
      })
      .on('broadcast', { event: 'post_published' }, () => {
        fetchAutomations();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filteredAutomations = automations.filter(auto => {
    const matchesSearch = (auto.campaign_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (auto.raw_content || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPlatform = platformFilter === 'all' || auto.target_platforms?.includes(platformFilter);
    const matchesStatus = statusFilter === 'all' || 
      (statusFilter === 'published' ? (auto.status === 'published' || auto.status === 'demo_published') : auto.status === statusFilter);
    return matchesSearch && matchesPlatform && matchesStatus;
  });

  const publishedCount = automations.filter(a => a.status === 'published' || a.status === 'demo_published').length;
  const successRate = automations.length > 0 ? Math.round((publishedCount / automations.length) * 100) : 0;

  return (
    <div className="flex-col gap-8">
      {/* Top Banner Header */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-extrabold" style={{ color: 'var(--text-main)' }}>
            Automation History
          </h1>
          <p className="text-secondary mt-1 text-sm">
            Track past executions, publication logs, and platform distribution metrics.
          </p>
        </div>

        <button className="btn-secondary" onClick={fetchAutomations} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          <span>Refresh Logs</span>
        </button>
      </div>

      {/* KPI Performance Summary Strip */}
      <div className="flex gap-5 flex-wrap">
        <div className="card flex-1 flex items-center gap-4" style={{ minWidth: '220px' }}>
          <div style={{ backgroundColor: 'var(--primary-light)', padding: '0.75rem', borderRadius: '12px', color: 'var(--primary)' }}>
            <Sparkles size={24} />
          </div>
          <div>
            <p className="text-xs text-secondary font-semibold uppercase">Total Executed</p>
            <p className="text-2xl font-extrabold text-main mt-0.5">{automations.length}</p>
          </div>
        </div>

        <div className="card flex-1 flex items-center gap-4" style={{ minWidth: '220px' }}>
          <div style={{ backgroundColor: '#dcfce7', padding: '0.75rem', borderRadius: '12px', color: '#059669' }}>
            <CheckCircle2 size={24} />
          </div>
          <div>
            <p className="text-xs text-secondary font-semibold uppercase">Success Rate</p>
            <p className="text-2xl font-extrabold text-success mt-0.5">{automations.length > 0 ? `${successRate}%` : 'N/A'}</p>
          </div>
        </div>

        <div className="card flex-1 flex items-center gap-4" style={{ minWidth: '220px' }}>
          <div style={{ backgroundColor: '#eff6ff', padding: '0.75rem', borderRadius: '12px', color: '#2563eb' }}>
            <Clock size={24} />
          </div>
          <div>
            <p className="text-xs text-secondary font-semibold uppercase">Published Posts</p>
            <p className="text-2xl font-extrabold text-main mt-0.5">{publishedCount}</p>
          </div>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="card p-4 flex items-center justify-between flex-wrap gap-4">
        {/* Search Bar */}
        <div className="flex items-center flex-1" style={{ position: 'relative', minWidth: '240px' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', color: '#94a3b8' }} />
          <input
            type="text"
            placeholder="Filter history by keyword or campaign..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="input"
            style={{ paddingLeft: '2.5rem' }}
          />
        </div>

        {/* Platform Dropdown */}
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-secondary" />
          <select
            className="input"
            value={platformFilter}
            onChange={(e) => setPlatformFilter(e.target.value)}
            style={{ width: '150px' }}
          >
            <option value="all">All Channels</option>
            <option value="instagram">Instagram</option>
            <option value="twitter">Twitter / X</option>
            <option value="whatsapp">WhatsApp</option>
          </select>

          {/* Status Dropdown */}
          <select
            className="input"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            style={{ width: '140px' }}
          >
            <option value="all">All Statuses</option>
            <option value="published">Published</option>
            <option value="scheduled">Scheduled</option>
          </select>
        </div>
      </div>

      {/* Execution Logs List */}
      <div className="card flex-col gap-4">
        {loading ? (
          <div className="flex justify-center py-12 text-secondary">
            <Loader2 size={28} className="animate-spin text-primary" />
          </div>
        ) : filteredAutomations.length === 0 ? (
          <div className="text-center py-12 text-secondary flex-col items-center justify-center">
            <Inbox size={36} className="mx-auto text-muted mb-2" />
            <p className="font-semibold text-base text-main">No automation logs found</p>
            <p className="text-xs text-secondary mt-1 max-w-sm mx-auto">
              {searchQuery || platformFilter !== 'all' || statusFilter !== 'all' 
                ? 'Try resetting your filter parameters to see past logs.' 
                : 'Create your first automation flow to start generating social content.'}
            </p>
            <div className="mt-4">
              <Link to="/automations/new" className="btn-primary text-xs">
                + Create Automation Flow
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex-col gap-3">
            {filteredAutomations.map(auto => (
              <div
                key={auto.id}
                className="flex items-center justify-between p-4 flex-wrap gap-4"
                style={{
                  backgroundColor: '#f8fafc',
                  borderRadius: '14px',
                  border: '1px solid var(--border)',
                  transition: 'all 0.2s'
                }}
              >
                <div className="flex items-start gap-4 flex-1" style={{ minWidth: '280px' }}>
                  <div
                    style={{
                      width: '44px',
                      height: '44px',
                      borderRadius: '12px',
                      backgroundColor: 'var(--primary-light)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--primary)',
                      flexShrink: 0
                    }}
                  >
                    <Sparkles size={20} />
                  </div>
                  <div>
                    <h3 className="font-bold text-base text-main">{auto.campaign_name || 'Untitled Campaign'}</h3>
                    <p className="text-xs text-secondary truncate mt-1" style={{ maxWidth: '480px' }}>
                      {auto.raw_content}
                    </p>
                    <span className="text-xs text-muted mt-1 block">
                      Executed at: {new Date(auto.created_at).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {/* Platform Icons */}
                  <div className="flex items-center gap-1.5">
                    {auto.target_platforms?.includes('instagram') && (
                      <span title="Instagram" style={{ color: '#E1306C', backgroundColor: '#fee2e2', padding: '6px', borderRadius: '8px' }}>
                        <Camera size={16} />
                      </span>
                    )}
                    {auto.target_platforms?.includes('twitter') && (
                      <span title="Twitter / X" style={{ color: '#0f172a', backgroundColor: '#f1f5f9', padding: '6px', borderRadius: '8px' }}>
                        <AtSign size={16} />
                      </span>
                    )}
                    {auto.target_platforms?.includes('whatsapp') && (
                      <span title="WhatsApp" style={{ color: '#25D366', backgroundColor: '#dcfce7', padding: '6px', borderRadius: '8px' }}>
                        <MessageCircle size={16} />
                      </span>
                    )}
                  </div>

                  {/* Status Badge */}
                  <span className={`chip ${auto.status === 'published' ? 'chip-success' : auto.status === 'demo_published' ? 'chip-info' : 'chip-default'}`}>
                    {(auto.status === 'published' || auto.status === 'demo_published') ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                    <span className="capitalize">{auto.status === 'demo_published' ? 'Published' : (auto.status || 'Draft')}</span>
                  </span>

                  <button className="btn-ghost" title="View details">
                    <ExternalLink size={16} />
                  </button>
                  <button className="btn-ghost" title="More options">
                    <MoreVertical size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
