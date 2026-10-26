import { useCallback, useEffect, useRef } from 'react';

/**
 * Coalesce bursts of device connect/disconnect/heartbeat events into one
 * dashboard render per animation frame instead of rerendering the full device
 * view once for every TCP client event.
 */
export function useBatchedDeviceEvents(setDevices, setActivityLog) {
  const pendingDevicesRef = useRef(new Map());
  const pendingActivityRef = useRef([]);
  const animationFrameRef = useRef(null);
  const activitySequenceRef = useRef(0);

  const flush = useCallback(() => {
    animationFrameRef.current = null;
    const updates = [...pendingDevicesRef.current.values()];
    const activities = pendingActivityRef.current;
    pendingDevicesRef.current.clear();
    pendingActivityRef.current = [];

    if (updates.length) {
      setDevices(previous => {
        const byId = new Map(previous.map(device => [device.deviceId, device]));
        for (const update of updates) {
          const current = byId.get(update.deviceId);
          byId.set(update.deviceId, {
            ...(current || {}),
            ...update,
            deviceName: update.deviceName || current?.deviceName || update.deviceId,
            accessId: update.accessId || current?.accessId || '',
            deviceInfo: {
              ...(current?.deviceInfo || {}),
              ...(update.deviceInfo || {}),
            },
          });
        }
        return [...byId.values()];
      });
    }

    if (activities.length) {
      setActivityLog(previous => [...activities.reverse(), ...previous].slice(0, 100));
    }
  }, [setDevices, setActivityLog]);

  const enqueueDeviceEvent = useCallback((event, data) => {
    const deviceId = data?.deviceId;
    if (!deviceId) return;

    const timestamp = data.timestamp || new Date().toISOString();
    const existing = pendingDevicesRef.current.get(deviceId) || { deviceId };
    let update;

    if (event === 'device:connected') {
      update = {
        isOnline: true,
        deviceName: data.deviceInfo?.name || deviceId,
        deviceInfo: data.deviceInfo || {},
        accessId: data.accessId || '',
        registeredAt: timestamp,
        lastSeen: timestamp,
      };
      pendingActivityRef.current.push({
        id: `device-connect-${Date.now()}-${activitySequenceRef.current++}`,
        type: 'connect',
        text: `Device connected: ${deviceId}`,
        time: new Date(),
      });
    } else if (event === 'device:disconnected') {
      update = { isOnline: false, lastSeen: timestamp };
      pendingActivityRef.current.push({
        id: `device-disconnect-${Date.now()}-${activitySequenceRef.current++}`,
        type: 'disconnect',
        text: `Device disconnected: ${deviceId}`,
        time: new Date(),
      });
    } else if (event === 'device:heartbeat' || event === 'device:latency') {
      update = { isOnline: true, lastSeen: timestamp };
    } else {
      return;
    }

    pendingDevicesRef.current.set(deviceId, { ...existing, ...update });
    if (animationFrameRef.current === null) {
      animationFrameRef.current = requestAnimationFrame(flush);
    }
  }, [flush]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    pendingDevicesRef.current.clear();
    pendingActivityRef.current = [];
  }, []);

  return enqueueDeviceEvent;
}
