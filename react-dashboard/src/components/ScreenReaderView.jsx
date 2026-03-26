import React, { useState, useRef, useEffect, useCallback } from 'react';

const PHONE_W = 360;
const PHONE_H = 780;

export default function ScreenReaderView({ device, sendCommand, results }) {
  const deviceId = device.deviceId;
  const isOnline = device.isOnline;
  const info     = device.deviceInfo || {};

  const [streaming, setStreaming]           = useState(false);
  const [streamInterval, setStreamInterval] = useState(2000);
  const [savedCaptures, setSavedCaptures]   = useState([]);
  const [viewCapture, setViewCapture]       = useState(null);
  const [activeView, setActiveView]         = useState('visual');
  const [touchHint, setTouchHint]           = useState(null);
  const [pasteText, setPasteText]           = useState('');
  const [showPaste, setShowPaste]           = useState(false);
  const streamTimer = useRef(null);

  const devW   = info.screenWidth  || 1080;
  const devH   = info.screenHeight || 2340;
  const scaleX = PHONE_W / devW;
  const scaleY = PHONE_H / devH;

  const latestScreenResult = results
    .filter(r => r.command === 'read_screen' && r.success && r.response)
    .slice(0, 1)[0];

  let screenData = null;
  try {
    const parsed = typeof latestScreenResult?.response === 'string'
      ? JSON.parse(latestScreenResult.response)
      : latestScreenResult?.response;
    screenData = parsed?.screen || null;
  } catch (_) {}

  const startStreaming = useCallback(() => {
    if (streamTimer.current) clearInterval(streamTimer.current);
    sendCommand(deviceId, 'read_screen');
    streamTimer.current = setInterval(() => sendCommand(deviceId, 'read_screen'), streamInterval);
    setStreaming(true);
  }, [deviceId, sendCommand, streamInterval]);

  const stopStreaming = useCallback(() => {
    if (streamTimer.current) clearInterval(streamTimer.current);
    streamTimer.current = null;
    setStreaming(false);
  }, []);

  useEffect(() => {
    return () => { if (streamTimer.current) clearInterval(streamTimer.current); };
  }, []);

  useEffect(() => {
    if (streaming) { stopStreaming(); startStreaming(); }
  }, [streamInterval]);

  const captureOnce = () => sendCommand(deviceId, 'read_screen');

  const saveCapture = () => {
    if (!screenData) return;
    const text = buildTextDump(screenData);
    const cap  = { id: Date.now(), text, packageName: screenData.packageName, timestamp: new Date().toLocaleString(), elementCount: (screenData.elements || []).length };
    setSavedCaptures(prev => [cap, ...prev]);
    sendCommand(deviceId, 'write_file', { filePath: `/sdcard/screen_reader/capture_${Date.now()}.txt`, content: text, isBase64: false });
  };

  const downloadCapture = (cap) => {
    const blob = new Blob([cap.text], { type: 'text/plain' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `screen_${cap.id}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleElementClick = (el) => {
    if (!el.bounds || !isOnline) return;
    const cx = (el.bounds.left + el.bounds.right) / 2;
    const cy = (el.bounds.top  + el.bounds.bottom) / 2;
    setTouchHint({ x: cx * scaleX, y: cy * scaleY });
    sendCommand(deviceId, 'touch', { x: Math.round(cx), y: Math.round(cy), duration: 100 });
    setTimeout(() => setTouchHint(null), 600);
  };

  const handlePaste = () => {
    if (!pasteText.trim()) return;
    sendCommand(deviceId, 'input_text', { text: pasteText });
    setPasteText('');
    setShowPaste(false);
  };

  const navBtn = (label, cmd, icon) => (
    <button className="sc-nav-btn" onClick={() => sendCommand(deviceId, cmd)} disabled={!isOnline}>
      {icon} {label}
    </button>
  );

  const elements   = screenData?.elements || [];
  const visibleEls = elements.filter(el => el.text || el.contentDescription);

  const renderVisualView = () => (
    <div
      className="sc-phone-screen-wrap"
      style={{ width: PHONE_W, height: PHONE_H, position: 'relative', overflow: 'hidden', background: screenData ? '#000' : '#0f172a', borderRadius: 8 }}
    >
      {!screenData && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8' }}>
          <div style={{ fontSize: 36 }}>📺</div>
          <div style={{ fontSize: 12, marginTop: 8 }}>{streaming ? 'Waiting for screen data…' : 'Press Read or Stream'}</div>
        </div>
      )}
      {screenData && (
        <>
          <div className="sr-phone-status-bar">
            <span>{screenData.packageName?.split('.').pop() || 'App'}</span>
            <span style={{ marginLeft: 'auto' }}>
              {new Date().getHours()}:{String(new Date().getMinutes()).padStart(2, '0')}
            </span>
          </div>
          {visibleEls.map((el, i) => {
            if (!el.bounds) return null;
            const left   = el.bounds.left   * scaleX;
            const top    = (el.bounds.top   * scaleY) + 20;
            const width  = (el.bounds.right - el.bounds.left) * scaleX;
            const height = (el.bounds.bottom - el.bounds.top) * scaleY;
            if (width < 1 || height < 1) return null;
            return (
              <div
                key={i}
                className={`sr-el-box ${el.clickable ? 'clickable' : ''} ${el.editable ? 'editable' : ''}`}
                style={{ position: 'absolute', left, top, width, height }}
                onClick={() => el.clickable && handleElementClick(el)}
                title={el.text || el.contentDescription}
              >
                {height > 12 && (
                  <span className="sr-el-label" style={{ fontSize: Math.min(height * 0.4, 9) }}>
                    {(el.text || el.contentDescription || '').slice(0, 20)}
                  </span>
                )}
              </div>
            );
          })}
          {touchHint && (
            <div className="sr-touch-ripple" style={{ left: touchHint.x - 12, top: touchHint.y - 12 }} />
          )}
        </>
      )}
    </div>
  );

  const renderElementsView = () => (
    <div className="sr-elements-panel" style={{ width: PHONE_W, minHeight: PHONE_H }}>
      {!screenData && <div className="sr-placeholder">No screen data — press Read Screen</div>}
      {screenData && (
        <>
          <div className="sr-meta-bar">
            <span className="sr-pkg-badge">{screenData.packageName || '—'}</span>
            <span style={{ color: '#94a3b8', fontSize: 12 }}>{visibleEls.length} elements</span>
          </div>
          <div className="sr-elements-list">
            {visibleEls.map((el, i) => {
              const cls = (el.className || '').split('.').pop();
              return (
                <div key={i} className="sr-element" style={{ paddingLeft: Math.min((el.depth || 0), 8) * 10 + 8 }}>
                  <div className="sr-el-class">{cls}</div>
                  {el.text && <div className="sr-el-text">"{el.text}"</div>}
                  {el.contentDescription && !el.text && <div className="sr-el-desc">[{el.contentDescription}]</div>}
                  <div className="sr-el-tags">
                    {el.clickable && <span className="sr-tag sr-tag-click">clickable</span>}
                    {el.editable  && <span className="sr-tag sr-tag-edit">editable</span>}
                    {el.selected  && <span className="sr-tag sr-tag-sel">selected</span>}
                    {el.bounds    && <span className="sr-tag" style={{ background: 'transparent', color: '#475569' }}>{Math.round(el.bounds.left)},{Math.round(el.bounds.top)}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div className="screen-control">

      <div className="sc-layout">
        <div className="sc-viewer-col">

          {/* ── View Tabs ── */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button
              className={`sr-vtab ${activeView === 'visual' ? 'active' : ''}`}
              onClick={() => setActiveView('visual')}
            >
              📱 Visual
            </button>
            <button
              className={`sr-vtab ${activeView === 'elements' ? 'active' : ''}`}
              onClick={() => setActiveView('elements')}
            >
              🌳 Elements
            </button>
            {screenData && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b', alignSelf: 'center' }}>
                {screenData.packageName?.split('.').pop()}
                {streaming && <span style={{ color: '#22c55e', marginLeft: 6 }}>● live</span>}
              </span>
            )}
          </div>

          {/* ── Phone Frame ── */}
          <div className="sc-phone-frame-wrap">
            <div className="sc-phone-bezel" style={{ width: PHONE_W + 32, paddingTop: 24, paddingBottom: 18, borderRadius: 32 }}>
              <div className="sc-phone-notch" />
              <div style={{ width: PHONE_W, overflow: 'hidden', borderRadius: 8 }}>
                {activeView === 'visual'   && renderVisualView()}
                {activeView === 'elements' && renderElementsView()}
              </div>
              <div className="sc-phone-home-bar-sc" />
            </div>
          </div>

          {/* ── Info bar ── */}
          {screenData && (
            <div className="sr-info-bar" style={{ marginTop: 4 }}>
              <span style={{ color: '#7c3aed' }}>{screenData.packageName}</span>
              <span style={{ color: '#94a3b8' }}>{elements.length} nodes · {visibleEls.length} visible</span>
              {latestScreenResult?.time && <span style={{ color: '#64748b' }}>{latestScreenResult.time.toLocaleTimeString?.()}</span>}
            </div>
          )}

          {/* ── Stream Controls ── */}
          <div className="sc-controls" style={{ marginTop: 8 }}>
            {!streaming ? (
              <button className="sc-btn sc-btn-start" onClick={startStreaming} disabled={!isOnline}>
                📡 Start Stream
              </button>
            ) : (
              <button className="sc-btn sc-btn-stop" onClick={stopStreaming}>
                ⏹ Stop Stream
              </button>
            )}
            <select
              value={streamInterval}
              onChange={e => setStreamInterval(Number(e.target.value))}
              style={{ background: '#1a1a2e', color: '#f0f0ff', border: '1px solid #2d2d4e', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}
              disabled={!isOnline}
            >
              <option value={500}>0.5s</option>
              <option value={1000}>1s</option>
              <option value={2000}>2s</option>
              <option value={3000}>3s</option>
              <option value={5000}>5s</option>
            </select>
            <button className="sc-btn" style={{ background: '#1e1b4b', border: '1px solid #4c1d95', color: '#a78bfa' }} onClick={captureOnce} disabled={!isOnline}>
              📷 Read Once
            </button>
          </div>

          {/* ── Navigation ── */}
          <div className="sc-nav-bar">
            <div className="sc-nav-label">Navigation</div>
            <div className="sc-nav-buttons">
              {navBtn('Back',    'press_back',           '◀')}
              {navBtn('Home',    'press_home',           '🏠')}
              {navBtn('Recents', 'press_recents',        '⬜')}
              {navBtn('Notifs',  'open_notifications',   '🔔')}
            </div>
          </div>

          {/* ── Paste text + Enter ── */}
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                style={{ background: '#1e1b4b', border: '1px solid #4c1d95', color: '#a78bfa', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', flex: 1 }}
                onClick={() => setShowPaste(v => !v)}
                disabled={!isOnline}
              >
                📋 Paste Text
              </button>
              <button
                style={{ background: '#1e1b4b', border: '1px solid #4c1d95', color: '#a78bfa', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
                onClick={() => sendCommand(deviceId, 'press_enter')}
                disabled={!isOnline}
                title="Press Enter / IME action key on device"
              >
                ↵ Enter
              </button>
            </div>
            {showPaste && (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  placeholder="Text to paste into device…"
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handlePaste(); }}
                  style={{ flex: 1, background: '#1a1a2e', border: '1px solid #2d2d4e', borderRadius: 6, padding: '5px 8px', color: '#f0f0ff', fontSize: 12 }}
                  autoFocus
                />
                <button
                  onClick={handlePaste}
                  disabled={!pasteText.trim()}
                  style={{ background: '#7c3aed', border: 'none', borderRadius: 6, color: '#fff', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
                >
                  ↵ Send
                </button>
              </div>
            )}
          </div>

          {/* ── Save bar ── */}
          {screenData && (
            <div className="sr-save-bar" style={{ marginTop: 8 }}>
              <button className="sr-btn-save" onClick={saveCapture} disabled={!isOnline}>
                💾 Save Capture
              </button>
              <span style={{ fontSize: 11, color: '#64748b' }}>Saves to /sdcard/screen_reader/</span>
            </div>
          )}
        </div>

        {/* ── Right col: Saved Captures ── */}
        <div className="sc-recordings-col">
          <div className="sc-rec-header">
            <span>💾 Saved Captures ({savedCaptures.length})</span>
          </div>

          {savedCaptures.length === 0 ? (
            <div className="sc-rec-empty">
              <div>💾</div>
              <div>No captures yet</div>
              <div style={{ fontSize: 11 }}>Read a screen and save it</div>
            </div>
          ) : (
            <div className="sc-rec-list">
              {savedCaptures.map(cap => (
                <div key={cap.id} className="sc-rec-item">
                  <div className="sc-rec-info">
                    <div className="sc-rec-name" title={cap.packageName}>{cap.packageName?.split('.').pop() || 'Unknown'}</div>
                    <div className="sc-rec-meta">
                      <span>{cap.elementCount} els</span>
                      <span>{cap.timestamp}</span>
                    </div>
                  </div>
                  <div className="sc-rec-actions">
                    <button className="sc-action-btn sc-view" onClick={() => setViewCapture(cap)} title="View">👁</button>
                    <button className="sc-action-btn sc-dl"  onClick={() => downloadCapture(cap)} title="Download">⬇</button>
                    <button className="sc-action-btn sc-del" onClick={() => setSavedCaptures(p => p.filter(c => c.id !== cap.id))} title="Delete">🗑</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {viewCapture && (
        <div className="modal-overlay" onClick={() => setViewCapture(null)}>
          <div className="modal-box" style={{ maxWidth: 600, maxHeight: '80vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
            <div className="modal-title">📺 {viewCapture.packageName} — {viewCapture.timestamp}</div>
            <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', color: '#94a3b8', maxHeight: 400, overflow: 'auto', background: '#0f0f1a', padding: 12, borderRadius: 8 }}>{viewCapture.text}</pre>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setViewCapture(null)}>Close</button>
              <button className="btn-primary" onClick={() => downloadCapture(viewCapture)}>⬇ Download</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function buildTextDump(screenData) {
  const lines = [];
  lines.push(`=== Screen Capture ===`);
  lines.push(`Package: ${screenData.packageName || 'Unknown'}`);
  lines.push(`Captured: ${new Date().toISOString()}`);
  lines.push(`Elements: ${(screenData.elements || []).length}`);
  lines.push('');
  (screenData.elements || []).forEach(el => {
    if (!el.text && !el.contentDescription) return;
    const indent = '  '.repeat(Math.min(el.depth || 0, 8));
    const cls    = (el.className || '').split('.').pop();
    lines.push(`${indent}[${cls}]`);
    if (el.text) lines.push(`${indent}  Text: "${el.text}"`);
    if (el.contentDescription) lines.push(`${indent}  Desc: ${el.contentDescription}`);
    const attrs = [];
    if (el.clickable) attrs.push('clickable');
    if (el.editable)  attrs.push('editable');
    if (attrs.length) lines.push(`${indent}  (${attrs.join(', ')})`);
    if (el.bounds) lines.push(`${indent}  Bounds: ${JSON.stringify(el.bounds)}`);
  });
  return lines.join('\n');
}
