'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const Module = require('node:module');

class FakeRedis extends EventEmitter {
    static instances = [];

    constructor(url) {
        super();
        this.url = url;
        this.status = 'connecting';
        this.commands = [];
        FakeRedis.instances.push(this);
        setImmediate(() => {
            if (this.status !== 'connecting') return;
            this.status = 'ready';
            this.emit('ready');
        });
    }

    async lpush(...args) {
        if (this.status !== 'ready') throw new Error('Connection is closed.');
        this.commands.push(['lpush', ...args]);
    }

    async ltrim(...args) {
        if (this.status !== 'ready') throw new Error('Connection is closed.');
        this.commands.push(['ltrim', ...args]);
    }

    async expire(...args) {
        if (this.status !== 'ready') throw new Error('Connection is closed.');
        this.commands.push(['expire', ...args]);
    }

    async ping() {
        if (this.status !== 'ready') throw new Error('Connection is closed.');
        return 'PONG';
    }

    async quit() {
        this.status = 'end';
        this.emit('close');
        return 'OK';
    }

    disconnect() {
        this.status = 'end';
        this.emit('close');
    }
}

const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'ioredis') return FakeRedis;
    return originalLoad.call(this, request, parent, isMain);
};
const RedisStore = require('../redis');
Module._load = originalLoad;

test('Redis reconnects ignore closed-client writes and stale client events', async () => {
    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args.join(' '));

    try {
        await RedisStore.init('redis://first.test');
        const firstClient = RedisStore.client();
        assert.equal(RedisStore.isConnected(), true);

        await RedisStore.pushKeylog('device-1', { text: 'entry' });
        assert.deepEqual(firstClient.commands.map(command => command[0]), ['lpush', 'ltrim', 'expire']);

        firstClient.lpush = async () => {
            firstClient.status = 'close';
            firstClient.emit('close');
            throw new Error('Connection is closed.');
        };
        await RedisStore.pushKeylog('device-1', { text: 'during reconnect' });
        assert.equal(warnings.some(message => message.includes('pushKeylog error')), false);

        await RedisStore.restart('redis://second.test');
        const secondClient = RedisStore.client();
        assert.notEqual(secondClient, firstClient);
        assert.equal(RedisStore.isConnected(), true);

        firstClient.status = 'ready';
        firstClient.emit('ready');
        firstClient.status = 'close';
        firstClient.emit('close');
        assert.equal(RedisStore.client(), secondClient);
        assert.equal(RedisStore.isConnected(), true);
    } finally {
        console.warn = originalWarn;
        await RedisStore.stop();
    }
});
