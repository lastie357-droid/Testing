'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatSseDataEvent, dashboardClientMayReceive } = require('../utils/sseProtocol');

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
