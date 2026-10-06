'use strict';

function formatSseDataEvent(event, data) {
    return `data: ${JSON.stringify({ event, data })}\n\n`;
}

function dashboardClientMayReceive(client, accessId, deviceScoped) {
    if (!client || client.role !== 'user' || !deviceScoped) return true;
    return !!accessId && String(client.accessId || '') === String(accessId);
}

module.exports = { formatSseDataEvent, dashboardClientMayReceive };
