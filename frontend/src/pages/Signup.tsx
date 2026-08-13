import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { Sparkles, Mail, Lock, User, Loader2, ArrowRight } from 'lucide-react';

export default function Signup() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName,
        }
      }
    });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      navigate('/');
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#09101d',
        backgroundImage: 'radial-gradient(circle at top, rgba(37, 99, 235, 0.25) 0%, transparent 65%)',
        padding: '1.5rem'
      }}
    >
      <div
        className="card"
        style={{
          width: '100%',
          maxWidth: '420px',
          borderRadius: '24px',
          padding: '2.5rem 2rem',
          boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
          border: '1px solid rgba(255,255,255,0.1)',
          backgroundColor: '#ffffff'
        }}
      >
        <div className="flex-col items-center text-center mb-8">
          <div
            className="flex items-center justify-center mb-3"
            style={{
              width: '48px',
              height: '48px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #2563eb 0%, #8b5cf6 100%)',
              color: 'white',
              boxShadow: '0 8px 20px rgba(37, 99, 235, 0.4)'
            }}
          >
            <Sparkles size={26} />
          </div>
          <h1 className="text-2xl font-extrabold text-main">Get started free</h1>
          <p className="text-secondary text-xs mt-1">Create your UNAI Flow automation account</p>
        </div>

        {error && (
          <div
            className="mb-4 text-xs font-medium"
            style={{
              padding: '0.85rem',
              backgroundColor: '#fee2e2',
              color: '#991b1b',
              borderRadius: '10px',
              border: '1px solid #fecaca'
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSignup} className="flex-col gap-4">
          <div>
            <label className="label" htmlFor="fullName">Full Name</label>
            <div style={{ position: 'relative' }}>
              <User size={18} style={{ position: 'absolute', left: '12px', top: '12px', color: '#94a3b8' }} />
              <input
                id="fullName"
                type="text"
                className="input"
                placeholder="Alex Rivera"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                style={{ paddingLeft: '2.4rem' }}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="email">Email address</label>
            <div style={{ position: 'relative' }}>
              <Mail size={18} style={{ position: 'absolute', left: '12px', top: '12px', color: '#94a3b8' }} />
              <input
                id="email"
                type="email"
                className="input"
                placeholder="name@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ paddingLeft: '2.4rem' }}
              />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="password">Password</label>
            <div style={{ position: 'relative' }}>
              <Lock size={18} style={{ position: 'absolute', left: '12px', top: '12px', color: '#94a3b8' }} />
              <input
                id="password"
                type="password"
                className="input"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                style={{ paddingLeft: '2.4rem' }}
              />
            </div>
          </div>

          <button
            type="submit"
            className="btn-primary w-full mt-3"
            style={{ padding: '0.8rem', fontSize: '0.95rem', borderRadius: '12px' }}
            disabled={loading}
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <span>Create Account</span>}
            {!loading && <ArrowRight size={16} />}
          </button>
        </form>

        <div className="mt-8 text-center text-xs text-secondary pt-4" style={{ borderTop: '1px solid var(--border)' }}>
          Already have an account?{' '}
          <Link to="/login" className="font-bold text-primary">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
