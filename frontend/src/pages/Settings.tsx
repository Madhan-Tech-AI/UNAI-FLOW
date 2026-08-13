import { useState, useEffect } from 'react';
import { User, Building, Bell, Save, CheckCircle2, Cpu, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';

export default function Settings() {
  const [activeTab, setActiveTab] = useState('profile');
  const [saved, setSaved] = useState(false);
  const [fullName, setFullName] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');
  const [defaultTone, setDefaultTone] = useState('professional');
  const [aiModel, setAiModel] = useState('gemini-1.5-flash');

  useEffect(() => {
    async function loadUserData() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const metaName = session.user.user_metadata?.full_name || '';
        const userEmail = session.user.email || '';
        setFullName(metaName || (userEmail ? userEmail.split('@')[0] : ''));

        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (profile) {
          if (profile.full_name) setFullName(profile.full_name);
          if (profile.company) setCompany(profile.company);
          if (profile.role) setRole(profile.role);
        }
      }
    }

    loadUserData();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        await supabase
          .from('profiles')
          .upsert({
            id: session.user.id,
            full_name: fullName,
            company,
            role
          });
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error("Failed to save settings:", err);
    }
  };

  const tabs = [
    { id: 'profile', label: 'Profile & Account', icon: User },
    { id: 'workspace', label: 'Workspace & Brand', icon: Building },
    { id: 'ai-engine', label: 'AI Engine & Model', icon: Cpu },
    { id: 'notifications', label: 'Notifications', icon: Bell }
  ];

  return (
    <div className="flex-col gap-8">
      {/* Top Banner Header */}
      <div className="flex justify-between items-center flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-extrabold" style={{ color: 'var(--text-main)' }}>
            Settings & Preferences
          </h1>
          <p className="text-secondary mt-1 text-sm">
            Manage profile account credentials, brand default settings, and AI engine preferences.
          </p>
        </div>

        {saved && (
          <div className="chip chip-success flex items-center gap-2 p-2 px-4" style={{ fontSize: '0.85rem' }}>
            <CheckCircle2 size={16} /> Changes saved successfully!
          </div>
        )}
      </div>

      {/* Settings Navigation Tabs */}
      <div className="flex gap-2 flex-wrap pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className="flex items-center gap-2 px-4 py-2.5"
              style={{
                borderRadius: '12px',
                fontWeight: isActive ? 700 : 500,
                color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                backgroundColor: isActive ? 'var(--primary-light)' : 'transparent',
                border: isActive ? '1px solid #bfdbfe' : '1px solid transparent',
                fontSize: '0.9rem',
                transition: 'all 0.2s'
              }}
            >
              <Icon size={18} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Main Settings Card Panel */}
      <div className="card max-w-xl">
        <form onSubmit={handleSave} className="flex-col gap-6">
          {activeTab === 'profile' && (
            <>
              <h3 className="font-bold text-lg text-main pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
                Personal Profile
              </h3>

              {/* Avatar Preview */}
              <div className="flex items-center gap-4">
                <div
                  style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontWeight: 800,
                    fontSize: '1.5rem',
                    boxShadow: 'var(--shadow-md)'
                  }}
                >
                  {fullName ? fullName.charAt(0).toUpperCase() : 'U'}
                </div>
                <div>
                  <button type="button" className="btn-secondary text-xs" style={{ padding: '0.4rem 0.85rem' }}>
                    Change Avatar
                  </button>
                  <p className="text-xs text-muted mt-1">JPG, PNG or GIF. Max 2MB.</p>
                </div>
              </div>

              <div>
                <label className="label">Full Name</label>
                <input
                  className="input"
                  type="text"
                  placeholder="Enter your full name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>

              <div>
                <label className="label">Company Name</label>
                <input
                  className="input"
                  type="text"
                  placeholder="Enter company name"
                  value={company}
                  onChange={(e) => setCompany(e.target.value)}
                />
              </div>

              <div>
                <label className="label">Role / Job Title</label>
                <input
                  className="input"
                  type="text"
                  placeholder="e.g. Marketing Manager"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                />
              </div>
            </>
          )}

          {activeTab === 'workspace' && (
            <>
              <h3 className="font-bold text-lg text-main pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
                Workspace & Branding Defaults
              </h3>

              <div>
                <label className="label">Default Brand Tone</label>
                <select
                  className="input"
                  value={defaultTone}
                  onChange={(e) => setDefaultTone(e.target.value)}
                >
                  <option value="professional">Professional (Authoritative, B2B)</option>
                  <option value="casual">Casual (Friendly, Conversational)</option>
                  <option value="promotional">Promotional (High energy, CTA)</option>
                  <option value="storytelling">Storytelling (Narrative driven)</option>
                </select>
              </div>

              <div>
                <label className="label">Default Target Channels</label>
                <div className="flex-col gap-2 text-xs text-main">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" defaultChecked /> Instagram Business
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" defaultChecked /> Twitter / X Enterprise
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" defaultChecked /> WhatsApp Cloud API
                  </label>
                </div>
              </div>
            </>
          )}

          {activeTab === 'ai-engine' && (
            <>
              <h3 className="font-bold text-lg text-main pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
                AI Generation Model Settings
              </h3>

              <div>
                <label className="label">Primary AI Engine</label>
                <select
                  className="input"
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                >
                  <option value="gemini-1.5-flash">Gemini 1.5 Flash (Supercharged & Ultra-fast)</option>
                  <option value="gemini-1.5-pro">Gemini 1.5 Pro (Deep Reasoning & Long Context)</option>
                </select>
              </div>

              <div className="p-4" style={{ backgroundColor: '#f8fafc', borderRadius: '12px', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2 text-xs font-bold text-main">
                  <Sparkles size={16} className="text-primary" /> Gemini AI Auto-Formatting
                </div>
                <p className="text-xs text-secondary mt-1">
                  Automatically adds channel hashtags, converts Markdown formatting to WhatsApp bolding, and optimizes line breaks.
                </p>
              </div>
            </>
          )}

          {activeTab === 'notifications' && (
            <>
              <h3 className="font-bold text-lg text-main pb-3" style={{ borderBottom: '1px solid var(--border)' }}>
                Notification Preferences
              </h3>

              <div className="flex-col gap-3 text-xs text-main">
                <label className="flex items-center justify-between p-3" style={{ backgroundColor: '#f8fafc', borderRadius: '10px' }}>
                  <span>Email summary on campaign publish</span>
                  <input type="checkbox" defaultChecked style={{ width: '1.1rem', height: '1.1rem' }} />
                </label>
                <label className="flex items-center justify-between p-3" style={{ backgroundColor: '#f8fafc', borderRadius: '10px' }}>
                  <span>Alert on channel disconnection or token expiry</span>
                  <input type="checkbox" defaultChecked style={{ width: '1.1rem', height: '1.1rem' }} />
                </label>
              </div>
            </>
          )}

          <div className="pt-4 mt-2" style={{ borderTop: '1px solid var(--border)' }}>
            <button type="submit" className="btn-primary" style={{ padding: '0.7rem 1.5rem', borderRadius: '12px' }}>
              <Save size={18} />
              <span>Save Changes</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
