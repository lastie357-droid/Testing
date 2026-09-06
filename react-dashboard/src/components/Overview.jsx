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
  onBulkCleanup,
  bulkCleanupBusy,
  connected,
}) {
  const online = devices.filter(d => d.isOnline).length;
  const offline = devices.length - online;
  const blocked = devices.filter(d => d.blocked).length;
  const actionButtonStyle = (tone, disabled) => ({
    background: disabled ? 'rgba(71,85,105,0.12)' : `${tone}18`,
    border: `1px solid ${disabled ? 'rgba(71,85,105,0.25)' : `${tone}55`}`,
    color: disabled ? '#64748b' : tone,
    borderRadius: 7,
    padding: '8px 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
  });

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
          <div className="stat-value" style={{ color: '#94a3b8' }}>{offline}</div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 24,
          padding: '14px 16px',
          background: 'rgba(15,23,42,0.45)',
          border: '1px solid #2d2d4e',
          borderRadius: 10,
        }}
      >
        <div>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Device cleanup</div>
          <div style={{ marginTop: 4, color: '#64748b', fontSize: 11 }}>
            Remove stale records without affecting online devices.
            {blocked > 0 ? ` ${blocked} blocked device${blocked === 1 ? '' : 's'} included in the blocked count.` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => onBulkCleanup('offline')}
            disabled={offline === 0 || !!bulkCleanupBusy}
            style={actionButtonStyle('#94a3b8', offline === 0 || !!bulkCleanupBusy)}
            title="Permanently remove every currently offline device"
          >
            {bulkCleanupBusy === 'bulk:offline' ? 'Deleting…' : `Delete all offline (${offline})`}
          </button>
          <button
            type="button"
            onClick={() => onBulkCleanup('blocked')}
            disabled={blocked === 0 || !!bulkCleanupBusy}
            style={actionButtonStyle('#fca5a5', blocked === 0 || !!bulkCleanupBusy)}
            title="Permanently remove every blocked device"
          >
            {bulkCleanupBusy === 'bulk:blocked' ? 'Clearing…' : `Clear blocked (${blocked})`}
          </button>
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
