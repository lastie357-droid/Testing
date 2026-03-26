import React from 'react';

export default function StatusBar({ connected, reconnecting, deviceCount }) {
  return (
    <div className="status-bar">
      <span className="logo">⚡ CONTROL PANEL</span>
      <span>
        <span className={`dot ${connected ? 'green' : reconnecting ? 'yellow' : 'red'}`} />
        {connected ? 'Server Connected' : reconnecting ? 'Reconnecting...' : 'Disconnected'}
      </span>
      <span style={{ color: '#94a3b8', fontSize: 13 }}>
        📱 {deviceCount} device{deviceCount !== 1 ? 's' : ''} online
      </span>
    </div>
  );
}
