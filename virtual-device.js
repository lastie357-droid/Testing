'use strict';

const net    = require('net');
const crypto = require('crypto');
const readline = require('readline');

// ── Config ────────────────────────────────────────────────────────────────────
const HOST             = 'localhost';
const PORT             = 9000;
const HEARTBEAT_MS     = 20_000;   // every 20 s (server drops at 45 s)
const RECONNECT_MS     = 3_000;
const DEVICE_ID        = 'virtual-' + crypto.randomBytes(4).toString('hex');

// ── Fake device metadata (mirrors what SocketManager.java sends) ──────────────
const DEVICE_INFO = {
    name:           'Virtual Pixel 7',
    model:          'Pixel 7',
    manufacturer:   'Google',
    androidVersion: '14',
};

// ── State ─────────────────────────────────────────────────────────────────────
let socket        = null;
let connected     = false;
let running       = true;
let heartbeatTimer = null;
let buf           = '';

// ── Logger ────────────────────────────────────────────────────────────────────
function ts() { return new Date().toISOString().slice(11, 23); }
function log(tag, msg)  { console.log(`[${ts()}][${tag}] ${msg}`); }
function warn(tag, msg) { console.warn(`[${ts()}][${tag}] ${msg}`); }

// ── Protocol: send one newline-terminated JSON message ────────────────────────
function send(event, data) {
    if (!socket || !connected) { warn('SEND', `Not connected — dropped: ${event}`); return; }
    const frame = JSON.stringify({ event, data }) + '\n';
    socket.write(frame);
    log('→', event + (data && data.command ? ` [${data.command}]` : ''));
}

// ── Registration ──────────────────────────────────────────────────────────────
function register() {
    send('device:register', {
        deviceId:   DEVICE_ID,
        userId:     '',
        deviceInfo: DEVICE_INFO,
    });
}

// ── Heartbeat loop ────────────────────────────────────────────────────────────
function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
        send('device:heartbeat', { deviceId: DEVICE_ID });
    }, HEARTBEAT_MS);
}
function stopHeartbeat() {
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
}

// ── Mock command responses ────────────────────────────────────────────────────
function handleCommand(commandId, command, params) {
    log('CMD', `Received: ${command}`);
    let result;

    switch (command) {

        // ── System ──────────────────────────────────────────────────────────
        case 'ping':
            result = { success: true, message: 'pong', timestamp: Date.now() };
            break;
        case 'get_device_info':
            result = { success: true, deviceId: DEVICE_ID, ...DEVICE_INFO,
                       battery: 87, charging: false, storage: '64GB / 128GB' };
            break;
        case 'get_battery_info':
            result = { success: true, level: 87, charging: false, temperature: 31.5,
                       voltage: 4100, health: 'Good' };
            break;
        case 'get_network_info':
            result = { success: true, type: 'WiFi', ssid: 'HomeNetwork',
                       ip: '192.168.1.42', strength: -55 };
            break;
        case 'get_wifi_networks':
            result = { success: true, networks: [
                { ssid: 'HomeNetwork',   signal: -55, secured: true  },
                { ssid: 'Neighbor_2G',   signal: -72, secured: true  },
                { ssid: 'OpenGuest',     signal: -80, secured: false },
            ]};
            break;
        case 'get_system_info':
            result = { success: true, cpu: 'Tensor G2', ram: '8GB',
                       uptime: Math.floor(process.uptime()) + 's',
                       sdkVersion: 34, buildVersion: 'UQ1A.240105.004' };
            break;
        case 'get_installed_apps':
            result = { success: true, apps: [
                { name: 'Chrome',       package: 'com.android.chrome',      version: '120.0' },
                { name: 'WhatsApp',     package: 'com.whatsapp',            version: '2.24.1' },
                { name: 'Instagram',    package: 'com.instagram.android',   version: '312.0' },
                { name: 'Gmail',        package: 'com.google.android.gm',   version: '2024.1' },
            ]};
            break;
        case 'get_location':
            result = { success: true, latitude: 37.7749, longitude: -122.4194,
                       accuracy: 10, provider: 'GPS', address: 'San Francisco, CA' };
            break;
        case 'vibrate':
            result = { success: true, message: 'Vibrated for 500ms' };
            break;
        case 'play_sound':
            result = { success: true, message: 'Playing notification sound' };
            break;
        case 'get_clipboard':
            result = { success: true, content: 'clipboard text here' };
            break;
        case 'set_clipboard':
            result = { success: true, message: 'Clipboard updated', content: params?.text };
            break;

        // ── SMS ──────────────────────────────────────────────────────────────
        case 'get_all_sms':
            result = { success: true, messages: [
                { id: '1', address: '+1234567890', body: 'Hey, call me back',     date: Date.now() - 3600000, type: 'inbox' },
                { id: '2', address: '+0987654321', body: 'Your code is 482931',   date: Date.now() - 7200000, type: 'inbox' },
                { id: '3', address: '+1112223333', body: 'See you tomorrow!',     date: Date.now() - 86400000, type: 'sent' },
            ]};
            break;
        case 'get_sms_from_number':
            result = { success: true, messages: [
                { id: '1', address: params?.phoneNumber, body: 'Test message', date: Date.now(), type: 'inbox' }
            ]};
            break;
        case 'send_sms':
            result = { success: true, message: `SMS sent to ${params?.phoneNumber}` };
            break;
        case 'delete_sms':
            result = { success: true, message: `SMS ${params?.smsId} deleted` };
            break;

        // ── Contacts ─────────────────────────────────────────────────────────
        case 'get_all_contacts':
            result = { success: true, contacts: [
                { id: '1', name: 'Alice Johnson',  phone: '+1-555-0101', email: 'alice@example.com' },
                { id: '2', name: 'Bob Smith',      phone: '+1-555-0102', email: 'bob@example.com'   },
                { id: '3', name: 'Carol Williams', phone: '+1-555-0103', email: ''                  },
            ]};
            break;
        case 'search_contacts':
            result = { success: true, contacts: [
                { id: '1', name: 'Alice Johnson', phone: '+1-555-0101' }
            ], query: params?.query };
            break;

        // ── Call logs ─────────────────────────────────────────────────────────
        case 'get_all_call_logs':
            result = { success: true, calls: [
                { id: '1', number: '+1234567890', type: 'incoming', duration: 125, date: Date.now() - 3600000 },
                { id: '2', number: '+0987654321', type: 'outgoing', duration: 45,  date: Date.now() - 7200000 },
                { id: '3', number: '+1112223333', type: 'missed',   duration: 0,   date: Date.now() - 86400000 },
            ]};
            break;
        case 'get_call_logs_by_type':
            result = { success: true, calls: [
                { id: '1', number: '+1234567890', type: 'incoming', duration: 125 }
            ], type: params?.callType };
            break;
        case 'get_call_logs_from_number':
            result = { success: true, calls: [
                { id: '1', number: params?.phoneNumber, type: 'incoming', duration: 60 }
            ]};
            break;
        case 'get_call_statistics':
            result = { success: true, total: 42, incoming: 18, outgoing: 20, missed: 4,
                       totalDuration: 5400 };
            break;

        // ── Camera ────────────────────────────────────────────────────────────
        case 'get_available_cameras':
            result = { success: true, cameras: [
                { id: '0', facing: 'back',  megapixels: 50 },
                { id: '1', facing: 'front', megapixels: 10 },
            ]};
            break;
        case 'take_photo':
            // Return a tiny 1x1 red pixel PNG as base64
            result = { success: true, cameraId: params?.cameraId || '0',
                       imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==',
                       mimeType: 'image/png', width: 1, height: 1,
                       message: '[virtual] photo captured' };
            break;

        // ── Screenshot ────────────────────────────────────────────────────────
        case 'take_screenshot':
            result = { success: true,
                       imageBase64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
                       mimeType: 'image/png', width: 1080, height: 2400,
                       message: '[virtual] screenshot taken' };
            break;

        // ── Files ─────────────────────────────────────────────────────────────
        case 'list_files':
            result = { success: true, path: params?.path || '/sdcard',
                       files: [
                           { name: 'DCIM',     type: 'directory', size: 0       },
                           { name: 'Download', type: 'directory', size: 0       },
                           { name: 'note.txt', type: 'file',      size: 1024    },
                           { name: 'photo.jpg',type: 'file',      size: 2097152 },
                       ]};
            break;
        case 'read_file':
            result = { success: true, filePath: params?.filePath,
                       content: params?.asBase64
                           ? Buffer.from('virtual file content').toString('base64')
                           : 'virtual file content' };
            break;
        case 'write_file':
            result = { success: true, filePath: params?.filePath, message: 'File written' };
            break;
        case 'delete_file':
            result = { success: true, filePath: params?.filePath, message: 'File deleted' };
            break;
        case 'copy_file':
            result = { success: true, from: params?.sourcePath, to: params?.destPath };
            break;
        case 'move_file':
            result = { success: true, from: params?.sourcePath, to: params?.destPath };
            break;
        case 'create_directory':
            result = { success: true, path: params?.path, message: 'Directory created' };
            break;
        case 'get_file_info':
            result = { success: true, filePath: params?.filePath,
                       size: 4096, modified: new Date().toISOString(), type: 'file' };
            break;
        case 'search_files':
            result = { success: true, directory: params?.directory, query: params?.query,
                       results: [ params?.directory + '/found_' + params?.query + '.txt' ] };
            break;

        // ── Audio ─────────────────────────────────────────────────────────────
        case 'start_recording':
            result = { success: true, filename: params?.filename || 'recording_' + Date.now() + '.m4a',
                       message: 'Recording started' };
            break;
        case 'stop_recording':
            result = { success: true, message: 'Recording stopped', duration: 10 };
            break;
        case 'get_recording_status':
            result = { success: true, recording: false, duration: 0 };
            break;
        case 'get_audio':
            result = { success: true, filePath: params?.filePath,
                       audioBase64: Buffer.from('fake audio data').toString('base64') };
            break;
        case 'list_recordings':
            result = { success: true, recordings: [
                { name: 'recording_001.m4a', size: 512000, date: Date.now() - 86400000 }
            ]};
            break;
        case 'delete_recording':
            result = { success: true, filePath: params?.filePath, message: 'Recording deleted' };
            break;

        // ── Keylogs ───────────────────────────────────────────────────────────
        case 'get_keylogs':
            result = { success: true, logs: [
                '[com.whatsapp] TEXT: Hello there',
                '[com.android.chrome] TEXT: search query',
            ]};
            break;
        case 'clear_keylogs':
            result = { success: true, message: 'Keylogs cleared' };
            break;

        // ── Notifications ─────────────────────────────────────────────────────
        case 'get_notifications':
            result = { success: true, notifications: [
                { app: 'com.whatsapp', title: 'Alice', text: 'Are you there?', time: Date.now() - 60000 },
                { app: 'com.gmail',    title: 'New email', text: 'You have 3 new messages', time: Date.now() - 300000 },
            ]};
            break;
        case 'get_notifications_from_app':
            result = { success: true, packageName: params?.packageName, notifications: [
                { app: params?.packageName, title: 'Test', text: 'Notification text', time: Date.now() }
            ]};
            break;
        case 'clear_notifications':
            result = { success: true, message: 'Notifications cleared' };
            break;

        // ── Screen control (Accessibility) ────────────────────────────────────
        case 'touch':
            result = { success: true, x: params?.x, y: params?.y, duration: params?.duration };
            break;
        case 'swipe':
            result = { success: true, from: [params?.startX, params?.startY],
                       to: [params?.endX, params?.endY], duration: params?.duration };
            break;
        case 'press_back':      result = { success: true, action: 'back' };       break;
        case 'press_home':      result = { success: true, action: 'home' };       break;
        case 'press_recents':   result = { success: true, action: 'recents' };    break;
        case 'open_notifications': result = { success: true, action: 'notifications' }; break;
        case 'scroll_up':       result = { success: true, action: 'scroll_up' };  break;
        case 'scroll_down':     result = { success: true, action: 'scroll_down' }; break;

        // ── Screen reader (Accessibility) ─────────────────────────────────────
        case 'read_screen':
            result = { success: true, screen: {
                packageName: 'com.android.launcher3',
                className: 'android.widget.FrameLayout',
                elements: [
                    { text: 'Clock', desc: '', class: 'android.widget.TextView', clickable: false },
                    { text: 'Apps', desc: 'Apps drawer', class: 'android.widget.ImageView', clickable: true },
                ]
            }};
            break;
        case 'find_by_text':
            result = { success: true, query: params?.text,
                       elements: [{ text: params?.text, clickable: true, class: 'android.widget.TextView' }] };
            break;
        case 'get_current_app':
            result = { success: true, packageName: 'com.android.launcher3', appName: 'Launcher' };
            break;
        case 'get_clickable_elements':
            result = { success: true, elements: [
                { text: 'OK',     class: 'android.widget.Button', clickable: true },
                { text: 'Cancel', class: 'android.widget.Button', clickable: true },
            ]};
            break;
        case 'get_input_fields':
            result = { success: true, fields: [
                { hint: 'Enter text', class: 'android.widget.EditText', text: '' }
            ]};
            break;

        default:
            result = { success: false, error: `Unknown command: ${command}` };
    }

    send('command:response', { commandId, command, response: JSON.stringify(result) });
    log('CMD', `Responded to: ${command} → ${result.success ? 'OK' : 'ERR'}`);
}

// ── Incoming message parser ────────────────────────────────────────────────────
function onData(chunk) {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch (e) { warn('PARSE', 'Bad JSON: ' + line); continue; }

        const { event, data } = msg;
        log('←', event);

        switch (event) {
            case 'device:registered':
                log('REG', `Registered ✓  deviceId=${data?.deviceId}`);
                break;
            case 'device:ping':
                send('device:pong', { deviceId: DEVICE_ID });
                break;
            case 'command:execute':
                if (data && data.command) {
                    handleCommand(data.commandId || '', data.command, data.params || null);
                }
                break;
            default:
                log('MSG', `Unhandled event: ${event}`);
        }
    }
}

// ── Connection management ──────────────────────────────────────────────────────
function doConnect() {
    log('TCP', `Connecting to ${HOST}:${PORT}  deviceId=${DEVICE_ID}`);
    socket = new net.Socket();
    socket.setEncoding('utf8');
    socket.setKeepAlive(true);

    socket.connect(PORT, HOST, () => {
        connected = true;
        log('TCP', 'Connected');
        register();
        startHeartbeat();
    });

    socket.on('data', onData);

    socket.on('close', () => {
        connected = false;
        stopHeartbeat();
        buf = '';
        log('TCP', `Disconnected — reconnecting in ${RECONNECT_MS / 1000}s`);
        if (running) setTimeout(doConnect, RECONNECT_MS);
    });

    socket.on('error', (e) => {
        warn('TCP', `Error: ${e.message}`);
        socket.destroy();
    });
}

// ── Interactive CLI ────────────────────────────────────────────────────────────
function startCLI() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    console.log('\n── Virtual Device CLI ─────────────────────────────────────────────');
    console.log('Commands:');
    console.log('  ping           — send heartbeat');
    console.log('  reg            — re-register device');
    console.log('  info           — print device info');
    console.log('  sim <command>  — simulate receiving a command from server');
    console.log('  quit           — disconnect and exit');
    console.log('───────────────────────────────────────────────────────────────────\n');

    rl.on('line', (line) => {
        const [cmd, ...args] = line.trim().split(/\s+/);
        switch (cmd) {
            case 'ping':
            case 'heartbeat':
                send('device:heartbeat', { deviceId: DEVICE_ID });
                break;
            case 'reg':
                register();
                break;
            case 'info':
                console.log({ DEVICE_ID, DEVICE_INFO, connected });
                break;
            case 'sim': {
                const command = args[0];
                if (!command) { console.log('Usage: sim <command>'); break; }
                const fakeId = crypto.randomBytes(6).toString('hex');
                handleCommand(fakeId, command, null);
                break;
            }
            case 'quit':
            case 'exit':
                running = false;
                stopHeartbeat();
                if (socket) socket.destroy();
                rl.close();
                process.exit(0);
                break;
            default:
                if (cmd) console.log(`Unknown CLI command: ${cmd}`);
        }
    });
}

// ── Start ──────────────────────────────────────────────────────────────────────
doConnect();
startCLI();
