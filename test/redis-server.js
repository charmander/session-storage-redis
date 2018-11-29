'use strict';

const {EventEmitter} = require('events');
const child_process = require('child_process');

class SimpleTextSearch {
	constructor(find) {
		this.find = find;
		this.previous = '';
	}

	add(text) {
		const search = this.previous + text;

		if (search.includes(this.find)) {
			return true;
		}

		this.previous = search.slice(-this.find.length);
		return false;
	}
}

class RedisServer extends EventEmitter {
	constructor({confPath, verbose}) {
		super();
		this.confPath = confPath;
		this.verbose = verbose;
		this.process = null;
		this._errorListener = this._errorListener.bind(this);
		this._exitListener = this._exitListener.bind(this);
	}

	start() {
		const server = this.process = child_process.spawn('redis-server', [this.confPath], {
			stdio: ['ignore', 'pipe', 'inherit'],
		});

		server.stdout.setEncoding('utf8');

		if (this.verbose) {
			server.stdout.on('data', part => {
				process.stderr.write(`\x1b[2m${part}\x1b[22m`);
			});
		}

		return new Promise((resolve, reject) => {
			// Node doesn’t support UNIX datagram sockets and it doesn’t support waiting for a child process to stop. So… this.
			const search = new SimpleTextSearch('The server is now ready to accept connections');

			const dataListener = part => {
				if (search.add(part)) {
					server.stdout.removeListener('data', dataListener);
					server.removeListener('exit', exitListener);
					server.removeListener('error', errorListener);
					resolve();
				}
			};

			const errorListener = error => {
				server.stdout.removeListener('data', dataListener);
				server.removeListener('exit', exitListener);
				reject(error);
			};

			const exitListener = code => {
				server.stdout.removeListener('data', dataListener);
				server.removeListener('error', errorListener);
				reject(new Error(`Redis exited unexpectedly (with code ${code})`));
			};

			server.stdout.on('data', dataListener);
			server.once('error', errorListener);
			server.once('exit', exitListener);
		})
			.then(() => {
				server.on('error', this._errorListener);
				server.on('exit', this._exitListener);
			});
	}

	_errorListener(error) {
		this.emit('error', error);
	}

	_exitListener(code) {
		this.emit('error', new Error(`Redis exited unexpectedly (with code ${code})`));
	}

	static start(confPath) {
		const server = new this(confPath);
		return server.start().then(() => server);
	}

	stop() {
		const server = this.process;

		server.kill('SIGINT');

		return new Promise((resolve, reject) => {
			const errorListener = error => {
				server.removeListener('exit', exitListener);
				reject(error);
			};

			const exitListener = code => {
				server.removeListener('error', errorListener);

				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`Redis exited with code ${code}`));
				}
			};

			server.removeListener('error', this._errorListener);
			server.removeListener('exit', this._exitListener);
			server.once('error', errorListener);
			server.once('exit', exitListener);
		});
	}
}

module.exports = RedisServer;
