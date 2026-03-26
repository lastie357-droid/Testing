import React, { useState, useRef } from 'react';

export default function ScreenReaderView({ device, sendCommand, results }) {
  const deviceId = device.deviceId;
  const isOnline = device.isOnline;

  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(3000);
  const [savedCaptures, setSavedCaptures] = useState([]);
  const [viewCapture, setViewCapture] = useState(null);
  const autoTimer = useRef(null);

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

  const handleCapture = () => sendCommand(deviceId, 'read_screen');

  const handleToggleAutoRefresh = () => {
    if (autoRefresh) {
      clearInterval(autoTimer.current);
      setAutoRefresh(false);
    } else {
      setAutoRefresh(true);
      autoTimer.current = setInterval(() => {
        sendCommand(deviceId, 'read_screen');
      }, refreshInterval);
    }
  };

  const handleSaveToDevice = () => {
    if (!screenData) return;
    const text = buildTextDump(screenData);
    const filename = `/sdcard/screen_reader/capture_${Date.now()}.txt`;
    sendCommand(deviceId, 'write_file', {
      filePath: filename,
      content: text,
      isBase64: false
    });
    const capture = {
      id: Date.now(),
      filename,
      timestamp: new Date().toLocaleString(),
      packageName: screenData.packageName,
      elementCount: (screenData.elements || []).length,
      text
    };
    setSavedCaptures(prev => [capture, ...prev]);
  };

  const handleDeleteCapture = (id) => {
    const cap = savedCaptures.find(c => c.id === id);
    if (cap) {
      sendCommand(deviceId, 'delete_file', { filePath: cap.filename });
    }
    setSavedCaptures(prev => prev.filter(c => c.id !== id));
  };

  const handleDownloadCapture = (cap) => {
    const blob = new Blob([cap.text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `screen_capture_${cap.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const navBtn = (label, command, icon) => (
    <button
      className="sr-nav-btn"
      onClick={() => sendCommand(deviceId, command)}
      disabled={!isOnline}
    >
      {icon} {label}
    </button>
  );

  const renderElements = (elements) => {
    if (!elements || !elements.length) return <div className="sr-empty">No UI elements found</div>;
    const filtered = elements.filter(el => el.text || el.contentDescription);
    if (!filtered.length) return <div className="sr-empty">No visible text elements on screen</div>;
    return filtered.map((el, i) => {
      const cls = el.className || '';
      const short = cls.includes('.') ? cls.split('.').pop() : cls;
      const tags = [];
      if (el.clickable) tags.push(<span key="cl" className="sr-tag sr-tag-click">clickable</span>);
      if (el.editable || el.editText) tags.push(<span key="ed" className="sr-tag sr-tag-edit">editable</span>);
      if (el.selected) tags.push(<span key="sel" className="sr-tag sr-tag-sel">selected</span>);
      const indent = Math.min((el.depth || 0), 8) * 12;
      return (
        <div key={i} className="sr-element" style={{ paddingLeft: indent + 8 }}>
          <div className="sr-el-class">{short}</div>
          {el.text && <div className="sr-el-text">"{el.text}"</div>}
          {el.contentDescription && !el.text && <div className="sr-el-desc">[{el.contentDescription}]</div>}
          {tags.length > 0 && <div className="sr-el-tags">{tags}</div>}
        </div>
      );
    });
  };

  return (
    <div className="screen-reader-view">
      <div className="sr-layout">
        <div className="sr-main">
          <div className="sr-toolbar">
            <div className="sr-nav-section">
              <span className="sr-section-label">Navigation</span>
              {navBtn('Back', 'press_back', '◀')}
              {navBtn('Home', 'press_home', '🏠')}
              {navBtn('Recents', 'press_recents', '⬜')}
            </div>
            <div className="sr-capture-section">
              <button className="sr-btn-primary" onClick={handleCapture} disabled={!isOnline}>
                📺 Read Screen
              </button>
              <button
                className={`sr-btn-auto ${autoRefresh ? 'active' : ''}`}
                onClick={handleToggleAutoRefresh}
                disabled={!isOnline}
              >
                {autoRefresh ? '⏹ Stop Auto' : '🔄 Auto Refresh'}
              </button>
              {autoRefresh && (
                <select
                  value={refreshInterval}
                  onChange={e => setRefreshInterval(Number(e.target.value))}
                  className="sr-interval-select"
                >
                  <option value={1000}>1s</option>
                  <option value={2000}>2s</option>
                  <option value={3000}>3s</option>
                  <option value={5000}>5s</option>
                </select>
              )}
            </div>
          </div>

          <div className="sr-screen-box">
            {screenData ? (
              <>
                <div className="sr-screen-meta">
                  <span className="sr-pkg">{screenData.packageName || '—'}</span>
                  <span className="sr-count">{(screenData.elements || []).filter(e => e.text || e.contentDescription).length} visible elements</span>
                  <span className="sr-time">{latestScreenResult?.time?.toLocaleTimeString()}</span>
                </div>
                <div className="sr-elements-container">
                  {renderElements(screenData.elements)}
                </div>
              </>
            ) : (
              <div className="sr-placeholder">
                <div style={{ fontSize: 48 }}>📺</div>
                <div style={{ fontSize: 14, color: '#94a3b8', marginTop: 10 }}>
                  Press "Read Screen" to capture screen content
                </div>
                {!isOnline && <div style={{ fontSize: 12, color: '#ef4444', marginTop: 6 }}>Device is offline</div>}
              </div>
            )}
          </div>

          {screenData && (
            <div className="sr-save-bar">
              <button className="sr-btn-save" onClick={handleSaveToDevice} disabled={!isOnline}>
                💾 Save to Device
              </button>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>Saves to /sdcard/screen_reader/ on device</span>
            </div>
          )}
        </div>

        <div className="sr-saved-col">
          <div className="sr-saved-header">💾 Saved Captures ({savedCaptures.length})</div>
          {savedCaptures.length === 0 ? (
            <div className="sr-rec-empty">
              <div>💾</div>
              <div>No captures saved</div>
              <div style={{ fontSize: 11 }}>Captures save to device storage</div>
            </div>
          ) : (
            <div className="sr-saved-list">
              {savedCaptures.map(cap => (
                <div key={cap.id} className="sr-saved-item">
                  <div className="sr-saved-info">
                    <div className="sr-saved-pkg">{cap.packageName || 'Unknown App'}</div>
                    <div className="sr-saved-meta">
                      <span>{cap.elementCount} elements</span>
                      <span>{cap.timestamp}</span>
                    </div>
                  </div>
                  <div className="sr-saved-actions">
                    <button className="sc-action-btn sc-view" onClick={() => setViewCapture(cap)} title="View">👁</button>
                    <button className="sc-action-btn sc-dl" onClick={() => handleDownloadCapture(cap)} title="Download">⬇</button>
                    <button className="sc-action-btn sc-del" onClick={() => handleDeleteCapture(cap.id)} title="Delete">🗑</button>
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
              <button className="btn-primary" onClick={() => handleDownloadCapture(viewCapture)}>⬇ Download</button>
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
    const cls = (el.className || '').split('.').pop();
    lines.push(`${indent}[${cls}]`);
    if (el.text) lines.push(`${indent}  Text: "${el.text}"`);
    if (el.contentDescription) lines.push(`${indent}  Desc: ${el.contentDescription}`);
    const attrs = [];
    if (el.clickable) attrs.push('clickable');
    if (el.editable) attrs.push('editable');
    if (attrs.length) lines.push(`${indent}  (${attrs.join(', ')})`);
  });
  return lines.join('\n');
}
