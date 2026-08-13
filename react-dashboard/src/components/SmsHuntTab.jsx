import React, { useEffect, useMemo, useRef, useState } from 'react';
import { formatDateTime } from '../utils/dateTime.js';

const EMPTY_DRAFT = {
  name: 'New SMS Hunt',
  targetMode: 'phone',
  target: '',
  enabled: true,
  scheduleOnConnect: false,
};

const authHeaders = () => {
  const token = localStorage.getItem('admin_token') || localStorage.getItem('user_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

function mergeMessages(current, incoming) {
  const byKey = new Map();
  [...current, ...incoming].forEach(message => {
    const key = String(message?._id || message?.messageKey || `${message?.date}:${message?.sender}:${message?.body}`);
    if (message) byKey.set(key, message);
  });
  return [...byKey.values()].sort((a, b) => Number(b.date || 0) - Number(a.date || 0));
}

const messageIdentity = (message) => String(
  message?._id || message?.messageKey || `${message?.date}:${message?.sender}:${message?.body}`,
);

export default function SmsHuntTab({
  device,
  sendCommand,
  results = [],
  pendingCommands = [],
  incomingMessages = [],
}) {
  const deviceId = device?.deviceId;
  const isOnline = !!device?.isOnline;
  const [hunts, setHunts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [selectedHuntId, setSelectedHuntId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState(() => new Set());
  const [syncRequestedAt, setSyncRequestedAt] = useState(0);
  const [syncState, setSyncState] = useState({ status: 'idle', message: '' });
  const [health, setHealth] = useState({ loading: true, mongodb: 'unknown', redis: 'unknown' });
  const deletedMessageKeysRef = useRef(new Set());

  const flash = (message) => {
    setStatusMsg(message);
    window.setTimeout(() => setStatusMsg(''), 3500);
  };

  const load = async () => {
    if (!deviceId) return;
    setLoading(true);
    try {
      const query = encodeURIComponent(deviceId);
      const [huntRes, messageRes, healthRes] = await Promise.all([
        fetch(`/api/sms-hunt?deviceId=${query}`, { headers: authHeaders() }),
        fetch(`/api/sms-hunt/messages?deviceId=${query}`, { headers: authHeaders() }),
        fetch('/api/health', { headers: authHeaders() }),
      ]);
      const huntData = await huntRes.json();
      const messageData = await messageRes.json();
      if (!huntRes.ok || !huntData.success) throw new Error(huntData.error || 'Could not load hunts');
      if (!messageRes.ok || !messageData.success) throw new Error(messageData.error || 'Could not load captured messages');
      setHunts(Array.isArray(huntData.hunts) ? huntData.hunts : []);
      setMessages(Array.isArray(messageData.messages) ? messageData.messages : []);
      if (healthRes.ok) {
        const healthData = await healthRes.json();
        setHealth({
          loading: false,
          mongodb: healthData.mongodb || 'unknown',
          redis: healthData.redis || 'unknown',
        });
      } else {
        setHealth(current => ({ ...current, loading: false }));
      }
    } catch (error) {
      flash(error.message || 'Could not load SMS Hunt');
    } finally {
      setLoading(false);
      setHealth(current => ({ ...current, loading: false }));
    }
  };

  useEffect(() => {
    setHunts([]);
    setMessages([]);
    setSelectedHuntId(null);
    setDraft(EMPTY_DRAFT);
    setSelectedMessageIds(new Set());
    setSyncState({ status: 'idle', message: '' });
    load();
  }, [deviceId]);

  useEffect(() => {
    if (incomingMessages.length) {
      setMessages(current => mergeMessages(
        current,
        incomingMessages.filter(message => !deletedMessageKeysRef.current.has(messageIdentity(message))),
      ));
    }
  }, [incomingMessages]);

  const visibleMessages = useMemo(() => {
    if (!selectedHuntId) return messages;
    return messages.filter(message => (message.huntIds || []).some(id => String(id) === String(selectedHuntId)));
  }, [messages, selectedHuntId]);

  useEffect(() => {
    if (!syncRequestedAt) return;
    const result = results.find(item => (
      item.command === 'set_sms_hunts'
      && String(item.deviceId) === String(deviceId)
      && new Date(item.time || 0).getTime() >= syncRequestedAt
    ));
    if (!result) return;
    const count = result.response?.hunts;
    const deviceAccepted = result.success !== false && result.response?.success !== false;
    setSyncState({
      status: deviceAccepted ? 'success' : 'error',
      message: deviceAccepted
        ? `Device received ${Number.isFinite(Number(count)) ? count : 'the'} hunt rule${Number(count) === 1 ? '' : 's'}.`
        : (result.error || result.response?.error || 'Device rejected the hunt sync.'),
    });
  }, [results, syncRequestedAt, deviceId]);

  useEffect(() => {
    setSelectedMessageIds(current => {
      const visibleIds = new Set(visibleMessages.map(message => String(message._id || message.messageKey)));
      const next = new Set([...current].filter(id => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleMessages]);

  const selectedHunt = hunts.find(hunt => String(hunt._id) === String(selectedHuntId));

  const selectHunt = (hunt) => {
    setSelectedHuntId(hunt._id);
    setDraft({
      name: hunt.name || '',
      targetMode: hunt.targetMode || 'phone',
      target: hunt.target || '',
      enabled: hunt.enabled !== false,
      scheduleOnConnect: !!hunt.scheduleOnConnect,
    });
  };

  const newHunt = () => {
    setSelectedHuntId(null);
    setDraft({ ...EMPTY_DRAFT, name: `SMS Hunt ${hunts.length + 1}` });
  };

  const save = async (event) => {
    event.preventDefault();
    if (!draft.name.trim() || !draft.target.trim()) {
      flash('Give this hunt a name and a sender number or contact name.');
      return;
    }
    setSaving(true);
    const requestStartedAt = Date.now();
    try {
      const response = await fetch('/api/sms-hunt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          _id: selectedHuntId || null,
          deviceId,
          ...draft,
          name: draft.name.trim(),
          target: draft.target.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not save hunt');
      setHunts(current => {
        const next = current.filter(hunt => String(hunt._id) !== String(data.hunt._id));
        return [data.hunt, ...next].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      });
      setSelectedHuntId(data.hunt._id);
      if (isOnline && !data.hunt.scheduleOnConnect) setSyncRequestedAt(requestStartedAt);
      setSyncState({ status: data.hunt.scheduleOnConnect ? 'queued' : 'pending', message: data.hunt.scheduleOnConnect
        ? 'Saved and queued for the next device connection.'
        : isOnline ? 'Saved. Waiting for the device acknowledgement…' : 'Saved locally on the server; it will sync when the device reconnects.' });
      flash(data.hunt.scheduleOnConnect
        ? 'Hunt saved — it will sync on the next device connection.'
        : isOnline ? 'Hunt saved and synced to the device.' : 'Hunt saved for this device.');
    } catch (error) {
      flash(error.message || 'Could not save hunt');
    } finally {
      setSaving(false);
    }
  };

  const syncHunts = () => {
    if (!isOnline) {
      setSyncState({ status: 'queued', message: 'Device is offline. The saved hunts will sync automatically when it reconnects.' });
      flash('Device offline — hunt sync queued for reconnect.');
      return;
    }
    const requestedAt = Date.now();
    setSyncRequestedAt(requestedAt);
    setSyncState({ status: 'pending', message: 'Sending saved hunts to the device…' });
    sendCommand?.(deviceId, 'set_sms_hunts', {
      hunts: hunts.filter(hunt => hunt.enabled !== false).map(hunt => ({
        huntId: String(hunt._id),
        name: hunt.name,
        targetMode: hunt.targetMode,
        target: hunt.target,
        enabled: hunt.enabled !== false,
      })),
    });
  };

  const deleteHunt = async () => {
    if (!confirmDelete?.hunt?._id) return;
    try {
      const response = await fetch(`/api/sms-hunt/${confirmDelete.hunt._id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not delete hunt');
      setHunts(current => current.filter(hunt => String(hunt._id) !== String(confirmDelete.hunt._id)));
      if (String(selectedHuntId) === String(confirmDelete.hunt._id)) newHunt();
      flash(data.deviceSync === 'queued'
        ? 'Hunt deleted. The device is offline; removal will sync when it reconnects.'
        : 'Hunt deleted from this device.');
    } catch (error) {
      flash(error.message || 'Could not delete hunt');
    } finally {
      setConfirmDelete(null);
    }
  };

  const deleteMessage = async () => {
    const message = confirmDelete?.message;
    const messageId = message && messageIdentity(message);
    if (!messageId) return;
    try {
      const response = await fetch(`/api/sms-hunt/messages/${encodeURIComponent(messageId)}?deviceId=${encodeURIComponent(deviceId || '')}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || 'Could not delete message');
      deletedMessageKeysRef.current.add(messageId);
      if (data.deletedId) deletedMessageKeysRef.current.add(String(data.deletedId));
      setMessages(current => current.filter(item => ![
        messageIdentity(item),
        String(item?._id || ''),
        String(item?.messageKey || ''),
      ].includes(messageId)));
      setSelectedMessageIds(current => {
        const next = new Set(current);
        next.delete(messageId);
        return next;
      });
      flash('Captured message deleted.');
    } catch (error) {
      flash(error.message || 'Could not delete message');
    } finally {
      setConfirmDelete(null);
    }
  };

  const deleteSelectedMessages = async () => {
    const ids = [...selectedMessageIds];
    if (!ids.length) return;
    setSaving(true);
    try {
      const responses = await Promise.all(ids.map(id => fetch(`/api/sms-hunt/messages/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })));
      const payloads = await Promise.all(responses.map(response => response.json()));
      const failed = payloads.find((payload, index) => !responses[index].ok || !payload.success);
      if (failed) throw new Error(failed.error || 'Could not delete all selected messages');
      ids.forEach(id => deletedMessageKeysRef.current.add(String(id)));
      setMessages(current => current.filter(message => !selectedMessageIds.has(messageIdentity(message))));
      setSelectedMessageIds(new Set());
      flash(`${ids.length} captured message${ids.length === 1 ? '' : 's'} deleted.`);
    } catch (error) {
      flash(error.message || 'Could not delete selected messages');
    } finally {
      setSaving(false);
    }
  };

  const toggleMessage = (message) => {
    const id = String(message._id || message.messageKey);
    setSelectedMessageIds(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = visibleMessages.length > 0
    && visibleMessages.every(message => selectedMessageIds.has(String(message._id || message.messageKey)));

  const toggleAllVisible = () => {
    setSelectedMessageIds(current => {
      const next = new Set(current);
      if (allVisibleSelected) {
        visibleMessages.forEach(message => next.delete(String(message._id || message.messageKey)));
      } else {
        visibleMessages.forEach(message => next.add(String(message._id || message.messageKey)));
      }
      return next;
    });
  };

  return (
    <div style={styles.root}>
      <div style={styles.header}>
        <div style={styles.headingIcon}>🎯</div>
        <div>
          <div style={styles.title}>SMS Hunt</div>
          <div style={styles.subtitle}>Capture incoming messages from a number or contact name</div>
        </div>
        <div style={styles.headerRight}>
          <span style={{ color: isOnline ? '#4ade80' : '#f87171', fontSize: 12 }}>
            {isOnline ? '● Device online' : '● Device offline'}
          </span>
          <button onClick={load} disabled={loading} style={button('#334155')}>
            {loading ? 'Loading…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {statusMsg && <div role="status" style={styles.status}>{statusMsg}</div>}

      <div style={styles.healthBar}>
        <span>
          <strong>Database:</strong>{' '}
          <span style={{ color: health.mongodb === 'connected' ? '#4ade80' : '#f87171' }}>
            {health.loading ? 'checking…' : health.mongodb}
          </span>
        </span>
        <span><strong>Saved hunts:</strong> {hunts.length}</span>
        <span>
          <strong>Device:</strong>{' '}
          <span style={{ color: isOnline ? '#4ade80' : '#f87171' }}>{isOnline ? 'online' : 'offline'}</span>
        </span>
        {syncState.message && (
          <span style={{ color: syncState.status === 'error' ? '#fca5a5' : '#c4b5fd' }}>
            <strong>Sync:</strong> {syncState.message}
          </span>
        )}
      </div>

      {!isOnline && (
        <div style={styles.offlineBanner}>
          <strong>Device offline.</strong> You can still create, edit, and review hunts. Saved rules and captured matches stay tied to this device and sync when it reconnects.
        </div>
      )}

      <div style={styles.workspace}>
        <aside style={styles.sidebar}>
          <div style={styles.panelHeader}>
            <span>Saved hunts</span>
            <button onClick={newHunt} style={button('#7c3aed')}>+ New</button>
          </div>
          <div style={styles.list}>
            {hunts.length === 0 && !loading && (
              <div style={styles.emptySmall}>No hunts yet.<br />Create one to start watching a sender.</div>
            )}
            {hunts.map(hunt => (
              <div
                key={hunt._id}
                onClick={() => selectHunt(hunt)}
                style={{
                  ...styles.huntRow,
                  background: String(selectedHuntId) === String(hunt._id) ? 'rgba(124,58,237,.18)' : 'transparent',
                  borderLeftColor: String(selectedHuntId) === String(hunt._id) ? '#a78bfa' : 'transparent',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={styles.huntName}>
                    {hunt.scheduleOnConnect && <span title="Syncs on next connection" style={{ color: '#4ade80' }}>⚡</span>}
                    <span style={styles.ellipsis}>{hunt.name}</span>
                  </div>
                  <div style={styles.huntMeta}>
                    {hunt.targetMode === 'name' ? 'Name' : 'Number'} · {hunt.target}
                  </div>
                </div>
                <span style={{ color: hunt.enabled ? '#4ade80' : '#64748b', fontSize: 10 }}>
                  {hunt.enabled ? 'ON' : 'OFF'}
                </span>
              </div>
            ))}
          </div>
          <div style={styles.sideNote}>
            <div style={{ color: '#c4b5fd', fontWeight: 700, marginBottom: 5 }}>Device-only rules</div>
            Hunts are never shared with another device. The Android app stores matches locally until the server is reachable.
          </div>
        </aside>

        <section style={styles.editor}>
          <form onSubmit={save}>
            <div style={styles.panelHeader}>
              <span>{selectedHunt ? 'Edit hunt' : 'New hunt'}</span>
              <div style={{ display: 'flex', gap: 7 }}>
                <button type="button" onClick={syncHunts} disabled={syncState.status === 'pending' || !hunts.length} style={button('#2563eb')}>
                  {syncState.status === 'pending' ? 'Sending…' : '↥ Send to device'}
                </button>
                {selectedHunt && (
                  <button type="button" onClick={() => setConfirmDelete({ hunt: selectedHunt })} style={button('#7f1d1d')}>
                    Delete hunt
                  </button>
                )}
              </div>
            </div>
            <div style={styles.formBody}>
              <label style={styles.label}>Hunt name
                <input value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} style={inputStyle} placeholder="e.g. Bank alerts" />
              </label>
              <div style={styles.twoCol}>
                <label style={styles.label}>Match by
                  <select value={draft.targetMode} onChange={e => setDraft({ ...draft, targetMode: e.target.value })} style={inputStyle}>
                    <option value="phone">Phone number</option>
                    <option value="name">Contact name</option>
                  </select>
                </label>
                <label style={styles.label}>{draft.targetMode === 'name' ? 'Contact name' : 'Phone number'}
                  <input
                    value={draft.target}
                    onChange={e => setDraft({ ...draft, target: e.target.value })}
                    style={inputStyle}
                    placeholder={draft.targetMode === 'name' ? 'e.g. Alex Morgan' : 'e.g. +1 555 0100'}
                  />
                </label>
              </div>

              <div style={styles.optionCard}>
                <label style={styles.checkRow}>
                  <input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />
                  <span><strong>Hunt enabled</strong><small>Listen for matching incoming SMS while this rule is active.</small></span>
                </label>
                <label style={styles.checkRow}>
                  <input type="checkbox" checked={draft.scheduleOnConnect} onChange={e => setDraft({ ...draft, scheduleOnConnect: e.target.checked })} />
                  <span><strong>Sync on next connection</strong><small>Keep this rule saved while offline and send it automatically when this device reconnects.</small></span>
                </label>
              </div>

              <div style={styles.actionRow}>
                <button type="submit" disabled={saving} style={button('#7c3aed')}>{saving ? 'Saving…' : '💾 Save hunt'}</button>
                <span style={styles.helpText}>
                  {pendingCommands.some(item => item.command === 'set_sms_hunts') ? 'Device is receiving the saved hunts…' : ''}
                </span>
                {!isOnline && <span style={styles.helpText}>Saving works while offline.</span>}
              </div>
            </div>
          </form>

          <div style={{ ...styles.messagesPanel, marginTop: 12 }}>
            <div style={styles.panelHeader}>
              <span>Captured messages {selectedHunt ? `· ${selectedHunt.name}` : ''}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={styles.count}>{visibleMessages.length}</span>
                {selectedMessageIds.size > 0 && (
                  <button type="button" onClick={deleteSelectedMessages} disabled={saving} style={button('#b91c1c')}>
                    Delete selected ({selectedMessageIds.size})
                  </button>
                )}
              </div>
            </div>
            {visibleMessages.length > 0 && (
              <div style={styles.selectBar}>
                <label style={styles.selectAll}>
                  <input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} />
                  Select all visible
                </label>
                <span>{selectedMessageIds.size ? `${selectedMessageIds.size} selected` : 'Select messages to delete them together'}</span>
              </div>
            )}
            <div style={styles.messagesList}>
              {visibleMessages.length === 0 && (
                <div style={styles.emptyMessages}>
                  <div style={{ fontSize: 30, marginBottom: 8 }}>💬</div>
                  {messages.length ? 'No captured messages match this hunt.' : 'Matching messages will appear here and remain available while the device is offline.'}
                </div>
              )}
              {visibleMessages.map(message => (
                <div key={message._id || message.messageKey} style={styles.messageRow}>
                  <input
                    type="checkbox"
                    aria-label={`Select message from ${message.senderName || message.sender || 'unknown sender'}`}
                    checked={selectedMessageIds.has(String(message._id || message.messageKey))}
                    onChange={() => toggleMessage(message)}
                    style={{ marginTop: 10 }}
                  />
                  <div style={styles.avatar}>SMS</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={styles.messageTop}>
                      <strong>{message.senderName || message.sender || 'Unknown sender'}</strong>
                      <span style={styles.date}>{formatDateTime(Number(message.date || message.receivedAt), '')}</span>
                    </div>
                    <div style={styles.senderLine}>{message.sender || 'Unknown number'}</div>
                    <div style={styles.messageBody}>{message.body || '(empty message)'}</div>
                    <div style={styles.messageMeta}>
                      <span>{(message.huntIds || []).length || 1} matching hunt{(message.huntIds || []).length === 1 ? '' : 's'}</span>
                      <button onClick={() => setConfirmDelete({ message })} style={styles.deleteLink}>Delete</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {confirmDelete && (
        <div style={styles.modalBackdrop} onClick={e => e.target === e.currentTarget && setConfirmDelete(null)}>
          <div style={styles.modal}>
            <strong style={{ fontSize: 16, color: '#f8fafc' }}>
              {confirmDelete.hunt ? 'Delete this SMS Hunt?' : 'Delete this captured message?'}
            </strong>
            <p style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.5 }}>
              {confirmDelete.hunt
                ? 'The rule will be removed from this device. Previously captured messages are kept.'
                : 'This removes the saved dashboard record. It does not delete the original SMS on the device.'}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setConfirmDelete(null)} style={button('#334155')}>Cancel</button>
              <button onClick={confirmDelete.hunt ? deleteHunt : deleteMessage} style={button('#dc2626')}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const button = (background) => ({
  background, color: '#fff', border: 'none', borderRadius: 6,
  padding: '6px 11px', cursor: 'pointer', fontSize: 12, fontWeight: 600,
  whiteSpace: 'nowrap',
});

const inputStyle = {
  width: '100%', boxSizing: 'border-box', background: '#0f172a',
  color: '#f1f5f9', border: '1px solid #334155', borderRadius: 7,
  padding: '9px 10px', fontSize: 13, marginTop: 6,
};

const styles = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, color: '#e2e8f0', background: '#0f172a', fontFamily: 'system-ui,sans-serif' },
  header: { display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid #1e293b' },
  headingIcon: { width: 38, height: 38, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'rgba(124,58,237,.2)', fontSize: 20 },
  title: { fontWeight: 750, fontSize: 16, color: '#f8fafc' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 2 },
  headerRight: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 },
  status: { padding: '8px 18px', background: '#1e293b', color: '#c4b5fd', fontSize: 12, borderBottom: '1px solid #334155' },
  healthBar: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 14, padding: '8px 18px', background: '#111827', borderBottom: '1px solid #1e293b', color: '#94a3b8', fontSize: 11 },
  offlineBanner: { margin: '12px 14px 0', padding: '10px 12px', borderRadius: 8, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.25)', color: '#cbd5e1', fontSize: 12, lineHeight: 1.5 },
  workspace: { flex: 1, minHeight: 0, display: 'flex', gap: 12, padding: 12, overflow: 'auto' },
  sidebar: { width: 230, flex: '0 0 230px', display: 'flex', flexDirection: 'column', background: '#16213e', border: '1px solid #2d2d4e', borderRadius: 10, overflow: 'hidden', alignSelf: 'flex-start' },
  editor: { flex: 1, minWidth: 360, display: 'flex', flexDirection: 'column' },
  panelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 14px', borderBottom: '1px solid #2d2d4e', color: '#c4b5fd', fontWeight: 700, fontSize: 13 },
  list: { maxHeight: 300, overflowY: 'auto' },
  huntRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid #2d2d4e', borderLeft: '3px solid transparent', cursor: 'pointer' },
  huntName: { display: 'flex', alignItems: 'center', gap: 4, color: '#f1f5f9', fontSize: 12, fontWeight: 650 },
  huntMeta: { color: '#64748b', fontSize: 10, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  ellipsis: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  emptySmall: { padding: 20, color: '#64748b', textAlign: 'center', fontSize: 12, lineHeight: 1.5 },
  sideNote: { margin: 10, padding: 10, borderRadius: 8, background: 'rgba(124,58,237,.08)', color: '#94a3b8', fontSize: 11, lineHeight: 1.5 },
  formBody: { padding: 14, background: '#16213e', border: '1px solid #2d2d4e', borderTop: 0, borderRadius: '0 0 10px 10px' },
  label: { display: 'block', color: '#94a3b8', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 },
  twoCol: { display: 'grid', gridTemplateColumns: 'minmax(130px, .7fr) minmax(180px, 1.3fr)', gap: 10, marginTop: 12 },
  optionCard: { marginTop: 14, padding: 11, borderRadius: 8, border: '1px solid #2d2d4e', background: '#1a1a2e', display: 'grid', gap: 11 },
  checkRow: { display: 'flex', alignItems: 'flex-start', gap: 9, color: '#e2e8f0', fontSize: 12, cursor: 'pointer' },
  actionRow: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 },
  helpText: { color: '#64748b', fontSize: 11 },
  messagesPanel: { flex: 1, minHeight: 220, display: 'flex', flexDirection: 'column', background: '#16213e', border: '1px solid #2d2d4e', borderRadius: 10, overflow: 'hidden' },
  count: { minWidth: 22, padding: '2px 7px', borderRadius: 10, background: '#1e293b', color: '#a5b4fc', fontSize: 11, textAlign: 'center' },
  selectBar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 14px', background: '#111827', color: '#64748b', fontSize: 10, borderBottom: '1px solid #2d2d4e' },
  selectAll: { display: 'flex', alignItems: 'center', gap: 7, color: '#cbd5e1', cursor: 'pointer' },
  messagesList: { flex: 1, overflowY: 'auto' },
  emptyMessages: { padding: 36, color: '#64748b', fontSize: 12, textAlign: 'center', lineHeight: 1.5 },
  messageRow: { display: 'flex', gap: 11, padding: '12px 14px', borderBottom: '1px solid #2d2d4e' },
  avatar: { width: 34, height: 34, flex: '0 0 34px', borderRadius: 9, background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.25)', display: 'grid', placeItems: 'center', color: '#86efac', fontSize: 9, fontWeight: 800 },
  messageTop: { display: 'flex', justifyContent: 'space-between', gap: 8, color: '#f1f5f9', fontSize: 13 },
  date: { color: '#64748b', fontSize: 10, whiteSpace: 'nowrap' },
  senderLine: { color: '#64748b', fontSize: 10, marginTop: 3 },
  messageBody: { color: '#cbd5e1', fontSize: 12, lineHeight: 1.5, marginTop: 6, wordBreak: 'break-word' },
  messageMeta: { display: 'flex', alignItems: 'center', gap: 10, marginTop: 7, color: '#475569', fontSize: 10 },
  deleteLink: { border: 0, background: 'transparent', color: '#f87171', padding: 0, fontSize: 10, cursor: 'pointer' },
  modalBackdrop: { position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,.75)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  modal: { width: 360, maxWidth: '92vw', padding: 22, borderRadius: 12, border: '1px solid #334155', background: '#1e293b' },
};
