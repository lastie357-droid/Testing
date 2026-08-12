import React, { useState, useEffect, useCallback } from 'react';
import { formatDateTime } from '../utils/dateTime.js';

const token = () => localStorage.getItem('admin_token') || localStorage.getItem('user_token');
const hdrs   = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` });

function fmtDate(d) {
  if (!d) return '—';
  return formatDateTime(d);
}

function SubBadge({ sub, isActive }) {
  if (!isActive) return <span style={pill('#ef4444','rgba(239,68,68,0.12)')}>🚫 Disabled</span>;
  if (!sub) return null;
  const map = {
    paid:    [pill('#22c55e','rgba(34,197,94,0.12)'),  '✅ Paid'],
    trial:   [pill('#f59e0b','rgba(245,158,11,0.12)'), '⏳ Trial'],
    expired: [pill('#ef4444','rgba(239,68,68,0.12)'),  '🔒 Expired'],
  };
  const entry = map[sub.state] || map.expired;
  return <span style={entry[0]}>{entry[1]}{sub.daysLeft != null ? ` · ${sub.daysLeft}d` : ''}</span>;
}

function pill(color, bg) {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 9px', borderRadius: 99, fontSize: 11, fontWeight: 600,
    color, background: bg, border: `1px solid ${color}40`,
  };
}

const CARD = { background: '#16213e', border: '1px solid #2d2d4e', borderRadius: 12, overflow: 'hidden' };
const INPUT = {
  background: '#0f172a', border: '1px solid #334155', borderRadius: 7,
  padding: '7px 11px', color: '#f0f0ff', fontSize: 12, outline: 'none', width: '100%', boxSizing: 'border-box',
};
const BTN = (bg, disabled) => ({
  background: disabled ? '#1e293b' : bg, border: 'none', borderRadius: 7,
  color: disabled ? '#475569' : '#fff', padding: '7px 14px', fontSize: 12, fontWeight: 600,
  cursor: disabled ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', transition: 'opacity .15s',
});

export default function AdminUsersTab() {
  const [users,     setUsers]     = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [search,    setSearch]    = useState('');
  const [expanded,  setExpanded]  = useState(null);
  const [toast,     setToast]     = useState(null);
  const [busy,      setBusy]      = useState({});
  const [grantVals, setGrantVals] = useState({});

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/admin/users', { headers: hdrs() });
      const d = await r.json();
      if (d.success) setUsers(d.users || []);
      else showToast(d.error || 'Failed to load users', 'error');
    } catch (e) { showToast('Network error: ' + e.message, 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (userId, path, method = 'POST', body = null) => {
    setBusy(b => ({ ...b, [userId + path]: true }));
    try {
      const r = await fetch(`/api/admin/users/${userId}${path}`, {
        method, headers: hdrs(),
        body: body ? JSON.stringify(body) : undefined,
      });
      const d = await r.json();
      if (d.success !== false) return d;
      showToast(d.error || 'Action failed', 'error');
      return null;
    } catch (e) {
      showToast('Network error: ' + e.message, 'error');
      return null;
    } finally {
      setBusy(b => { const n = { ...b }; delete n[userId + path]; return n; });
    }
  };

  const handleDisable = async (u) => {
    const d = await act(u._id, '/disable');
    if (d) {
      setUsers(prev => prev.map(x => x._id === u._id ? { ...x, isActive: d.isActive } : x));
      showToast(`Account ${d.isActive ? 'enabled' : 'disabled'}: ${u.email}`);
    }
  };

  const handleDelete = async (u) => {
    if (!window.confirm(`Permanently delete ${u.email}? This cannot be undone.`)) return;
    const d = await act(u._id, '', 'DELETE');
    if (d) {
      setUsers(prev => prev.filter(x => x._id !== u._id));
      setExpanded(null);
      showToast(`Deleted: ${u.email}`);
    }
  };

  const handleBlockDevices = async (u) => {
    const d = await act(u._id, '/block-devices', 'POST', { accessId: u.accessId });
    if (d) showToast(`Disconnected ${d.blocked} device(s) for ${u.email}`);
  };

  const handleRevoke = async (u) => {
    if (!window.confirm(`Revoke licence for ${u.email}? They will see the paywall immediately.`)) return;
    const d = await act(u._id, '/revoke-paid');
    if (d) {
      setUsers(prev => prev.map(x => x._id === u._id
        ? { ...x, paidUntil: null, tier: 'free', subscription: { state: 'expired', source: 'none', daysLeft: 0 } }
        : x));
      showToast(`Licence revoked for ${u.email}`);
    }
  };

  const handleGrant = async (u) => {
    const gv = grantVals[u._id] || {};
    const amount = parseInt(gv.amount || '', 10);
    const unit   = gv.unit || 'days';
    if (!amount || amount < 1) return showToast('Enter a valid number', 'error');
    const days = unit === 'months' ? amount * 30 : amount;
    const d = await act(u._id, '/grant-month', 'POST', { days });
    if (d) {
      setUsers(prev => prev.map(x => x._id === u._id
        ? { ...x, paidUntil: d.paidUntil, tier: 'paid',
            subscription: { state: 'paid', source: 'paid', expiresAt: d.paidUntil, daysLeft: days } }
        : x));
      setGrantVals(prev => ({ ...prev, [u._id]: { amount: '', unit: 'days' } }));
      showToast(`Granted ${amount} ${unit} to ${u.email}`);
    }
  };

  const handleReport = async (u, fmt = 'csv') => {
    const url = `/api/admin/users/${u._id}/report?format=${fmt}`;
    const r = await fetch(url, { headers: hdrs() });
    if (!r.ok) { showToast('Report failed', 'error'); return; }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `report-${u.email}-${Date.now()}.${fmt}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const filtered = users.filter(u =>
    !search || u.email?.toLowerCase().includes(search.toLowerCase())
      || u.name?.toLowerCase().includes(search.toLowerCase())
      || (u.accessId || '').toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total:   users.length,
    active:  users.filter(u => u.isActive !== false).length,
    paid:    users.filter(u => u.subscription?.state === 'paid').length,
    trial:   users.filter(u => u.subscription?.state === 'trial').length,
    expired: users.filter(u => u.subscription?.state === 'expired').length,
    disabled:users.filter(u => u.isActive === false).length,
  };

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Toast */}
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 26 }}>👥</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>User Management</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Licences · Accounts · Devices · Reports</div>
          </div>
        </div>
        <button onClick={load} style={BTN('rgba(99,102,241,0.25)', loading)}>
          {loading ? '⏳ Loading…' : '🔄 Refresh'}
        </button>
      </div>

      {/* Stats row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px,1fr))', gap: 10 }}>
        {[
          { label: 'Total',    val: stats.total,   color: '#a5b4fc' },
          { label: 'Active',   val: stats.active,  color: '#86efac' },
          { label: 'Paid',     val: stats.paid,    color: '#34d399' },
          { label: 'Trial',    val: stats.trial,   color: '#fcd34d' },
          { label: 'Expired',  val: stats.expired, color: '#f87171' },
          { label: 'Disabled', val: stats.disabled,color: '#94a3b8' },
        ].map(s => (
          <div key={s.label} style={{ background: '#16213e', border: '1px solid #2d2d4e', borderRadius: 10, padding: '10px 14px', textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.val}</div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <input
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by email, name, or Access ID…"
        style={{ ...INPUT, fontSize: 13, padding: '10px 14px' }}
      />

      {loading && (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>Loading users…</div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{ color: '#64748b', textAlign: 'center', padding: 40 }}>
          {search ? 'No users match your search.' : 'No users registered yet.'}
        </div>
      )}

      {/* User list */}
      {filtered.map(u => {
        const isOpen   = expanded === u._id;
        const gv       = grantVals[u._id] || { amount: '', unit: 'days' };
        const isBusy   = (path) => !!busy[u._id + path];
        const sub      = u.subscription || {};

        return (
          <div key={u._id} style={CARD}>
            {/* Row header */}
            <div
              onClick={() => setExpanded(isOpen ? null : u._id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
                cursor: 'pointer', userSelect: 'none',
                background: isOpen ? 'rgba(99,102,241,0.07)' : 'transparent',
                transition: 'background .15s',
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
                background: u.isActive === false ? '#1e293b' : 'linear-gradient(135deg,#6366f1,#8b5cf6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 15, fontWeight: 700, color: '#fff',
              }}>
                {(u.name || u.email || '?')[0].toUpperCase()}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: '#e2e8f0' }}>{u.name || '—'}</span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>{u.email}</span>
                  {u.accessId && (
                    <span style={{ fontSize: 11, color: '#6366f1', fontFamily: 'monospace', background: 'rgba(99,102,241,0.1)', padding: '1px 6px', borderRadius: 4 }}>
                      {u.accessId}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>
                  Joined {fmtDate(u.createdAt)} · Last login {fmtDate(u.lastLogin)}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                <SubBadge sub={sub} isActive={u.isActive !== false} />
                <span style={{ color: '#475569', fontSize: 14 }}>{isOpen ? '▲' : '▼'}</span>
              </div>
            </div>

            {/* Expanded panel */}
            {isOpen && (
              <div style={{ borderTop: '1px solid #1e293b', padding: '18px 18px 20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 16 }}>

                  {/* LEFT: Info + IPs */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                    {/* Subscription info */}
                    <Section title="📋 Subscription">
                      <InfoRow label="Status"    value={sub.state || '—'} />
                      <InfoRow label="Tier"      value={u.tier || 'free'} />
                      <InfoRow label="Paid Until" value={fmtDate(u.paidUntil)} />
                      <InfoRow label="Trial End" value={fmtDate(u.trialEndDate)} />
                      <InfoRow label="Days Left"  value={sub.daysLeft != null ? `${sub.daysLeft}d` : '—'} />
                    </Section>

                    {/* Login IPs */}
                    <Section title="🌐 Login IP Addresses" action={
                      <span style={{ fontSize: 11, color: '#64748b' }}>{(u.loginIps || []).length} recorded</span>
                    }>
                      {(!u.loginIps || u.loginIps.length === 0) ? (
                        <div style={{ color: '#475569', fontSize: 12 }}>No IPs recorded yet</div>
                      ) : (
                        <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {u.loginIps.map((e, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, background: '#0f172a', padding: '5px 10px', borderRadius: 6 }}>
                              <span style={{ color: '#a5b4fc', fontFamily: 'monospace' }}>{e.ip}</span>
                              <span style={{ color: '#475569' }}>{fmtDate(e.at)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </Section>

                    {/* Payment history */}
                    {u.paymentHistory && u.paymentHistory.length > 0 && (
                      <Section title="💳 Payment History">
                        <div style={{ maxHeight: 140, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {u.paymentHistory.slice().reverse().map((p, i) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, background: '#0f172a', padding: '5px 10px', borderRadius: 6, gap: 6 }}>
                              <span style={{ color: '#86efac' }}>{p.status}</span>
                              <span style={{ color: '#94a3b8' }}>+{p.extendedDays}d</span>
                              <span style={{ color: '#475569' }}>${p.amountUsd || 0}</span>
                              <span style={{ color: '#334155' }}>{fmtDate(p.receivedAt)}</span>
                            </div>
                          ))}
                        </div>
                      </Section>
                    )}
                  </div>

                  {/* RIGHT: Actions */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                    {/* Grant licence */}
                    <Section title="🎫 Grant Licence">
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="number" min="1" step="1" placeholder="Amount"
                          value={gv.amount}
                          onChange={e => setGrantVals(p => ({ ...p, [u._id]: { ...gv, amount: e.target.value } }))}
                          style={{ ...INPUT, flex: 1 }}
                        />
                        <select
                          value={gv.unit}
                          onChange={e => setGrantVals(p => ({ ...p, [u._id]: { ...gv, unit: e.target.value } }))}
                          style={{ ...INPUT, flex: 0, width: 90 }}
                        >
                          <option value="days">Days</option>
                          <option value="months">Months</option>
                        </select>
                        <button
                          onClick={() => handleGrant(u)}
                          disabled={isBusy('/grant-month') || !gv.amount}
                          style={BTN('linear-gradient(135deg,#6366f1,#8b5cf6)', isBusy('/grant-month') || !gv.amount)}
                        >
                          {isBusy('/grant-month') ? '⏳' : '✅ Grant'}
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                        Use when webhook/callback fails or to manually extend access.
                      </div>
                    </Section>

                    {/* Danger actions */}
                    <Section title="⚡ Account Actions">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

                        {/* Disable / Enable */}
                        <ActionRow
                          icon={u.isActive !== false ? '🚫' : '✅'}
                          label={u.isActive !== false ? 'Disable Account' : 'Enable Account'}
                          desc={u.isActive !== false ? 'Prevent this user from logging in' : 'Restore login access'}
                          btnColor={u.isActive !== false ? '#f59e0b' : '#22c55e'}
                          busy={isBusy('/disable')}
                          onClick={() => handleDisable(u)}
                        />

                        {/* Block devices */}
                        <ActionRow
                          icon="📵"
                          label="Block Connected Devices"
                          desc="Disconnect all devices linked to this account right now"
                          btnColor="#8b5cf6"
                          busy={isBusy('/block-devices')}
                          onClick={() => handleBlockDevices(u)}
                        />

                        {/* Revoke licence */}
                        <ActionRow
                          icon="🔒"
                          label="Revoke Licence"
                          desc="Clear paid window — account returns to expired/trial state"
                          btnColor="#f59e0b"
                          busy={isBusy('/revoke-paid')}
                          onClick={() => handleRevoke(u)}
                        />

                        {/* Delete */}
                        <ActionRow
                          icon="🗑️"
                          label="Delete Account"
                          desc="Permanently remove this account — cannot be undone"
                          btnColor="#ef4444"
                          busy={isBusy('')}
                          onClick={() => handleDelete(u)}
                        />
                      </div>
                    </Section>

                    {/* Report download */}
                    <Section title="📄 Account Report">
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => handleReport(u, 'csv')}
                          style={{ ...BTN('linear-gradient(135deg,#0ea5e9,#6366f1)', false), flex: 1 }}
                        >
                          ⬇️ Download CSV
                        </button>
                        <button
                          onClick={() => handleReport(u, 'json')}
                          style={{ ...BTN('rgba(99,102,241,0.3)', false), flex: 1 }}
                        >
                          ⬇️ JSON
                        </button>
                      </div>
                      <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                        Includes devices, IPs, subscription, and payment history.
                      </div>
                    </Section>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Section({ title, children, action }) {
  return (
    <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          {title}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid #1e293b' }}>
      <span style={{ color: '#64748b' }}>{label}</span>
      <span style={{ color: '#cbd5e1', fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function ActionRow({ icon, label, desc, btnColor, busy, onClick }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: '#16213e', border: '1px solid #2d2d4e', borderRadius: 8, padding: '10px 12px', gap: 10,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{icon} {label}</div>
        <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{desc}</div>
      </div>
      <button
        onClick={onClick}
        disabled={busy}
        style={{
          background: busy ? '#1e293b' : btnColor, border: 'none', borderRadius: 7,
          color: busy ? '#475569' : '#fff', padding: '6px 14px', fontSize: 11, fontWeight: 600,
          cursor: busy ? 'not-allowed' : 'pointer', flexShrink: 0,
        }}
      >
        {busy ? '⏳' : 'Run'}
      </button>
    </div>
  );
}
