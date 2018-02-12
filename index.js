'use strict';

const path = require('path');
const net = require('net');
const debug = require('debug')('lightning-client');
const {EventEmitter} = require('events');
const JSONParser = require('jsonparse')
const _ = require('lodash');
const methods = require('./methods');

class LightningClient extends EventEmitter {
    constructor(rpcPath) {
        if (!path.isAbsolute(rpcPath)) {
            throw new Error('The rpcPath must be an absolute path');
        }

        if (rpcPath.slice(-14) !== '/lightning-rpc') {
            rpcPath = path.join(rpcPath, '/lightning-rpc');
        }

        debug(`Connecting to ${rpcPath}`);

        super();
        this.rpcPath = rpcPath;
        this.reconnectWait = 0.5;
        this.reconnectTimeout = null;
        this.reqcount = 0;
        this.parser = new JSONParser

        const _self = this;

        this.client = net.createConnection(rpcPath);
        this.clientConnectionPromise = new Promise(resolve => {
            _self.client.on('connect', () => {
                debug(`Lightning client connected`);
                _self.reconnectWait = 1;
                resolve();
            });

            _self.client.on('end', () => {
                console.error('Lightning client connection closed, reconnecting');
                _self.increaseWaitTime();
                _self.reconnect();
            });

            _self.client.on('error', error => {
                console.error(`Lightning client connection error`, error);
                _self.increaseWaitTime();
                _self.reconnect();
            });
        });

        this.client.on('data', data => _self.parser.write(data));

        this.parser.onValue = function(val) {
          if (this.stack.length) return; // top-level objects only
          debug('#%d <-- %j', val.id, val.result)
          _self.emit('res:' + val.id, val);
        }

    }

    increaseWaitTime() {
        if (this.reconnectWait >= 16) {
            this.reconnectWait = 16;
        } else {
            this.reconnectWait *= 2;
        }
    }

    reconnect() {
        const _self = this;

        if (this.reconnectTimeout) {
            return;
        }

        this.reconnectTimeout = setTimeout(() => {
            debug('Trying to reconnect...');

            _self.client.connect(_self.rpcPath);
            _self.reconnectTimeout = null;
        }, this.reconnectWait * 1000);
    }

    call(method, args = []) {
        if (!_.isString(method) || !_.isArray(args)) {
            return Promise.reject(new Error('invalid_call'));
        }

        const _self = this;

        const callInt = ++this.reqcount;
        const sendObj = {
            method,
            params: args,
            id: ''+callInt
        };

        debug('#%d --> %s %j', callInt, method, args)

        // Wait for the client to connect
        return this.clientConnectionPromise
            .then(() => new Promise((resolve, reject) => {
                // Wait for a response
                this.once('res:' + callInt, response => {
                    if (_.isNil(response.error)) {
                        resolve(response.result);
                        return;
                    }

                    reject(new Error(response.error));
                });

                // Send the command
                _self.client.write(JSON.stringify(sendObj));
            }));
    }
}

const protify = s => s.replace(/-([a-z])/g, m => m[1].toUpperCase());

methods.forEach(k => {
    LightningClient.prototype[protify(k)] = function (...args) {
        return this.call(k, args);
    };
});

// optional new
module.exports = rpcPath => new LightningClient(rpcPath);
module.exports.LightningClient = LightningClient;
