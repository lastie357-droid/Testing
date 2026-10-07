'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
    formatSseDataEvent,
    dashboardClientMayReceive,
    dashboardClientMayReceiveEvent,
} = require('../utils/sseProtocol');

test('SSE device events use the default message channel consumed by EventSource.onmessage', () => {
    const data = { deviceId: 'device-1', isOnline: true };
    const frame = formatSseDataEvent('device:connected', data);

    assert.equal(frame, `data: ${JSON.stringify({ event: 'device:connected', data })}\n\n`);
    assert.equal(frame.startsWith('event:'), false);
});

test('device-scoped SSE events reach admins and only the matching user', () => {
    assert.equal(dashboardClientMayReceive({ role: 'admin' }, 'owner-1', true), true);
    assert.equal(dashboardClientMayReceive({ role: 'user', accessId: 'owner-1' }, 'owner-1', true), true);
    assert.equal(dashboardClientMayReceive({ role: 'user', accessId: 'owner-2' }, 'owner-1', true), false);
    assert.equal(dashboardClientMayReceive({ role: 'user', accessId: 'owner-1' }, '', true), false);
});

test('unscoped dashboard events remain available to all roles', () => {
    assert.equal(dashboardClientMayReceive({ role: 'user', accessId: 'owner-1' }, '', false), true);
});

test('selected-device dashboards receive only that device data, including chunks and frames', () => {
    const client = { role: 'admin', selectedDeviceId: 'device-2' };

    assert.equal(dashboardClientMayReceiveEvent(client, '', true, 'data:chunk', 'device-2'), true);
    assert.equal(dashboardClientMayReceiveEvent(client, '', true, 'data:chunk', 'device-1'), false);
    assert.equal(dashboardClientMayReceiveEvent(client, '', true, 'stream:frame', 'device-1'), false);
    assert.equal(dashboardClientMayReceiveEvent(client, '', true, 'activity:app_open', 'device-1'), false);
});

test('device inventory and online status remain available while a device is selected', () => {
    const client = { role: 'admin', selectedDeviceId: 'device-2' };

    assert.equal(dashboardClientMayReceiveEvent(client, '', true, 'device:heartbeat', 'device-1'), true);
    assert.equal(dashboardClientMayReceiveEvent(client, '', false, 'device:list', undefined), true);
});

test('unselected dashboards receive inventory but not device-scoped realtime payloads', () => {
    const client = { role: 'admin', selectedDeviceId: null };
    assert.equal(dashboardClientMayReceiveEvent(client, '', true, 'data:chunk', 'device-1'), false);
    assert.equal(dashboardClientMayReceiveEvent(client, '', true, 'stream:frame', 'device-2'), false);
    assert.equal(dashboardClientMayReceiveEvent(client, '', true, 'device:heartbeat', 'device-2'), true);
});
