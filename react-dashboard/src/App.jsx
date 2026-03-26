import React, { useState, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket.js';
import Sidebar from './components/Sidebar.jsx';
import DeviceControl from './components/DeviceControl.jsx';
import Overview from './components/Overview.jsx';
import StatusBar from './components/StatusBar.jsx';
import './App.css';

export default function App() {
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [commandResults, setCommandResults] = useState([]);
  const [pendingCommands, setPendingCommands] = useState({});
  const [activityLog, setActivityLog] = useState([]);
  const [streamFrames, setStreamFrames] = useState({});

  const handleMessage = useCallback((event, data) => {
    switch (event) {
      case 'device:list':
        setDevices(Array.isArray(data) ? data : []);
        break;

      case 'device:connected':
        setActivityLog(prev => [{
          id: Date.now(),
          type: 'connect',
          text: `Device connected: ${data.deviceId}`,
          time: new Date()
        }, ...prev].slice(0, 100));
        break;

      case 'device:disconnected':
        setActivityLog(prev => [{
          id: Date.now(),
          type: 'disconnect',
          text: `Device disconnected: ${data.deviceId}`,
          time: new Date()
        }, ...prev].slice(0, 100));
        setDevices(prev =>
          prev.map(d => d.deviceId === data.deviceId ? { ...d, isOnline: false } : d)
        );
        break;

      case 'device:heartbeat':
        setDevices(prev =>
          prev.map(d => d.deviceId === data.deviceId ? { ...d, isOnline: true, lastSeen: data.timestamp } : d)
        );
        break;

      case 'command:sent':
        setPendingCommands(prev => ({ ...prev, [data.commandId]: data }));
        break;

      case 'command:result': {
        setPendingCommands(prev => {
          const next = { ...prev };
          delete next[data.commandId];
          return next;
        });
        const result = {
          id: data.commandId || Date.now(),
          command: data.command,
          deviceId: data.deviceId,
          success: data.success,
          response: data.response,
          error: data.error,
          time: new Date()
        };
        setCommandResults(prev => [result, ...prev].slice(0, 200));
        setActivityLog(prev => [{
          id: Date.now(),
          type: data.success ? 'success' : 'error',
          text: `${data.command} → ${data.success ? 'OK' : data.error}`,
          time: new Date()
        }, ...prev].slice(0, 100));
        break;
      }

      case 'command:error':
        setCommandResults(prev => [{
          id: Date.now(),
          command: data.command || 'unknown',
          deviceId: data.deviceId,
          success: false,
          error: data.message,
          time: new Date()
        }, ...prev].slice(0, 200));
        break;

      case 'stream:frame':
        if (data.deviceId && data.frameData) {
          setStreamFrames(prev => ({ ...prev, [data.deviceId]: data.frameData }));
        }
        break;

      case 'recording:started':
      case 'recording:saved':
      case 'recording:error':
        break;

      default:
        break;
    }
  }, []);

  const { connected, reconnecting, send } = useWebSocket(handleMessage);

  const sendCommand = useCallback((deviceId, command, params = null) => {
    send('command:send', { deviceId, command, params });
  }, [send]);

  return (
    <div className="app">
      <StatusBar connected={connected} reconnecting={reconnecting} deviceCount={devices.filter(d => d.isOnline).length} />
      <div className="app-body">
        <Sidebar
          devices={devices}
          selectedDevice={selectedDevice}
          onSelectDevice={setSelectedDevice}
        />
        <main className="main-content">
          {selectedDevice ? (
            <DeviceControl
              device={devices.find(d => d.deviceId === selectedDevice) || { deviceId: selectedDevice }}
              sendCommand={sendCommand}
              results={commandResults.filter(r => r.deviceId === selectedDevice)}
              pending={Object.values(pendingCommands).filter(c => c.deviceId === selectedDevice)}
              onBack={() => setSelectedDevice(null)}
              streamFrame={streamFrames[selectedDevice] || null}
              send={send}
            />
          ) : (
            <Overview
              devices={devices}
              activityLog={activityLog}
              onSelectDevice={setSelectedDevice}
              connected={connected}
            />
          )}
        </main>
      </div>
    </div>
  );
}
