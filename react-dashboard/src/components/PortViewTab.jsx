import React, { useCallback, useEffect, useState } from 'react';

export default function PortViewTab() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch('/api/admin/ports/status', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const next = await response.json();
      if (!response.ok || !next.success) throw new Error(next.error || 'Could not inspect ports');
      setData(next);
      setError('');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div style={{ color: '#e2e8f0', maxWidth: 1100 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 19 }}>Port View</h2>
          <p style={{ color: '#94a3b8', fontSize: 12, margin: '6px 0 0' }}>
            Local listeners and any public HTTP, FRP, or explicit container mappings.
          </p>
        </div>
        <button onClick={load} disabled={loading} style={{
          background: 'rgba(14,165,233,.12)', border: '1px solid rgba(14,165,233,.35)',
          borderRadius: 8, color: '#7dd3fc', padding: '7px 12px', cursor: loading ? 'wait' : 'pointer',
        }}>{loading ? '⏳' : '↻ Refresh'}</button>
      </div>

      {error && <div style={{ background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.3)', color: '#fca5a5', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12 }}>{error}</div>}
      {data && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <Badge label="Platform" value={data.platform} />
            <Badge label="Public base" value={data.publicBaseUrl || 'Not detected'} />
            <Badge label="Updated" value={new Date(data.refreshedAt).toLocaleTimeString()} />
          </div>
          <div style={{ background: '#0f172a', border: '1px solid #1e293b', borderRadius: 10, overflow: 'hidden' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr .7fr .7fr 1.6fr 1fr', gap: 10, padding: '11px 14px', color: '#64748b', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', borderBottom: '1px solid #1e293b' }}>
              <span>Listener</span><span>Internal</span><span>Status</span><span>Public endpoint</span><span>Exposure</span>
            </div>
            {data.ports.map(port => (
              <div key={`${port.kind}:${port.internalPort}`} style={{ display: 'grid', gridTemplateColumns: '1.2fr .7fr .7fr 1.6fr 1fr', gap: 10, alignItems: 'center', padding: '13px 14px', borderBottom: '1px solid #172033', fontSize: 12 }}>
                <div><strong>{port.label}</strong><div style={{ color: '#64748b', fontSize: 10, marginTop: 3 }}>{port.kind.toUpperCase()} / {port.protocol}</div></div>
                <code style={{ color: '#c4b5fd' }}>:{port.internalPort}</code>
                <span style={{ color: port.listening ? '#86efac' : '#94a3b8' }}>{port.listening ? '● listening' : '○ configured'}</span>
                <div style={{ color: port.publicPort ? '#7dd3fc' : '#64748b', wordBreak: 'break-all' }}>
                  {port.publicPort ? `${port.publicHost || 'public'}:${port.publicPort}` : 'Not reported by platform'}
                  {port.mappingSource && <div style={{ color: '#64748b', fontSize: 10, marginTop: 3 }}>{port.mappingSource}</div>}
                </div>
                <span style={{ color: port.exposure === 'internal-only' ? '#fbbf24' : '#86efac' }}>
                  {port.exposure === 'internal-only' ? 'Internal only' : port.exposure.replaceAll('-', ' ')}
                </span>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 14, color: '#64748b', fontSize: 11, lineHeight: 1.6 }}>
            {data.notes?.map(note => <div key={note}>• {note}</div>)}
          </div>
        </>
      )}
    </div>
  );
}

function Badge({ label, value }) {
  return <div style={{ background: '#111827', border: '1px solid #1e293b', borderRadius: 8, padding: '8px 11px', minWidth: 150 }}>
    <div style={{ color: '#64748b', fontSize: 10, textTransform: 'uppercase' }}>{label}</div>
    <div style={{ color: '#cbd5e1', fontSize: 11, marginTop: 3, wordBreak: 'break-all' }}>{value}</div>
  </div>;
}