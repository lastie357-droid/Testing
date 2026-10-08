import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDeviceHeartbeat, deviceCommandKey, shouldProcessDeviceEvent } from '../src/utils/deviceEventScope.mjs';

test('chunks and live streams are isolated to the selected device', () => {
  const selected = 'device-2';
  assert.equal(shouldProcessDeviceEvent('data:chunk', { deviceId: selected }, selected), true);
  assert.equal(shouldProcessDeviceEvent('data:chunk', { deviceId: 'device-1' }, selected), false);
  assert.equal(shouldProcessDeviceEvent('stream:frame', { deviceId: 'device-1' }, selected), false);
  assert.equal(shouldProcessDeviceEvent('camera:frame', { deviceId: 'device-1' }, selected), false);
  assert.equal(shouldProcessDeviceEvent('activity:app_open', { deviceId: 'device-1' }, selected), false);
});

test('device inventory and health updates still reach the dashboard', () => {
  assert.equal(shouldProcessDeviceEvent('device:heartbeat', { deviceId: 'device-1' }, 'device-2'), true);
  assert.equal(shouldProcessDeviceEvent('device:list', [], 'device-2'), true);
  assert.equal(shouldProcessDeviceEvent('device:latency', { deviceId: 'device-1' }, 'device-2'), false);
  assert.equal(shouldProcessDeviceEvent('device:latency', { deviceId: 'device-2' }, 'device-2'), true);
});

test('without a selected device, device payloads are dropped while health updates remain', () => {
  assert.equal(shouldProcessDeviceEvent('data:chunk', { deviceId: 'device-1' }, null), false);
  assert.equal(shouldProcessDeviceEvent('stream:frame', { deviceId: 'device-2' }, null), false);
  assert.equal(shouldProcessDeviceEvent('device:heartbeat', { deviceId: 'device-2' }, null), true);
});

test('identical command IDs from different devices cannot share a chunk assembly', () => {
  assert.notEqual(deviceCommandKey('device-1', 'same-id'), deviceCommandKey('device-2', 'same-id'));
});

test('frequent heartbeats do not replace device state or trigger another root render', () => {
  const devices = [{ deviceId: 'device-1', isOnline: true, lastSeen: '2026-10-08T10:00:00.000Z' }];
  const now = Date.parse('2026-10-08T10:00:20.000Z');
  assert.equal(applyDeviceHeartbeat(devices, {
    deviceId: 'device-1',
    timestamp: '2026-10-08T10:00:20.000Z',
  }, now), devices);
});

test('heartbeats restore offline devices and refresh last seen at most once per minute', () => {
  const now = Date.parse('2026-10-08T10:02:00.000Z');
  const offline = [{ deviceId: 'device-1', isOnline: false, lastSeen: '2026-10-08T10:01:59.000Z' }];
  const restored = applyDeviceHeartbeat(offline, { deviceId: 'device-1', timestamp: '2026-10-08T10:02:00.000Z' }, now);
  assert.equal(restored[0].isOnline, true);

  const aged = [{ deviceId: 'device-1', isOnline: true, lastSeen: '2026-10-08T10:00:59.000Z' }];
  const refreshed = applyDeviceHeartbeat(aged, { deviceId: 'device-1', timestamp: '2026-10-08T10:02:00.000Z' }, now);
  assert.equal(refreshed[0].lastSeen, '2026-10-08T10:02:00.000Z');
});
