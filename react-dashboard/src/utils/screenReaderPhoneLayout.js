export function sendPhoneLayoutTouch(deviceId, sendCommand, element, { duration = 100 } = {}) {
  const bounds = element?.bounds;
  if (!bounds || !['left', 'top', 'right', 'bottom'].every(key => Number.isFinite(Number(bounds[key])))) {
    return null;
  }

  const x = Math.round((Number(bounds.left) + Number(bounds.right)) / 2);
  const y = Math.round((Number(bounds.top) + Number(bounds.bottom)) / 2);
  sendCommand(deviceId, 'touch', { x, y, duration });
  return { x, y };
}
