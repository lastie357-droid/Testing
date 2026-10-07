const GLOBAL_DEVICE_EVENTS = new Set([
  'device:list',
  'device:connected',
  'device:disconnected',
  'device:status',
  'device:heartbeat',
  'device:latency',
  'device:pong',
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
