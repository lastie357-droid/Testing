'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const SECRET_FILE = path.join(__dirname, '.jwt_secret');
const DATE_FILE   = path.join(__dirname, '.jwt_secret_date');
const ENV_SECRET  = String(process.env.JWT_SECRET || process.env.SESSION_SECRET || '').trim();

function todayString() {
    return new Date().toISOString().slice(0, 10);
}

function generateSecret() {
    return crypto.randomBytes(64).toString('hex');
}

function loadOrCreate() {
    // Heroku, Render, and similar platforms may replace the container
    // filesystem during a restart or scale-out. Prefer a shared platform
    // secret so every container signs and verifies the same sessions.
    if (ENV_SECRET.length >= 32) {
        console.log('[JWT] Shared environment signing secret loaded');
        return ENV_SECRET;
    }

    try {
        // JWTs are issued for 7 days. Do not rotate the signing key daily,
        // because that invalidates every active session at midnight and
        // leaves the dashboard's SSE connection retrying forever.
        if (fs.existsSync(SECRET_FILE)) {
            const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim();
            if (existing && existing.length >= 64) {
                return existing;
            }
        }
    } catch (_) {}

    const secret = generateSecret();
    try {
        fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
        fs.writeFileSync(DATE_FILE, today, { mode: 0o600 });
    } catch (e) {
        console.warn('[JWT] Could not persist secret to disk:', e.message);
    }
    console.log('[JWT] New secret generated for', today);
    return secret;
}

let _current = loadOrCreate();

function rotate() {
    _current = generateSecret();
    const today = todayString();
    try {
        fs.writeFileSync(SECRET_FILE, _current, { mode: 0o600 });
        fs.writeFileSync(DATE_FILE, today, { mode: 0o600 });
    } catch (e) {
        console.warn('[JWT] Could not persist rotated secret:', e.message);
    }
    console.log('[JWT] Secret rotated for', today);
}

function scheduleDailyRotation() {
    console.log('[JWT] Persistent signing secret loaded; active sessions will not be invalidated by daily rotation');
}

scheduleDailyRotation();

function getJwtSecret() {
    return _current;
}

module.exports = { getJwtSecret };
