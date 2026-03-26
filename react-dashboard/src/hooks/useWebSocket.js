import { useEffect, useRef, useCallback, useState } from 'react';

export function useWebSocket(onMessage) {
  const wsRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const retryRef = useRef(null);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const connect = useCallback(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host;
    const url = `${proto}://${host}/ws`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setReconnecting(false);
      clearTimeout(retryRef.current);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        onMessageRef.current(msg.event, msg.data);
      } catch (_) {}
    };

    ws.onclose = () => {
      setConnected(false);
      setReconnecting(true);
      retryRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(retryRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [connect]);

  const send = useCallback((event, data) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ event, data }));
    }
  }, []);

  return { connected, reconnecting, send };
}
