import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * useTcpStream — replaces useWebSocket entirely.
 *
 * Server → Browser:  EventSource (SSE over a persistent HTTP/TCP connection).
 *                    No WebSocket protocol, no WS framing overhead.
 * Browser → Server:  Plain HTTP POST (fire-and-forget, no queue).
 *                    Each request gets its own TCP connection from the browser
 *                    pool — truly parallel, no head-of-line blocking.
 *
 * The hook exposes the same { connected, reconnecting, send } API as the old
 * useWebSocket hook so no component needs to change.
 */
export function useTcpStream(onMessage, tokenStorageKey = null, onAuthExpired = null) {
  const [connected, setConnected]     = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const esRef         = useRef(null);
  const retryRef      = useRef(null);
  const connectRef    = useRef(null);
  const generationRef = useRef(0);
  const disposedRef   = useRef(false);
  const sseIdRef      = useRef(null);   // assigned by server via session:init
  const realtimeQueueRef = useRef(new Map());
  const realtimeFlushRef = useRef(null);
  const onMessageRef  = useRef(onMessage);
  const onAuthExpiredRef = useRef(onAuthExpired);
  onMessageRef.current = onMessage;
  onAuthExpiredRef.current = onAuthExpired;

  const queueRealtimeMessage = (event, data) => {
    const key = `${event}:${data?.deviceId || '__global__'}`;
    realtimeQueueRef.current.set(key, { event, data });
    if (realtimeFlushRef.current !== null) return;

    // Large screen/camera frames can arrive faster than React can render the
    // dashboard. Latest-wins coalescing keeps the SSE connection live while
    // bounding browser work to at most 10 realtime updates per second.
    realtimeFlushRef.current = setTimeout(() => {
      realtimeFlushRef.current = null;
      const pending = Array.from(realtimeQueueRef.current.values());
      realtimeQueueRef.current.clear();
      for (const message of pending) {
        onMessageRef.current(message.event, message.data);
      }
    }, 100);
  };

  const connect = useCallback(async () => {
    if (disposedRef.current) return;
    // Each dashboard uses its own token. Do not let an old admin token in the
    // same browser override a user's JWT and cause an endless SSE reconnect.
    const token = tokenStorageKey
      ? localStorage.getItem(tokenStorageKey)
      : (localStorage.getItem('admin_token') || localStorage.getItem('user_token'));
    if (!token) return;

    // Never allow two EventSource instances to survive a reconnect race.
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    const generation = ++generationRef.current;
    const scheduleRetry = () => {
      if (disposedRef.current || generation !== generationRef.current) return;
      clearTimeout(retryRef.current);
      retryRef.current = setTimeout(() => connectRef.current?.(), 3000);
    };

    // EventSource does not expose HTTP response status codes. Validate the
    // session first so an expired token does not create an endless silent
    // reconnect loop that leaves the dashboard frozen.
    try {
      const response = await fetch('/api/session/check', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      if (generation !== generationRef.current || disposedRef.current) return;
      if (response.status === 401 || response.status === 403) {
        localStorage.removeItem(tokenStorageKey || 'admin_token');
        setConnected(false);
        setReconnecting(false);
        onAuthExpiredRef.current?.();
        return;
      }
      if (!response.ok) throw new Error(`Session check failed (${response.status})`);
    } catch (_) {
      if (generation !== generationRef.current || disposedRef.current) return;
      setConnected(false);
      setReconnecting(true);
      scheduleRetry();
      return;
    }

    // EventSource opens a persistent TCP connection; browser reconnects automatically.
    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    esRef.current = es;

    es.onopen = () => {
      if (generation !== generationRef.current || disposedRef.current) return;
      setConnected(true);
      setReconnecting(false);
      clearTimeout(retryRef.current);
    };

    es.onmessage = (e) => {
      if (generation !== generationRef.current || disposedRef.current) return;
      try {
        const msg = JSON.parse(e.data);
        // Capture our sseClientId the first time the server sends it
        if (msg.event === 'session:init' && msg.data?.sseClientId) {
          sseIdRef.current = msg.data.sseClientId;
          sessionStorage.setItem('sseClientId', msg.data.sseClientId);
        }
        if (msg.event === 'stream:frame' ||
            msg.event === 'screen:update' ||
            msg.event === 'camera:frame' ||
            msg.event === 'device:heartbeat' ||
            msg.event === 'device:latency') {
          queueRealtimeMessage(msg.event, msg.data);
        } else {
          onMessageRef.current(msg.event, msg.data);
        }
      } catch (_) {}
    };

    es.onerror = () => {
      if (generation !== generationRef.current || disposedRef.current) return;
      setConnected(false);
      setReconnecting(true);
      es.close();
      // EventSource would retry automatically but we want controlled backoff.
      scheduleRetry();
    };
  }, []);
  connectRef.current = connect;

  useEffect(() => {
    disposedRef.current = false;
    connect();
    return () => {
      disposedRef.current = true;
      generationRef.current += 1;
      clearTimeout(retryRef.current);
      clearTimeout(realtimeFlushRef.current);
      realtimeFlushRef.current = null;
      realtimeQueueRef.current.clear();
      if (esRef.current) esRef.current.close();
      esRef.current = null;
    };
  }, [connect]);

  /**
   * send(event, data) — maps legacy WS event names to HTTP POST endpoints.
   * Commands are dispatched immediately over independent TCP connections
   * (browser connection pool), so multiple commands are truly parallel.
   */
  const send = useCallback((event, data) => {
    const token = tokenStorageKey
      ? localStorage.getItem(tokenStorageKey)
      : (localStorage.getItem('admin_token') || localStorage.getItem('user_token'));

    // ── command:send → POST /api/commands ────────────────────────────
    if (event === 'command:send') {
      const { deviceId, command, params } = data || {};
      fetch('/api/commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ deviceId, command, params: params ?? null,
                               sseClientId: sseIdRef.current }),
      })
        .then(async r => {
          const d = await r.json().catch(() => ({}));
          // 402 → trial expired; surface as a paywall event so the dashboard
          // can re-render the lock screen even if the user state was stale.
          if (r.status === 402) {
            onMessageRef.current('subscription:locked', { paywall: d.paywall, deviceId, command });
            onMessageRef.current('command:error', { message: d.message || 'Subscription required', deviceId, command });
            return null;
          }
          return d;
        })
        .then(d => {
          if (!d) return;
          if (d.commandId) {
            // Synthesise a command:sent event so App.jsx pending-map stays in sync
            onMessageRef.current('command:sent', {
              commandId: d.commandId, command: d.command,
              deviceId: d.deviceId, params: d.params,
              status: 'executing', timestamp: d.timestamp,
            });
          } else if (d.error) {
            onMessageRef.current('command:error', { message: d.error, deviceId, command });
          }
        })
        .catch(err => {
          onMessageRef.current('command:error', { message: err.message });
        });
      return;
    }

    // ── dashboard:ping → POST /api/dashboard/ping ────────────────────
    if (event === 'dashboard:ping') {
      const sentAt = data?.sentAt ?? Date.now();
      fetch('/api/dashboard/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentAt }),
      })
        .then(r => r.json())
        .then(d => onMessageRef.current('dashboard:pong', { sentAt: d.sentAt, serverAt: d.serverAt }))
        .catch(() => {});
      return;
    }

    // ── recording:start → POST /api/recordings/:deviceId/start ───────
    if (event === 'recording:start') {
      const { deviceId } = data || {};
      if (!deviceId) return;
      fetch(`/api/recordings/${encodeURIComponent(deviceId)}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   'Authorization': `Bearer ${token}` },
        body: JSON.stringify({}),
      }).catch(() => {});
      return;
    }

    // ── recording:stop → POST /api/recordings/:deviceId/stop ─────────
    if (event === 'recording:stop') {
      const { deviceId } = data || {};
      if (!deviceId) return;
      fetch(`/api/recordings/${encodeURIComponent(deviceId)}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   'Authorization': `Bearer ${token}` },
        body: JSON.stringify({}),
      }).catch(() => {});
      return;
    }

    // ── fallback: ignore (was dashboard:get_devices, commands:get_registry
    //    — server pushes those on SSE connect automatically) ──────────
  }, []);

  return { connected, reconnecting, send };
}
