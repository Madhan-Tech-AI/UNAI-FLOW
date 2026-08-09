import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useEffect, useState } from 'react';
import { LogOut, Home, Link2, PlusCircle, History, Settings } from 'lucide-react';

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<any>(null);

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

  // If no session and on auth pages, just render outlet
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

  return (
    <div className="flex" style={{ minHeight: '100vh' }}>
      <aside style={{ width: '250px', backgroundColor: 'white', borderRight: '1px solid var(--border)', padding: '1.5rem', display: 'flex', flexDirection: 'column' }}>
        <div style={{ marginBottom: '2rem' }}>
          <h1 className="text-xl font-bold" style={{ color: 'var(--primary)' }}>UNAI Flow</h1>
        </div>
        <nav className="flex-col gap-2" style={{ flexGrow: 1 }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className="flex items-center gap-2"
                style={{
                  padding: '0.75rem 1rem',
                  borderRadius: '0.375rem',
                  color: isActive ? 'var(--primary)' : 'var(--text-secondary)',
                  backgroundColor: isActive ? 'var(--bg-secondary)' : 'transparent',
                  fontWeight: isActive ? 600 : 500,
                  textDecoration: 'none'
                }}
              >
                <Icon size={18} />
                {item.name}
              </Link>
            );
          })}
        </nav>
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '1rem' }}>
          <button onClick={handleLogout} className="flex items-center gap-2 text-secondary w-full" style={{ padding: '0.5rem', background: 'none', border: 'none', textAlign: 'left', fontWeight: 500 }}>
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </aside>
      <main className="flex-col" style={{ flexGrow: 1 }}>
        <header style={{ height: '64px', backgroundColor: 'white', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 2rem' }}>
          <div className="font-semibold">{navItems.find(i => i.path === location.pathname)?.name || 'UNAI Flow'}</div>
        </header>
        <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto', width: '100%' }}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
