import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { formatDateTime, formatTime } from '../utils/dateTime.js';
import ScreenInteractionLock from './ScreenInteractionLock.jsx';

const PHONE_W = 360;
const PHONE_H = 780;
const SCREEN_READER_INTERVAL_OPTIONS = [
  { value: 500,  label: '500ms' },
  { value: 850,  label: '850ms' },
  { value: 1000, label: '1 sec' },
  { value: 1500, label: '1.5 sec' },
  { value: 2000, label: '2 sec' },
  { value: 3000, label: '3 sec' },
  { value: 5000, label: '5 sec' },
  { value: 10000, label: '10 sec' },
];

const SETTINGS_PACKAGE = 'com.android.settings';
const MAX_SETTINGS_SWIPES = 8;
const SETTINGS_SCREEN_READ_RETRY_MS = 2000;
const MAX_SETTINGS_SCREEN_READ_RETRIES = 5;
const SETTINGS_HOME_LABELS = [
  'connections',
  'network & internet',
  'connected devices',
  'apps',
  'notifications',
  'battery',
  'storage',
  'sound & vibration',
  'sound and vibration',
  'wallpaper & style',
  'wallpaper and style',
  'security & privacy',
  'security and privacy',
  'accounts and backup',
  'passwords & accounts',
  'digital wellbeing and parental controls',
  'accessibility',
  'general management',
  'system',
  'about phone',
];

function normalizeScreenText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function hasScreenBounds(element) {
  const bounds = element?.bounds;
  return bounds && ['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(Number(bounds[key])));
}

function findScreenElement(elements, target, { allowPrefix = false, contains = false, requireBounds = true } = {}) {
  const expected = normalizeScreenText(target);
  return (elements || [])
    .filter(element => !requireBounds || hasScreenBounds(element))
    .map(element => {
      const labels = [element.text, element.contentDescription, element.hintText].map(normalizeScreenText);
      const exact = labels.some(label => label === expected);
      const matches = labels.some(label => (
        contains
          ? label.includes(expected)
          : exact || (allowPrefix && label.startsWith(`${expected} `))
      ));
      return { element, exact, matches };
    })
    .filter(match => match.matches)
    .sort((a, b) => (
      Number(b.exact) - Number(a.exact)
      || Number(Boolean(b.element.clickable)) - Number(Boolean(a.element.clickable))
    ))
    .map(match => match.element)[0] || null;
}

function getScreenElementLabels(elements) {
  return (elements || [])
    .flatMap(element => [element.text, element.contentDescription, element.hintText])
    .map(normalizeScreenText)
    .filter(Boolean);
}

function hasSettingsScreenEvidence(screen) {
  const labels = getScreenElementLabels(screen?.elements);
  if (labels.some(label => (
    label === 'settings'
    || label.startsWith('search settings')
    || label === 'display'
    || label.startsWith('display ')
    || label.includes('accidental touch protection')
  ))) {
    return true;
  }

  const matchedHomeLabels = SETTINGS_HOME_LABELS.filter(expected => (
    labels.some(label => label === expected || label.startsWith(`${expected} `))
  ));
  return matchedHomeLabels.length >= 2;
}

function parseScreenResponse(result) {
  try {
    const response = typeof result?.response === 'string'
      ? JSON.parse(result.response)
      : result?.response;
    return response?.screen || null;
  } catch (_) {
    return null;
  }
}

export default function ScreenReaderView({
  device,
  sendCommand,
  results,
  screenPushData,
  connected,
  isActive,
  screenBlocked = false,
  setScreenBlocked = () => {},
}) {
  const deviceId = device.deviceId;
  const isOnline = device.isOnline;
  const info     = device.deviceInfo || {};

  const [streaming, setStreaming]           = useState(false);
  const [streamInterval, setStreamInterval] = useState(1000);
  const [savedCaptures, setSavedCaptures]   = useState([]);
  const [viewCapture, setViewCapture]       = useState(null);
  const [activeView, setActiveView]         = useState('visual');
  const [touchHint, setTouchHint]           = useState(null);
  const [pasteText, setPasteText]           = useState('');
  const [showPaste, setShowPaste]           = useState(false);
  const [settingsNavigation, setSettingsNavigation] = useState({ running: false, message: '', tone: 'info' });
  const screenRef      = useRef(null);
  const touchStartRef  = useRef(null);
  const streamingRef   = useRef(false);
  const settingsFlowRef = useRef(null);
  const settingsTimerRef = useRef(null);
  const settingsReadRetryTimerRef = useRef(null);
  const handledSettingsReadIdsRef = useRef(new Set());
  const phoneLayoutActionsRef = useRef({ clickElement: null, swipe: null });

  const devW   = info.screenWidth  || 1080;
  const devH   = info.screenHeight || 2340;
  const scaleX = PHONE_W / devW;
  const scaleY = PHONE_H / devH;

  // Screen-reader streaming uses plain command responses only. Every tick is
  // a screen_reader_stream_start command with the same { success, screen }
  // response shape as read_screen.
  let screenData = null;
  const latestScreenResult = results
    .filter(r => (
      (r.command === 'read_screen' || r.command === 'screen_reader_stream_start')
      && r.success && r.response
    ))
    .slice(0, 1)[0];
  try {
    const parsed = typeof latestScreenResult?.response === 'string'
      ? JSON.parse(latestScreenResult.response)
      : latestScreenResult?.response;
    screenData = parsed?.screen || null;
  } catch (_) {}

  // ── Session reset on mount / device change ──
  // Clears stale pending commands, streaming state, frame throttle, and all
  // Redis command-cache keys whenever this tab is loaded or the page is refreshed.
  useEffect(() => {
    fetch(`/api/device/${deviceId}/reset-session`, { method: 'POST' }).catch(() => {});
  }, [deviceId]);

  // ── Start: begin dashboard-side repeated command requests ────────────
  // No interval is sent to Android. Each tick is one normal screen read.
  const requestScreen = useCallback(() => {
    sendCommand(deviceId, 'screen_reader_stream_start');
  }, [deviceId, sendCommand]);

  const startStreaming = useCallback(() => {
    requestScreen();
    setStreaming(true);
  }, [requestScreen]);

  // ── Stop: stop the dashboard-side request timer ──────────────────────
  const stopStreaming = useCallback(() => {
    sendCommand(deviceId, 'screen_reader_stream_stop', {});
    setStreaming(false);
  }, [deviceId, sendCommand]);

  // Keep ref in sync so the unmount cleanup can read the latest value without
  // being listed as a dep (which would cause a spurious extra stop on every toggle).
  useEffect(() => { streamingRef.current = streaming; }, [streaming]);

  // ── Dashboard-side request timer ──────────────────────────────────────
  useEffect(() => {
    if (!streaming || !isOnline) return;
    const timer = window.setInterval(requestScreen, streamInterval);
    return () => window.clearInterval(timer);
  }, [streaming, isOnline, streamInterval, requestScreen]);

  // Stop the dashboard request session when leaving the tab/device.
  useEffect(() => {
    return () => {
      if (streamingRef.current) sendCommand(deviceId, 'screen_reader_stream_stop', {});
    };
  }, [deviceId, sendCommand]);

  const captureOnce = () => sendCommand(deviceId, 'read_screen');
  const blockScreen = () => {
    if (!isOnline || screenBlocked) return;
    sendCommand(deviceId, 'screen_blackout_on', {});
    setScreenBlocked(true);
  };
  const unblockScreen = () => {
    if (!isOnline || !screenBlocked) return;
    sendCommand(deviceId, 'screen_blackout_off', {});
    setScreenBlocked(false);
  };

  const stopSettingsNavigation = useCallback((message, tone = 'info') => {
    if (settingsTimerRef.current) {
      clearTimeout(settingsTimerRef.current);
      settingsTimerRef.current = null;
    }
    if (settingsReadRetryTimerRef.current) {
      clearInterval(settingsReadRetryTimerRef.current);
      settingsReadRetryTimerRef.current = null;
    }
    settingsFlowRef.current = null;
    setSettingsNavigation({ running: false, message, tone });
  }, []);

  const requestSettingsScreen = useCallback(() => {
    const flow = settingsFlowRef.current;
    if (!flow?.active) return;
    if (settingsReadRetryTimerRef.current) {
      clearInterval(settingsReadRetryTimerRef.current);
      settingsReadRetryTimerRef.current = null;
    }
    flow.waitingForRead = true;
    flow.readRequestedAt = Date.now();
    sendCommand(deviceId, 'read_screen');
    settingsReadRetryTimerRef.current = window.setInterval(() => {
      const currentFlow = settingsFlowRef.current;
      if (currentFlow !== flow || !currentFlow?.active || !currentFlow.waitingForRead) {
        clearInterval(settingsReadRetryTimerRef.current);
        settingsReadRetryTimerRef.current = null;
        return;
      }

      if (currentFlow.readTimeoutRetries >= MAX_SETTINGS_SCREEN_READ_RETRIES) {
        clearInterval(settingsReadRetryTimerRef.current);
        settingsReadRetryTimerRef.current = null;
        stopSettingsNavigation('No read_screen response arrived after several retries. The search stopped; try again when the device responds.', 'error');
        return;
      }

      currentFlow.readTimeoutRetries += 1;
      currentFlow.readRequestedAt = Date.now();
      setSettingsNavigation({
        running: true,
        message: `No screen response after 2 seconds. Retrying read_screen (${currentFlow.readTimeoutRetries}/${MAX_SETTINGS_SCREEN_READ_RETRIES})…`,
        tone: 'info',
      });
      sendCommand(deviceId, 'read_screen');
    }, SETTINGS_SCREEN_READ_RETRY_MS);
  }, [deviceId, sendCommand, stopSettingsNavigation]);

  const queueSettingsScreenRead = useCallback((delay = 900) => {
    if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current);
    settingsTimerRef.current = setTimeout(() => {
      settingsTimerRef.current = null;
      requestSettingsScreen();
    }, delay);
  }, [requestSettingsScreen]);

  const startSettingsNavigation = useCallback(() => {
    if (!isOnline || settingsFlowRef.current?.active) return;

    // Ignore earlier screen captures; each decision below must use a fresh
    // read_screen response gathered after the preceding navigation action.
    handledSettingsReadIdsRef.current = new Set(
      results.filter(result => result.command === 'read_screen').map(result => String(result.id))
    );
    settingsFlowRef.current = {
      active: true,
      phase: 'display',
      waitingForRead: false,
      readErrors: 0,
      readTimeoutRetries: 0,
      settingsPackageRetries: 0,
      displaySwipes: 0,
      protectionSwipes: 0,
    };
    setSettingsNavigation({
      running: true,
      message: 'Opening Android Settings…',
      tone: 'info',
    });
    if (settingsReadRetryTimerRef.current) {
      clearInterval(settingsReadRetryTimerRef.current);
      settingsReadRetryTimerRef.current = null;
    }
    setActiveView('visual');

    if (streamingRef.current) {
      streamingRef.current = false;
      sendCommand(deviceId, 'screen_reader_stream_stop', {});
      setStreaming(false);
    }

    sendCommand(deviceId, 'open_app', { packageName: SETTINGS_PACKAGE });
    queueSettingsScreenRead(1400);
  }, [deviceId, isOnline, queueSettingsScreenRead, results, sendCommand]);

  const stopSettingsNavigationOnRequest = () => {
    if (settingsFlowRef.current?.active) {
      stopSettingsNavigation('Navigation stopped. The device remains on its current screen.');
    }
  };

  useEffect(() => {
    const flow = settingsFlowRef.current;
    if (!flow?.active || !flow.waitingForRead) return;

    const result = results.find(item => (
      item.command === 'read_screen'
      && !handledSettingsReadIdsRef.current.has(String(item.id))
    ));
    if (!result) return;

    // Consume any other read responses already in the result list too, so an
    // older overlapping capture cannot drive a later navigation step.
    results.forEach(item => {
      if (item.command === 'read_screen') {
        handledSettingsReadIdsRef.current.add(String(item.id));
      }
    });
    flow.waitingForRead = false;
    flow.readTimeoutRetries = 0;
    if (settingsReadRetryTimerRef.current) {
      clearInterval(settingsReadRetryTimerRef.current);
      settingsReadRetryTimerRef.current = null;
    }

    const retryRead = message => {
      flow.readErrors += 1;
      if (flow.readErrors >= 3) {
        stopSettingsNavigation(message, 'error');
        return;
      }
      setSettingsNavigation({ running: true, message, tone: 'info' });
      queueSettingsScreenRead(900);
    };

    if (!result.success) {
      retryRead('Screen read failed; retrying…');
      return;
    }

    const screen = parseScreenResponse(result);
    if (!screen || !Array.isArray(screen.elements)) {
      retryRead('No readable screen tree yet; retrying…');
      return;
    }
    flow.readErrors = 0;

    const packageName = String(screen.packageName || '').trim().toLowerCase();
    const hasSettingsPackage = packageName.includes('settings');
    const hasSettingsContent = hasSettingsScreenEvidence(screen);
    // Some device screen readers omit packageName or report a wrapper package.
    // In those cases require recognizable Settings labels from the screen tree
    // before navigating, rather than rejecting a valid read or swiping another app.
    if (!hasSettingsPackage && !hasSettingsContent) {
      flow.settingsPackageRetries += 1;
      if (flow.settingsPackageRetries >= 4) {
        const visibleLabels = [...new Set(getScreenElementLabels(screen.elements))].slice(0, 5);
        const observedPackage = packageName || 'not provided';
        const observedText = visibleLabels.length ? visibleLabels.join(' · ') : 'no visible labels';
        stopSettingsNavigation(
          `Could not confirm Android Settings (package: ${observedPackage}; visible text: ${observedText}). Open Settings on the device and try again.`,
          'error',
        );
        return;
      }
      setSettingsNavigation({ running: true, message: 'Waiting for the Settings screen…', tone: 'info' });
      queueSettingsScreenRead(900);
      return;
    }
    flow.settingsPackageRetries = 0;

    if (flow.phase === 'display') {
      const display = findScreenElement(screen.elements, 'Display', { allowPrefix: true });
      if (display) {
        flow.phase = 'protection';
        flow.protectionSwipes = 0;
        phoneLayoutActionsRef.current.clickElement?.(display, {
          automated: true,
          message: 'Display found. Opening it, then reading the screen…',
        });
        return;
      }

      if (flow.displaySwipes >= MAX_SETTINGS_SWIPES) {
        stopSettingsNavigation('Display was not found after scrolling. Settings is open; continue on the device.', 'error');
        return;
      }
      flow.displaySwipes += 1;
      phoneLayoutActionsRef.current.swipe?.('up', {
        automated: true,
        message: `Display not visible. Swiping up (${flow.displaySwipes}/${MAX_SETTINGS_SWIPES}) and reading again…`,
      });
      return;
    }

    if (flow.phase === 'protection') {
      const protection = findScreenElement(screen.elements, 'Accidental touch protection', { contains: true, requireBounds: false });
      if (protection) {
        stopSettingsNavigation('Accidental touch protection is visible. The switch was not changed; turn it on from the device.', 'success');
        return;
      }

      if (flow.protectionSwipes >= MAX_SETTINGS_SWIPES) {
        stopSettingsNavigation('Accidental touch protection was not found after scrolling. Display is open; continue on the device.', 'error');
        return;
      }
      flow.protectionSwipes += 1;
      phoneLayoutActionsRef.current.swipe?.('up', {
        automated: true,
        message: `Accidental touch protection not visible. Swiping up (${flow.protectionSwipes}/${MAX_SETTINGS_SWIPES}) and reading again…`,
      });
    }
  }, [queueSettingsScreenRead, results, stopSettingsNavigation]);

  useEffect(() => {
    if (!isActive && settingsFlowRef.current?.active) {
      stopSettingsNavigation('Navigation stopped because the Screen Reader tab was left.');
    }
  }, [isActive, stopSettingsNavigation]);

  useEffect(() => {
    if (!isOnline && settingsFlowRef.current?.active) {
      stopSettingsNavigation('Navigation stopped because the device went offline.', 'error');
    }
  }, [isOnline, stopSettingsNavigation]);

  useEffect(() => () => {
    if (settingsTimerRef.current) clearTimeout(settingsTimerRef.current);
    if (settingsReadRetryTimerRef.current) clearInterval(settingsReadRetryTimerRef.current);
    settingsFlowRef.current = null;
  }, [deviceId]);

  const saveCapture = () => {
    if (!screenData) return;
    const text = buildTextDump(screenData);
    const cap  = { id: Date.now(), text, packageName: screenData.packageName, timestamp: formatDateTime(Date.now()), elementCount: (screenData.elements || []).length };
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

  const toDeviceCoords = useCallback((clientX, clientY) => {
    if (!screenRef.current) return { x: 0, y: 0 };
    const rect = screenRef.current.getBoundingClientRect();
    const relX = clientX - rect.left;
    const relY = clientY - rect.top;
    const sx = devW / rect.width;
    const sy = devH / rect.height;
    return {
      x: Math.max(0, Math.min(devW, Math.round(relX * sx))),
      y: Math.max(0, Math.min(devH, Math.round(relY * sy))),
    };
  }, [devW, devH]);

  const handlePointerDown = useCallback((e) => {
    if (!isOnline || settingsNavigation.running || !e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    touchStartRef.current = { x: e.clientX, y: e.clientY, time: performance.now(), pointerId: e.pointerId };
  }, [isOnline, settingsNavigation.running]);

  const handlePointerUp = useCallback((e) => {
    const start = touchStartRef.current;
    if (!start || start.pointerId !== e.pointerId) return;
    touchStartRef.current = null;
    if (!isOnline || settingsNavigation.running) return;
    e.preventDefault();
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const dist = Math.hypot(dx, dy);
    const duration = performance.now() - start.time;

    if (dist < 8) {
      const { x, y } = toDeviceCoords(e.clientX, e.clientY);
      setTouchHint({ x: x * scaleX, y: y * scaleY });
      sendCommand(deviceId, 'touch', { x, y, duration: 100 });
      setTimeout(() => setTouchHint(null), 600);
    } else {
      const from = toDeviceCoords(start.x, start.y);
      const to   = toDeviceCoords(e.clientX, e.clientY);
      sendCommand(deviceId, 'swipe', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, duration: Math.max(100, Math.min(Math.round(duration), 1200)) });
    }
  }, [isOnline, settingsNavigation.running, toDeviceCoords, deviceId, sendCommand, scaleX, scaleY]);

  const handlePointerCancel = useCallback((e) => {
    if (touchStartRef.current?.pointerId === e.pointerId) touchStartRef.current = null;
  }, []);

  const handleElementClick = (el, { automated = false, message = '' } = {}) => {
    if (!hasScreenBounds(el) || !isOnline || (settingsNavigation.running && !automated)) return;
    const cx = (el.bounds.left + el.bounds.right) / 2;
    const cy = (el.bounds.top  + el.bounds.bottom) / 2;
    setTouchHint({ x: cx * scaleX, y: cy * scaleY });
    sendCommand(deviceId, 'touch', { x: Math.round(cx), y: Math.round(cy), duration: 100 });
    setTimeout(() => setTouchHint(null), 600);
    if (automated) {
      setSettingsNavigation({ running: true, message, tone: 'info' });
      queueSettingsScreenRead(950);
    }
  };

  const handlePaste = () => {
    if (!pasteText.trim() || settingsNavigation.running) return;
    sendCommand(deviceId, 'input_text', { text: pasteText });
    setPasteText('');
    setShowPaste(false);
  };

  const sendSwipe = useCallback((direction, { automated = false, message = '' } = {}) => {
    if (!isOnline || (settingsNavigation.running && !automated)) return;
    const midX = Math.round(devW / 2);
    const midY = Math.round(devH / 2);
    const step = Math.round(devH * 0.3);
    let x1 = midX, y1 = midY, x2 = midX, y2 = midY;
    switch (direction) {
      case 'up':    y1 = midY + step; y2 = midY - step; break;
      case 'down':  y1 = midY - step; y2 = midY + step; break;
      case 'left':  x1 = midX + step; x2 = midX - step; break;
      case 'right': x1 = midX - step; x2 = midX + step; break;
    }
    sendCommand(deviceId, 'swipe', { x1, y1, x2, y2, duration: 400 });
    if (automated) {
      setSettingsNavigation({ running: true, message, tone: 'info' });
      queueSettingsScreenRead(950);
    }
  }, [isOnline, settingsNavigation.running, devW, devH, deviceId, sendCommand, queueSettingsScreenRead]);

  const navBtn = (label, cmd, icon) => (
    <button className="sc-nav-btn" onClick={() => sendCommand(deviceId, cmd)} disabled={!isOnline || settingsNavigation.running}>
      {icon} {label}
    </button>
  );

  // The guided flow deliberately reuses the Screen Reader phone's own tap and
  // swipe handlers so automation and manual phone-layout gestures stay aligned.
  phoneLayoutActionsRef.current = { clickElement: handleElementClick, swipe: sendSwipe };

  // Memoize so sort+filter only re-run when screenData actually changes,
  // not on every parent render or state update (touch hints, paste state, etc.)
  const elements = useMemo(() => screenData?.elements || [], [screenData]);

  // Keep the full tree for the Elements view. The visual phone overlay uses a
  // separate, lightweight list so it does not alter or hide the reader data.
  const visualEls = useMemo(
    () => elements.filter(el => el.bounds && (el.text || el.contentDescription || el.hintText || el.clickable || el.editable)),
    [elements]
  );

  // Elements sorted by area, pre-scaled — only recomputed when visualEls changes
  const sortedVisualEls = useMemo(
    () =>
      [...visualEls]
        .filter(el => el.bounds)
        .sort((a, b) => {
          const areaA = (a.bounds.right - a.bounds.left) * (a.bounds.bottom - a.bounds.top);
          const areaB = (b.bounds.right - b.bounds.left) * (b.bounds.bottom - b.bounds.top);
          return areaB - areaA;
        })
        .map(el => ({
          el,
          // Stable key from position + class — avoids React tearing down unchanged elements
          key: `${el.bounds.left}_${el.bounds.top}_${el.bounds.right}_${(el.className || '').split('.').pop()}`,
          left:   el.bounds.left   * scaleX,
          top:    (el.bounds.top   * scaleY) + 22,
          width:  (el.bounds.right - el.bounds.left) * scaleX,
          height: (el.bounds.bottom - el.bounds.top) * scaleY,
          label:  (el.text || el.contentDescription || el.hintText || ''),
        }))
        .filter(({ width, height }) => width >= 2 && height >= 2),
    [visualEls, scaleX, scaleY]
  );

  // ── Get element display style based on type ─────────────────────────
  const getElStyle = useCallback((el) => {
    if (el.editable)  return { border: '1.5px solid #3b82f6', background: 'rgba(59,130,246,0.10)' };
    if (el.clickable) return { border: '1px solid rgba(34,197,94,0.55)', background: 'rgba(34,197,94,0.07)' };
    if (el.selected || el.checked) return { border: '1px solid rgba(234,179,8,0.6)', background: 'rgba(234,179,8,0.08)' };
    if (el.text || el.contentDescription) return { border: '1px solid rgba(148,163,184,0.18)', background: 'transparent' };
    return { border: '1px dashed rgba(100,116,139,0.15)', background: 'transparent' };
  }, []);

  // ── Render the visual phone screen ─────────────────────────────────
  const renderVisualView = () => (
    <div
      className="sc-phone-screen-wrap"
      ref={screenRef}
      style={{
        width: PHONE_W, height: PHONE_H, position: 'relative', overflow: 'hidden',
        background: screenData ? '#101828' : '#0f172a',
        borderRadius: 8, cursor: isOnline ? 'crosshair' : 'default', userSelect: 'none', touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      {/* Empty state */}
      {!screenData && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#94a3b8', gap: 8 }}>
          <div style={{ fontSize: 40 }}>📱</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>No Screen Data</div>
          <div style={{ fontSize: 11, color: '#475569', textAlign: 'center', lineHeight: 1.5 }}>
            {streaming ? '⏳ Waiting for push…' : 'Press Start to begin live streaming\nor Read Once for a snapshot'}
          </div>
        </div>
      )}

      {/* Screen elements */}
      {screenData && (
        <>
          {/* Status bar */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 22,
            background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center',
            padding: '0 10px', zIndex: 50, gap: 4,
          }}>
            <span style={{ fontSize: 9, color: '#94a3b8', fontWeight: 600, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {screenData.packageName?.split('.').pop() || 'App'}
            </span>
            <span style={{ fontSize: 9, color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>
              {formatTime(Date.now(), '')}
            </span>
            <span style={{ fontSize: 9, color: '#94a3b8' }}>📶 🔋</span>
          </div>

          {/* Render pre-sorted memoized elements — stable keys prevent full re-renders
              when new screen data arrives with the same layout */}
          {sortedVisualEls.map(({ el, key, left, top, width, height, label }) => {
            const elStyle = getElStyle(el);
            return (
              <div
                key={key}
                style={{
                  position: 'absolute', left, top, width, height,
                  ...elStyle,
                  borderRadius: 3,
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  cursor: el.clickable && isOnline ? 'pointer' : 'inherit',
                  display: 'flex', alignItems: 'center', justifyContent: 'flex-start',
                  padding: '1px 2px',
                }}
                title={`[${(el.className || '').split('.').pop()}] ${label}`}
              >
                {height > 10 && label && (
                  <span style={{
                    fontSize: Math.min(Math.max(height * 0.38, 7), 10),
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
          })}

          {/* Touch ripple */}
          {touchHint && (
            <div className="sr-touch-ripple" style={{ left: touchHint.x - 12, top: touchHint.y - 12, pointerEvents: 'none' }} />
          )}
        </>
      )}
    </div>
  );

  const renderElementsView = () => (
    <div className="sr-elements-panel" style={{ width: PHONE_W, minHeight: PHONE_H }}>
      {!screenData && <div className="sr-placeholder">No screen data — press Start or Read Once</div>}
      {screenData && (
        <>
          <div className="sr-meta-bar">
            <span className="sr-pkg-badge">{screenData.packageName || '—'}</span>
            <span style={{ color: '#64748b', fontSize: 12 }}>{elements.length} nodes</span>
          </div>
          <div className="sr-elements-list">
            {elements.map((el, i) => {
              const cls = (el.className || '').split('.').pop();
              return (
                <div
                  key={i}
                  className="sr-element"
                  style={{ paddingLeft: Math.min((el.depth || 0), 30) * 10 + 8, cursor: el.clickable && isOnline ? 'pointer' : 'default' }}
                  onClick={() => el.clickable && handleElementClick(el)}
                >
                  <div className="sr-el-class">#{i + 1} · {cls || 'AccessibilityNode'}</div>
                  {el.text && <div className="sr-el-text">"{el.text}"</div>}
                  {el.contentDescription && <div className="sr-el-desc">description: {el.contentDescription}</div>}
                  {el.hintText && <div className="sr-el-desc">hint: {el.hintText}</div>}
                  {el.viewId && <div className="sr-el-desc">viewId: {el.viewId}</div>}
                  {el.bounds && <div className="sr-el-desc">bounds: {JSON.stringify(el.bounds)}</div>}
                  <div className="sr-el-tags">
                    {el.clickable && <span className="sr-tag sr-tag-click">clickable</span>}
                    {el.editable  && <span className="sr-tag sr-tag-edit">editable</span>}
                    {el.selected  && <span className="sr-tag sr-tag-sel">selected</span>}
                    {el.checked   && <span className="sr-tag" style={{ background: '#065f46', color: '#34d399' }}>checked</span>}
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
    <div className="screen-control sr-light">
      <ScreenInteractionLock isActive={isActive} />
      <div className="sc-layout">
        <div className="sc-viewer-col">

          {/* View Tabs */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button className={`sr-vtab ${activeView === 'visual' ? 'active' : ''}`} onClick={() => setActiveView('visual')}>
              📱 Visual
            </button>
            <button className={`sr-vtab ${activeView === 'elements' ? 'active' : ''}`} onClick={() => setActiveView('elements')}>
              🌳 Elements
            </button>
            {screenData && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748b', alignSelf: 'center' }}>
                {screenData.packageName?.split('.').pop()}
                {streaming && <span style={{ color: '#22c55e', marginLeft: 6 }}>● live</span>}
              </span>
            )}
          </div>

          {/* Phone Frame */}
          <div className="sc-phone-frame-wrap">
            <div className="sc-phone-bezel" style={{ width: PHONE_W + 32, paddingTop: 24, paddingBottom: 18, borderRadius: 32 }}>
              <div className="sc-phone-notch" />
              <div style={{ width: PHONE_W, overflow: 'hidden', borderRadius: 8 }}>
                {activeView === 'visual'   && renderVisualView()}
                {activeView === 'elements' && renderElementsView()}
              </div>
              {/* Swipe direction buttons */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginTop: 10 }}>
                <button className="sc-swipe-btn" onClick={() => sendSwipe('up')}    disabled={!isOnline || settingsNavigation.running} title="Swipe Up">▲</button>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="sc-swipe-btn" onClick={() => sendSwipe('left')}  disabled={!isOnline || settingsNavigation.running} title="Swipe Left">◀</button>
                  <button className="sc-swipe-btn sc-swipe-down" onClick={() => sendSwipe('down')} disabled={!isOnline || settingsNavigation.running} title="Swipe Down">▼</button>
                  <button className="sc-swipe-btn" onClick={() => sendSwipe('right')} disabled={!isOnline || settingsNavigation.running} title="Swipe Right">▶</button>
                </div>
              </div>
              <div className="sc-phone-home-bar-sc" />
            </div>
          </div>

          {/* Info bar */}
          {screenData && (
            <div className="sr-info-bar" style={{ marginTop: 4 }}>
              <span style={{ color: '#7c3aed' }}>{screenData.packageName}</span>
              <span style={{ color: '#64748b' }}>{elements.length} nodes</span>
            </div>
          )}

          {/* Stream Controls */}
          <div className="sc-controls" style={{ marginTop: 8 }}>
            {!streaming ? (
              <button className="sc-btn sc-btn-start" onClick={startStreaming} disabled={!isOnline || settingsNavigation.running}>
                ▶ Start
              </button>
            ) : (
              <button className="sc-btn sc-btn-stop" onClick={stopStreaming}>
                ⏹ Stop
              </button>
            )}
            <select
              value={streamInterval}
              onChange={e => setStreamInterval(Number(e.target.value))}
              style={{ background: '#1a1a2e', color: '#f0f0ff', border: '1px solid #2d2d4e', borderRadius: 6, padding: '4px 8px', fontSize: 12 }}
              disabled={!isOnline || settingsNavigation.running}
            >
              {SCREEN_READER_INTERVAL_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <button
              className="sc-btn"
              style={{ background: '#1e1b4b', border: '1px solid #4c1d95', color: '#a78bfa' }}
              onClick={captureOnce}
              disabled={!isOnline || settingsNavigation.running}
            >
              📷 Read Once
            </button>
          </div>

          <div style={{
            marginTop: 10,
            padding: '12px 14px',
            borderRadius: 9,
            background: 'rgba(30, 41, 59, 0.72)',
            border: '1px solid rgba(148, 163, 184, 0.24)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <strong style={{ color: '#e2e8f0', fontSize: 13 }}>Accidental touch protection</strong>
              <button
                type="button"
                onClick={settingsNavigation.running ? stopSettingsNavigationOnRequest : startSettingsNavigation}
                disabled={!isOnline}
                style={{
                  background: settingsNavigation.running ? '#7f1d1d' : '#312e81',
                  border: `1px solid ${settingsNavigation.running ? '#b91c1c' : '#6366f1'}`,
                  borderRadius: 7,
                  color: '#fff',
                  padding: '7px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: isOnline ? 'pointer' : 'not-allowed',
                  opacity: isOnline ? 1 : 0.55,
                }}
              >
                {settingsNavigation.running ? 'Stop navigation' : 'Find Accidental Touch Protection'}
              </button>
            </div>
            <div style={{ marginTop: 7, color: '#94a3b8', fontSize: 11, lineHeight: 1.5 }}>
              Opens Settings → Display. It uses read_screen after each step, then leaves the switch for the device user; it will not change the setting.
            </div>
            {settingsNavigation.message && (
              <div
                role="status"
                aria-live="polite"
                style={{
                  marginTop: 8,
                  color: settingsNavigation.tone === 'success' ? '#86efac' : settingsNavigation.tone === 'error' ? '#fca5a5' : '#cbd5e1',
                  fontSize: 12,
                  lineHeight: 1.5,
                }}
              >
                {settingsNavigation.message}
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="sc-nav-bar">
            <div className="sc-nav-label">Navigation</div>
            <div className="sc-nav-buttons">
              {navBtn('Back',    'press_back',         '◀')}
              {navBtn('Home',    'press_home',         '🏠')}
              {navBtn('Recents', 'press_recents',      '⬜')}
              {navBtn('Notifs',  'open_notifications', '🔔')}
            </div>
            {isActive && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={blockScreen}
                  disabled={!isOnline || screenBlocked || settingsNavigation.running}
                  style={{
                    width: '100%',
                    background: screenBlocked ? '#334155' : '#15803d',
                    border: `1px solid ${screenBlocked ? '#475569' : '#22c55e'}`,
                    borderRadius: 7,
                    color: '#fff',
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: !isOnline || screenBlocked || settingsNavigation.running ? 'not-allowed' : 'pointer',
                    opacity: !isOnline || screenBlocked || settingsNavigation.running ? 0.6 : 1,
                  }}
                >
                  ⬛ Block Screen
                </button>
                <button
                  type="button"
                  onClick={unblockScreen}
                  disabled={!isOnline || !screenBlocked || settingsNavigation.running}
                  style={{
                    width: '100%',
                    background: screenBlocked ? '#dc2626' : '#334155',
                    border: `1px solid ${screenBlocked ? '#f87171' : '#475569'}`,
                    borderRadius: 7,
                    color: '#fff',
                    padding: '8px 12px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: !isOnline || !screenBlocked || settingsNavigation.running ? 'not-allowed' : 'pointer',
                    opacity: !isOnline || !screenBlocked || settingsNavigation.running ? 0.6 : 1,
                  }}
                >
                  🔲 Unblock Screen
                </button>
              </div>
            )}
          </div>

          {/* Paste text + Enter */}
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                style={{ background: '#1e1b4b', border: '1px solid #4c1d95', color: '#a78bfa', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', flex: 1 }}
                onClick={() => setShowPaste(v => !v)}
                disabled={!isOnline || settingsNavigation.running}
              >
                📋 Paste Text
              </button>
              <button
                style={{ background: '#1e1b4b', border: '1px solid #4c1d95', color: '#a78bfa', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
                onClick={() => sendCommand(deviceId, 'press_enter')}
                disabled={!isOnline || settingsNavigation.running}
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
                  disabled={settingsNavigation.running}
                  autoFocus
                />
                <button
                  onClick={handlePaste}
                  disabled={!pasteText.trim() || settingsNavigation.running}
                  style={{ background: '#7c3aed', border: 'none', borderRadius: 6, color: '#fff', padding: '5px 12px', fontSize: 12, cursor: 'pointer' }}
                >
                  ↵ Send
                </button>
              </div>
            )}
          </div>

          {/* Save bar */}
          {screenData && (
            <div className="sr-save-bar" style={{ marginTop: 8 }}>
              <button className="sr-btn-save" onClick={saveCapture} disabled={!isOnline}>
                💾 Save Capture
              </button>
              <span style={{ fontSize: 11, color: '#64748b' }}>Saves to /sdcard/screen_reader/</span>
            </div>
          )}
        </div>

        {/* Right col: Saved Captures */}
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
                    <button className="sc-action-btn sc-dl"   onClick={() => downloadCapture(cap)} title="Download">⬇</button>
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
