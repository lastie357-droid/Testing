import React, { useCallback, useEffect, useRef, useState } from 'react';
import { sendPhoneLayoutTouch } from '../utils/screenReaderPhoneLayout.js';

const READ_RETRY_MS = 2000;
const MAX_READ_RETRIES = 5;
const CLICK_INTERVAL_MS = 100;
const VERIFY_DELAY_MS = 350;
const SWITCH_CLASS_NAMES = new Set(['switch', 'switchcompat', 'materialswitch', 'togglebutton']);

function getReadIds(results, deviceId) {
  return new Set(
    (Array.isArray(results) ? results : [])
      .filter(result => result.command === 'read_screen' && String(result.deviceId) === String(deviceId))
      .map(result => String(result.id)),
  );
}

function parseScreen(result) {
  try {
    const response = typeof result?.response === 'string'
      ? JSON.parse(result.response)
      : result?.response;
    return response?.screen || null;
  } catch (_) {
    return null;
  }
}

function isSwitchElement(element) {
  const className = String(element?.className || '').split('.').pop().toLowerCase();
  return element?.checkable === true && SWITCH_CLASS_NAMES.has(className);
}

function hasValidBounds(element, screenWidth, screenHeight) {
  const bounds = element?.bounds;
  if (!bounds || !['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(Number(bounds[key])))) {
    return false;
  }
  const left = Number(bounds.left);
  const top = Number(bounds.top);
  const right = Number(bounds.right);
  const bottom = Number(bounds.bottom);
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  return right > left
    && bottom > top
    && centerX >= 0
    && centerY >= 0
    && centerX <= screenWidth
    && centerY <= screenHeight;
}

function collectVisibleSwitches(screen, deviceInfo, targetState) {
  const width = Number(deviceInfo?.screenWidth) || 1080;
  const height = Number(deviceInfo?.screenHeight) || 2340;
  const potential = (Array.isArray(screen?.elements) ? screen.elements : []).filter(isSwitchElement);
  const unique = new Map();

  for (const element of potential) {
    const label = String(element.text || element.contentDescription || element.hintText || '').replace(/\s+/g, ' ').trim();
    if (
      !label
      || element.visibleToUser !== true
      || element.clickable !== true
      || element.enabled === false
      || typeof element.checked !== 'boolean'
      || !hasValidBounds(element, width, height)
    ) {
      continue;
    }

    const bounds = element.bounds;
    const centerY = (Number(bounds.top) + Number(bounds.bottom)) / 2;
    const key = `${label}|${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}`;
    unique.set(key, {
      element,
      label,
      checked: element.checked,
      needsChange: element.checked !== targetState,
      centerY,
    });
  }

  return {
    switches: [...unique.values()].sort((a, b) => a.centerY - b.centerY),
    skipped: potential.length - unique.size,
  };
}

const initialPanelState = {
  mode: 'idle',
  action: null,
  message: '',
  switches: [],
  skipped: 0,
  packageName: '',
};

export default function ScreenToggleAutomation({ device, sendCommand, results, isActive }) {
  const deviceId = device?.deviceId;
  const isOnline = Boolean(device?.isOnline);
  const deviceInfo = device?.deviceInfo || {};
  const [panel, setPanel] = useState(initialPanelState);
  const flowRef = useRef(null);
  const timersRef = useRef(new Set());
  const resultsRef = useRef(Array.isArray(results) ? results : []);

  useEffect(() => {
    resultsRef.current = Array.isArray(results) ? results : [];
  }, [results]);

  const schedule = useCallback((callback, delay) => {
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer);
      callback();
    }, delay);
    timersRef.current.add(timer);
    return timer;
  }, []);

  const clearScheduled = useCallback(() => {
    for (const timer of timersRef.current) window.clearTimeout(timer);
    timersRef.current.clear();
  }, []);

  const cancelFlow = useCallback((message = 'Switch action canceled.') => {
    clearScheduled();
    flowRef.current = null;
    setPanel({ ...initialPanelState, mode: 'done', message });
  }, [clearScheduled]);

  const requestRead = useCallback((flow) => {
    if (flowRef.current !== flow) return;
    flow.baselineIds = new Set([
      ...flow.baselineIds,
      ...getReadIds(resultsRef.current, deviceId),
    ]);
    sendCommand(deviceId, 'read_screen');
    flow.readTimer = schedule(() => {
      if (flowRef.current !== flow) return;
      if (flow.readRetries >= MAX_READ_RETRIES) {
        flowRef.current = null;
        setPanel({
          ...initialPanelState,
          mode: 'error',
          message: 'No read_screen response arrived after several retries. No switches were changed.',
        });
        return;
      }
      flow.readRetries += 1;
      setPanel(previous => ({
        ...previous,
        message: `No screen response after 2 seconds. Retrying read_screen (${flow.readRetries}/${MAX_READ_RETRIES})…`,
      }));
      requestRead(flow);
    }, READ_RETRY_MS);
  }, [deviceId, schedule, sendCommand]);

  const beginReview = useCallback((targetState) => {
    if (!isOnline || !isActive || flowRef.current) return;
    clearScheduled();
    const flow = {
      phase: 'reading',
      targetState,
      baselineIds: getReadIds(resultsRef.current, deviceId),
      readRetries: 0,
      readTimer: null,
      switches: [],
    };
    flowRef.current = flow;
    setPanel({
      ...initialPanelState,
      mode: 'reading',
      action: targetState,
      message: 'Reading the current screen before listing switches…',
    });
    requestRead(flow);
  }, [clearScheduled, deviceId, isActive, isOnline, requestRead]);

  useEffect(() => {
    const flow = flowRef.current;
    if (!flow || !['reading', 'verifying'].includes(flow.phase)) return;

    const result = (Array.isArray(results) ? results : []).find(item => (
      item.command === 'read_screen'
      && String(item.deviceId) === String(deviceId)
      && !flow.baselineIds.has(String(item.id))
    ));
    if (!result) return;

    flow.baselineIds.add(String(result.id));
    if (flow.readTimer) {
      window.clearTimeout(flow.readTimer);
      timersRef.current.delete(flow.readTimer);
      flow.readTimer = null;
    }

    if (!result.success) {
      flowRef.current = null;
      setPanel({
        ...initialPanelState,
        mode: 'error',
        message: 'read_screen failed. No switch was changed.',
      });
      return;
    }

    const screen = parseScreen(result);
    if (!screen || !Array.isArray(screen.elements)) {
      flowRef.current = null;
      setPanel({
        ...initialPanelState,
        mode: 'error',
        message: 'The read_screen response did not contain a usable screen tree. No switch was changed.',
      });
      return;
    }

    const { switches, skipped } = collectVisibleSwitches(screen, deviceInfo, flow.targetState);
    if (flow.phase === 'reading') {
      flow.switches = switches;
      flow.phase = 'review';
      const changesNeeded = switches.filter(item => item.needsChange).length;

      if (switches.length === 0) {
        flowRef.current = null;
        setPanel({
          ...initialPanelState,
          mode: 'done',
          action: flow.targetState,
          message: 'No visible, labeled, enabled, clickable switches were found. No changes were made.',
          skipped,
          packageName: screen.packageName || '',
        });
        return;
      }
      if (changesNeeded === 0) {
        flowRef.current = null;
        setPanel({
          ...initialPanelState,
          mode: 'done',
          action: flow.targetState,
          message: `All ${switches.length} listed switch${switches.length === 1 ? '' : 'es'} already ${flow.targetState ? 'on' : 'off'}. No taps were sent.`,
          switches,
          skipped,
          packageName: screen.packageName || '',
        });
        return;
      }

      setPanel({
        mode: 'review',
        action: flow.targetState,
        message: `Review ${switches.length} visible switch${switches.length === 1 ? '' : 'es'}. Only ${changesNeeded} need to change.`,
        switches,
        skipped,
        packageName: screen.packageName || '',
      });
      return;
    }

    const pendingLabels = flow.switches
      .filter(item => item.needsChange)
      .filter(item => {
        const current = switches.find(candidate => candidate.label === item.label);
        return !current || current.checked !== flow.targetState;
      })
      .map(item => item.label);

    flowRef.current = null;
    clearScheduled();
    setPanel({
      mode: pendingLabels.length ? 'error' : 'done',
      action: flow.targetState,
      message: pendingLabels.length
        ? `Sent the taps, but could not verify: ${pendingLabels.join(', ')}. Inspect the screen before retrying.`
        : `Verified ${flow.switches.filter(item => item.needsChange).length} switch${flow.switches.filter(item => item.needsChange).length === 1 ? '' : 'es'} ${flow.targetState ? 'on' : 'off'}.`,
      switches,
      skipped,
      packageName: screen.packageName || '',
    });
  }, [clearScheduled, deviceInfo, deviceId, results]);

  const confirmChanges = useCallback(() => {
    const flow = flowRef.current;
    if (!flow || flow.phase !== 'review' || !isOnline || !isActive) return;

    const changes = flow.switches
      .filter(item => item.needsChange)
      .sort((a, b) => b.centerY - a.centerY);
    if (!changes.length) {
      flowRef.current = null;
      setPanel(previous => ({ ...previous, mode: 'done', message: 'All listed switches are already in the requested state.' }));
      return;
    }

    flow.phase = 'applying';
    flow.sentCount = 0;
    setPanel(previous => ({
      ...previous,
      mode: 'applying',
      message: `Sending ${changes.length} phone-layout taps at 100 ms intervals…`,
    }));

    changes.forEach((item, index) => {
      schedule(() => {
        if (flowRef.current !== flow) return;
        const sent = sendPhoneLayoutTouch(deviceId, sendCommand, item.element, { duration: 100 });
        if (!sent) {
          flow.sentCount += 1;
          return;
        }
        flow.sentCount += 1;
        setPanel(previous => ({
          ...previous,
          mode: 'applying',
          message: `Sent tap ${flow.sentCount} of ${changes.length}…`,
        }));

        if (index === changes.length - 1) {
          schedule(() => {
            if (flowRef.current !== flow) return;
            flow.phase = 'verifying';
            flow.baselineIds = getReadIds(resultsRef.current, deviceId);
            flow.readRetries = 0;
            setPanel(previous => ({ ...previous, mode: 'verifying', message: 'Taps sent. Reading the screen to verify…' }));
            requestRead(flow);
          }, VERIFY_DELAY_MS);
        }
      }, index * CLICK_INTERVAL_MS);
    });
  }, [deviceId, isActive, isOnline, requestRead, schedule, sendCommand]);

  useEffect(() => {
    if (!isActive && flowRef.current) {
      cancelFlow('Switch action canceled because this tab was left.');
    }
  }, [cancelFlow, isActive]);

  useEffect(() => () => {
    clearScheduled();
    flowRef.current = null;
  }, [clearScheduled, deviceId]);

  const busy = ['reading', 'review', 'applying', 'verifying'].includes(panel.mode);
  const buttonStyle = (background, border) => ({
    background,
    border: `1px solid ${border}`,
    color: '#fff',
    borderRadius: 6,
    padding: '6px 11px',
    fontSize: 12,
    fontWeight: 600,
    cursor: !isOnline || !isActive || busy ? 'not-allowed' : 'pointer',
    opacity: !isOnline || !isActive || busy ? 0.55 : 1,
  });

  return (
    <section
      aria-label="Screen switch controls"
      style={{
        marginTop: 8,
        padding: 10,
        border: '1px solid rgba(148,163,184,0.22)',
        borderRadius: 8,
        background: 'rgba(15,23,42,0.62)',
      }}
    >
      <div style={{ color: '#e2e8f0', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
        Visible screen switches
      </div>
      <div style={{ color: '#94a3b8', fontSize: 11, lineHeight: 1.45, marginBottom: 8 }}>
        Reads the current screen, then previews labeled switches. Unlabeled, disabled, or non-clickable controls are skipped.
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => beginReview(true)}
          disabled={!isOnline || !isActive || busy}
          style={buttonStyle('#15803d', '#22c55e')}
        >
          Toggle On
        </button>
        <button
          type="button"
          onClick={() => beginReview(false)}
          disabled={!isOnline || !isActive || busy}
          style={buttonStyle('#b91c1c', '#f87171')}
        >
          Toggle Off
        </button>
        {panel.mode === 'review' && (
          <>
            <button
              type="button"
              onClick={confirmChanges}
              disabled={!isOnline || !isActive}
              style={buttonStyle('#4338ca', '#818cf8')}
            >
              Confirm Toggle {panel.action ? 'On' : 'Off'}
            </button>
            <button type="button" onClick={() => cancelFlow('Switch action canceled. No taps were sent.')} style={buttonStyle('#334155', '#64748b')}>
              Cancel
            </button>
          </>
        )}
        {panel.mode === 'applying' && (
          <button type="button" onClick={() => cancelFlow('Remaining taps canceled. Already-sent taps may complete.')} style={buttonStyle('#334155', '#64748b')}>
            Cancel remaining taps
          </button>
        )}
      </div>
      {panel.message && (
        <div
          role="status"
          aria-live="polite"
          style={{
            marginTop: 8,
            color: panel.mode === 'error' ? '#fca5a5' : panel.mode === 'done' ? '#86efac' : '#cbd5e1',
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          {panel.message}
          {panel.packageName && <div style={{ color: '#64748b' }}>Screen: {panel.packageName}</div>}
        </div>
      )}
      {panel.switches.length > 0 && ['review', 'done', 'error'].includes(panel.mode) && (
        <ul style={{ margin: '7px 0 0', paddingLeft: 18, maxHeight: 140, overflowY: 'auto', color: '#cbd5e1', fontSize: 11 }}>
          {panel.switches.map((item, index) => (
            <li key={`${item.label}-${index}`}>
              {item.label}: {item.checked ? 'On' : 'Off'}
              {item.needsChange ? ` → ${panel.action ? 'On' : 'Off'}` : ' (already correct)'}
            </li>
          ))}
        </ul>
      )}
      {panel.skipped > 0 && ['review', 'done', 'error'].includes(panel.mode) && (
        <div style={{ color: '#94a3b8', fontSize: 10, marginTop: 5 }}>
          Skipped {panel.skipped} unlabeled, disabled, hidden, or non-clickable switch control{panel.skipped === 1 ? '' : 's'}.
        </div>
      )}
      {panel.mode === 'review' && (
        <div style={{ marginTop: 6, color: '#fbbf24', fontSize: 10, lineHeight: 1.4 }}>
          Confirm only if these are the switches you intend to change. Keep the device on this screen until the action completes.
        </div>
      )}
    </section>
  );
}
