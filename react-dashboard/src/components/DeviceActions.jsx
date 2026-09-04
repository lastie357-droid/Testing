import React from 'react';

export default function DeviceActions({ device, onBlock, onDelete, busy = false, compact = false }) {
  const blocked = !!device.blocked;

  const buttonStyle = (background, border, color) => ({
    background,
    border: `1px solid ${border}`,
    borderRadius: 6,
    color,
    padding: compact ? '3px 6px' : '5px 9px',
    fontSize: compact ? 10 : 11,
    fontWeight: 600,
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.55 : 1,
    whiteSpace: 'nowrap',
  });

  return (
    <div
      role="group"
      aria-label={`Actions for ${device.deviceName || device.deviceId}`}
      onClick={event => event.stopPropagation()}
      style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}
    >
      <button
        type="button"
        title={blocked ? 'Allow this device to reconnect' : 'Block this device and reject future connections'}
        onClick={() => onBlock(device)}
        disabled={busy}
        style={buttonStyle(
          blocked ? 'rgba(34,197,94,0.12)' : 'rgba(245,158,11,0.12)',
          blocked ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.35)',
          blocked ? '#86efac' : '#fbbf24',
        )}
      >
        {busy ? '…' : blocked ? '↗ Allow' : '⛔ Block'}
      </button>
      <button
        type="button"
        title="Delete this device from the dashboard"
        onClick={() => onDelete(device)}
        disabled={busy}
        style={buttonStyle('rgba(239,68,68,0.12)', 'rgba(239,68,68,0.35)', '#fca5a5')}
      >
        {busy ? '…' : '🗑 Delete'}
      </button>
    </div>
  );
}