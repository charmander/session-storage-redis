'use strict';

const assert = require('assert');
const test = require('@charmander/test')(module);
const {promisify} = require('util');
const path = require('path');
const redis = require('redis');
const SessionBox = require('@charmander/session');

const RedisStorage = require('../');
const RedisServer = require('./redis-server');

SessionBox.prototype.getAsync = promisify(SessionBox.prototype.get);
SessionBox.prototype.updateAsync = promisify(SessionBox.prototype.update);

[
	'hlen',
	'keys',
	'zcard',
].forEach(command => {
	redis.RedisClient.prototype[command + 'Async'] = promisify(redis.RedisClient.prototype[command]);
});

let redisServer;
let redisClient;
let storage;
let sessionBox;

test.setup('redis connect', async () => {
	redisServer = await RedisServer.start({
		confPath: path.join(__dirname, 'redis.conf'),
		verbose: process.argv.lastIndexOf('-v') > 1,
	});

	redisClient = redis.createClient({
		path: 'redis.sock',
	});

	/* eslint-disable-next-line no-console */
	storage = new RedisStorage(redisClient, {log: console.error});
	sessionBox = new SessionBox(storage);

	return new Promise((resolve, reject) => {
		redisClient.once('error', reject);

		redisClient.once('connect', () => {
			redisClient.removeListener('error', reject);
			resolve();
		});
	});
});

test('sessions', async () => {
	let session = await sessionBox.getAsync(null);

	assert.deepStrictEqual(await redisClient.keysAsync('*'), []);

	session = await sessionBox.updateAsync(session, 1);

	assert.deepStrictEqual(
		(await redisClient.keysAsync('*')).sort(),
		['sessions', 'sessions:user', 'users:1:sessions'],
	);

	assert.strictEqual(await redisClient.zcardAsync('sessions'), 1);
	assert.strictEqual(await redisClient.hlenAsync('sessions:user'), 1);
	assert.strictEqual(await redisClient.zcardAsync('users:1:sessions'), 1);

	{
		const newSession = await sessionBox.updateAsync(session, 2);

		assert.notEqual(newSession.newToken, null);
		assert.strictEqual(newSession.userId, 2);
		assert.notStrictEqual(newSession.csrf, session.csrf);

		session = newSession;
	}

	{
		const newSession = await sessionBox.updateAsync(session, 2);

		assert.notEqual(newSession.newToken, null);
		assert.strictEqual(newSession.userId, 2);
		assert.notStrictEqual(newSession.csrf, session.csrf);

		session = newSession;
	}

	assert.strictEqual(await redisClient.zcardAsync('sessions'), 1);
	assert.strictEqual(await redisClient.hlenAsync('sessions:user'), 1);
	assert.strictEqual(await redisClient.zcardAsync('users:1:sessions'), 0);
	assert.strictEqual(await redisClient.zcardAsync('users:2:sessions'), 1);

	{
		const retrieved = await sessionBox.getAsync(session.newToken);
		assert.strictEqual(retrieved.newToken, null);
		assert.strictEqual(retrieved.userId, 2);
		assert.strictEqual(retrieved.csrf, session.csrf);
	}

	await sessionBox.updateAsync(session, null);

	assert.strictEqual(await redisClient.zcardAsync('sessions'), 0);
	assert.strictEqual(await redisClient.hlenAsync('sessions:user'), 0);
	assert.strictEqual(await redisClient.zcardAsync('users:1:sessions'), 0);
	assert.strictEqual(await redisClient.zcardAsync('users:2:sessions'), 0);

	{
		const retrieved = await sessionBox.getAsync(session.newToken);
		assert.notStrictEqual(retrieved.newToken, null);
		assert.strictEqual(retrieved.userId, null);
	}
});

test.teardown('redis disconnect', async () => {
	redisClient.quit();

	await new Promise(resolve => {
		redisClient.once('end', resolve);
	});

	await redisServer.stop();
});
