'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const jwt    = require('jsonwebtoken');

const SECRET_FILE = path.join(__dirname, '.jwt_secret');
const DATE_FILE   = path.join(__dirname, '.jwt_secret_date');
const STABLE_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || null;

function todayString() {
    return new Date().toISOString().slice(0, 10);
}

function generateSecret() {
    return crypto.randomBytes(64).toString('hex');
}

function loadOrCreate() {
    const today = todayString();

    // Keep the existing generated key as a verification-only migration key.
    // New tokens use the stable environment secret, so browser sessions survive
    // backend restarts and daily UTC boundaries.
    if (STABLE_SECRET) {
        try {
            if (fs.existsSync(SECRET_FILE)) {
                const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim();
                if (existing && existing.length >= 64) return existing;
            }
        } catch (_) {}

        const secret = generateSecret();
        try {
            fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
            fs.writeFileSync(DATE_FILE, today, { mode: 0o600 });
        } catch (e) {
            console.warn('[JWT] Could not persist legacy verification key:', e.message);
        }
        return secret;
    }

    try {
        const storedDate = fs.existsSync(DATE_FILE)
            ? fs.readFileSync(DATE_FILE, 'utf8').trim()
            : null;

        if (storedDate === today && fs.existsSync(SECRET_FILE)) {
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
    const now   = new Date();
    const next  = new Date(now);
    next.setUTCHours(0, 0, 0, 0);
    next.setUTCDate(next.getUTCDate() + 1);
    const msUntilMidnight = next.getTime() - now.getTime();

    setTimeout(() => {
        rotate();
        setInterval(rotate, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);

    console.log(`[JWT] Next rotation in ${Math.round(msUntilMidnight / 3600000 * 10) / 10}h (UTC midnight)`);
}

if (!STABLE_SECRET) scheduleDailyRotation();
else console.log('[JWT] Stable signing secret configured; existing sessions will be migrated on refresh.');

function getJwtSecret() {
    return STABLE_SECRET || _current;
}

function verifyJwt(token) {
    const secrets = [...new Set([STABLE_SECRET, _current].filter(Boolean))];
    let lastError;

    for (const secret of secrets) {
        try {
            return jwt.verify(token, secret);
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('No JWT verification key is available.');
}

module.exports = { getJwtSecret, verifyJwt };
