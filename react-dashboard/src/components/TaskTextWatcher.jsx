import React, { useCallback, useEffect, useState } from 'react';

const ACTIVE_STATUSES = new Set(['searching', 'clicking']);

function authHeaders(json = false) {
  const token = localStorage.getItem('admin_token') || localStorage.getItem('user_token');
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function sessionStatusLabel(status) {
  switch (status) {
    case 'searching': return 'Searching for text…';
    case 'clicking': return 'Clicking matches from the detected frame…';
    case 'completed': return 'All matches clicked once.';
    case 'stopped': return 'Watcher stopped.';
    case 'expired': return 'Watcher timed out.';
    case 'failed': return 'Watcher stopped with an error.';
    default: return 'Ready';
  }
}

export default function TaskTextWatcher({ device }) {
  const deviceId = device?.deviceId || '';
  const isOnline = !!device?.isOnline;
  const [targetsText, setTargetsText] = useState('');
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const readSession = useCallback(async () => {
    if (!deviceId) return;
    try {
      const response = await fetch(
        `/api/task-studio/text-watch?deviceId=${encodeURIComponent(deviceId)}`,
        { headers: authHeaders() }
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Could not load watcher status.');
      }
      setSession(data.session || null);
      setError('');
    } catch (err) {
      setError(err.message || 'Could not load watcher status.');
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/task-studio/text-watch?deviceId=${encodeURIComponent(deviceId)}`, {
      headers: authHeaders(),
    })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) throw new Error(data.error || 'Could not load watcher status.');
        if (!cancelled) {
          setSession(data.session || null);
          setError('');
        }
      })
      .catch(err => { if (!cancelled) setError(err.message || 'Could not load watcher status.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [deviceId]);

  useEffect(() => {
    if (!session?.id || !ACTIVE_STATUSES.has(session.status)) return undefined;
    const timer = window.setInterval(readSession, 1000);
    return () => window.clearInterval(timer);
  }, [session?.id, session?.status, readSession]);

  const startWatching = async () => {
    const targets = targetsText.split(/\r?\n/).map(text => text.trim()).filter(Boolean);
    if (!targets.length) {
      setError('Enter one or more text targets, one per line.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/task-studio/text-watch/start', {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({ deviceId, targets }),
      });
      const data = await response.json().catch(() => ({}));
      if (data.session) setSession(data.session);
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Could not start the watcher.');
      }
      setSession(data.session);
    } catch (err) {
      setError(err.message || 'Could not start the watcher.');
    } finally {
      setBusy(false);
    }
  };

  const stopWatching = async () => {
    if (!session?.id) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/task-studio/text-watch/${encodeURIComponent(session.id)}/stop`, {
        method: 'POST',
        headers: authHeaders(true),
        body: JSON.stringify({}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Could not stop the watcher.');
      }
      setSession(data.session);
    } catch (err) {
      setError(err.message || 'Could not stop the watcher.');
    } finally {
      setBusy(false);
    }
  };

  const active = ACTIVE_STATUSES.has(session?.status);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10, minHeight: 0 }}>
      <div style={{ fontSize: 12, color: '#cbd5e1', lineHeight: 1.5 }}>
        The backend reads the screen and taps exact text you list at its reported bounds, including text nodes not marked clickable. This is separate from saved task steps.
      </div>

      <label style={{ display: 'flex', flexDirection: 'column', gap: 5, color: '#94a3b8', fontSize: 11 }}>
        Text to watch for — one phrase per line
        <textarea
          value={targetsText}
          onChange={event => setTargetsText(event.target.value)}
          disabled={active || busy}
          rows={4}
          placeholder={'Sign in\nContinue to dashboard'}
          style={{
            resize: 'vertical', background: '#0f172a', color: '#e2e8f0',
            border: '1px solid #334155', borderRadius: 7, padding: '8px 9px',
            fontSize: 12, lineHeight: 1.45, fontFamily: 'inherit', minHeight: 78,
          }}
        />
      </label>

      {active ? (
        <button
          type="button"
          onClick={stopWatching}
          disabled={busy}
          style={{
            background: '#b91c1c', border: 'none', borderRadius: 7, color: '#fff',
            padding: '8px 10px', fontSize: 12, fontWeight: 700, cursor: busy ? 'wait' : 'pointer',
          }}
        >
          {busy ? 'Stopping…' : 'Stop watcher'}
        </button>
      ) : (
        <button
          type="button"
          onClick={startWatching}
          disabled={!isOnline || busy || loading}
          style={{
            background: '#059669', border: 'none', borderRadius: 7, color: '#fff',
            padding: '8px 10px', fontSize: 12, fontWeight: 700,
            cursor: !isOnline || busy || loading ? 'not-allowed' : 'pointer',
            opacity: !isOnline || busy || loading ? 0.55 : 1,
          }}
        >
          {busy ? 'Starting…' : 'Start screen watcher'}
        </button>
      )}

      <div style={{
        border: `1px solid ${active ? 'rgba(245,158,11,.35)' : '#2d2d4e'}`,
        background: active ? 'rgba(245,158,11,.08)' : '#111827',
        borderRadius: 8, padding: 9,
      }}>
        <div style={{ color: active ? '#fbbf24' : '#cbd5e1', fontSize: 12, fontWeight: 700 }}>
          {loading ? 'Loading watcher status…' : sessionStatusLabel(session?.status)}
        </div>
        {session?.message && (
          <div style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.45, marginTop: 4 }}>
            {session.message}
          </div>
        )}
        {session?.packageName && (
          <div style={{ color: '#64748b', fontSize: 10, marginTop: 5, overflowWrap: 'anywhere' }}>
            App: {session.packageName}
          </div>
        )}
        {session?.targets?.length > 0 && (
          <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 3 }}>
            {session.targets.map((target, index) => (
              <div key={`${target}-${index}`} style={{ color: '#a5b4fc', fontSize: 10, overflowWrap: 'anywhere' }}>
                Watching: “{target}”
              </div>
            ))}
          </div>
        )}
        {session?.matches?.length > 0 && (
          <div style={{ marginTop: 8, borderTop: '1px solid #293548', paddingTop: 7 }}>
            <div style={{ color: '#cbd5e1', fontSize: 10, fontWeight: 700, marginBottom: 4 }}>
              Matched bounds ({session.clickedCount || 0}/{session.matches.length} clicked)
            </div>
            {session.matches.map((match, index) => (
              <div key={`${match.text}-${index}`} style={{
                color: match.clicked ? '#34d399' : '#fbbf24',
                fontSize: 10, lineHeight: 1.45, overflowWrap: 'anywhere',
              }}>
                {match.clicked ? '✓' : '•'} “{match.text}” · {Math.round(match.bounds.left)},{Math.round(match.bounds.top)}–{Math.round(match.bounds.right)},{Math.round(match.bounds.bottom)}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ color: '#64748b', fontSize: 10, lineHeight: 1.45 }}>
        Matching is case-insensitive and finds your phrase inside longer labels. Each matching bound is tapped once. Installer, permission, destructive, payment, and generic confirmation labels are blocked. The backend watcher expires after 5 minutes.
      </div>

      {error && (
        <div role="alert" style={{ color: '#fca5a5', background: 'rgba(127,29,29,.25)', border: '1px solid rgba(248,113,113,.25)', borderRadius: 7, padding: 8, fontSize: 11 }}>
          {error}
        </div>
      )}
    </div>
  );
}
