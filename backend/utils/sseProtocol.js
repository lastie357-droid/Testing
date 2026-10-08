'use strict';

function formatSseDataEvent(event, data) {
    return `data: ${JSON.stringify({ event, data })}\n\n`;
}

function dashboardClientMayReceive(client, accessId, deviceScoped) {
    if (!client || client.role !== 'user' || !deviceScoped) return true;
    return !!accessId && String(client.accessId || '') === String(accessId);
}

const DEVICE_STATUS_EVENTS = new Set([
    'device:list',
    'device:connected',
    'device:disconnected',
    'device:status',
    'device:heartbeat',
]);

function dashboardClientMayReceiveEvent(client, accessId, deviceScoped, event, deviceId) {
    if (!dashboardClientMayReceive(client, accessId, deviceScoped)) return false;
    if (!deviceId || DEVICE_STATUS_EVENTS.has(event)) return true;
    const selectedDeviceId = client?.selectedDeviceId;
    return !!selectedDeviceId && String(selectedDeviceId) === String(deviceId);
}

module.exports = {
    formatSseDataEvent,
    dashboardClientMayReceive,
    dashboardClientMayReceiveEvent,
};
