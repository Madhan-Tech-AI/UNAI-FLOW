import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Camera, 
  CheckCircle2, 
  ChevronRight, 
  Clock, 
  Plus, 
  Sparkles, 
  TrendingUp, 
  AtSign, 
  ArrowUpRight,
  BarChart3,
  Layers,
  MoreVertical,
  Calendar as CalendarIcon
} from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export default function Dashboard() {
  const [selectedDate, setSelectedDate] = useState('14');
  const [automations, setAutomations] = useState<any[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [userProfileName, setUserProfileName] = useState('User');

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const emailName = session.user.email?.split('@')[0];
          const metaName = session.user.user_metadata?.full_name;
          setUserProfileName(metaName || (emailName ? emailName.charAt(0).toUpperCase() + emailName.slice(1) : 'User'));
        }

        const { data: autoData } = await supabase
          .from('automations')
          .select('*')
          .order('created_at', { ascending: false });

        if (autoData) {
          setAutomations(autoData);
        }

        const { data: connData } = await supabase
          .from('platform_connections')
          .select('*');

        if (connData) {
          setConnections(connData.filter(c => c.status === 'active'));
        }
      } catch (err) {
        console.error("Dashboard fetch error:", err);
      }
    }

    loadDashboardData();
  }, []);

  const dateItems = [
    { day: 'Mon', date: '12' },
    { day: 'Tue', date: '13' },
    { day: 'Wed', date: '14' },
    { day: 'Thu', date: '15' },
    { day: 'Fri', date: '16' },
    { day: 'Sat', date: '17' },
    { day: 'Sun', date: '18' },
  ];

  const publishedCount = automations.filter(a => a.status === 'published').length;
  const scheduledAutomations = automations.filter(a => a.status === 'scheduled');
  const hasInstagram = connections.some(c => c.platform === 'instagram');
  const hasTwitter = connections.some(c => c.platform === 'twitter');
  return (
    <div className="flex-col gap-8">
      {/* Welcome Banner */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-extrabold flex items-center gap-3" style={{ color: 'var(--text-main)' }}>
            Welcome back, {userProfileName} 👋
          </h1>
          <p className="text-secondary mt-1 text-sm">
            Your multi-channel AI marketing engine • <span className="text-success font-medium">{connections.length} connected platform{connections.length === 1 ? '' : 's'} operating</span>
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link to="/automations/new" className="btn-primary">
            <Plus size={16} />
            <span>Create Automation</span>
          </Link>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="flex gap-5 flex-wrap">
        {/* Card 1: Solid Vibrant Blue Gradient Accent Card */}
        <div className="card-solid flex-1" style={{ minWidth: '240px' }}>
          <div className="flex justify-between items-start mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ opacity: 0.9 }}>
              Total Automations
            </span>
            <div style={{ backgroundColor: 'rgba(255,255,255,0.2)', padding: '0.35rem', borderRadius: '8px' }}>
              <ChevronRight size={16} />
            </div>
          </div>
          <div className="flex items-baseline gap-3">
            <p className="text-3xl font-bold">{automations.length}</p>
            <span className="text-xs font-medium" style={{ opacity: 0.85 }}>total created</span>
          </div>
          <div className="mt-4">
            <div className="flex justify-between text-xs mb-1" style={{ opacity: 0.85 }}>
              <span>Monthly Target (30)</span>
              <span>{Math.min(100, Math.round((automations.length / 30) * 100))}%</span>
            </div>
            <div style={{ height: '6px', backgroundColor: 'rgba(255,255,255,0.25)', borderRadius: '999px', overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, Math.round((automations.length / 30) * 100))}%`, height: '100%', backgroundColor: '#ffffff', borderRadius: '999px' }} />
            </div>
          </div>
        </div>

        {/* Card 2: Connected Platforms */}
        <div className="card flex-1" style={{ minWidth: '240px' }}>
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
              Connected Platforms
            </span>
            <div style={{ backgroundColor: '#f1f5f9', padding: '0.35rem', borderRadius: '8px', color: '#475569' }}>
              <ArrowUpRight size={16} />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-main mt-1">{connections.length} <span className="text-xs font-normal text-secondary">Active</span></p>
          <div className="flex items-center gap-2 mt-4">
            <div className="flex items-center gap-1">
              <span style={{ backgroundColor: hasInstagram ? '#fee2e2' : '#f1f5f9', padding: '4px', borderRadius: '6px', color: hasInstagram ? '#E1306C' : '#94a3b8' }}>
                <Camera size={14} />
              </span>
              <span style={{ backgroundColor: hasTwitter ? '#e2e8f0' : '#f1f5f9', padding: '4px', borderRadius: '6px', color: hasTwitter ? '#0f172a' : '#94a3b8' }}>
                <AtSign size={14} />
              </span>
            </div>
            <span className="text-xs text-success font-medium flex items-center gap-1 ml-auto">
              <TrendingUp size={12} /> Sync Active
            </span>
          </div>
        </div>

        {/* Card 3: Posts Published */}
        <div className="card flex-1" style={{ minWidth: '240px' }}>
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
              Posts Published
            </span>
            <div style={{ backgroundColor: '#f1f5f9', padding: '0.35rem', borderRadius: '8px', color: '#475569' }}>
              <ArrowUpRight size={16} />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-main mt-1">{publishedCount} <span className="text-xs font-normal text-secondary">total</span></p>
          <div className="mt-4 flex items-center justify-between text-xs text-secondary">
            <span>Status: Operational</span>
            <span className="chip chip-success" style={{ fontSize: '0.65rem' }}>Live</span>
          </div>
        </div>

        {/* Card 4: AI Model Performance */}
        <div className="card flex-1" style={{ minWidth: '240px' }}>
          <div className="flex justify-between items-start mb-2">
            <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
              AI Generation Engine
            </span>
            <div style={{ backgroundColor: '#f1f5f9', padding: '0.35rem', borderRadius: '8px', color: '#475569' }}>
              <ChevronRight size={16} />
            </div>
          </div>
          <p className="text-3xl font-extrabold text-primary mt-1">Gemini AI</p>
          <div className="mt-4 text-xs text-secondary flex items-center justify-between">
            <span>Multi-platform formatter</span>
            <span className="text-primary font-semibold">1.5 Flash</span>
          </div>
        </div>
      </div>

      {/* Main Visual Charts Section */}
      <div className="flex gap-6 flex-wrap">
        {/* Left Wave Chart Container */}
        <div className="card flex-col gap-4" style={{ flex: '2', minWidth: '340px' }}>
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-bold text-lg" style={{ color: 'var(--text-main)' }}>
                Automation Performance & Activity
              </h3>
              <p className="text-xs text-secondary">Campaign execution history</p>
            </div>
          </div>

          {automations.length === 0 ? (
            <div className="flex-col items-center justify-center py-12 text-center" style={{ backgroundColor: '#f8fafc', borderRadius: '14px', border: '1px dashed var(--border)' }}>
              <BarChart3 size={36} className="text-muted mb-2" />
              <p className="font-semibold text-sm text-main">No automation activity recorded yet</p>
              <p className="text-xs text-secondary mt-1 max-w-sm">
                Create your first campaign automation flow to track platform performance and reach.
              </p>
              <Link to="/automations/new" className="btn-secondary text-xs mt-4">
                + Create First Automation
              </Link>
            </div>
          ) : (
            <div style={{ width: '100%', height: '230px', position: 'relative', marginTop: '1rem' }}>
              <svg viewBox="0 0 500 200" className="w-full h-full" style={{ overflow: 'visible' }}>
                <defs>
                  <linearGradient id="waveGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2563eb" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#2563eb" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                <line x1="0" y1="40" x2="500" y2="40" stroke="#f1f5f9" strokeDasharray="4 4" />
                <line x1="0" y1="90" x2="500" y2="90" stroke="#f1f5f9" strokeDasharray="4 4" />
                <line x1="0" y1="140" x2="500" y2="140" stroke="#f1f5f9" strokeDasharray="4 4" />

                <path
                  d="M 0 150 C 40 120, 80 140, 120 100 C 160 60, 200 130, 240 70 C 280 10, 320 80, 360 40 C 400 90, 440 120, 500 110 L 500 190 L 0 190 Z"
                  fill="url(#waveGradient)"
                />

                <path
                  d="M 0 150 C 40 120, 80 140, 120 100 C 160 60, 200 130, 240 70 C 280 10, 320 80, 360 40 C 400 90, 440 120, 500 110"
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                />

                <circle cx="120" cy="100" r="4" fill="#2563eb" stroke="#ffffff" strokeWidth="2" />
                <circle cx="240" cy="70" r="4" fill="#2563eb" stroke="#ffffff" strokeWidth="2" />
              </svg>
            </div>
          )}
        </div>

        {/* Right Distribution Container */}
        <div className="card flex-col gap-4 flex-1" style={{ minWidth: '280px' }}>
          <div>
            <h3 className="font-bold text-lg" style={{ color: 'var(--text-main)' }}>
              Platform Distribution
            </h3>
            <p className="text-xs text-secondary">Active channels configured</p>
          </div>

          <div className="flex items-center justify-center py-6" style={{ position: 'relative' }}>
            <div style={{ textAlign: 'center' }}>
              <span className="text-3xl font-extrabold text-main">{connections.length}</span>
              <p className="text-xs text-secondary font-medium mt-1">Active Connected Channels</p>
            </div>
          </div>

          {/* Legend Pills */}
          <div className="flex-col gap-2 mt-2">
            <div className="flex items-center justify-between text-xs p-2 rounded-lg" style={{ backgroundColor: '#f8fafc' }}>
              <div className="flex items-center gap-2">
                <Camera size={16} style={{ color: '#E1306C' }} />
                <span className="font-semibold text-main">Instagram</span>
              </div>
              <span className="font-bold text-secondary">{hasInstagram ? 'Connected' : 'Not Connected'}</span>
            </div>
            <div className="flex items-center justify-between text-xs p-2 rounded-lg" style={{ backgroundColor: '#f8fafc' }}>
              <div className="flex items-center gap-2">
                <AtSign size={16} style={{ color: '#0f172a' }} />
                <span className="font-semibold text-main">Twitter / X</span>
              </div>
              <span className="font-bold text-secondary">{hasTwitter ? 'Connected' : 'Not Connected'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section: Recent Automations Table & Upcoming Schedule */}
      <div className="flex gap-6 flex-wrap">
        {/* Recent Automations List */}
        <div className="card flex-col gap-4" style={{ flex: '2', minWidth: '340px' }}>
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-bold text-lg" style={{ color: 'var(--text-main)' }}>
                Recent Automations
              </h3>
              <p className="text-xs text-secondary">Latest AI generated campaign workflows</p>
            </div>
            {automations.length > 0 && (
              <Link to="/history" className="btn-ghost text-xs text-primary font-semibold flex items-center gap-1">
                View All History <ChevronRight size={14} />
              </Link>
            )}
          </div>

          {automations.length === 0 ? (
            <div className="text-center py-10 text-secondary" style={{ backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid var(--border)' }}>
              <Layers size={32} className="mx-auto text-muted mb-2" />
              <p className="font-semibold text-sm text-main">No recent automations</p>
              <p className="text-xs text-secondary mt-1">Start by creating your first automation workflow.</p>
              <Link to="/automations/new" className="btn-primary text-xs mt-4">
                <Plus size={14} /> Create Automation
              </Link>
            </div>
          ) : (
            <div className="flex-col gap-3 mt-2">
              {automations.slice(0, 5).map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-4"
                  style={{
                    backgroundColor: '#f8fafc',
                    borderRadius: '12px',
                    border: '1px solid var(--border)',
                    transition: 'background 0.2s'
                  }}
                >
                  <div className="flex items-center gap-4 flex-1 truncate pr-4">
                    <div
                      style={{
                        width: '42px',
                        height: '42px',
                        borderRadius: '10px',
                        backgroundColor: 'var(--primary-light)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--primary)'
                      }}
                    >
                      <Sparkles size={20} />
                    </div>
                    <div className="truncate flex-1">
                      <h4 className="font-bold text-sm truncate" style={{ color: 'var(--text-main)' }}>
                        {item.campaign_name || 'Untitled Automation'}
                      </h4>
                      <p className="text-xs text-secondary truncate mt-1">
                        {item.raw_content}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1">
                      {item.target_platforms?.includes('instagram') && (
                        <span title="Instagram" style={{ color: '#E1306C', backgroundColor: '#fee2e2', padding: '4px', borderRadius: '6px' }}>
                          <Camera size={14} />
                        </span>
                      )}
                      {item.target_platforms?.includes('twitter') && (
                        <span title="Twitter / X" style={{ color: '#0f172a', backgroundColor: '#f1f5f9', padding: '4px', borderRadius: '6px' }}>
                          <AtSign size={14} />
                        </span>
                      )}
                    </div>

                    <span className={`chip ${item.status === 'published' ? 'chip-success' : 'chip-info'}`}>
                      {item.status === 'published' ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                      <span className="capitalize">{item.status || 'Draft'}</span>
                    </span>

                    <button className="btn-ghost" style={{ padding: '0.25rem' }}>
                      <MoreVertical size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Upcoming Schedule Strip */}
        <div className="card flex-col gap-4 flex-1" style={{ minWidth: '300px' }}>
          <div className="flex justify-between items-center">
            <div>
              <h3 className="font-bold text-lg flex items-center gap-2" style={{ color: 'var(--text-main)' }}>
                <CalendarIcon size={18} className="text-primary" /> Upcoming Schedule
              </h3>
              <p className="text-xs text-secondary">Scheduled campaign releases</p>
            </div>
            <Link to="/automations/new" className="text-xs font-bold text-primary flex items-center gap-1">
              + Create
            </Link>
          </div>

          <div className="flex justify-between gap-1 py-1">
            {dateItems.map((item) => (
              <div
                key={item.date}
                className={`date-pill ${selectedDate === item.date ? 'active' : ''}`}
                onClick={() => setSelectedDate(item.date)}
              >
                <span className="text-xs font-medium" style={{ opacity: 0.8 }}>{item.day}</span>
                <span className="text-sm font-bold mt-1">{item.date}</span>
              </div>
            ))}
          </div>

          {scheduledAutomations.length === 0 ? (
            <div className="text-center py-8 text-secondary" style={{ backgroundColor: '#f8fafc', borderRadius: '10px' }}>
              <Clock size={24} className="mx-auto text-muted mb-1" />
              <p className="text-xs font-semibold text-main">No scheduled posts for this date</p>
            </div>
          ) : (
            <div className="flex-col gap-3 mt-2">
              {scheduledAutomations.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3"
                  style={{ backgroundColor: '#eff6ff', borderRadius: '10px', borderLeft: '4px solid #2563eb' }}
                >
                  <div className="flex items-center gap-3">
                    <Sparkles size={16} className="text-primary" />
                    <div>
                      <p className="font-semibold text-xs text-main">{item.campaign_name || 'Scheduled Campaign'}</p>
                      <p className="text-xs text-secondary">{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                  </div>
                  <ChevronRight size={16} className="text-secondary" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
