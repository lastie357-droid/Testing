import { useCallback, useEffect, useRef, useState } from 'react';

function parseScreenResult(result) {
  if (!result) return null;
  const response = typeof result.response === 'string'
    ? (() => {
        try { return JSON.parse(result.response); } catch (_) { return null; }
      })()
    : result.response;

  if (!result.success || !response?.success || !response.screen) return null;
  return {
    ...response,
    _ts: result.time ? new Date(result.time).getTime() : Date.now(),
  };
}

/**
 * Read the accessibility tree through the normal read_screen command.
 *
 * The next request is sent only after the previous command result arrives.
 * This deliberately avoids the screen:update event stream, gzip payloads,
 * frame chunks, and overlapping AccessibilityNodeInfo traversals.
 */
export function useReadScreenPolling({
  deviceId,
  isOnline,
  results,
  sendCommand,
  intervalMs = 150,
}) {
  const [screenData, setScreenData] = useState(null);
  const [reading, setReading] = useState(false);
  const [active, setActive] = useState(false);

  const activeRef = useRef(false);
  const awaitingRef = useRef(false);
  const seenResultIdsRef = useRef(new Set());
  const nextTimerRef = useRef(null);
  const responseTimeoutRef = useRef(null);
  const requestReadRef = useRef(null);

  const clearTimers = useCallback(() => {
    if (nextTimerRef.current) {
      clearTimeout(nextTimerRef.current);
      nextTimerRef.current = null;
    }
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current);
      responseTimeoutRef.current = null;
    }
  }, []);

  const scheduleNext = useCallback((delay = intervalMs) => {
    if (!activeRef.current || !isOnline) return;
    if (nextTimerRef.current) clearTimeout(nextTimerRef.current);
    nextTimerRef.current = setTimeout(() => {
      nextTimerRef.current = null;
      requestReadRef.current?.();
    }, Math.max(50, delay));
  }, [intervalMs, isOnline]);

  const requestRead = useCallback(() => {
    if (!isOnline || awaitingRef.current) return;

    awaitingRef.current = true;
    setReading(true);
    sendCommand(deviceId, 'read_screen');

    // A lost command must not leave polling permanently stuck. This is only
    // a retry guard; it never overlaps a successful read_screen request.
    if (responseTimeoutRef.current) clearTimeout(responseTimeoutRef.current);
    responseTimeoutRef.current = setTimeout(() => {
      if (!awaitingRef.current) return;
      awaitingRef.current = false;
      setReading(false);
      if (activeRef.current) scheduleNext(500);
    }, 10_000);
  }, [deviceId, isOnline, scheduleNext, sendCommand]);

  requestReadRef.current = requestRead;

  useEffect(() => {
    // Mark results already present when this view mounts as historical. A
    // newly issued request will still be picked up by its unique result id.
    for (const result of results || []) {
      if (result?.id != null) seenResultIdsRef.current.add(String(result.id));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const fresh = (results || [])
      .filter(result => result?.command === 'read_screen' && result?.id != null)
      .filter(result => !seenResultIdsRef.current.has(String(result.id)))
      .sort((a, b) => String(b.id).localeCompare(String(a.id)));

    if (!fresh.length) return;
    const result = fresh[0];
    seenResultIdsRef.current.add(String(result.id));

    const parsed = parseScreenResult(result);
    if (parsed) setScreenData(parsed);

    // A command response is the only clock used by the live reader. This
    // prevents command overlap when a device takes longer to traverse its UI.
    if (awaitingRef.current) {
      awaitingRef.current = false;
      setReading(false);
      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current);
        responseTimeoutRef.current = null;
      }
      if (activeRef.current) scheduleNext();
    }
  }, [results, scheduleNext]);

  const start = useCallback(() => {
    if (!isOnline || activeRef.current) return;
    activeRef.current = true;
    setActive(true);
    requestReadRef.current?.();
  }, [isOnline]);

  const stop = useCallback(() => {
    activeRef.current = false;
    awaitingRef.current = false;
    clearTimers();
    setActive(false);
    setReading(false);
  }, [clearTimers]);

  // A manual Read Once uses the exact same command path without enabling the
  // repeating reader.
  const readOnce = useCallback(() => {
    requestReadRef.current?.();
  }, []);

  useEffect(() => {
    if (!isOnline && activeRef.current) stop();
  }, [isOnline, stop]);

  useEffect(() => () => {
    activeRef.current = false;
    awaitingRef.current = false;
    clearTimers();
  }, [clearTimers]);

  return { screenData, reading, active, start, stop, readOnce };
}