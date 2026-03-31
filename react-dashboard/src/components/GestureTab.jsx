import React, { useState, useEffect, useRef, useCallback } from 'react';

const COLORS = ['#00ff88', '#00ccff', '#ff6b35', '#ffd700', '#cc77ff'];

function GesturePreview({ gesture, width = 200, height = 160, live = false }) {
  if (!gesture || !gesture.points || gesture.points.length === 0) {
    return (
      <div style={{ width, height, background: '#0f172a', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 12 }}>
        {live ? 'Waiting for touch…' : 'No points'}
      </div>
    );
  }
  const points = gesture.points;
  const pointers = {};
  points.forEach(p => {
    if (!pointers[p.id]) pointers[p.id] = [];
    pointers[p.id].push(p);
  });
  const pad = 10;
  const vb = `0 0 ${width} ${height}`;

  return (
    <svg width={width} height={height} viewBox={vb} style={{ background: '#0f172a', borderRadius: 8, display: 'block', border: live ? '1px solid #22c55e' : '1px solid #1e293b' }}>
      <rect width={width} height={height} fill="#0f172a" rx="8" />
      {Object.entries(pointers).map(([pid, pts], idx) => {
        if (pts.length < 2) {
          const p = pts[0];
          if (!p) return null;
          const cx = (p.nx * (width - pad * 2) + pad).toFixed(1);
          const cy = (p.ny * (height - pad * 2) + pad).toFixed(1);
          return <circle key={pid} cx={cx} cy={cy} r="5" fill={COLORS[idx % COLORS.length]} opacity="0.9" />;
        }
        const color = COLORS[idx % COLORS.length];
        const d = pts.map((p, i) =>
          `${i === 0 ? 'M' : 'L'}${(p.nx * (width - pad * 2) + pad).toFixed(1)},${(p.ny * (height - pad * 2) + pad).toFixed(1)}`
        ).join(' ');
        return (
          <g key={pid}>
            <path d={d} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
            <circle cx={(pts[0].nx * (width - pad * 2) + pad).toFixed(1)} cy={(pts[0].ny * (height - pad * 2) + pad).toFixed(1)} r="5" fill={color} opacity="0.9" />
            <circle cx={(pts[pts.length-1].nx * (width - pad * 2) + pad).toFixed(1)} cy={(pts[pts.length-1].ny * (height - pad * 2) + pad).toFixed(1)} r="4" fill="none" stroke={color} strokeWidth="2" opacity="0.9" />
          </g>
        );
      })}
      {live && (
        <text x={width - 6} y={16} textAnchor="end" fontSize="10" fill="#22c55e" fontFamily="monospace">● LIVE</text>
      )}
    </svg>
  );
}

export default function GestureTab({ device, sendCommand, results }) {
  const deviceId = device?.deviceId;
  const isOnline = device?.isOnline;

  const [gestures, setGestures]             = useState([]);
  const [loading, setLoading]               = useState(false);
  const [isRecording, setIsRecording]       = useState(false);
  const [isPaused, setIsPaused]             = useState(false);
  const [livePoints, setLivePoints]         = useState(null);
  const [selectedGesture, setSelected]      = useState(null);
  const [selectedData, setSelectedData]     = useState(null);
  const [showRecordForm, setShowRecordForm] = useState(false);
  const [showLiveForm, setShowLiveForm]     = useState(false);
  const [recordPkg, setRecordPkg]           = useState('');
  const [recordLabel, setRecordLabel]       = useState('');
  const [liveLabel, setLiveLabel]           = useState('');
  const [statusMsg, setStatusMsg]           = useState('');
  const [replayingFile, setReplayingFile]   = useState(null);
  const [showRecords, setShowRecords]       = useState(false);
  const seenResults = useRef(new Set());
  const pollRef     = useRef(null);
  const livePollRef = useRef(null);

  // Remote draw canvas state
  const [showRemoteDraw, setShowRemoteDraw] = useState(false);
  const drawRef = useRef(null);
  const drawingRef = useRef(false);
  const drawStartRef = useRef(null);
  const drawPathRef = useRef([]);
  const [drawLines, setDrawLines] = useState([]);

  const status = msg => setStatusMsg(msg);

  const sendCmd = useCallback((cmd, params = {}) => {
    if (deviceId) sendCommand(deviceId, cmd, params);
  }, [deviceId, sendCommand]);

  const loadList = useCallback(() => {
    setLoading(true);
    sendCmd('gesture_list');
  }, [sendCmd]);

  useEffect(() => { loadList(); }, []);

  // Poll recording status every 2s
  useEffect(() => {
    if (isRecording) {
      pollRef.current = setInterval(() => sendCmd('gesture_status'), 2000);
    } else {
      clearInterval(pollRef.current);
    }
    return () => clearInterval(pollRef.current);
  }, [isRecording, sendCmd]);

  // Poll live points every 500ms during recording for live preview
  useEffect(() => {
    if (isRecording) {
      livePollRef.current = setInterval(() => sendCmd('gesture_get_live'), 500);
    } else {
      clearInterval(livePollRef.current);
      if (!isRecording) setLivePoints(null);
    }
    return () => clearInterval(livePollRef.current);
  }, [isRecording, sendCmd]);

  // Process command results
  useEffect(() => {
    if (!results || results.length === 0) return;
    results.forEach(r => {
      if (seenResults.current.has(r.id)) return;
      seenResults.current.add(r.id);
      let data;
      try { data = typeof r.response === 'string' ? JSON.parse(r.response) : r.response; }
      catch (_) { return; }
      if (!data) return;

      if (r.command === 'gesture_list') {
        setLoading(false);
        if (data.success && data.gestures) setGestures(data.gestures);
      }
      if (r.command === 'gesture_start_record') {
        if (data.success) { setIsRecording(true); setIsPaused(false); setLivePoints(null); status('Recording started — draw on device screen'); }
        else              { status('Error: ' + (data.error || 'Failed')); }
      }
      if (r.command === 'gesture_stop_record') {
        setIsRecording(false); setIsPaused(false); setLivePoints(null);
        if (data.success) { status('Saved: ' + (data.result?.filename || '')); loadList(); }
        else              { status('Error: ' + (data.error || 'Failed to save')); }
      }
      if (r.command === 'gesture_cancel_record') {
        setIsRecording(false); setIsPaused(false); setLivePoints(null);
        status('Recording cancelled');
      }
      if (r.command === 'gesture_pause_record') {
        if (data.success) { setIsPaused(true); status('Recording paused'); }
        else              { status('Error: ' + (data.error || '')); }
      }
      if (r.command === 'gesture_resume_record') {
        if (data.success) { setIsPaused(false); status('Recording resumed'); }
        else              { status('Error: ' + (data.error || '')); }
      }
      if (r.command === 'gesture_status') {
        if (data.success) { setIsRecording(!!data.recording); setIsPaused(!!data.paused); }
      }
      if (r.command === 'gesture_get_live') {
        if (data.success) {
          setIsRecording(!!data.recording);
          setIsPaused(!!data.paused);
          setLivePoints(data.recording ? { points: data.points || [], screenW: data.screenW, screenH: data.screenH } : null);
        }
      }
      if (r.command === 'gesture_get') {
        if (data.success && data.gesture) setSelectedData(data.gesture);
      }
      if (r.command === 'gesture_replay') {
        setReplayingFile(null);
        status(data.success ? `Replayed: ${data.filename} (${data.pointCount} pts)` : 'Replay failed: ' + (data.error || ''));
      }
      if (r.command === 'gesture_delete') {
        if (data.success) {
          setGestures(prev => prev.filter(g => g.filename !== data.filename));
          if (selectedGesture === data.filename) { setSelected(null); setSelectedData(null); }
          status('Deleted');
        }
      }
    });
  }, [results]);

  function startRecord() {
    if (!recordLabel.trim()) { status('Enter a label for the gesture'); return; }
    sendCmd('gesture_start_record', { packageId: recordPkg.trim() || 'unknown', label: recordLabel.trim() });
    setShowRecordForm(false);
    status('Starting recording…');
  }

  function startLiveRecord() {
    if (!liveLabel.trim()) { status('Enter a label for the live recording'); return; }
    sendCmd('gesture_start_record', { packageId: 'live', label: liveLabel.trim() });
    setShowLiveForm(false);
    setLiveLabel('');
    status('Starting live recording — perform gestures on device');
  }

  function stopRecord() {
    sendCmd('gesture_stop_record');
    status('Stopping and saving…');
  }

  function pauseRecord() {
    sendCmd('gesture_pause_record');
  }

  function resumeRecord() {
    sendCmd('gesture_resume_record');
  }

  function cancelRecord() {
    sendCmd('gesture_cancel_record');
  }

  function replay(filename) {
    setReplayingFile(filename);
    sendCmd('gesture_replay', { filename });
    status(`Replaying ${filename}…`);
  }

  function selectGesture(g) {
    setSelected(g.filename);
    setSelectedData(null);
    sendCmd('gesture_get', { filename: g.filename });
  }

  function deleteGesture(filename) {
    if (window.confirm(`Delete gesture "${filename}"?`)) {
      sendCmd('gesture_delete', { filename });
    }
  }

  // ── Remote draw canvas ──────────────────────────────────────────────────
  const handleDrawPointerDown = useCallback((e) => {
    if (!isOnline) return;
    e.preventDefault();
    drawingRef.current = true;
    drawStartRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    drawPathRef.current = [{ x: e.clientX, y: e.clientY }];
    setDrawLines(prev => [...prev, [{ x: e.clientX, y: e.clientY }]]);
  }, [isOnline]);

  const handleDrawPointerMove = useCallback((e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    drawPathRef.current.push({ x: e.clientX, y: e.clientY });
    setDrawLines(prev => {
      const lines = [...prev];
      lines[lines.length - 1] = [...drawPathRef.current];
      return lines;
    });
  }, []);

  const handleDrawPointerUp = useCallback((e) => {
    if (!drawingRef.current || !drawRef.current) return;
    e.preventDefault();
    drawingRef.current = false;
    const rect = drawRef.current.getBoundingClientRect();
    const path = drawPathRef.current;
    const devInfo = device?.deviceInfo || {};
    const devW = devInfo.screenWidth || 1080;
    const devH = devInfo.screenHeight || 2340;

    if (path.length === 1) {
      // Single tap
      const px = (path[0].x - rect.left) / rect.width;
      const py = (path[0].y - rect.top) / rect.height;
      sendCmd('touch', { x: Math.round(px * devW), y: Math.round(py * devH), duration: 100 });
    } else {
      // Swipe/drag
      const from = path[0];
      const to   = path[path.length - 1];
      const dur  = Math.max(100, Math.min(Date.now() - drawStartRef.current.t, 1000));
      sendCmd('swipe', {
        x1: Math.round((from.x - rect.left) / rect.width * devW),
        y1: Math.round((from.y - rect.top)  / rect.height * devH),
        x2: Math.round((to.x   - rect.left) / rect.width * devW),
        y2: Math.round((to.y   - rect.top)  / rect.height * devH),
        duration: dur,
      });
    }
    drawPathRef.current = [];
    setTimeout(() => setDrawLines([]), 600);
  }, [isOnline, sendCmd, device]);

  const formatDur = ms => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  const formatTime = ms => ms ? new Date(ms).toLocaleString() : '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: 'system-ui,sans-serif', color: '#e2e8f0', background: '#0f172a' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid #1e293b', background: '#0f172a' }}>
        <span style={{ fontSize: 22 }}>✋</span>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Gesture Recorder</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>Record, store and replay touch gestures per app</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {isRecording && (
            <span style={{
              background: isPaused ? '#78350f22' : '#ef444422',
              border: `1px solid ${isPaused ? '#f59e0b' : '#ef4444'}`,
              color: isPaused ? '#f59e0b' : '#ef4444',
              borderRadius: 6, padding: '4px 10px', fontSize: 12, fontWeight: 700,
              animation: isPaused ? 'none' : 'pulse 1s infinite',
            }}>
              {isPaused ? '⏸ PAUSED' : '● RECORDING'}
            </span>
          )}
          <button
            onClick={() => { setShowRecords(true); loadList(); }}
            disabled={!isOnline}
            style={{ ...btnStyle('#1d4ed8'), display: 'flex', alignItems: 'center', gap: 5 }}
          >
            📋 View Records ({gestures.length})
          </button>
          <button onClick={loadList} disabled={!isOnline || loading} style={btnStyle('#334155')}>
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Status bar */}
      {statusMsg && (
        <div style={{ padding: '8px 18px', background: '#1e293b', fontSize: 12, color: '#94a3b8', borderBottom: '1px solid #1e293b' }}>
          {statusMsg}
        </div>
      )}

      <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>

        {/* Left: gesture list + controls */}
        <div style={{ width: 310, borderRight: '1px solid #1e293b', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Record controls */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #1e293b' }}>
            {!isRecording && !showRecordForm && !showLiveForm && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button onClick={() => setShowLiveForm(true)} disabled={!isOnline} style={{ ...btnStyle('#0e7490'), width: '100%', fontWeight: 700 }}>
                  ⚡ Live Record
                </button>
                <button onClick={() => setShowRecordForm(true)} disabled={!isOnline} style={{ ...btnStyle('#16a34a'), width: '100%', fontWeight: 700 }}>
                  ⏺ Record with Package
                </button>
                <button
                  onClick={() => setShowRemoteDraw(v => !v)}
                  disabled={!isOnline}
                  style={{ ...btnStyle(showRemoteDraw ? '#7c3aed' : '#334155'), width: '100%' }}
                >
                  🖊 {showRemoteDraw ? 'Hide Remote Draw' : 'Remote Draw on Device'}
                </button>
              </div>
            )}
            {showLiveForm && !isRecording && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 11, color: '#7dd3fc', fontWeight: 600, marginBottom: 2 }}>
                  ⚡ Live Record — records any gesture on device
                </div>
                <input
                  placeholder="Label (e.g. swipe_unlock)"
                  value={liveLabel}
                  onChange={e => setLiveLabel(e.target.value)}
                  style={inputStyle}
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && startLiveRecord()}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={startLiveRecord} disabled={!isOnline} style={{ ...btnStyle('#0e7490'), flex: 1 }}>⚡ Start</button>
                  <button onClick={() => setShowLiveForm(false)} style={{ ...btnStyle('#334155'), flex: 1 }}>Cancel</button>
                </div>
              </div>
            )}
            {showRecordForm && !isRecording && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  placeholder="Package ID (e.g. com.android.phone)"
                  value={recordPkg}
                  onChange={e => setRecordPkg(e.target.value)}
                  style={inputStyle}
                />
                <input
                  placeholder="Label (e.g. unlock_pattern)"
                  value={recordLabel}
                  onChange={e => setRecordLabel(e.target.value)}
                  style={inputStyle}
                  onKeyDown={e => e.key === 'Enter' && startRecord()}
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={startRecord} disabled={!isOnline} style={{ ...btnStyle('#16a34a'), flex: 1 }}>⏺ Record</button>
                  <button onClick={() => setShowRecordForm(false)} style={{ ...btnStyle('#334155'), flex: 1 }}>Cancel</button>
                </div>
              </div>
            )}
            {isRecording && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ fontSize: 12, color: isPaused ? '#fbbf24' : '#fca5a5', textAlign: 'center', fontWeight: 600 }}>
                  {isPaused ? '⏸ Paused — tap Resume to continue' : 'Draw on the device screen now'}
                </div>
                {/* Live preview */}
                <div style={{ display: 'flex', justifyContent: 'center' }}>
                  <GesturePreview gesture={livePoints} width={260} height={160} live />
                </div>
                {livePoints && (
                  <div style={{ fontSize: 10, color: '#64748b', textAlign: 'center' }}>
                    {livePoints.points?.length || 0} points captured
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button onClick={stopRecord} disabled={!isOnline} style={{ ...btnStyle('#dc2626'), flex: 1, fontWeight: 700 }}>
                    ⏹ Stop &amp; Save
                  </button>
                  {!isPaused
                    ? <button onClick={pauseRecord} disabled={!isOnline} style={{ ...btnStyle('#b45309'), flex: 1 }}>⏸ Pause</button>
                    : <button onClick={resumeRecord} disabled={!isOnline} style={{ ...btnStyle('#16a34a'), flex: 1 }}>▶ Resume</button>
                  }
                  <button onClick={cancelRecord} disabled={!isOnline} style={{ ...btnStyle('#334155'), width: 36, flex: 'none' }} title="Cancel">✕</button>
                </div>
              </div>
            )}
          </div>

          {/* Remote Draw Panel */}
          {showRemoteDraw && !isRecording && (
            <div style={{ padding: '10px 14px', borderBottom: '1px solid #1e293b', background: '#0f1923' }}>
              <div style={{ fontSize: 11, color: '#7dd3fc', fontWeight: 600, marginBottom: 6 }}>
                🖊 Draw here → sends touch/swipe to device
              </div>
              <div
                ref={drawRef}
                onPointerDown={handleDrawPointerDown}
                onPointerMove={handleDrawPointerMove}
                onPointerUp={handleDrawPointerUp}
                onPointerLeave={handleDrawPointerUp}
                style={{
                  width: '100%', height: 140, background: '#0f172a', borderRadius: 8,
                  border: '1px dashed #334155', cursor: isOnline ? 'crosshair' : 'not-allowed',
                  position: 'relative', overflow: 'hidden', touchAction: 'none',
                }}
              >
                <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
                  {drawLines.map((line, i) => {
                    if (line.length < 2) return null;
                    const rect = drawRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
                    const d = line.map((p, j) => `${j === 0 ? 'M' : 'L'}${p.x - rect.left},${p.y - rect.top}`).join(' ');
                    return <path key={i} d={d} fill="none" stroke="#7c3aed" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />;
                  })}
                </svg>
                {!isOnline && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 11 }}>
                    Device offline
                  </div>
                )}
                {isOnline && drawLines.length === 0 && (
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#334155', fontSize: 11, pointerEvents: 'none' }}>
                    Draw here to send gesture
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
                <button onClick={() => setDrawLines([])} style={{ ...btnStyle('#334155'), fontSize: 10, padding: '3px 10px' }}>Clear</button>
              </div>
            </div>
          )}

          {/* Gesture list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {gestures.length === 0 && !loading && (
              <div style={{ padding: 24, textAlign: 'center', color: '#475569', fontSize: 13 }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✋</div>
                No gestures saved yet.<br />Record one to get started.
              </div>
            )}
            {gestures.map(g => (
              <div
                key={g.filename}
                onClick={() => selectGesture(g)}
                style={{
                  padding: '12px 14px', borderBottom: '1px solid #1e293b',
                  cursor: 'pointer',
                  background: selectedGesture === g.filename ? '#1e3a5f' : 'transparent',
                  transition: 'background .15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#e2e8f0' }}>{g.label || '—'}</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{g.packageId || '—'}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      onClick={e => { e.stopPropagation(); replay(g.filename); }}
                      disabled={!isOnline || replayingFile === g.filename}
                      style={{ ...btnStyle('#1d4ed8'), fontSize: 11, padding: '3px 8px' }}
                      title="Replay gesture on device"
                    >
                      {replayingFile === g.filename ? '…' : '▶'}
                    </button>
                    <button
                      onClick={e => { e.stopPropagation(); deleteGesture(g.filename); }}
                      style={{ ...btnStyle('#7f1d1d'), fontSize: 11, padding: '3px 8px' }}
                      title="Delete gesture"
                    >
                      🗑
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, marginTop: 5, fontSize: 11, color: '#64748b' }}>
                  {g.pointCount != null && <span>{g.pointCount} pts</span>}
                  {g.durationMs != null && <span>{formatDur(g.durationMs)}</span>}
                  {g.screenW && <span>{g.screenW}×{g.screenH}</span>}
                </div>
                {g.modifiedMs && <div style={{ fontSize: 10, color: '#334155', marginTop: 3 }}>{formatTime(g.modifiedMs)}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Right: preview + actions */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', padding: 20, gap: 16 }}>
          {!selectedGesture && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>✋</div>
              <div style={{ fontSize: 14 }}>Select a gesture from the list to preview and replay</div>
              <div style={{ fontSize: 12, marginTop: 8, maxWidth: 400, textAlign: 'center', color: '#334155' }}>
                Gestures are stored locally on the device per app package ID. Use ⏺ Record to capture a new gesture — the device will show a recording overlay.
              </div>
            </div>
          )}

          {selectedGesture && (
            <>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Gesture Preview</div>
                  {selectedData
                    ? <GesturePreview gesture={selectedData} width={280} height={220} />
                    : <div style={{ width: 280, height: 220, background: '#1e293b', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', fontSize: 12 }}>Loading…</div>
                  }
                </div>

                {selectedData && (
                  <div style={{ flex: 1, minWidth: 180 }}>
                    <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>Details</div>
                    <div style={{ background: '#1e293b', borderRadius: 8, padding: 14, fontSize: 13 }}>
                      {[
                        ['Label',       selectedData.label],
                        ['Package',     selectedData.packageId],
                        ['Points',      selectedData.points?.length],
                        ['Duration',    selectedData.durationMs != null ? formatDur(selectedData.durationMs) : '—'],
                        ['Recorded on', selectedData.screenW + '×' + selectedData.screenH],
                        ['Recorded at', selectedData.recordedAt ? new Date(selectedData.recordedAt).toLocaleString() : '—'],
                      ].map(([k, v]) => (
                        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #0f172a' }}>
                          <span style={{ color: '#64748b' }}>{k}</span>
                          <span style={{ color: '#e2e8f0', fontFamily: 'monospace', fontSize: 12 }}>{v}</span>
                        </div>
                      ))}
                    </div>

                    <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => replay(selectedGesture)}
                        disabled={!isOnline || replayingFile === selectedGesture}
                        style={{ ...btnStyle('#1d4ed8'), fontWeight: 700, padding: '8px 20px' }}
                      >
                        {replayingFile === selectedGesture ? '⏳ Replaying…' : '▶ Replay on Device'}
                      </button>
                      <button
                        onClick={() => deleteGesture(selectedGesture)}
                        style={{ ...btnStyle('#7f1d1d'), padding: '8px 16px' }}
                      >
                        🗑 Delete
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div style={{ fontSize: 11, color: '#334155', fontFamily: 'monospace' }}>
                {selectedGesture}
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
      `}</style>

      {/* View Records Modal */}
      {showRecords && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }} onClick={e => { if (e.target === e.currentTarget) setShowRecords(false); }}>
          <div style={{
            background: '#1e293b', borderRadius: 14, width: 560, maxWidth: '95vw',
            maxHeight: '80vh', border: '1px solid #334155', display: 'flex', flexDirection: 'column', overflow: 'hidden',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 16px', borderBottom: '1px solid #334155', background: '#162032',
            }}>
              <span style={{ fontWeight: 700, color: '#94a3b8', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
                📋 Recorded Gestures
              </span>
              <span style={{ fontSize: 11, color: '#64748b' }}>{gestures.length} records</span>
              <button onClick={loadList} disabled={loading} style={{ ...btnStyle('#334155'), fontSize: 11, padding: '3px 10px', marginLeft: 4 }}>
                {loading ? '…' : '↻ Refresh'}
              </button>
              <button onClick={() => setShowRecords(false)} style={{ ...btnStyle('#334155'), fontSize: 13, padding: '3px 10px', marginLeft: 'auto' }}>
                ✕ Close
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto' }}>
              {gestures.length === 0 && !loading && (
                <div style={{ padding: 32, textAlign: 'center', color: '#475569', fontSize: 13 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>✋</div>
                  No gestures saved yet.
                </div>
              )}
              {loading && (
                <div style={{ padding: 32, textAlign: 'center', color: '#64748b', fontSize: 13 }}>Loading…</div>
              )}
              {gestures.map(g => (
                <div key={g.filename} style={{
                  padding: '12px 16px', borderBottom: '1px solid #1e293b',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: '#e2e8f0' }}>{g.label || '—'}</div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{g.packageId || '—'}</div>
                    <div style={{ fontSize: 10, color: '#334155', marginTop: 3, fontFamily: 'monospace' }}>{g.filename}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {g.pointCount != null && <span style={{ fontSize: 11, color: '#64748b', alignSelf: 'center' }}>{g.pointCount} pts</span>}
                    <button
                      onClick={() => { replay(g.filename); setShowRecords(false); }}
                      disabled={!isOnline || replayingFile === g.filename}
                      style={{ ...btnStyle('#1d4ed8'), fontSize: 11, padding: '4px 10px' }}
                    >
                      {replayingFile === g.filename ? '…' : '▶ Replay'}
                    </button>
                    <button
                      onClick={() => { selectGesture(g); setShowRecords(false); }}
                      style={{ ...btnStyle('#334155'), fontSize: 11, padding: '4px 10px' }}
                    >
                      👁 View
                    </button>
                    <button
                      onClick={() => { deleteGesture(g.filename); }}
                      style={{ ...btnStyle('#7f1d1d'), fontSize: 11, padding: '4px 10px' }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const btnStyle = bg => ({
  background: bg,
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  padding: '6px 12px',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'inherit',
  transition: 'opacity .15s',
});

const inputStyle = {
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: 6,
  color: '#e2e8f0',
  fontSize: 12,
  padding: '7px 10px',
  width: '100%',
  boxSizing: 'border-box',
  fontFamily: 'monospace',
};
