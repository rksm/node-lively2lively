var util         = require('util'),
    f            = util.format,
    EventEmitter = require('events').EventEmitter,
    websocket    = require("websocket");

var base = require('./base'),
    sendLivelyMessage = base.sendLivelyMessage,
    onLivelyJSONMessage = base.onLivelyJSONMessage,
    log = base.log;

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// client
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
var WebSocketClientImpl = websocket.client;

function WebSocketClient(url, options) {
    options = options || {};
    EventEmitter.call(this);
    this.url = url;
    this.protocol = options.protocol;
    this.setupClient();
    this.sender = options.sender || null;
    this.debugLevel = options.debugLevel !== undefined ?  options.debugLevel : 1;
}

util.inherits(WebSocketClient, EventEmitter);

(function() {

    this.setupClient = function() {
        var self = this;
        var c = this._client = new WebSocketClientImpl();

        c.on('connectFailed', function(e) { self.onConnectionFailed(e); });

        c.on('connect', function(connection) {
            connection.on('error', function(e) { self.onError(e); });
            connection.on('close', function() { self.onClose(); });
            connection.on('message', function(message) {
                self.onMessage(message, connection); });
            connection._send = connection.send;
            connection.send = function(msg, callback) {
                return sendLivelyMessage(self, connection, msg, callback); };
            self.onConnect(connection);
        });
    };

    this.onConnect = function(connection) {
        log(this.debugLevel, 'Connected %s', this.toString());
        if (this.connection) this.connection.close();
        this.connection = connection;
        this.emit('connect', connection);
    };

    this.onConnectionFailed = function(err) {
        console.warn('Could not connect %s:\n%s', this.toString(), err.toString());
        this.emit("error", {message: 'connection failed', error: err});
    };

    this.onError = function(err) {
        console.warn('%s connection error %s', this.toString(), err);
        this.emit("error", err);
    };

    this.onClose = function() {
        log(this.debugLevel, '%s closed', this.toString());
        this.emit("close");
    };

    this.onMessage = function(msg, connection) {
        var json;
        try {
            json = JSON.parse(msg.utf8Data);
        } catch(e) {
            this.onError(f('%s could not parse message %s', this, e));
            return;
        }
        this.lastMessage = json;
        this.emit("message", json);
        onLivelyJSONMessage(this, connection, json);
    };

    this.connect = function() {
        log(this.debugLevel, 'Connecting %s', this);
        try {
            return this._client.connect(this.url, this.protocol);
        } catch(e) {
            console.error(e);
            this.onConnectionFailed(e);
        }
    };

    this.close = function() {
        return this.connection && this.connection.close();
    };

    this.send = function(data, callback) {
        if (!data.sender && this.sessionId) data.sender = this.sessionId;
        sendLivelyMessage(this, this.connection, data, callback);
    };

    this.answer = function(msg, data, callback) {
        if (!msg.messageId) { throw new Error('Cannot answer message without messageId!'); }
        if (!msg.sender) { throw new Error('Cannot answer message without sender!'); }
        return this.send({inResponseTo: msg.messageId, action: msg.action+'Result', data: data, target: msg.sender}, callback);
    };

    this.toString = function() {
        return f('<Lively2LivelyWebSocketClient %s, sender: %s, isOpen: %s>',
            this.url, this.sender, this.isOpen());
    };

    this.isOpen = function() {
        return this.connection && this.connection.state === 'open';
    };

    this.register = function(thenDo) {
        // sends a request to the session tracker to register a connection
        // pointing to this session connection/id
        if (!this.sessionId) this.sessionId = 'nodejs-client-session:' + base.uuid();
        var session = this;

        this.send({
            action: 'registerClient',
            data: {
                id: this.sessionId,
                worldURL: "custom-nodejs",
                user: 'anonymous-nodejs-user',
                lastActivity: Date.now(),
                timeOfCreation: Date.now()
            }
        }, function(msg) {
            console.log("registered %s", session);
            session.trackerId = msg.data && msg.data.tracker && msg.data.tracker.id;
            thenDo && thenDo(msg);
        });
    }

    this.unregister = function(thenDo) {
        if (this.sessionId && this.trackerId) {
            console.log("unregisterClient");
            this.send({
                action: 'unregisterClient',
                target: this.trackerId,
                data: {}
            }, thenDo);
        }
        this.connection.close();
        this.sessionId = null;
        this.trackerId = null;
    }

}).call(WebSocketClient.prototype);

// -=-=-=-
// exports
// -=-=-=-

module.exports = {
    Client: WebSocketClient
};
