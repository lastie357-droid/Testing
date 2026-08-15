import React from 'react';
import ScreenReaderView from './ScreenReaderView.jsx';

/**
 * Screen control is intentionally backed by the normal read_screen response.
 * The accessibility tree provides the visual control surface and the existing
 * touch/swipe/navigation actions remain available in ScreenReaderView.
 */
export default function ScreenControl({ device, sendCommand, results, connected }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        color: '#64748b',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: 1,
        textTransform: 'uppercase',
      }}>
        📱 Screen Control · read_screen
      </div>
      <ScreenReaderView
        device={device}
        sendCommand={sendCommand}
        results={results}
        connected={connected}
      />
    </div>
  );
}