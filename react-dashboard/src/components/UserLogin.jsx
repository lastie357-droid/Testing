import React, { useState, useRef } from 'react';
import Captcha from './Captcha';

const COLORS = {
  bg: 'linear-gradient(135deg, #0a0a14 0%, #0f0f1e 50%, #0d1220 100%)',
  card: 'rgba(255,255,255,0.035)',
  cardBorder: 'rgba(99,102,241,0.2)',
  input: 'rgba(255,255,255,0.05)',
  inputBorder: 'rgba(99,102,241,0.25)',
  primary: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
  adminBg: 'rgba(15,23,42,0.6)',
  adminBorder: 'rgba(51,65,85,0.6)',
  text: '#e2e8f0',
  muted: '#64748b',
  accent: '#a5b4fc',
  err: '#f87171',
  errBg: 'rgba(239,68,68,0.08)',
  errBorder: 'rgba(239,68,68,0.25)',
  success: '#34d399',
  successBg: 'rgba(52,211,153,0.08)',
  successBorder: 'rgba(52,211,153,0.25)',
};

const disclaimerItems = [
  {
    icon: '⚖️',
    text: <>
      <strong style={{ color: '#fca5a5' }}>You are solely and entirely responsible</strong> for every action
      you take using this software. We accept no liability whatsoever for any consequences, legal or otherwise,
      arising from your use.
    </>,
  },
  {
    icon: '🔒',
    text: <>
      This software is permitted <strong style={{ color: '#fca5a5' }}>only on devices you own</strong> or
      have obtained explicit written authorisation to access. Any other use is strictly prohibited.
    </>,
  },
  {
    icon: '🚨',
    text: <>
      Unauthorized installation on devices you do not own or lack permission to access{' '}
      <strong style={{ color: '#fca5a5' }}>is a criminal offence</strong> in most jurisdictions. You will face
      all legal consequences alone. We will not intervene or provide assistance in any legal proceeding.
    </>,
  },
  {
    icon: '💥',
    text: <>
      Any damage, data loss, privacy violation, financial harm, or injury — to yourself, third parties,
      or any device — is{' '}
      <strong style={{ color: '#fca5a5' }}>entirely and irrevocably your responsibility</strong>.
    </>,
  },
  {
    icon: '📋',
    text: <>
      By creating an account you confirm you are of legal age in your jurisdiction, that you have the
      legal authority to use this software, and that you accept these terms{' '}
      <strong style={{ color: '#fca5a5' }}>without reservation</strong>.
    </>,
  },
];

export default function UserLogin({ onLogin, onSwitchToAdmin }) {
  const [tab, setTab]           = useState('signin');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [name, setName]         = useState('');
  const [confirm, setConfirm]   = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const [loading, setLoading]   = useState(false);

  const [captchaId,    setCaptchaId]    = useState('');
  const [captchaValue, setCaptchaValue] = useState('');
  const captchaRef = useRef(null);

  const switchTab = (t) => {
    setTab(t);
    setError('');
    setSuccess('');
    setEmail('');
    setPassword('');
    setName('');
    setConfirm('');
    setAccepted(false);
    setCaptchaValue('');
  };

  const handleSignIn = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res  = await fetch('/api/user-auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('user_token', data.token);
        localStorage.setItem('user_info', JSON.stringify(data.user));
        onLogin(data.user);
      } else {
        setError(data.error || 'Invalid credentials.');
      }
    } catch {
      setError('Unable to reach server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    if (password.length < 6)  { setError('Password must be at least 6 characters.'); return; }
    if (!accepted)            { setError('You must accept the Terms & Conditions to proceed.'); return; }
    setLoading(true);
    try {
      const res  = await fetch('/api/user-auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password, licenseAccepted: true, captchaId, captcha: captchaValue }),
      });
      const data = await res.json();
      if (data.success && data.token && data.user) {
        localStorage.setItem('user_token', data.token);
        localStorage.setItem('user_info', JSON.stringify(data.user));
        onLogin(data.user);
      } else {
        setError(data.error || 'Registration failed. Please try again.');
        if (data.captchaFailed) {
          setCaptchaValue('');
          captchaRef.current?.refresh();
        }
      }
    } catch {
      setError('Unable to reach server. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: COLORS.bg,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '24px 16px',
      fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif',
    }}>
      <div style={{ width: '100%', maxWidth: 440 }}>

        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 52, height: 52, borderRadius: 14,
            background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
            boxShadow: '0 8px 24px rgba(99,102,241,0.35)',
            marginBottom: 14, fontSize: 24,
          }}>🛡️</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.4px' }}>
            Remote Access Panel
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: COLORS.muted }}>
            Secure device management platform
          </p>
        </div>

        <div style={{
          background: COLORS.card,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: 18,
          padding: '28px 28px 24px',
          boxShadow: '0 24px 64px rgba(0,0,0,0.55)',
          backdropFilter: 'blur(12px)',
        }}>

          <div style={{
            display: 'flex', background: 'rgba(0,0,0,0.25)',
            borderRadius: 10, padding: 4, marginBottom: 24, gap: 4,
          }}>
            {[
              { id: 'signin',   label: 'Sign In' },
              { id: 'register', label: 'Create Account' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => switchTab(t.id)}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 8, border: 'none',
                  cursor: 'pointer', fontSize: 13, fontWeight: 600, transition: 'all 0.18s',
                  background: tab === t.id
                    ? 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'
                    : 'transparent',
                  color: tab === t.id ? '#fff' : COLORS.muted,
                  boxShadow: tab === t.id ? '0 4px 12px rgba(99,102,241,0.3)' : 'none',
                }}
              >{t.label}</button>
            ))}
          </div>

          {error && (
            <div style={{
              background: COLORS.errBg, border: `1px solid ${COLORS.errBorder}`,
              borderRadius: 8, padding: '10px 12px', color: COLORS.err,
              fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>⚠️</span> {error}
            </div>
          )}
          {success && (
            <div style={{
              background: COLORS.successBg, border: `1px solid ${COLORS.successBorder}`,
              borderRadius: 8, padding: '10px 12px', color: COLORS.success,
              fontSize: 13, marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <span>✓</span> {success}
            </div>
          )}

          {tab === 'signin' && (
            <form onSubmit={handleSignIn}>
              <Field label="Email Address">
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" required disabled={loading} autoComplete="email" />
              </Field>
              <Field label="Password">
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Your password" required disabled={loading} autoComplete="current-password" />
              </Field>
              <Btn loading={loading}>Sign In</Btn>
            </form>
          )}

          {tab === 'register' && (
            <form onSubmit={handleRegister}>

              {/* ── Legal Disclaimer ─────────────────────────────────── */}
              <div style={{
                background: 'rgba(239,68,68,0.06)',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 10,
                padding: '14px 14px 10px',
                marginBottom: 20,
              }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
                  paddingBottom: 10, borderBottom: '1px solid rgba(239,68,68,0.18)',
                }}>
                  <span style={{ fontSize: 18 }}>⚠️</span>
                  <div>
                    <div style={{ color: '#f87171', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                      Legal Warning — Read Before Proceeding
                    </div>
                    <div style={{ color: '#ef4444', fontSize: 11, marginTop: 2 }}>
                      This is a binding legal notice. Creating an account constitutes full acceptance.
                    </div>
                  </div>
                </div>

                {disclaimerItems.map((item, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: i < disclaimerItems.length - 1 ? 9 : 0,
                  }}>
                    <span style={{ fontSize: 13, flexShrink: 0, marginTop: 1, lineHeight: 1.3 }}>{item.icon}</span>
                    <span style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.55 }}>{item.text}</span>
                  </div>
                ))}
              </div>

              <Field label="Full Name">
                <Input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Your full name" required disabled={loading} />
              </Field>
              <Field label="Email Address">
                <Input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" required disabled={loading} />
              </Field>
              <Field label="Password">
                <Input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="At least 6 characters" required disabled={loading} />
              </Field>
              <Field label="Confirm Password">
                <Input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat password" required disabled={loading} />
              </Field>

              <Captcha
                ref={captchaRef}
                label="Security Check"
                value={captchaValue}
                onChange={setCaptchaValue}
                onIdChange={setCaptchaId}
                disabled={loading}
              />

              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                marginBottom: 20, cursor: 'pointer',
              }}>
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={() => setAccepted(a => !a)}
                  style={{ marginTop: 3, accentColor: '#6366f1', cursor: 'pointer', flexShrink: 0 }}
                />
                <span style={{ color: '#94a3b8', fontSize: 12, lineHeight: 1.55 }}>
                  I have read the legal warning above and accept full, sole responsibility for my use of
                  this software. I confirm I am legally authorised to use it on the intended device(s).
                </span>
              </label>

              <Btn loading={loading}>Create Account &amp; Start Free Trial</Btn>
            </form>
          )}
        </div>

        <div style={{
          marginTop: 16,
          background: COLORS.adminBg,
          border: `1px solid ${COLORS.adminBorder}`,
          borderRadius: 12, padding: '16px 20px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#94a3b8', marginBottom: 2 }}>
              Administrator Access
            </div>
            <div style={{ fontSize: 12, color: COLORS.muted }}>
              Full control panel for device management
            </div>
          </div>
          <button
            onClick={onSwitchToAdmin}
            style={{
              background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.35)',
              borderRadius: 8, color: COLORS.accent, fontSize: 13, fontWeight: 600,
              padding: '8px 16px', cursor: 'pointer', whiteSpace: 'nowrap',
              transition: 'all 0.15s', flexShrink: 0,
            }}
            onMouseOver={e => {
              e.currentTarget.style.background = 'rgba(99,102,241,0.22)';
              e.currentTarget.style.borderColor = 'rgba(99,102,241,0.55)';
            }}
            onMouseOut={e => {
              e.currentTarget.style.background = 'rgba(99,102,241,0.12)';
              e.currentTarget.style.borderColor = 'rgba(99,102,241,0.35)';
            }}
          >
            Admin Login →
          </button>
        </div>

        <p style={{ textAlign: 'center', fontSize: 11, color: '#334155', marginTop: 20 }}>
          Protected by end-to-end encryption · For authorized use only
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{
        display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 600,
        marginBottom: 6, letterSpacing: '0.6px', textTransform: 'uppercase',
      }}>{label}</label>
      {children}
    </div>
  );
}

function Input(props) {
  return (
    <input
      {...props}
      style={{
        width: '100%', background: 'rgba(255,255,255,0.05)',
        border: '1px solid rgba(99,102,241,0.25)', borderRadius: 8,
        padding: '10px 12px', color: '#e2e8f0', fontSize: 14, outline: 'none',
        boxSizing: 'border-box', transition: 'border-color 0.2s',
        ...props.style,
      }}
      onFocus={e => { e.target.style.borderColor = 'rgba(99,102,241,0.7)'; }}
      onBlur={e => { e.target.style.borderColor = 'rgba(99,102,241,0.25)'; }}
    />
  );
}

function Btn({ loading, children }) {
  return (
    <button
      type="submit"
      disabled={loading}
      style={{
        width: '100%',
        background: loading ? 'rgba(99,102,241,0.4)' : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
        border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600,
        padding: '12px 0', cursor: loading ? 'not-allowed' : 'pointer',
        transition: 'opacity 0.2s', marginBottom: 4,
        boxShadow: loading ? 'none' : '0 4px 16px rgba(99,102,241,0.35)',
        letterSpacing: '0.2px',
      }}
    >
      {loading ? '⏳ Please wait…' : children}
    </button>
  );
}
