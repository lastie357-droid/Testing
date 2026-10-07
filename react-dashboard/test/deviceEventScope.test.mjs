import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceCommandKey, shouldProcessDeviceEvent } from '../src/utils/deviceEventScope.mjs';

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
});

test('without a selected device, device payloads are dropped while health updates remain', () => {
  assert.equal(shouldProcessDeviceEvent('data:chunk', { deviceId: 'device-1' }, null), false);
  assert.equal(shouldProcessDeviceEvent('stream:frame', { deviceId: 'device-2' }, null), false);
  assert.equal(shouldProcessDeviceEvent('device:heartbeat', { deviceId: 'device-2' }, null), true);
});

test('identical command IDs from different devices cannot share a chunk assembly', () => {
  assert.notEqual(deviceCommandKey('device-1', 'same-id'), deviceCommandKey('device-2', 'same-id'));
});
