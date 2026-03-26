import React, { useState } from 'react';
import CommandPanel from './CommandPanel.jsx';
import ResultPanel from './ResultPanel.jsx';

export default function DeviceControl({ device, sendCommand, results, pending, onBack }) {
  const [activeResult, setActiveResult] = useState(null);
  const info = device.deviceInfo || {};

  const handleCommand = (command, params) => {
    sendCommand(device.deviceId, command, params);
  };

  const isOnline = device.isOnline;

  return (
    <div className="device-control">
      <div className="dc-header">
        <button className="btn-back" onClick={onBack}>← Back</button>
        <span style={{ fontSize: 22 }}>📱</span>
        <div>
          <div className="dc-title">{device.deviceName || device.deviceId}</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            {info.manufacturer} {info.model} · Android {info.androidVersion || 'N/A'}
          </div>
        </div>
        <span className={`dc-status ${isOnline ? 'online' : 'offline'}`}>
          {isOnline ? '● ONLINE' : '● OFFLINE'}
        </span>
      </div>

      {!isOnline && (
        <div style={{
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 8,
          padding: '10px 14px',
          marginBottom: 16,
          color: '#ef4444',
          fontSize: 13
        }}>
          ⚠️ Device is offline. Commands will fail until device reconnects.
        </div>
      )}

      {pending.length > 0 && (
        <div className="pending-banner">
          ⏳ {pending.length} command{pending.length > 1 ? 's' : ''} waiting for device response...
        </div>
      )}

      <div className="device-info-grid">
        <div className="di-item">
          <div className="di-label">Device ID</div>
          <div className="di-value" style={{ fontSize: 11, fontFamily: 'monospace' }}>
            {device.deviceId}
          </div>
        </div>
        <div className="di-item">
          <div className="di-label">Model</div>
          <div className="di-value">{info.model || '—'}</div>
        </div>
        <div className="di-item">
          <div className="di-label">Manufacturer</div>
          <div className="di-value">{info.manufacturer || '—'}</div>
        </div>
        <div className="di-item">
          <div className="di-label">Android</div>
          <div className="di-value">{info.androidVersion || '—'}</div>
        </div>
      </div>

      <div className="dc-layout">
        <CommandPanel
          onSend={handleCommand}
          disabled={!isOnline}
          pendingCommands={pending.map(p => p.command)}
        />
        <ResultPanel
          results={results}
          activeResult={activeResult}
          onSelect={setActiveResult}
        />
      </div>
    </div>
  );
}
