import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useEffect, useState } from 'react';
import { LogOut, Home, Link2, PlusCircle, History, Settings, Sparkles, Search, Bell, ChevronDown } from 'lucide-react';

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (!session && location.pathname !== '/login' && location.pathname !== '/signup') {
        navigate('/login');
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session && location.pathname !== '/login' && location.pathname !== '/signup') {
        navigate('/login');
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, location]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  if (!session && (location.pathname === '/login' || location.pathname === '/signup')) {
    return <Outlet />;
  }

  const navItems = [
    { name: 'Dashboard', path: '/', icon: Home },
    { name: 'Connections', path: '/connections', icon: Link2 },
    { name: 'New Automation', path: '/automations/new', icon: PlusCircle },
    { name: 'History', path: '/history', icon: History },
    { name: 'Settings', path: '/settings', icon: Settings },
  ];

  const currentNav = navItems.find((i) => i.path === location.pathname) || { name: 'UNAI Flow' };
  const userEmail = session?.user?.email || '';
  const metaName = session?.user?.user_metadata?.full_name;
  const userName = metaName || (userEmail ? userEmail.split('@')[0] : 'User');

  return (
    <div className="flex" style={{ minHeight: '100vh', backgroundColor: 'var(--bg-main)' }}>
      {/* Sleek Dark Navy Left Sidebar */}
      <aside
        style={{
          width: '260px',
          backgroundColor: '#09101d',
          backgroundImage: 'radial-gradient(circle at top left, rgba(37, 99, 235, 0.15), transparent 70%)',
          borderRight: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '1.75rem 1.25rem',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          position: 'sticky',
          top: 0,
          height: '100vh',
          zIndex: 40
        }}
      >
        <div>
          {/* Logo & Brand Header */}
          <div className="flex items-center gap-3" style={{ marginBottom: '2.5rem', paddingLeft: '0.5rem' }}>
            <div
              className="flex items-center justify-center"
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #2563eb 0%, #8b5cf6 100%)',
                color: 'white',
                boxShadow: '0 6px 16px rgba(37, 99, 235, 0.4)'
              }}
            >
              <Sparkles size={22} />
            </div>
            <div>
              <h1 className="font-extrabold text-xl" style={{ color: '#ffffff', letterSpacing: '-0.03em', lineHeight: 1.2 }}>
                UNAI Flow
              </h1>
              <span className="text-xs font-semibold" style={{ color: '#64748b', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                AI MARKETING ENGINE
              </span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex-col gap-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className="flex items-center justify-between"
                  style={{
                    padding: '0.8rem 1rem',
                    borderRadius: '12px',
                    color: isActive ? '#ffffff' : '#94a3b8',
                    background: isActive ? 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)' : 'transparent',
                    fontWeight: isActive ? 600 : 500,
                    textDecoration: 'none',
                    boxShadow: isActive ? '0 6px 20px rgba(37, 99, 235, 0.35)' : 'none',
                    transition: 'all 0.2s ease',
                    marginBottom: '0.25rem'
                  }}
                >
                  <div className="flex items-center gap-3">
                    <Icon size={20} color={isActive ? '#ffffff' : '#94a3b8'} />
                    <span style={{ fontSize: '0.925rem' }}>{item.name}</span>
                  </div>
                  {isActive && (
                    <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#ffffff' }} />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Sidebar Footer User Box */}
        <div
          style={{
            backgroundColor: '#111c2e',
            borderRadius: '14px',
            padding: '1rem',
            border: '1px solid rgba(255, 255, 255, 0.08)'
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3" style={{ overflow: 'hidden' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  border: '2px solid rgba(255,255,255,0.2)'
                }}
              >
                {userName.charAt(0).toUpperCase()}
              </div>
              <div className="truncate">
                <p className="font-semibold text-sm truncate" style={{ color: '#ffffff' }}>
                  {userName}
                </p>
                <p className="text-xs text-muted truncate" style={{ color: '#64748b' }}>
                  {userEmail}
                </p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              title="Logout"
              style={{
                padding: '0.5rem',
                color: '#94a3b8',
                borderRadius: '8px',
                transition: 'background 0.2s',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
              onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-col flex-1" style={{ minWidth: 0 }}>
        {/* Modern Header Bar */}
        <header
          style={{
            height: '72px',
            backgroundColor: '#ffffff',
            borderBottom: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 2rem',
            position: 'sticky',
            top: 0,
            zIndex: 30,
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          {/* Breadcrumb & Title */}
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold" style={{ color: 'var(--text-main)' }}>
              {currentNav.name}
            </h2>
            <span className="chip chip-info" style={{ fontSize: '0.7rem' }}>
              v2.4 Live
            </span>
          </div>

          {/* Search Pill Input */}
          <div className="flex items-center" style={{ position: 'relative', width: '340px' }}>
            <Search size={18} style={{ position: 'absolute', left: '14px', color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Search automations, platforms..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input input-pill"
              style={{ fontSize: '0.85rem' }}
            />
            <span
              style={{
                position: 'absolute',
                right: '12px',
                fontSize: '0.7rem',
                backgroundColor: '#e2e8f0',
                color: '#64748b',
                padding: '2px 6px',
                borderRadius: '4px',
                fontWeight: 600
              }}
            >
              Ctrl K
            </span>
          </div>

          {/* Header Action Buttons & User Menu */}
          <div className="flex items-center gap-4">
            <Link to="/automations/new" className="btn-primary" style={{ padding: '0.55rem 1rem' }}>
              <PlusCircle size={17} />
              <span>Create Flow</span>
            </Link>

            <button
              style={{
                position: 'relative',
                padding: '0.6rem',
                borderRadius: '50%',
                backgroundColor: '#f1f5f9',
                color: '#475569'
              }}
              title="Notifications"
            >
              <Bell size={19} />
              <span
                style={{
                  position: 'absolute',
                  top: '4px',
                  right: '4px',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: '#2563eb',
                  border: '2px solid #ffffff'
                }}
              />
            </button>

            <div className="flex items-center gap-2" style={{ paddingLeft: '0.5rem', borderLeft: '1px solid var(--border)' }}>
              <div
                style={{
                  width: '36px',
                  height: '36px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'white',
                  fontWeight: 700,
                  fontSize: '0.85rem'
                }}
              >
                {userName.charAt(0).toUpperCase()}
              </div>
              <ChevronDown size={16} color="#64748b" />
            </div>
          </div>
        </header>

        {/* Page Content Outlet Container */}
        <div style={{ padding: '2rem 2.5rem', maxWidth: '1350px', margin: '0 auto', width: '100%' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
