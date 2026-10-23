#!/usr/bin/env node
'use strict';

/**
 * Bounded local integration/load test for the dashboard's admin auth, SSE,
 * device registration, chunk delivery, stream channel, and reconnect paths.
 *
 * Safety boundaries:
 * - Always targets 127.0.0.1; there is no remote host option.
 * - Defaults to 251 simulated clients and refuses more than 299.
 * - Uses only generated load-test device IDs and harmless synthetic payloads.
 * - Does not send device commands or use Android/APK code.
 * - Refuses to register devices if connect-scheduled tasks or Telegram
 *   notifications could be triggered.
 * - Removes only this run's devices before exiting.
 *
 * Run from the workspace with:
 *   cd backend && node scripts/load-test-dashboard.js
 *
 * Optional: LOAD_TEST_CONNECTIONS=251, LOAD_TEST_HTTP_PORT=5000,
 *           LOAD_TEST_TCP_PORT=6000
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const tls = require('node:tls');
const { performance } = require('node:perf_hooks');

const LOOPBACK = '127.0.0.1';
const HTTP_PORT = readPort(process.env.LOAD_TEST_HTTP_PORT, 5000);
const TCP_PORT = readPort(process.env.LOAD_TEST_TCP_PORT, 6000);
const CONNECTIONS = readConnectionCount(process.env.LOAD_TEST_CONNECTIONS);
const RUN_ID = crypto.randomBytes(5).toString('hex');
const ACCESS_ID = `__loadtest_${RUN_ID}`;
const DEVICE_IDS = Array.from(
  { length: CONNECTIONS },
  (_, index) => `lt-${RUN_ID}-${String(index + 1).padStart(3, '0')}`,
);
const ADMIN_SETTINGS_FILE = path.join(__dirname, '..', '.admin-telegram-settings.json');
const RUNTIME_DB_SETTINGS_FILE = path.join(__dirname, '..', '.runtime-db-settings.json');
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const CONNECT_TIMEOUT_MS = 20_000;
const SSE_TIMEOUT_MS = 20_000;
const CLEANUP_CONCURRENCY = 12;

let adminToken = null;
let feed = null;
let primaryClients = [];
let streamClients = [];
let registrationsStarted = false;

function readPort(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error('Load-test ports must be valid TCP ports.');
  }
  return value;
}

function readConnectionCount(raw) {
  if (raw == null || raw === '') return 251;
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > 299) {
    throw new Error('LOAD_TEST_CONNECTIONS must be between 1 and 299.');
  }
  return value;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function percentile(values, percent) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(percent * sorted.length) - 1)];
}

function printTimings(label, values) {
  if (!values.length) {
    console.log(`${label}: no measurements`);
    return;
  }
  const max = Math.max(...values);
  console.log(
    `${label}: n=${values.length} p50=${percentile(values, 0.50).toFixed(1)}ms ` +
    `p95=${percentile(values, 0.95).toFixed(1)}ms ` +
    `p99=${percentile(values, 0.99).toFixed(1)}ms max=${max.toFixed(1)}ms`,
  );
}

function mongoUriForPreflight() {
  try {
    const settings = JSON.parse(fs.readFileSync(RUNTIME_DB_SETTINGS_FILE, 'utf8'));
    if (typeof settings.mongodbUri === 'string' && settings.mongodbUri) {
      return settings.mongodbUri;
    }
  } catch (_) {
    // The runtime override is optional; use the same environment precedence
    // as the backend without ever printing a URI.
  }
  return process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.MONGODB_URL ||
    process.env.mongodb_url ||
    process.env.mongodb_uri ||
    'mongodb://localhost:27017/access-control';
}

async function preflightDatabase() {
  if (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_CHAT_ID ||
      fs.existsSync(ADMIN_SETTINGS_FILE)) {
    throw new Error(
      'Safety stop: Telegram settings are present; synthetic registrations were not started.',
    );
  }

  const mongoose = require('mongoose');
  const Task = require('../models/Task');
  const Device = require('../models/Device');
  const connection = mongoose.createConnection(mongoUriForPreflight(), {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
    maxPoolSize: 2,
    minPoolSize: 0,
  });

  try {
    await connection.asPromise();
    const tasks = connection.model(
      `LoadTestTaskCheck_${RUN_ID}`,
      Task.schema,
      Task.collection.collectionName,
    );
    const devices = connection.model(
      `LoadTestDeviceCheck_${RUN_ID}`,
      Device.schema,
      Device.collection.collectionName,
    );

    // A blank accessId is included in the backend's connect-task query for
    // every device, so refuse to consume or alter any such one-shot task.
    const scheduledTask = await tasks.exists({
      scheduleOnConnect: true,
      $or: [{ accessId: '' }, { accessId: ACCESS_ID }],
    });
    if (scheduledTask) {
      throw new Error(
        'Safety stop: a connect-scheduled task could run on registration; no devices were registered.',
      );
    }

    const collision = await devices.exists({ deviceId: { $in: DEVICE_IDS } });
    if (collision) {
      throw new Error('Safety stop: generated test IDs already exist; no devices were registered.');
    }
  } catch (error) {
    if (error.message.startsWith('Safety stop:')) throw error;
    throw new Error('Database safety preflight failed; no devices were registered.');
  } finally {
    await connection.close().catch(() => {});
  }
}

async function requestJson(route, { method = 'GET', body, token, timeoutMs = 15_000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://${LOOPBACK}:${HTTP_PORT}${route}`, {
      method,
      headers: {
        ...(body === undefined ? {} : JSON_HEADERS),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    let data = {};
    try {
      data = await response.json();
    } catch (_) {}
    return { response, data };
  } finally {
    clearTimeout(timer);
  }
}

class DashboardSseClient {
  constructor(token) {
    this.token = token;
    this.request = null;
    this.response = null;
    this.buffer = '';
    this.history = [];
    this.waiters = new Set();
  }

  async connect() {
    const startedAt = performance.now();
    await new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.request?.destroy();
        reject(new Error('SSE connection timed out.'));
      }, CONNECT_TIMEOUT_MS);

      const request = http.get({
        hostname: LOOPBACK,
        port: HTTP_PORT,
        path: `/api/events?token=${encodeURIComponent(this.token)}`,
        headers: { Accept: 'text/event-stream', 'Accept-Encoding': 'identity' },
      }, response => {
        this.response = response;
        response.setEncoding('utf8');
        if (response.statusCode !== 200) {
          clearTimeout(timeout);
          settled = true;
          response.resume();
          reject(new Error(`SSE authentication failed (HTTP ${response.statusCode}).`));
          return;
        }
        clearTimeout(timeout);
        settled = true;
        response.on('data', chunk => this.consume(chunk));
        response.on('error', () => {});
        resolve();
      });
      this.request = request;
      request.on('error', error => {
        if (!settled) {
          clearTimeout(timeout);
          settled = true;
          reject(new Error(`SSE connection failed (${error.code || 'network error'}).`));
        }
      });
    });
    return performance.now() - startedAt;
  }

  consume(chunk) {
    this.buffer += chunk;
    let boundary;
    while ((boundary = this.buffer.indexOf('\n\n')) >= 0) {
      const frame = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      const line = frame.split(/\r?\n/).find(value => value.startsWith('data:'));
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line.slice(5).trim());
      } catch (_) {
        continue;
      }
      const normalized = normalizeSseMessage(message);
      if (normalized) this.publish(normalized);
    }
  }

  publish(message) {
    this.history.push(message);
    if (this.history.length > 5000) this.history.splice(0, this.history.length - 5000);
    for (const waiter of [...this.waiters]) {
      try {
        if (waiter.predicate(this.history)) {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          waiter.resolve(this.history);
        }
      } catch (error) {
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        waiter.reject(error);
      }
    }
  }

  waitUntil(predicate, timeoutMs = SSE_TIMEOUT_MS, description = 'SSE event') {
    if (predicate(this.history)) return Promise.resolve(this.history);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`Timed out waiting for ${description}.`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  close() {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('SSE connection closed while waiting.'));
    }
    this.waiters.clear();
    this.request?.destroy();
    this.response?.destroy();
    this.request = null;
    this.response = null;
  }
}

function normalizeSseMessage(message) {
  if (!message || typeof message.event !== 'string') return null;
  const data = message.data;
  if (message.event === 'device:list') {
    const list = Array.isArray(data) ? data : [];
    return {
      event: message.event,
      data: {
        count: list.length,
        deviceIds: new Set(list.map(device => device?.deviceId).filter(Boolean)),
      },
    };
  }
  if (message.event === 'data:chunk') {
    return {
      event: message.event,
      data: {
        deviceId: data?.deviceId,
        commandId: data?.commandId,
        done: !!data?.done,
        error: !!data?.error,
        chunkCount: Array.isArray(data?.chunk) ? data.chunk.length : 0,
      },
    };
  }
  if (message.event === 'stream:frame') {
    return {
      event: message.event,
      data: {
        deviceId: data?.deviceId,
        sequence: data?.sequence,
        timestamp: data?.timestamp,
        hasFrame: typeof data?.frameData === 'string' && data.frameData.length > 0,
      },
    };
  }
  if (message.event === 'device:connected' || message.event === 'device:disconnected') {
    return { event: message.event, data: { deviceId: data?.deviceId } };
  }
  if (message.event === 'session:init') {
    return { event: message.event, data: { sseClientId: data?.sseClientId } };
  }
  if (message.event === 'commands:registry') {
    return { event: message.event, data: { count: Array.isArray(data) ? data.length : 0 } };
  }
  return null;
}

class SimulatedTcpClient {
  constructor(deviceId) {
    this.deviceId = deviceId;
    this.socket = null;
    this.buffer = '';
    this.messages = [];
    this.waiters = new Set();
    this.closePromise = null;
  }

  connectAndRegister(accessId) {
    const startedAt = performance.now();
    return new Promise((resolve, reject) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.socket?.destroy();
        reject(new Error(`Registration timed out for ${this.deviceId}.`));
      }, CONNECT_TIMEOUT_MS);

      const socket = tls.connect({
        host: LOOPBACK,
        port: TCP_PORT,
        servername: 'localhost',
        rejectUnauthorized: false,
      });
      this.socket = socket;
      socket.setNoDelay(true);
      this.closePromise = new Promise(closeResolve => socket.once('close', closeResolve));
      socket.setEncoding('utf8');
      socket.on('data', chunk => this.consume(chunk));
      socket.on('error', error => {
        if (!settled) {
          clearTimeout(timeout);
          settled = true;
          reject(new Error(`TCP connection failed for ${this.deviceId} (${error.code || 'network error'}).`));
        }
      });
      socket.on('secureConnect', () => {
        this.send('device:register', {
          deviceId: this.deviceId,
          accessId,
          deviceInfo: {
            name: this.deviceId,
            manufacturer: 'load-test',
            model: 'synthetic-client',
            androidVersion: 'test-only',
            screenWidth: 1,
            screenHeight: 1,
          },
        });
      });

      const poll = setInterval(() => {
        const ack = this.messages.find(
          message => message.event === 'device:registered' &&
            message.data.deviceId === this.deviceId,
        );
        if (!ack || settled) return;
        clearInterval(poll);
        clearTimeout(timeout);
        settled = true;
        if (!ack.data.success) {
          reject(new Error(`Registration rejected for ${this.deviceId}.`));
          return;
        }
        resolve(performance.now() - startedAt);
      }, 5);
      const clearPoll = () => clearInterval(poll);
      socket.once('close', clearPoll);
      socket.once('error', clearPoll);
    });
  }

  consume(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (_) {
        continue;
      }
      const normalized = normalizeTcpMessage(message);
      if (!normalized) continue;
      this.messages.push(normalized);
      if (this.messages.length > 30) this.messages.shift();
      for (const waiter of [...this.waiters]) {
        try {
          if (waiter.predicate(normalized)) {
            clearTimeout(waiter.timer);
            this.waiters.delete(waiter);
            waiter.resolve(normalized);
          }
        } catch (error) {
          clearTimeout(waiter.timer);
          this.waiters.delete(waiter);
          waiter.reject(error);
        }
      }
    }
  }

  waitForMessage(predicate, timeoutMs = SSE_TIMEOUT_MS, description = 'TCP response', afterIndex = 0) {
    const existing = this.messages.slice(afterIndex).find(predicate);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`Timed out waiting for ${description}.`));
        }, timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  send(event, data) {
    if (!this.socket || !this.socket.writable) {
      throw new Error(`TCP client ${this.deviceId} is not writable.`);
    }
    this.socket.write(`${JSON.stringify({ event, data })}\n`);
  }

  destroy() {
    this.socket?.destroy();
  }
}

function normalizeTcpMessage(message) {
  if (message?.event === 'device:registered') {
    return {
      event: message.event,
      data: { deviceId: message.data?.deviceId, success: !!message.data?.success },
    };
  }
  if (message?.event === 'stream:ack') {
    return { event: message.event, data: { deviceId: message.data?.deviceId } };
  }
  return null;
}

async function connectClients(ids, accessId) {
  const clients = ids.map(deviceId => new SimulatedTcpClient(deviceId));
  const results = await Promise.allSettled(clients.map(client => client.connectAndRegister(accessId)));
  const failed = results.filter(result => result.status === 'rejected');
  if (failed.length) {
    clients.forEach(client => client.destroy());
    throw new Error(`${failed.length}/${ids.length} synthetic TCP registrations failed.`);
  }
  return {
    clients,
    timings: results.map(result => result.value),
  };
}

async function waitForDeviceList(sseClient, expectedIds) {
  await sseClient.waitUntil(
    history => history.some(message =>
      message.event === 'device:list' &&
      expectedIds.every(id => message.data.deviceIds.has(id))),
    SSE_TIMEOUT_MS,
    'a dashboard device:list containing all synthetic devices',
  );
  return sseClient.history
    .filter(message => message.event === 'device:list')
    .find(message => expectedIds.every(id => message.data.deviceIds.has(id)));
}

async function sendChunkRound(clients, sseClient, round) {
  const pending = new Map();
  const latencies = [];
  const duplicates = new Set();
  const misrouted = [];

  const onMessage = message => {
    if (message.event !== 'data:chunk') return;
    const expected = pending.get(message.data.commandId);
    if (!expected) return;
    if (expected.receivedAt != null) {
      duplicates.add(message.data.commandId);
      return;
    }
    expected.receivedAt = performance.now();
    if (message.data.deviceId !== expected.deviceId) {
      misrouted.push({ expected: expected.deviceId, received: message.data.deviceId });
      return;
    }
    latencies.push(expected.receivedAt - expected.sentAt);
  };
  const originalPublish = sseClient.publish.bind(sseClient);
  sseClient.publish = message => {
    onMessage(message);
    originalPublish(message);
  };

  try {
    for (let index = 0; index < clients.length; index += 1) {
      const client = clients[index];
      const commandId = `lt-${RUN_ID}-r${round}-${index + 1}`;
      pending.set(commandId, {
        deviceId: client.deviceId,
        sentAt: null,
        receivedAt: null,
      });
    }

    for (let index = 0; index < clients.length; index += 1) {
      const client = clients[index];
      const commandId = `lt-${RUN_ID}-r${round}-${index + 1}`;
      const entry = pending.get(commandId);
      entry.sentAt = performance.now();
      client.send('data:chunk', {
        commandId,
        command: 'load_test_stream',
        fieldName: 'items',
        chunk: [{ sequence: index + 1, synthetic: true }],
        done: true,
      });
    }

    await sseClient.waitUntil(
      () => [...pending.values()].every(entry => entry.receivedAt != null),
      SSE_TIMEOUT_MS,
      `all ${clients.length} per-device data:chunk events (round ${round})`,
    );

    const incomplete = [...pending.values()].filter(entry => entry.receivedAt == null).length;
    if (incomplete || misrouted.length || duplicates.size) {
      throw new Error(
        `Chunk delivery mismatch in round ${round}: missing=${incomplete}, ` +
        `misrouted=${misrouted.length}, duplicate=${duplicates.size}.`,
      );
    }
    return latencies;
  } finally {
    sseClient.publish = originalPublish;
  }
}

async function subscribeToStream(sseClient, deviceId) {
  const session = await sseClient.waitUntil(
    history => history.some(message =>
      message.event === 'session:init' && message.data.sseClientId),
    SSE_TIMEOUT_MS,
    'dashboard SSE session:init',
  );
  const sessionId = session
    .filter(message => message.event === 'session:init')
    .at(-1).data.sseClientId;
  const { response, data } = await requestJson('/api/dashboard/stream-subscription', {
    method: 'POST',
    token: adminToken,
    body: { sseClientId: sessionId, deviceId },
  });
  if (!response.ok || !data.success) {
    throw new Error(`Dashboard stream subscription failed (HTTP ${response.status}).`);
  }
}

async function connectStreamChannel(deviceId) {
  const client = new SimulatedTcpClient(deviceId);
  const socket = tls.connect({
    host: LOOPBACK,
    port: TCP_PORT,
    servername: 'localhost',
    rejectUnauthorized: false,
  });
  client.socket = socket;
  client.closePromise = new Promise(resolve => socket.once('close', resolve));
  socket.setNoDelay(true);
  socket.setEncoding('utf8');
  socket.on('data', chunk => client.consume(chunk));
  socket.on('error', () => {});

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      reject(new Error('Stream-channel TLS handshake timed out.'));
    }, CONNECT_TIMEOUT_MS);
    socket.once('secureConnect', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('error', error => {
      clearTimeout(timeout);
      reject(new Error(`Stream-channel TCP connection failed (${error.code || 'network error'}).`));
    });
  });

  client.send('device:register_channel', { deviceId, channelType: 'stream' });
  return client;
}

async function connectStreamChannels(deviceIds) {
  const clients = deviceIds.map(deviceId => new SimulatedTcpClient(deviceId));
  const results = await Promise.allSettled(deviceIds.map(async (deviceId, index) => {
    const connected = await connectStreamChannel(deviceId);
    clients[index] = connected;
    return connected;
  }));
  const failed = results.filter(result => result.status === 'rejected');
  if (failed.length) {
    clients.forEach(client => client?.destroy());
    throw new Error(`${failed.length}/${deviceIds.length} synthetic stream-channel registrations failed.`);
  }
  await delay(50);
  return clients;
}

async function sendStreamFrameRound(clients, deviceIds, sseClient, round) {
  const latencies = [];
  const frameData = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
  for (let index = 0; index < deviceIds.length; index += 1) {
    const deviceId = deviceIds[index];
    const client = clients[index];
    const previousSequence = sseClient.history
      .filter(message => message.event === 'stream:frame' && message.data.deviceId === deviceId)
      .reduce((max, message) => Math.max(max, Number(message.data.sequence) || 0), 0);
    const ackStartIndex = client.messages.length;

    await subscribeToStream(sseClient, deviceId);
    const framePromise = sseClient.waitUntil(
      history => history.some(message =>
        message.event === 'stream:frame' &&
        message.data.deviceId === deviceId &&
        Number(message.data.sequence) > previousSequence &&
        message.data.hasFrame),
      SSE_TIMEOUT_MS,
      `stream:frame for ${deviceId} on dashboard SSE`,
    );
    const ackPromise = client.waitForMessage(
      message => message.event === 'stream:ack' && message.data.deviceId === deviceId,
      SSE_TIMEOUT_MS,
      `stream:ack for ${deviceId} on TCP stream channel`,
      ackStartIndex,
    );
    const startedAt = performance.now();
    client.send('stream:frame', {
      frameData,
      timestamp: Date.now(),
      screenWidth: 1,
      screenHeight: 1,
    });
    await Promise.all([framePromise, ackPromise]);
    latencies.push(performance.now() - startedAt);
  }
  return latencies;
}

async function cleanupSyntheticDevices() {
  if (!registrationsStarted || !adminToken) return { deleted: 0, failed: 0 };

  feed?.close();
  streamClients.forEach(client => client?.destroy());
  primaryClients.forEach(client => client.destroy());
  await delay(3300); // Let the server's 3-second disconnect grace timers settle.

  let nextIndex = 0;
  let deleted = 0;
  let failed = 0;
  const workers = Array.from(
    { length: Math.min(CLEANUP_CONCURRENCY, DEVICE_IDS.length) },
    async () => {
      while (nextIndex < DEVICE_IDS.length) {
        const deviceId = DEVICE_IDS[nextIndex++];
        try {
          const { response } = await requestJson(
            `/api/admin/devices/${encodeURIComponent(deviceId)}`,
            { method: 'DELETE', token: adminToken, timeoutMs: 20_000 },
          );
          if (response.ok || response.status === 404) deleted += 1;
          else failed += 1;
        } catch (_) {
          failed += 1;
        }
      }
    },
  );
  await Promise.all(workers);
  return { deleted, failed };
}

async function verifySyntheticDevicesAbsentFromDashboard() {
  const startedAt = performance.now();
  const deadline = Date.now() + 8000;
  let leftovers = DEVICE_IDS.length;

  while (Date.now() < deadline) {
    try {
      const result = await requestJson('/api/admin/devices', {
        token: adminToken,
        timeoutMs: 10_000,
      });
      if (result.response.ok && Array.isArray(result.data.devices)) {
        leftovers = result.data.devices
          .filter(device => DEVICE_IDS.includes(device.deviceId))
          .length;
        if (leftovers === 0) {
          return { cleared: true, leftovers, elapsedMs: performance.now() - startedAt };
        }
      }
    } catch (_) {}
    await delay(250);
  }
  return { cleared: false, leftovers, elapsedMs: performance.now() - startedAt };
}

async function main() {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
    throw new Error('Admin credential secrets are unavailable to the local test process.');
  }

  console.log(
    `Target: loopback only; synthetic devices=${CONNECTIONS}; primary TCP port=${TCP_PORT}.`,
  );
  await preflightDatabase();
  console.log('Database safety preflight passed; no connect-scheduled task or Telegram side effect found.');

  let startedAt = performance.now();
  const login = await requestJson('/api/admin/login', {
    method: 'POST',
    body: {
      username: process.env.ADMIN_USERNAME,
      password: process.env.ADMIN_PASSWORD,
    },
  });
  if (!login.response.ok || !login.data.success || !login.data.token) {
    throw new Error(`Dashboard admin sign-in failed (HTTP ${login.response.status}).`);
  }
  adminToken = login.data.token;
  console.log(`Dashboard admin sign-in: passed (${(performance.now() - startedAt).toFixed(1)}ms).`);

  startedAt = performance.now();
  const verify = await requestJson('/api/admin/verify', {
    method: 'POST',
    body: { token: adminToken },
  });
  if (!verify.response.ok || !verify.data.success) {
    throw new Error(`Dashboard admin session verification failed (HTTP ${verify.response.status}).`);
  }
  console.log(`Admin session verification: passed (${(performance.now() - startedAt).toFixed(1)}ms).`);

  const healthBefore = await requestJson('/api/health');
  if (!healthBefore.response.ok || healthBefore.data.mongodb !== 'connected') {
    throw new Error('Backend health/database check failed; no load was started.');
  }
  const initialAdminDevices = await requestJson('/api/admin/devices', { token: adminToken });
  if (!initialAdminDevices.response.ok || !Array.isArray(initialAdminDevices.data.devices)) {
    throw new Error(`Admin device-list request failed (HTTP ${initialAdminDevices.response.status}).`);
  }
  if (initialAdminDevices.data.devices.some(device => DEVICE_IDS.includes(device.deviceId))) {
    throw new Error('Generated test device IDs already appear in the dashboard list.');
  }

  feed = new DashboardSseClient(adminToken);
  startedAt = performance.now();
  await feed.connect();
  await feed.waitUntil(
    history => history.some(message => message.event === 'device:list') &&
      history.some(message => message.event === 'session:init'),
    SSE_TIMEOUT_MS,
    'initial SSE device:list and session:init',
  );
  const initialSseMs = performance.now() - startedAt;
  console.log(`Initial dashboard SSE: passed (${initialSseMs.toFixed(1)}ms to HTTP 200 and events).`);

  registrationsStarted = true;
  startedAt = performance.now();
  const firstRound = await connectClients(DEVICE_IDS, ACCESS_ID);
  primaryClients = firstRound.clients;
  printTimings('Initial TLS/TCP registration-to-ack', firstRound.timings);
  console.log(`TCP registration load: ${CONNECTIONS}/${CONNECTIONS} synthetic clients accepted.`);

  const list = await waitForDeviceList(feed, DEVICE_IDS);
  const connectedEvents = new Set(feed.history
    .filter(message => message.event === 'device:connected')
    .map(message => message.data.deviceId)
    .filter(id => DEVICE_IDS.includes(id)));
  const eventCounts = feed.history.reduce((counts, message) => {
    counts[message.event] = (counts[message.event] || 0) + 1;
    return counts;
  }, {});
  console.log(`Dashboard SSE event counts after registration: ${JSON.stringify(eventCounts)}.`);
  console.log(`Dashboard device:list: ${list.data.count} total, all ${CONNECTIONS} synthetic devices present.`);
  if (connectedEvents.size !== CONNECTIONS) {
    throw new Error(`Dashboard received ${connectedEvents.size}/${CONNECTIONS} device:connected events.`);
  }
  console.log(`Dashboard device:connected events: ${connectedEvents.size}/${CONNECTIONS}.`);
  console.log(`Registration phase duration: ${(performance.now() - startedAt).toFixed(1)}ms.`);

  const firstChunkLatencies = await sendChunkRound(primaryClients, feed, 1);
  printTimings('Per-device TCP data:chunk → dashboard SSE', firstChunkLatencies);
  console.log(`Chunk routing round 1: ${firstChunkLatencies.length}/${CONNECTIONS} delivered to the matching device ID.`);

  streamClients = await connectStreamChannels(DEVICE_IDS);
  console.log(`Stream-channel TCP registrations: ${streamClients.length}/${CONNECTIONS} connected.`);
  const firstStreamLatencies = await sendStreamFrameRound(streamClients, DEVICE_IDS, feed, 1);
  printTimings('Per-device stream frame → dashboard SSE + TCP ack', firstStreamLatencies);
  console.log(`Stream frame routing round 1: ${firstStreamLatencies.length}/${CONNECTIONS} delivered to the matching device ID.`);

  // Mirror the dashboard hook's reconnect path: a dropped EventSource is
  // reopened, session:init is consumed, and the selected-device subscription
  // is restored so the server can replay its latest cached frame.
  feed.close();
  await delay(3000);
  feed = new DashboardSseClient(adminToken);
  const reconnectSseMs = await feed.connect();
  await waitForDeviceList(feed, DEVICE_IDS);
  await subscribeToStream(feed, DEVICE_IDS[0]);
  const replayedFrame = await feed.waitUntil(
    history => history.some(message =>
      message.event === 'stream:frame' &&
      message.data.deviceId === DEVICE_IDS[0] &&
      message.data.hasFrame),
    SSE_TIMEOUT_MS,
    'cached stream frame after SSE reconnect and re-subscription',
  );
  const replay = replayedFrame
    .filter(message => message.event === 'stream:frame' && message.data.deviceId === DEVICE_IDS[0])
    .at(-1);
  console.log(
    `SSE reconnect/re-subscribe: passed (${reconnectSseMs.toFixed(1)}ms to HTTP 200; ` +
    `cached frame sequence=${replay.data.sequence}).`,
  );

  const disconnectedSet = new Set();
  const disconnectListener = message => {
    if (message.event === 'device:disconnected' &&
        DEVICE_IDS.includes(message.data.deviceId)) {
      disconnectedSet.add(message.data.deviceId);
    }
  };
  const originalPublish = feed.publish.bind(feed);
  feed.publish = message => {
    disconnectListener(message);
    originalPublish(message);
  };

  const oldClients = primaryClients;
  oldClients.forEach(client => client.destroy());
  await Promise.all(oldClients.map(client => client.closePromise));
  const reconnectStartedAt = performance.now();
  const secondRound = await connectClients(DEVICE_IDS, ACCESS_ID);
  primaryClients = secondRound.clients;
  printTimings('TCP reconnect registration-to-ack', secondRound.timings);
  await delay(3300); // Observe the server's disconnect grace period after reconnect.
  if (disconnectedSet.size) {
    throw new Error(
      `False device:disconnected events during TCP reconnect: ${disconnectedSet.size}/${CONNECTIONS}.`,
    );
  }
  console.log(
    `TCP reconnect: ${CONNECTIONS}/${CONNECTIONS} re-registered; ` +
    `no false offline event after grace period (${(performance.now() - reconnectStartedAt).toFixed(1)}ms).`,
  );

  const refreshedList = await waitForDeviceList(feed, DEVICE_IDS);
  if (DEVICE_IDS.some(id => !refreshedList.data.deviceIds.has(id))) {
    throw new Error('Dashboard device:list lost one or more devices after TCP reconnect.');
  }
  const secondChunkLatencies = await sendChunkRound(primaryClients, feed, 2);
  printTimings('Reconnected TCP data:chunk → dashboard SSE', secondChunkLatencies);
  console.log(`Chunk routing round 2: ${secondChunkLatencies.length}/${CONNECTIONS} delivered after reconnect.`);

  const secondStreamLatencies = await sendStreamFrameRound(streamClients, DEVICE_IDS, feed, 2);
  printTimings('Reconnected per-device stream frame → dashboard SSE + TCP ack', secondStreamLatencies);
  console.log(`Stream frame routing round 2: ${secondStreamLatencies.length}/${CONNECTIONS} delivered after reconnect.`);

  streamClients.forEach(client => client.destroy());
  streamClients = [];
  feed.close();
  feed = null;
  console.log('Load phase passed; disconnecting synthetic clients and cleaning up test records.');
}

main()
  .catch(error => {
    console.error(`LOAD TEST FAILED: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (!registrationsStarted || !adminToken) return;
    const cleanup = await cleanupSyntheticDevices();
    console.log(
      `Cleanup: ${cleanup.deleted}/${DEVICE_IDS.length} synthetic device records removed; ` +
      `${cleanup.failed} cleanup failures.`,
    );
    primaryClients = [];
    streamClient = null;
    feed = null;

    if (cleanup.failed) {
      process.exitCode = 1;
      return;
    }

    const verification = await verifySyntheticDevicesAbsentFromDashboard();
    if (!verification.cleared) {
      console.error(`Cleanup verification failed: ${verification.leftovers} synthetic devices remain in the dashboard list.`);
      process.exitCode = 1;
    } else {
      console.log(
        `Cleanup verification: no synthetic devices remain in the dashboard list ` +
        `(${verification.elapsedMs.toFixed(1)}ms for snapshot refresh).`,
      );
    }
  });
