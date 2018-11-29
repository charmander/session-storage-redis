'use strict';

const {inspect} = require('util');

const parseId = text => {
	const id = parseInt(text, 10);

	if (id <= 0 || !Number.isSafeInteger(id) || String(id) !== text) {
		throw new Error('Invalid user id: ' + inspect(id));
	}

	return id;
};

class RedisStorage {
	constructor(redis, options) {
		this.redis = redis;

		if ('log' in options) {
			this._log = options.log;
		}
	}

	get(key, callback) {
		this.redis.hget('sessions:user', key, (error, reply) => {
			if (error) {
				callback(error, undefined);
				return;
			}

			callback(null, reply === null ? null : parseId(reply));
		});
	}

	set(key, userId, callback) {
		const timestamp = Math.floor(Date.now() / 1000);

		this.redis.multi()
			.zadd('sessions', timestamp, key)
			.hsetnx('sessions:user', key, userId)
			.zadd(`users:${userId}:sessions`, timestamp, key)
			.exec((error, replies) => {
				if (!error && replies.some(reply => reply !== 1)) {
					error = new Error('Unexpected reply: ' + inspect(replies));
				}

				callback(error);
			});
	}

	delete(key, userId, callback) {
		this.redis.multi()
			.zrem('sessions', key)
			.hdel('sessions:user', key)
			.zrem(`users:${userId}:sessions`, key)
			.exec((error, replies) => {
				if (!error && replies.some(reply => reply !== 1)) {
					this._log('Session was deleted between request start and end: ' + inspect(replies));
				}

				callback(error);
			});
	}
}

const drop =
	/* eslint-disable-next-line no-unused-vars */
	message => {};

Object.defineProperty(RedisStorage.prototype, '_log', {
	configurable: true,
	writable: true,
	value: drop,
});

module.exports = RedisStorage;
