const GLOBAL_DEVICE_EVENTS = new Set([
  'device:list',
  'device:connected',
  'device:disconnected',
  'device:status',
  'device:heartbeat',
]);

export function shouldProcessDeviceEvent(event, data, selectedDeviceId) {
  const eventDeviceId = data?.deviceId;
  if (!eventDeviceId || GLOBAL_DEVICE_EVENTS.has(event)) return true;
  if (!selectedDeviceId) return false;
  return String(selectedDeviceId) === String(eventDeviceId);
}

export function deviceCommandKey(deviceId, commandId) {
  return `${deviceId || 'unknown'}:${commandId}`;
}

export function applyDeviceHeartbeat(devices, data, now = Date.now()) {
  if (!Array.isArray(devices) || !data?.deviceId) return devices;
  const current = devices.find(device => device.deviceId === data.deviceId);
  if (!current) return devices;

  const lastSeenAt = Date.parse(current.lastSeen);
  const refreshTimestamp = !Number.isFinite(lastSeenAt) || now - lastSeenAt >= 60000;
  if (current.isOnline && !refreshTimestamp) return devices;

  const timestamp = data.timestamp || new Date(now).toISOString();
  return devices.map(device => device.deviceId === data.deviceId
    ? {
        ...device,
        isOnline: true,
        lastSeen: !current.isOnline || refreshTimestamp ? timestamp : device.lastSeen,
      }
    : device);
}
