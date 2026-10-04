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
export function useTcpStream(onMessage, tokenStorageKey = null) {
  const [connected, setConnected]     = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const esRef         = useRef(null);
  const retryRef      = useRef(null);
  const watchdogRef   = useRef(null);
  const connectRef    = useRef(null);
  const generationRef = useRef(0);
  const disposedRef   = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const lastMessageAtRef = useRef(0);
  const sseIdRef      = useRef(null);   // assigned by server via session:init
  const onMessageRef  = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    if (disposedRef.current) return;
    // Each dashboard uses its own token. Do not let an old admin token in the
    // same browser override a user's JWT and cause an endless SSE reconnect.
    const token = tokenStorageKey
      ? localStorage.getItem(tokenStorageKey)
      : (localStorage.getItem('admin_token') || localStorage.getItem('user_token'));
    if (!token) {
      setConnected(false);
      setReconnecting(false);
      return;
    }

    // Never allow two EventSource instances to survive a reconnect race.
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    clearInterval(watchdogRef.current);
    watchdogRef.current = null;
    const generation = ++generationRef.current;

    // EventSource opens a persistent TCP connection. Our watchdog detects a
    // half-open connection that EventSource itself may not report as failed.
    const es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
    esRef.current = es;

    const failConnection = () => {
      if (generation !== generationRef.current || disposedRef.current) return;
      generationRef.current += 1;
      setConnected(false);
      setReconnecting(true);
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
      if (esRef.current === es) esRef.current = null;
      es.close();
      clearTimeout(retryRef.current);
      const delay = Math.min(3000 * (2 ** reconnectAttemptRef.current), 30000);
      reconnectAttemptRef.current = Math.min(reconnectAttemptRef.current + 1, 4);
      retryRef.current = setTimeout(() => {
        retryRef.current = null;
        connectRef.current?.();
      }, delay);
    };

    es.onopen = () => {
      if (generation !== generationRef.current || disposedRef.current) return;
      setConnected(true);
      setReconnecting(false);
      reconnectAttemptRef.current = 0;
      lastMessageAtRef.current = Date.now();
      clearTimeout(retryRef.current);
      clearInterval(watchdogRef.current);
      watchdogRef.current = setInterval(() => {
        if (generation !== generationRef.current || disposedRef.current) return;
        if (Date.now() - lastMessageAtRef.current > 70000) failConnection();
      }, 15000);
    };

    es.onmessage = (e) => {
      if (generation !== generationRef.current || disposedRef.current) return;
      lastMessageAtRef.current = Date.now();
      try {
        const msg = JSON.parse(e.data);
        // Capture our sseClientId the first time the server sends it
        if (msg.event === 'session:init' && msg.data?.sseClientId) {
          sseIdRef.current = msg.data.sseClientId;
          sessionStorage.setItem('sseClientId', msg.data.sseClientId);
        }
        onMessageRef.current(msg.event, msg.data);
      } catch (_) {}
    };

    es.onerror = () => {
      if (generation !== generationRef.current || disposedRef.current) return;
      // EventSource would retry automatically; close it and use bounded backoff.
      failConnection();
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
      clearInterval(watchdogRef.current);
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
