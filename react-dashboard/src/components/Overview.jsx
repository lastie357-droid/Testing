import React from 'react';
import { formatDateTime } from '../utils/dateTime.js';
import DeviceActions from './DeviceActions.jsx';

const ICONS = { connect: '🟢', disconnect: '🔴', success: '✅', error: '❌', info: 'ℹ️' };

export default function Overview({
  devices,
  activityLog,
  onSelectDevice,
  onBlockDevice,
  onDeleteDevice,
  deviceActionBusy,
  onBulkDeviceAction,
  bulkActionBusy,
  connected,
}) {
  const online = devices.filter(d => d.isOnline).length;
  const blocked = devices.filter(d => d.blocked).length;
  const offline = devices.length - online;

  const bulkButton = (background, label, action, count, disabled = false) => (
    <button
      type="button"
      onClick={() => onBulkDeviceAction(action)}
      disabled={bulkActionBusy || disabled}
      style={{
        border: '1px solid rgba(148,163,184,0.2)',
        borderRadius: 7,
        padding: '8px 11px',
        background,
        color: '#f8fafc',
        fontSize: 11,
        fontWeight: 700,
        cursor: bulkActionBusy || disabled ? 'not-allowed' : 'pointer',
        opacity: bulkActionBusy || disabled ? 0.45 : 1,
        whiteSpace: 'nowrap',
      }}
    >
      {label} <span style={{ color: '#cbd5e1', fontWeight: 500 }}>({count})</span>
    </button>
  );

  return (
    <div className="overview">
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Devices</div>
          <div className="stat-value">{devices.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Online Now</div>
          <div className="stat-value" style={{ color: online > 0 ? '#22c55e' : '#ef4444' }}>{online}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Server Status</div>
          <div className="stat-value" style={{ fontSize: 18, marginTop: 4 }}>
            {connected ? '🟢 Live' : '🔴 Down'}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Offline Devices</div>
          <div className="stat-value" style={{ color: '#94a3b8' }}>{devices.length - online}</div>
        </div>
      </div>

      <div style={{
        marginBottom: 24,
        padding: 14,
        borderRadius: 10,
        border: '1px solid #2d2d4e',
        background: 'rgba(22,33,62,0.72)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <div className="section-title" style={{ margin: 0 }}>🛡️ Device Control Center</div>
          {bulkActionBusy && <span style={{ fontSize: 11, color: '#a5b4fc' }}>Updating devices…</span>}
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 11 }}>
          Use these admin actions to manage the full device list. Deletions disconnect online devices and cannot be undone.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {bulkButton('#14532d', '↗ Unblock all', 'unblock-all', blocked, blocked === 0)}
          {bulkButton('#7f1d1d', '🗑 Delete blocked', 'delete-blocked', blocked, blocked === 0)}
          {bulkButton('#991b1b', '🗑 Delete offline', 'delete-offline', offline, offline === 0)}
          {bulkButton('#450a0a', '⚠ Delete all devices', 'delete-all', devices.length, devices.length === 0)}
        </div>
      </div>

      {devices.filter(d => d.isOnline).length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="section-title">Online Devices — Click to Control</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {devices.filter(d => d.isOnline).map(d => (
              <div
                key={d.deviceId}
                onClick={() => onSelectDevice(d.deviceId)}
                style={{
                  background: '#16213e',
                  border: '1px solid #2d2d4e',
                  borderLeft: '4px solid #22c55e',
                  borderRadius: 10,
                  padding: 16,
                  cursor: 'pointer',
                  transition: 'all 0.15s'
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(124,58,237,0.12)'}
                onMouseLeave={e => e.currentTarget.style.background = '#16213e'}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 24 }}>📱</span>
                  <div>
                    <div style={{ fontWeight: 700 }}>{d.deviceName || d.deviceId}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>
                      {d.deviceInfo?.manufacturer} {d.deviceInfo?.model}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8' }}>
                  Android {d.deviceInfo?.androidVersion || 'N/A'} &nbsp;·&nbsp;
                  Last seen: {formatDateTime(d.lastSeen || d.registeredAt)}
                  <br />
                  Registered: {formatDateTime(d.registeredAt)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
                  <div style={{ fontSize: 12, color: '#7c3aed', fontWeight: 600 }}>
                    → Open Control Panel
                  </div>
                  <DeviceActions
                    device={d}
                    onBlock={onBlockDevice}
                    onDelete={onDeleteDevice}
                    busy={deviceActionBusy === d.deviceId}
                    compact
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {devices.filter(d => !d.isOnline).length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="section-title" style={{ color: '#94a3b8' }}>Offline Devices</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {devices.filter(d => !d.isOnline).map(d => (
              <div
                key={d.deviceId}
                style={{
                  background: '#16213e',
                  border: '1px solid #2d2d4e',
                  borderLeft: '4px solid #475569',
                  borderRadius: 10,
                  padding: 16,
                  opacity: 0.65,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <span style={{ fontSize: 24, filter: 'grayscale(1)' }}>📱</span>
                  <div>
                    <div style={{ fontWeight: 700, color: '#94a3b8' }}>{d.deviceName || d.deviceId}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>
                      {d.deviceInfo?.manufacturer} {d.deviceInfo?.model}
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: '#475569' }}>
                  Android {d.deviceInfo?.androidVersion || 'N/A'} &nbsp;·&nbsp;
                  Last seen: {formatDateTime(d.lastSeen)}
                  <br />
                  Registered: {formatDateTime(d.registeredAt)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>
                    🔴 Offline
                  </div>
                  <DeviceActions
                    device={d}
                    onBlock={onBlockDevice}
                    onDelete={onDeleteDevice}
                    busy={deviceActionBusy === d.deviceId}
                    compact
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="section-title">Activity Log</div>
        <div className="activity-log">
          {activityLog.length === 0 && (
            <div className="empty">
              <div className="empty-icon">📋</div>
              <div className="empty-text">No activity yet</div>
            </div>
          )}
          {activityLog.map(a => (
            <div key={a.id} className="activity-item">
              <span className="activity-icon">{ICONS[a.type] || 'ℹ️'}</span>
              <span>{a.text}</span>
              <span className="activity-time">{formatDateTime(a.time)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
