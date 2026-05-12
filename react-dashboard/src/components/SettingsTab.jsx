import React, { useState, useEffect } from 'react';

function Toggle({ value, onChange, label, description }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #1e1b4b' }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{label}</div>
        {description && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{description}</div>}
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

export default function SettingsTab() {
  const [loading, setLoading]   = useState(true);
  const [toast, setToast]       = useState(null);
  const [role, setRole]         = useState(null);

  // User-only: Change password
  const [cpCurrent, setCpCurrent]   = useState('');
  const [cpNew, setCpNew]           = useState('');
  const [cpConfirm, setCpConfirm]   = useState('');
  const [savingPw, setSavingPw]     = useState(false);

  // User-only: Delete account modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword]   = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);

  // Admin-only: Build worker API key + status
  const [workerKey, setWorkerKey]           = useState('');
  const [workerKeySet, setWorkerKeySet]     = useState(false);
  const [workerOnline, setWorkerOnline]     = useState(false);
  const [workerLastSeen, setWorkerLastSeen] = useState(null);
  const [workerPending, setWorkerPending]   = useState(0);
  const [savingWorker, setSavingWorker]     = useState(false);

  // Admin-only: NOWPayments webhook config + status
  const [payWebhookUrl,  setPayWebhookUrl]  = useState('');
  const [payIpnSecret,   setPayIpnSecret]   = useState('');
  const [payIpnSecretSet,setPayIpnSecretSet]= useState(false);
  const [payPaymentUrl,  setPayPaymentUrl]  = useState('');
  const [payPriceUsd,    setPayPriceUsd]    = useState(25);
  const [payExtendDays,  setPayExtendDays]  = useState(30);
  const [savingPayment,  setSavingPayment]  = useState(false);
  const [copiedWebhook,  setCopiedWebhook]  = useState(false);

  // Admin-only: Device assignment panel
  const [adminDevices,      setAdminDevices]      = useState([]);
  const [adminUsers,        setAdminUsers]        = useState([]);
  const [loadingDevMgmt,    setLoadingDevMgmt]    = useState(false);
  const [assigningDevice,   setAssigningDevice]   = useState(null);
  const [assignTarget,      setAssignTarget]      = useState({});

  // Admin token takes precedence (admin dashboard); otherwise use user token.
  const adminToken = localStorage.getItem('admin_token');
  const userToken  = localStorage.getItem('user_token');
  const token   = adminToken || userToken;
  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` };
  const isAdmin = role === 'admin';

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadSettings = async () => {
    try {
      const r = await fetch('/api/settings', { headers });
      const d = await r.json();
      if (!d.success) return;
      setRole(d.role || (adminToken ? 'admin' : 'user'));
      const bw = d.buildWorker || {};
      setWorkerKey(bw.apiKey || '');
      setWorkerKeySet(!!bw.apiKeySet);
      setWorkerOnline(!!bw.workerOnline);
      setWorkerLastSeen(bw.lastSeen || null);
      setWorkerPending(bw.pending || 0);
    } catch (_) {
      showToast('Failed to load settings', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadSettings(); }, []);

  // Refresh worker status every 5s while admin is on this tab.
  useEffect(() => {
    if (role !== 'admin') return;
    const id = setInterval(loadSettings, 5000);
    return () => clearInterval(id);
  }, [role]);

  // Load payment / webhook config (admin only).
  const loadPayment = async () => {
    try {
      const r = await fetch('/api/admin/payment', { headers });
      const d = await r.json();
      if (!d.success) return;
      setPayWebhookUrl(d.webhookUrl || '');
      setPayIpnSecretSet(!!d.ipnSecretSet);
      setPayIpnSecret(d.ipnSecretSet ? (d.ipnSecretMask || '***') : '');
      setPayPaymentUrl(d.paymentUrl || '');
      setPayPriceUsd(d.priceUsd ?? 25);
      setPayExtendDays(d.extendDays ?? 30);
    } catch (_) { /* ignore */ }
  };

  useEffect(() => {
    if (role !== 'admin') return;
    loadPayment();
  }, [role]);

  const loadDeviceManagement = async () => {
    setLoadingDevMgmt(true);
    try {
      const [dr, ur] = await Promise.all([
        fetch('/api/admin/devices', { headers }).then(r => r.json()),
        fetch('/api/admin/users',   { headers }).then(r => r.json()),
      ]);
      if (dr.success) setAdminDevices(dr.devices || []);
      if (ur.success) setAdminUsers(ur.users   || []);
    } catch (_) {}
    finally { setLoadingDevMgmt(false); }
  };

  useEffect(() => {
    if (role !== 'admin') return;
    loadDeviceManagement();
  }, [role]);

  const handleAssignDevice = async (deviceId) => {
    const newAccessId = (assignTarget[deviceId] || '').trim();
    setAssigningDevice(deviceId);
    try {
      const r = await fetch(`/api/admin/devices/${encodeURIComponent(deviceId)}/assign`, {
        method: 'POST', headers,
        body: JSON.stringify({ accessId: newAccessId }),
      });
      const d = await r.json();
      if (d.success) {
        showToast(`Device assigned to Access ID: ${newAccessId || '(none)'}`);
        setAdminDevices(prev => prev.map(dev =>
          dev.deviceId === deviceId ? { ...dev, accessId: newAccessId } : dev
        ));
      } else {
        showToast(d.error || 'Assign failed', 'error');
      }
    } catch (e) {
      showToast('Network error: ' + e.message, 'error');
    } finally {
      setAssigningDevice(null);
    }
  };

  const handleSavePayment = async () => {
    setSavingPayment(true);
    try {
      const body = {
        ipnSecret:  payIpnSecret.startsWith('***') ? undefined : payIpnSecret,
        paymentUrl: payPaymentUrl,
        priceUsd:   Number(payPriceUsd),
        extendDays: Number(payExtendDays),
      };
      const r = await fetch('/api/admin/payment', { method: 'POST', headers, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.success) { showToast('Payment settings saved'); loadPayment(); }
      else showToast(d.error || 'Save failed', 'error');
    } catch (e) {
      showToast('Network error: ' + e.message, 'error');
    } finally {
      setSavingPayment(false);
    }
  };

  const handleCopyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(payWebhookUrl);
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 1500);
    } catch (_) { showToast('Copy failed — select and copy manually', 'error'); }
  };

  const handleSaveWorker = async () => {
    setSavingWorker(true);
    try {
      const body = {
        telegram: {},   // backend requires the wrapper but ignores empty fields
        buildWorker: {
          apiKey: workerKey.startsWith('***') ? undefined : workerKey,
        },
      };
      const r = await fetch('/api/settings', { method: 'POST', headers, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.success) {
        showToast('Build worker key saved');
        loadSettings();
      } else {
        showToast(d.error || 'Save failed', 'error');
      }
    } catch (e) {
      showToast('Network error: ' + e.message, 'error');
    } finally {
      setSavingWorker(false);
    }
  };

  const handleChangePassword = async () => {
    if (!cpCurrent || !cpNew || !cpConfirm) {
      return showToast('Please fill in all password fields.', 'error');
    }
    if (cpNew.length < 6) {
      return showToast('New password must be at least 6 characters.', 'error');
    }
    if (cpNew !== cpConfirm) {
      return showToast('New passwords do not match.', 'error');
    }
    setSavingPw(true);
    try {
      const r = await fetch('/api/user-auth/change-password', {
        method: 'POST', headers,
        body: JSON.stringify({ currentPassword: cpCurrent, newPassword: cpNew }),
      });
      const d = await r.json();
      if (d.success) {
        showToast('Password changed successfully.');
        setCpCurrent(''); setCpNew(''); setCpConfirm('');
      } else {
        showToast(d.error || 'Failed to change password.', 'error');
      }
    } catch (e) {
      showToast('Network error: ' + e.message, 'error');
    } finally {
      setSavingPw(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      return showToast('Enter your password to confirm deletion.', 'error');
    }
    setDeletingAccount(true);
    try {
      const r = await fetch('/api/user-auth/account', {
        method: 'DELETE', headers,
        body: JSON.stringify({ password: deletePassword }),
      });
      const d = await r.json();
      if (d.success) {
        localStorage.removeItem('user_token');
        window.location.reload();
      } else {
        showToast(d.error || 'Failed to delete account.', 'error');
        setDeletingAccount(false);
      }
    } catch (e) {
      showToast('Network error: ' + e.message, 'error');
      setDeletingAccount(false);
    }
  };

  const handleGenerateWorkerKey = () => {
    // Generate a 48-char URL-safe random key in the browser. Admin still has
    // to click Save to apply it.
    const arr = new Uint8Array(36);
    crypto.getRandomValues(arr);
    const b64 = btoa(String.fromCharCode(...arr))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    setWorkerKey(b64);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#64748b' }}>
        Loading settings…
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

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
      <div style={{ background: '#16213e', border: '1px solid #2d2d4e', borderRadius: 12, padding: '16px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28 }}>⚙️</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Settings</div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>Configure server behaviour and advanced options</div>
          </div>
        </div>
      </div>

      {/* Delete Account Confirmation Modal — USER ONLY */}
      {showDeleteModal && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 10000,
          background: 'rgba(0,0,0,0.75)', display: 'flex',
          alignItems: 'center', justifyContent: 'center', padding: 20,
        }}>
          <div style={{
            background: '#16213e', border: '1px solid #ef4444',
            borderRadius: 14, padding: '28px 28px 24px', maxWidth: 420, width: '100%',
            boxShadow: '0 8px 40px rgba(239,68,68,0.25)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span style={{ fontSize: 28 }}>⚠️</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: '#f87171' }}>Delete Account</div>
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>This action is permanent and cannot be undone</div>
              </div>
            </div>

            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#fca5a5',
              lineHeight: 1.6, marginBottom: 18,
            }}>
              All your data, devices, and subscription will be permanently erased.
              There is no way to recover your account after this.
            </div>

            <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
              Enter your password to confirm
            </label>
            <input
              type="password"
              value={deletePassword}
              onChange={e => setDeletePassword(e.target.value)}
              placeholder="Your current password"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleDeleteAccount()}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: '#0f172a', border: '1px solid #ef4444', borderRadius: 8,
                padding: '9px 12px', color: '#f0f0ff', fontSize: 13, outline: 'none',
                marginBottom: 18,
              }}
            />

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={() => { setShowDeleteModal(false); setDeletePassword(''); }}
                disabled={deletingAccount}
                style={{
                  background: 'transparent', border: '1px solid #334155',
                  borderRadius: 8, color: '#94a3b8', padding: '8px 20px',
                  fontSize: 13, cursor: 'pointer', fontWeight: 600,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAccount}
                disabled={deletingAccount || !deletePassword}
                style={{
                  background: deletingAccount || !deletePassword ? 'rgba(239,68,68,0.4)' : '#ef4444',
                  border: 'none', borderRadius: 8, color: '#fff',
                  padding: '8px 20px', fontSize: 13, cursor: (deletingAccount || !deletePassword) ? 'not-allowed' : 'pointer',
                  fontWeight: 700,
                }}
              >
                {deletingAccount ? '⏳ Deleting…' : '🗑️ Delete My Account'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Telegram moved to Notifications tab */}
      <div style={{ background: '#16213e', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
        <span style={{ fontSize: 24 }}>📢</span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#a5b4fc' }}>Telegram Notifications</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            Bot configuration and notification events have moved to the <strong style={{ color: '#a5b4fc' }}>Notifications</strong> tab.
          </div>
        </div>
      </div>

      {/* Change Password — USER ONLY */}
      {!isAdmin && (
        <div style={{ background: '#16213e', border: '1px solid #2d2d4e', borderRadius: 12, padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
            <span style={{ fontSize: 22 }}>🔑</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14 }}>Change Password</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Update your account password</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Current Password</label>
              <input
                type="password"
                value={cpCurrent}
                onChange={e => setCpCurrent(e.target.value)}
                placeholder="Enter your current password"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#0f172a', border: '1px solid #2d2d4e', borderRadius: 8,
                  padding: '9px 12px', color: '#f0f0ff', fontSize: 13, outline: 'none',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>New Password</label>
              <input
                type="password"
                value={cpNew}
                onChange={e => setCpNew(e.target.value)}
                placeholder="At least 6 characters"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#0f172a', border: '1px solid #2d2d4e', borderRadius: 8,
                  padding: '9px 12px', color: '#f0f0ff', fontSize: 13, outline: 'none',
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Confirm New Password</label>
              <input
                type="password"
                value={cpConfirm}
                onChange={e => setCpConfirm(e.target.value)}
                placeholder="Repeat your new password"
                onKeyDown={e => e.key === 'Enter' && handleChangePassword()}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#0f172a',
                  border: `1px solid ${cpConfirm && cpNew && cpConfirm !== cpNew ? '#ef4444' : '#2d2d4e'}`,
                  borderRadius: 8, padding: '9px 12px', color: '#f0f0ff',
                  fontSize: 13, outline: 'none',
                }}
              />
              {cpConfirm && cpNew && cpConfirm !== cpNew && (
                <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>Passwords do not match</div>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
            <button
              onClick={handleChangePassword}
              disabled={savingPw || !cpCurrent || !cpNew || !cpConfirm}
              style={{
                background: '#7c3aed', border: 'none', borderRadius: 8,
                color: '#fff', padding: '8px 22px', fontSize: 13,
                cursor: (savingPw || !cpCurrent || !cpNew || !cpConfirm) ? 'not-allowed' : 'pointer',
                fontWeight: 600,
                opacity: (savingPw || !cpCurrent || !cpNew || !cpConfirm) ? 0.5 : 1,
              }}
            >
              {savingPw ? '⏳ Updating…' : '🔒 Update Password'}
            </button>
          </div>
        </div>
      )}

      {/* Delete Account — USER ONLY */}
      {!isAdmin && (
        <div style={{ background: '#16213e', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 12, padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 22 }}>🗑️</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: '#f87171' }}>Delete Account</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Permanently remove your account and all associated data</div>
            </div>
          </div>
          <div style={{
            background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
            borderRadius: 8, padding: '10px 14px', fontSize: 12, color: '#fca5a5',
            lineHeight: 1.6, marginBottom: 16,
          }}>
            Deleting your account will permanently remove all your devices, settings, and subscription data.
            This cannot be undone.
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => { setDeletePassword(''); setShowDeleteModal(true); }}
              style={{
                background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)',
                borderRadius: 8, color: '#f87171', padding: '8px 20px',
                fontSize: 13, cursor: 'pointer', fontWeight: 600,
              }}
            >
              Delete My Account
            </button>
          </div>
        </div>
      )}

      {/* Payments / NOWPayments Webhook — ADMIN ONLY */}
      {isAdmin && (
        <div style={{ background: '#16213e', border: '1px solid #2d2d4e', borderRadius: 12, padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>☕</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>NOWPayments Webhook</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  Receive payment confirmations and unlock user accounts automatically
                </div>
              </div>
            </div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 12, fontSize: 11, fontWeight: 600,
              color: payIpnSecretSet ? '#86efac' : '#fca5a5',
              background: payIpnSecretSet ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
              border: `1px solid ${payIpnSecretSet ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: payIpnSecretSet ? '#22c55e' : '#ef4444',
              }} />
              {payIpnSecretSet ? 'Webhook armed' : 'Secret missing'}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Webhook URL */}
            <div>
              <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                Webhook URL (paste this into NOWPayments → Store → IPN Callback URL)
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={payWebhookUrl}
                  readOnly
                  spellCheck={false}
                  style={{
                    flex: 1, boxSizing: 'border-box',
                    background: '#0f172a', border: '1px solid #2d2d4e', borderRadius: 8,
                    padding: '9px 12px', color: '#a5b4fc', fontSize: 12,
                    outline: 'none', fontFamily: '"JetBrains Mono","Fira Code",monospace',
                  }}
                />
                <button
                  onClick={handleCopyWebhook}
                  style={{
                    background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.4)',
                    borderRadius: 8, color: '#a78bfa', padding: '8px 14px', fontSize: 12,
                    cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  {copiedWebhook ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>
            </div>

            {/* IPN Secret */}
            <div>
              <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                IPN Secret
                {payIpnSecretSet && (
                  <span style={{ marginLeft: 8, color: '#22c55e', fontSize: 10 }}>● Configured</span>
                )}
              </label>
              <input
                type="password"
                value={payIpnSecret}
                onChange={e => setPayIpnSecret(e.target.value)}
                placeholder={payIpnSecretSet ? 'Leave masked to keep existing secret' : 'Paste IPN secret from NOWPayments…'}
                spellCheck={false}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#0f172a', border: '1px solid #2d2d4e', borderRadius: 8,
                  padding: '9px 12px', color: '#f0f0ff', fontSize: 13,
                  outline: 'none', fontFamily: '"JetBrains Mono","Fira Code",monospace',
                }}
              />
              <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                Find it in NOWPayments → Account → Store Settings → IPN Secret. Used to verify webhook signatures.
              </div>
            </div>

            {/* Payment URL */}
            <div>
              <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                Payment Link
              </label>
              <input
                type="text"
                value={payPaymentUrl}
                onChange={e => setPayPaymentUrl(e.target.value)}
                placeholder="https://nowpayments.io/payment/?iid=..."
                spellCheck={false}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#0f172a', border: '1px solid #2d2d4e', borderRadius: 8,
                  padding: '9px 12px', color: '#f0f0ff', fontSize: 12,
                  outline: 'none', fontFamily: '"JetBrains Mono","Fira Code",monospace',
                }}
              />
              <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                Shown to users on the paywall. We append <code style={{ background: '#1e293b', padding: '1px 4px', borderRadius: 3 }}>order_id</code> + <code style={{ background: '#1e293b', padding: '1px 4px', borderRadius: 3 }}>customer_email</code> automatically.
              </div>
            </div>

            {/* Price + extend */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Price (USD)</label>
                <input
                  type="number" min="1" step="1"
                  value={payPriceUsd}
                  onChange={e => setPayPriceUsd(e.target.value)}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: '#0f172a', border: '1px solid #2d2d4e', borderRadius: 8,
                    padding: '9px 12px', color: '#f0f0ff', fontSize: 13, outline: 'none',
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>Unlock duration (days)</label>
                <input
                  type="number" min="1" step="1"
                  value={payExtendDays}
                  onChange={e => setPayExtendDays(e.target.value)}
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    background: '#0f172a', border: '1px solid #2d2d4e', borderRadius: 8,
                    padding: '9px 12px', color: '#f0f0ff', fontSize: 13, outline: 'none',
                  }}
                />
              </div>
            </div>

            {/* Setup hint */}
            <div style={{
              background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
              padding: '12px 14px', fontSize: 12, color: '#cbd5e1', lineHeight: 1.7,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: '#a5b4fc' }}>Setup steps</div>
              1. Sign in to <a href="https://account.nowpayments.io/" target="_blank" rel="noreferrer" style={{ color: '#a78bfa' }}>account.nowpayments.io</a>.<br />
              2. Open <strong>Store Settings → IPN Callback URL</strong>, paste the webhook URL above.<br />
              3. Copy the <strong>IPN Secret</strong> from the same page into the field above and Save.<br />
              4. After every paid invoice we extend the user's <code style={{ background: '#1e293b', padding: '1px 4px', borderRadius: 3 }}>paidUntil</code> by {payExtendDays || 30} days.
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
            <button
              onClick={handleSavePayment}
              disabled={savingPayment}
              style={{
                background: '#7c3aed', border: 'none', borderRadius: 8,
                color: '#fff', padding: '8px 22px', fontSize: 13,
                cursor: 'pointer', fontWeight: 600,
                opacity: savingPayment ? 0.6 : 1,
              }}
            >
              {savingPayment ? '⏳ Saving…' : '💾 Save Payment Settings'}
            </button>
          </div>
        </div>
      )}

      {/* Build Worker — ADMIN ONLY */}
      {isAdmin && (
        <div style={{ background: '#16213e', border: '1px solid #2d2d4e', borderRadius: 12, padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18, justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>🔧</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>APK Build Worker</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  Standalone build.sh worker — can run anywhere with network access
                </div>
              </div>
            </div>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 12px', borderRadius: 12, fontSize: 11, fontWeight: 600,
              color: workerOnline ? '#86efac' : '#fca5a5',
              background: workerOnline ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
              border: `1px solid ${workerOnline ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}`,
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%',
                background: workerOnline ? '#22c55e' : '#ef4444',
              }} />
              {workerOnline ? 'Worker online' : 'Worker offline'}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* API Key */}
            <div>
              <label style={{ fontSize: 12, color: '#94a3b8', display: 'block', marginBottom: 6 }}>
                Worker API Key
                {workerKeySet && (
                  <span style={{ marginLeft: 8, color: '#22c55e', fontSize: 10 }}>● Configured</span>
                )}
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  value={workerKey}
                  onChange={e => setWorkerKey(e.target.value)}
                  placeholder={workerKeySet ? 'Leave masked to keep existing key' : 'Click Generate or paste a key…'}
                  spellCheck={false}
                  style={{
                    flex: 1, boxSizing: 'border-box',
                    background: '#0f172a', border: '1px solid #2d2d4e', borderRadius: 8,
                    padding: '9px 12px', color: '#f0f0ff', fontSize: 13,
                    outline: 'none', fontFamily: '"JetBrains Mono","Fira Code",monospace',
                  }}
                />
                <button
                  onClick={handleGenerateWorkerKey}
                  style={{
                    background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.4)',
                    borderRadius: 8, color: '#a78bfa', padding: '8px 14px', fontSize: 12,
                    cursor: 'pointer', fontWeight: 600,
                  }}
                >
                  ✨ Generate
                </button>
              </div>
              <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                Only you (admin) can set this. All users can submit build jobs — the worker
                authenticates with this key to pick them up.
              </div>
            </div>

            {/* Setup hint */}
            <div style={{
              background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8,
              padding: '12px 14px', fontSize: 12, color: '#cbd5e1', lineHeight: 1.6,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 6, color: '#a5b4fc' }}>Deploy the worker anywhere</div>
              On any Linux box with build.sh checked out, run:
              <pre style={{
                background: '#020617', borderRadius: 6, padding: 10, margin: '8px 0 0 0',
                fontSize: 11.5, color: '#86efac', overflowX: 'auto',
              }}>
{`export BUILD_URL="${typeof window !== 'undefined' ? window.location.origin : 'https://your-dashboard'}"
export BUILD_API_KEY="<paste the key above>"
bash build.sh --worker`}
              </pre>
            </div>

            {/* Status grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Pending Jobs</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', marginTop: 2 }}>{workerPending}</div>
              </div>
              <div style={{ background: '#0f172a', borderRadius: 8, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>Last Seen</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0', marginTop: 4 }}>
                  {workerLastSeen
                    ? `${Math.max(0, Math.round((Date.now() - workerLastSeen) / 1000))}s ago`
                    : '—'}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
            <button
              onClick={handleSaveWorker}
              disabled={savingWorker || !workerKey || workerKey.startsWith('***')}
              style={{
                background: '#7c3aed', border: 'none', borderRadius: 8,
                color: '#fff', padding: '8px 22px', fontSize: 13,
                cursor: 'pointer', fontWeight: 600,
                opacity: (savingWorker || !workerKey || workerKey.startsWith('***')) ? 0.5 : 1,
              }}
            >
              {savingWorker ? '⏳ Saving…' : '💾 Save Worker Key'}
            </button>
          </div>
        </div>
      )}

      {/* Device Assignment — ADMIN ONLY */}
      {isAdmin && (
        <div style={{ background: '#16213e', border: '1px solid #2d2d4e', borderRadius: 12, padding: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 22 }}>📱</span>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Device → User Assignment</div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  Link any connected device to a user's Access ID so it appears in their dashboard
                </div>
              </div>
            </div>
            <button
              onClick={loadDeviceManagement}
              disabled={loadingDevMgmt}
              style={{
                background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.4)',
                borderRadius: 8, color: '#a5b4fc', padding: '6px 12px', fontSize: 11,
                cursor: 'pointer', fontWeight: 600,
              }}
            >
              {loadingDevMgmt ? '⏳' : '🔄 Refresh'}
            </button>
          </div>

          {adminDevices.length === 0 ? (
            <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>
              {loadingDevMgmt ? 'Loading devices…' : 'No devices connected yet.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {adminDevices.map(dev => {
                const ownerUser = adminUsers.find(u => u.accessId === dev.accessId);
                const isAssigning = assigningDevice === dev.deviceId;
                return (
                  <div key={dev.deviceId} style={{
                    background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10,
                    padding: '12px 14px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                        background: dev.isOnline ? '#22c55e' : '#64748b',
                      }} />
                      <span style={{ fontWeight: 600, fontSize: 13, color: '#e2e8f0' }}>
                        {dev.deviceName || dev.deviceId}
                      </span>
                      <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>
                        {dev.deviceId}
                      </span>
                      {dev.accessId ? (
                        <span style={{
                          marginLeft: 'auto', fontSize: 11, color: '#86efac',
                          background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
                          borderRadius: 6, padding: '2px 8px',
                        }}>
                          {ownerUser ? `${ownerUser.email}` : dev.accessId}
                        </span>
                      ) : (
                        <span style={{
                          marginLeft: 'auto', fontSize: 11, color: '#f87171',
                          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
                          borderRadius: 6, padding: '2px 8px',
                        }}>
                          Unassigned
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <select
                        value={assignTarget[dev.deviceId] ?? (dev.accessId || '')}
                        onChange={e => setAssignTarget(prev => ({ ...prev, [dev.deviceId]: e.target.value }))}
                        style={{
                          flex: 1, background: '#1e293b', border: '1px solid #334155',
                          borderRadius: 7, padding: '7px 10px', color: '#e2e8f0',
                          fontSize: 12, outline: 'none',
                        }}
                      >
                        <option value="">— Unassigned —</option>
                        {adminUsers.map(u => (
                          <option key={u._id} value={u.accessId || ''}>
                            {u.email} ({u.accessId || 'no ID'})
                          </option>
                        ))}
                      </select>
                      <button
                        onClick={() => handleAssignDevice(dev.deviceId)}
                        disabled={isAssigning}
                        style={{
                          background: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)',
                          border: 'none', borderRadius: 7, color: '#fff',
                          padding: '7px 16px', fontSize: 12, fontWeight: 600,
                          cursor: isAssigning ? 'wait' : 'pointer',
                          opacity: isAssigning ? 0.7 : 1,
                        }}
                      >
                        {isAssigning ? '⏳' : 'Assign'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Info box */}
      <div style={{ background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)', borderRadius: 8, padding: '12px 16px', fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
        {isAdmin ? (
          <>
            ℹ️ Settings changed here take effect immediately without restarting the server.
            You can also set <code style={{ background: '#1e293b', padding: '1px 4px', borderRadius: 3 }}>TELEGRAM_BOT_TOKEN</code> and{' '}
            <code style={{ background: '#1e293b', padding: '1px 4px', borderRadius: 3 }}>TELEGRAM_CHAT_ID</code> as environment secrets for permanent configuration.
          </>
        ) : (
          <>
            ℹ️ Your bot token and chat ID are stored privately on your account. Notifications will be sent only to your bot — separate from any other user or the administrator.
          </>
        )}
      </div>
    </div>
  );
}
