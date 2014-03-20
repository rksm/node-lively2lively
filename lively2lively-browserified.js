;(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var Connection = require('./lib/browser-client').Connection,
    url        = require("url"),
    services   = require('./lib/default-services'),
    lv         = require('./lib/browser-lively-interface').noConflict('lv');

var l2l = lv.l2l || {

    session: null,

    connect: function connect(options, thenDo) {
        options = options || {};
    
        var baseURL    = options.baseURL || "http://localhost:9001/",
            connectURL = url.resolve(baseURL, "nodejs/SessionTracker/connect"),
            name       = options.name || "browser-alien",
            session    = l2l.session = new Connection({
                sessionTrackerURL: connectURL,
                username: name,
                getSessionsCacheInvalidationTimeout: 10*1000
            });
    
        document.addEventListener('onbeforeunload', l2l.disconnect);
        session.reactTo('closed', function() {
            document.removeEventListener('onbeforeunload', l2l.disconnect); })
    
        session.register();
        session.openForRequests();
        session.whenOnline(function() {
            session.addActions(services);
            thenDo && thenDo(null, session);
        });
    },

    disconnect: function() {
        var s = l2l.session;
        if (s) { s.unregister(); l2l.session = null; }
    }
}

// currently supported:
// baseURL, name, autoload
function optionsFromScript() {
    var scriptName = "lively2lively-browserified.js",
        options = {},
        scripts = document.getElementsByTagName('script'),
        l2lScripts = [],
        script;

    for (var i = 0; i < scripts.length; i++) {
        var src = scripts[i].src;
        if (src.indexOf(scriptName) !== -1) l2lScripts.push(scripts[i]);
    }

    if (l2lScripts.length === 0) {
        console.warn('Could not find lively2lively script file for option extraction.');
    } else if (l2lScripts.length >= 2) {
        console.warn('Found multiple lively2lively script files when extracting options. Using the last one.');
        script = l2lScripts[l2lScripts.length-1];
    } else { script = l2lScripts[0]; }

    if (!script) return options;

    var optionsMatch = script.src.match(/\?(.*)/);
    if (!optionsMatch || !optionsMatch[1]) return options;
    optionsMatch[1].split('&').forEach(function(opt) {
        var kv = opt.split('=');
        options[kv[0]] = kv[1] && kv[1] === 'false' ? false : kv[1];
    });

    return options;
}

function dealWithExistingL2lSession() {
    if (!l2l.session || !l2l.session.isConnected()) return;
    console.warn("Found exisiting l2l connection. Deactivating it...");
    lv.l2l.disconnect();
}

(function autoload() {
    dealWithExistingL2lSession();
    var options = optionsFromScript();
    if (options.autoload === false) return;
    l2l.connect(options, function(err, session) {
        if (err) { console.error("Failed to load Lively2Lively: %s", err); return; }
        session._options = options;
        console.log('Lively2Lively connected with id %s', session.sessionId);
    });
})();

// -=-=-=-
// exports
// -=-=-=-

module.exports = lv.l2l = l2l;

},{"./lib/browser-client":3,"./lib/browser-lively-interface":5,"./lib/default-services":7,"url":10}],2:[function(require,module,exports){
var util         = require('util'),
    i            = util.inspect;

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// helper
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
function uuid() { // helper
    var id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        var r = Math.random()*16|0, v = c == 'x' ? r : (r&0x3|0x8); return v.toString(16); }).toUpperCase();
    return id;
}

var debugThreshold = 1;
function log(/*level, msg, arguments*/) {
    // the smaller logLevel the more important the message
    var args = Array.prototype.slice.call(arguments);
    var logLevel = typeof args[0] === 'number' ? args.shift() : 1;
    if (logLevel > debugThreshold) return;
    console.log.apply(console, args);
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// lively-json callback support
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
function addCallback(sender, msg, callback) {
    if (!callback) return;
    if (typeof msg === 'string') {
        console.warn('Websocket message callbacks are only supported for JSON messages!');
        return;
    }
    if (!sender._messageOutCounter) sender._messageOutCounter = 0;
    if (!sender.callbacks) sender.callbacks = {};
    msg.messageIndex = ++sender._messageOutCounter;
    msg.messageId = msg.messageId || 'lively-msg:' + uuid();
    var callbacks = sender.callbacks[msg.messageId] = sender.callbacks[msg.messageId] || [];
    callbacks.push(callback);
    // log(this.debugLevel, 'adding callback %s for sender %s. Message:', callback, sender, msg);
}

function triggerActions(receiver, connection, msg) {
    if (!receiver) {
        console.warn('no receiver for msg ', msg);
        return;
    }
    try {
        if (receiver.emit) receiver.emit('lively-message', msg, connection);
    } catch(e) {
        console.error('Error when dealing with %s requested from %s:\n%s',
            msg.action, msg.sender, e.stack);
    }
}

function triggerCallbacks(receiver, msg) {
    var expectMore = !!msg.expectMoreResponses,
        responseId = msg.inResponseTo,
        callbacks = responseId && receiver.callbacks && receiver.callbacks[responseId];
    // log(this.debugLevel, 'triggering callbacks for message:', receiver.callbacks, msg);
    if (!callbacks) return;
    callbacks.forEach(function(cb) {
        try { cb(msg, expectMore); } catch(e) { console.error('Error in websocket message callback:\n', e); }
    });
    if (!expectMore) callbacks.length = 0;
}

function onLivelyJSONMessage(receiver, connection, msg) {
    if (typeof msg === 'string') { try { msg = JSON.parse(msg); } catch(e) { return; } }
    var action = msg.action, sender = msg.sender;
    if (!action) return;
    log(receiver.debugLevel+1, '\n%s received %s from %s %s\n',
        receiver, action, sender,
        msg.messageIndex ? '('+msg.messageIndex+')':'',
        msg);
    if (receiver.requiresSender && !sender) { console.error('%s could not extract sender from incoming message %s', receiver, i(msg)); return; }
    if (!action) { console.warn('%s could not extract action from incoming message %s', receiver, i(msg)); }
    if (msg.inResponseTo) triggerCallbacks(receiver, msg);
    else triggerActions(receiver, connection, msg);
}

function sendLivelyMessage(sender, connection, msg, callback) {
    try {
        addCallback(sender, msg, callback);
        if (msg.action) log(sender.debugLevel+1, '\n%s sending: %s to %s\n', sender, msg.action, connection.id || 'unknown', msg);
        if (typeof msg !== 'string') {
            if (sender.sender && !msg.sender) msg.sender = sender.sender;
            if (!msg.messageId) msg.messageId = 'lively-msg:' + uuid();
            msg = JSON.stringify(msg);
        }
        var sendMethod;
        if (connection._send) sendMethod = '_send'; // we wrapped it
        else if (connection.sendUTF) sendMethod = 'sendUTF';
        else sendMethod = 'send';
        return connection[sendMethod](msg);
    } catch(e) {
        console.error('Send with %s failed: %s', sender, e);
    }
    return false;
}


// -=-=-=-
// exports
// -=-=-=-

module.exports = {
    sendLivelyMessage: sendLivelyMessage,
    onLivelyJSONMessage: onLivelyJSONMessage,
    uuid: uuid,
    log: log
};

},{"util":11}],3:[function(require,module,exports){
var util         = require('util'),
    i            = util.inspect,
    f            = util.format,
    EventEmitter = require('events').EventEmitter;

var base = require('./base'),
//     sendLivelyMessage = base.sendLivelyMessage,
//     onLivelyJSONMessage = base.onLivelyJSONMessage,
    log = base.log,
    uuid = base.uuid;

var signal, listen, unlisten;

function extend(origin, add) {
  // Don't do anything if add isn't an object
  if (!add || typeof add !== 'object') return origin;

  var keys = Object.keys(add);
  var i = keys.length;
  while (i--) {
    origin[keys[i]] = add[keys[i]];
  }
  return origin;
}

if (typeof lively !== "undefined" && typeof lively.bindings !== "undefined") {
    signal = function(emitter, type, evt) {
        lively.bindings.signal(emitter, type, evt);    
    }
    
    listen = function(emitter, type, listener, action, options) {
        lively.bindings.connect(emitter, type, listener, action, options);
    }
    
    unlisten = function(from, type, to, action) {
        lively.bindings.disconnect(from, type, to, action);
    }
} else {

    var registry = [];

    function findConnections(emitter, type, target, action, isOnce) {
        return registry.filter(function(entry) {
            return entry[0] === emitter
                && entry[1] === type
                && entry[2] === target
                && entry[3] === action
                && entry[4] === isOnce
        });
    }

    function hasConnection(emitter, type, target, action, isOnce) {
        return findConnections(emitter, type, target, action, isOnce).length > 0;
    }

    function removeConnections(emitter, type, target, action, isOnce) {
        var cs = findConnections(emitter, type, target, action, isOnce);
        cs.forEach(function(c) {
            registry.splice(registry.indexOf(c), 1);
            c[0].removeListener(c[1], c[5]);
        });
    }

    signal = function(emitter, type, evt) {
        emitter.emit(type, evt);
    }
    
    var listenerFuncs = {};
    listen = function(emitter, type, listener, action, options) {
        var once = options && (options.removeAfterUpdate || options.once);
        removeConnections(emitter, type, listener, action, once);
        var listenFunc = function(evt) {
            console.log('fired %s -> %s.%s', type, listener, action);
            listener[action](evt);
        }
        registry.push([emitter, type, listener, action, once, listenFunc]);
        emitter[once ? 'once' : 'on'](type, listenFunc)
    }
    
    unlisten = function(emitter, type, listener, action) {
        removeConnections(emitter, type, listener, action, false);
    }
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
function WebSocketHelper(url, options) {
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
    options = options || {}
    EventEmitter.call(this);
    this.initialize(url, options);
    // this.url = url;
    // this.protocol = options.protocol;
    // this.sender = options.sender || null;
    // this.setupClient();
    // this.debugLevel = options.debugLevel !== undefined ?  options.debugLevel : 1;
}

util.inherits(WebSocketHelper, EventEmitter);

(function() {

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// properties

    this.CONNECTING     = 0,
    this.OPEN           = 1,
    this.CLOSING        = 2,
    this.CLOSED         = 3,
    this.doNotSerialize = ['socket', 'callbacks']

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// initializing

    this.initialize = function(uri, options) {
        options = options || {};
        uri = uri.isURL ? uri.toString() : uri;
        uri = uri.replace(/^http/, 'ws');
        this.uri = uri;
        this._erroredCount = 0;
        this._openedCount = 0;
        this._closedCount = 0;
        this._messageOutCounter = 0;
        this._messageInCounter = 0;
        this._lastMessagesOut = [];
        this._lastMessagesIn = [];
        this._lastErrors = [];
        this.socket = null;
        this.reopenClosedConnection = options.enableReconnect || false;
        this._open = false;
        this.sendTimeout = options.timeout || 3 * 1000; // when to stop trying to send
        this.messageQueue = [];
        this.callbacks = {};
        this.protocol = options.protocol ? options.protocol : null;
    }

    this.onrestore = function() {
        this.callbacks = {};
        this._open = false;
    }

    this.enableReconnect = function() { this.reopenClosedConnection = true; }

    this.disableReconnect = function() { this.reopenClosedConnection = false; }

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// events

    this.signal = function(type, evt) {
        signal(this, type, evt);
    }

    this.onError = function(evt) {
        this._erroredCount++;
        this._lastErrors = this._lastErrors.concat(evt.message || evt).slice(-3);
        console.log('%s got error %s', this, evt.data ? evt.data : evt);
        this.signal('error', evt);
    }

    this.onOpen = function(evt) {
        this._openedCount++;
        this._open = true;
        this.deliverMessageQueue();
        this.signal('opened', evt);
    }

    this.onClose = function(evt) {
        this._closedCount++;
        this.signal('closed', evt);
        // reopen makes only sense if connection was open before
        if (this._open && this.reopenClosedConnection) this.connect();
        else this._open = false;
    }

    this.onMessage = function(evt) {
        this._messageInCounter++;
        this._lastMessagesIn = this._lastMessagesIn.concat(evt.data).slice(-3);
        this.signal('message', evt.data);
        if (this.protocol !== 'lively-json') return;
        var msg;
        try {
            msg = JSON.parse(evt.data);
        } catch(e) {
            console.warn(log('%s failed to JSON parse message and dispatch %s: %s', this, evt.data, e));
            return;
        }
        msg && this.onLivelyJSONMessage(msg);
    }

    this.onLivelyJSONMessage = function(msg) {
        // the lively-json protocol. Messages should be valid JSON in the form:
        // msg = {
        //   messageId: NUMBER|STRING, // optional identifier of the message
        //   action: STRING, // will specify what the receiver should do with
        //                   // the message. Might be used as the key/name for
        //                   // signaling data bindings or emitting events
        //   data: OBJECT, // the payload of the message
        //   sender: STRING, // sender id
        //   target: STRING, // target id
        //   [inResponseTo: NUMBER|STRING,] // optional identifier of a message
        //                                  // that this message answers
        //   [expectMoreResponses: BOOL,] // if this is an answer then this can
        //                                // this can be true and the answer
        //                                // callback will be trigered multiple
        //                                // times, "streaming response"
        //   [messageIndex: NUMBER,]  // Optional, might go away Really Soon,
        //                           // currently used for debugging
        //   [route: ARRAY]  // Ids(?) of websocket handlers that routed this
        //                   // msg
        // }
        var responseId = msg.inResponseTo;
        if (responseId) { // it is a message that is an answer
            var callbacks = responseId && this.callbacks[responseId];
            if (!callbacks) return;
            var expectMore = !!msg.expectMoreResponses;
            callbacks.forEach(function(cb) {
                try {
                    cb(msg, expectMore);
                } catch(e) {
                    console.error(log('Error in websocket message callback\n%s', e.stack || e));
                }
            });
            if (!expectMore) callbacks.length = 0;
        } else { // an initiating message
            this.signal('lively-message', msg);
        }
    }


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// network

    this.isOpen = function() { return this.socket && this.socket.readyState === this.OPEN; }

    this.isConnecting = function() { return this.socket && this.socket.readyState === this.CONNECTING; }

    this.isClosed = function() { return !this.socket || this.socket.readyState >= this.CLOSING; }

    this.connect = function() {
        if (this.isOpen() || this.isConnecting()) return this;
        if (this.socket) this.socket.close();
        var self = this;
        this.socket = extend(new WebSocket(this.uri, this.protocol), {
            onerror: function(evt) { return self.onError(evt); },
            onopen: function(evt) { return self.onOpen(evt); },
            onclose: function(evt) { return self.onClose(evt); },
            onmessage: function(evt) { return self.onMessage(evt); }
        });
    },

    this.send = function(data, options, callback) {
        callback = typeof options === 'function' ? options : callback;
        options = typeof options === 'function' ? {} : options;
        var msg = this.queue(data, callback);
        this.deliverMessageQueue(options);
        return msg;
    }

    this.queue = function(data, callback) {
        var msgString;
        if (typeof data !== 'string') {
            data.messageIndex = ++this._messageOutCounter;
            data.messageId = 'client-msg:' + uuid();
            if (callback) {
                var callbacks = this.callbacks[data.messageId] = this.callbacks[data.messageId] || [];
                callbacks.push(callback);
            }
            msgString = JSON.stringify(data);
        } else {
            if (callback) {
                console.warn(log('Websocket message callbacks are only supported for JSON messages!'));
            }
            msgString = data;
        }
        this.messageQueue.push(msgString);
        return data;
    }

    this.deliverMessageQueue = function(options) {
        if (this._sendInProgress) return;
        if (this.isClosed()) {
            // just reconnect, send will be triggered from onOpen
            this.connect(); return; }

        // send logic
        this._sendInProgress = true;
        var ws = this;
        function doSend() {
            try {
                var msg;
                while ((msg = ws.messageQueue.shift())) {
                    ws.socket.send(msg);
                    ws._messageOutCounter++;
                    ws._lastMessagesOut = ws._lastMessagesOut.concat(msg).slice(-3);
                }
            } finally {
                delete ws._sendInProgress;
            }
        }

        // delay and try again
        options = options || {};
        options.startTime = options.startTime || Date.now();
        options.retryDelay = options.retryDelay || 100;
        (function testConnectionAndTriggerSend() {
            if (ws.isOpen()) { doSend(); return; }
            if (ws.sendTimeout && Date.now() - options.startTime > ws.sendTimeout) {
                ws.onError({error: 'send attempt timed out', type: 'timeout'}); return;
            }
            setTimeout(testConnectionAndTriggerSend, options.retryDelay);
        })();
    }

    this.close = function() {
        this.reopenClosedConnection = false;
        if (!this.isClosed()) this.socket.close();
    }


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// debugging

    this.toString = function() {
        return f('lively2livelyBrowserClient(%s, connection: %s, %s received messages,  %s sent messages)',
            this.uri, this.isOpen() ? 'open' : 'closed', this._messageInCounter, this._messageOutCounter);
    }

}).call(WebSocketHelper.prototype);


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
function Connection(options) {
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

// from lively.net.SessionTracker SessionTrackerConnection
// methods removed:
//   setL2lStore
//   getL2lStore
//   ensureServerToServerConnection
//   resetServer
//   getWebResource

    EventEmitter.call(this);
    this.initialize(options);
    // this.url = url;
    // this.protocol = options.protocol;
    // this.sender = options.sender || null;
    // this.setupClient();
    // this.debugLevel = options.debugLevel !== undefined ?  options.debugLevel : 1;
}

util.inherits(Connection, EventEmitter);

(function() {

    this.reactTo = function(type, callback) {
        listen(this, type, {cb: callback}, 'cb');
    }

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// initializing

    this.initialize = function(options) {
        this.sessionId = null; // id of this session, defined when connected
        this.trackerId = null; // id of the tracker endpoint on the server, defined when connected
        this.sessionTrackerURL = options.sessionTrackerURL;
        this.username = options.username;
        this._status = 'disconnected';
        this.registerTimeout = options.registerTimeout || 60*1000; // ms
        this.activityTimeReportDelay = options.activityTimeReportDelay || 20*1000; // ms
        // a value other than null will enable session caching, i.e.
        // this.getSessions will only do a request at most as specified by timeout
        this.getSessionsCacheInvalidationTimeout = options.getSessionsCacheInvalidationTimeout || null;
        this.timeOfCreation = Date.now(); // UNIX timestamp
    }

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// net accessors

    this.getWebSocket = function() {
        if (this.webSocket) return this.webSocket;
        var url = String(this.sessionTrackerURL);
        // FIXME
        if (!/connect\/?$/.test(url)) url = url.replace(/\/?$/, '/connect')
        this.webSocket = new WebSocketHelper(url, {protocol: "lively-json", enableReconnect: true});
        listen(this.webSocket, 'error', this, 'connectionError');
        this.listen();
        return this.webSocket;
    }

    this.resetConnection = function() {
        this._status = 'disconnected';
        var ws = this.webSocket;
        if (!ws) return;
        // in case connection wasn't established yet
        unlisten(ws, 'error', this, 'connectionError');
        ws.close();
        this.webSocket = null;
    }

    this.send = function(action, jso, callback) {
        if (!this.sessionId) { throw new Error('Need sessionId to interact with SessionTracker!') }
        var msg;
        if (arguments.length === 1) {
            var options = arguments[0];
            callback = options.callback;
            msg = {
                sender: this.sessionId,
                action: options.action,
                data: options.data || {}
            }
            if (options.inResponseTo) msg.inResponseTo = options.inResponseTo;
            if (options.target) msg.target = options.target;
        } else {
            msg = {
                sender: this.sessionId,
                action: action,
                data: jso
            }
        }
        return this.getWebSocket().send(msg, {}, callback);
    }

    this.sendTo = function(targetId, action, data, callback) {
        return this.send({action: action, data: data, target: targetId, callback: callback});
    }

    this.answer = function(msg, data, callback) {
        if (!msg.messageId) { throw new Error('Cannot answer message without messageId!'); }
        if (!msg.sender) { throw new Error('Cannot answer message without sender!'); }
        return this.send({inResponseTo: msg.messageId, action: msg.action+'Result', data: data, target: msg.sender, callback: callback});
    }

    this.listen = function() {
        var ws = this.webSocket;
        listen(ws, 'lively-message', this, 'dispatchLivelyMessageMyself');
    }

    this.isConnected = function() {
        return this._status === 'connected' && !!this.sessionId;
    }


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// server management

    this.getSessions = function(cb, forceFresh) {
        // if timeout specified throttle requests so that they happen at most
        // timeout-often
        var to = this.getSessionsCacheInvalidationTimeout;
        if (forceFresh) delete this._getSessionsCachedResult;
        if (to && this._getSessionsCachedResult) {
            cb && cb(this._getSessionsCachedResult); return; }
        // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
        // queue requests
        var self = this;
        if (!this._getSessionsQueue) this._getSessionsQueue = [];
        this._getSessionsQueue.push(cb);
        if (this._getSessionsInProgress) return;
        // start request if currently no one ongoing
        this._getSessionsInProgress = true;
        this.sendTo(this.trackerId, 'getSessions', {}, function(msg) {
            self._getSessionsInProgress = false;
            var sessions = msg && msg.data; cb;
            if (to) {
                self._getSessionsCachedResult = sessions;
                setTimeout(function() { self._getSessionsCachedResult = null; }, to);
            }
            while ((cb = self._getSessionsQueue.shift())) cb && cb(sessions);
        });
    }

    this.getUserInfo = function(thenDo) {
        // flatten the session data and group by user so that it becomes
        // easier to consume
        this.getSessions(function(sessions) {
            var result = {};
            for (var trackerId in sessions) {
                for (var sessionId in sessions[trackerId]) {
                    if (!sessions[trackerId]) { continue; }
                    var session = sessions[trackerId][sessionId];
                    var sessionList = result[session.user] || (result[session.user] = []);
                    sessionList.push({
                        id: sessionId,
                        tracker: trackerId,
                        worldURL: session.worldURL,
                        lastActivity: session.lastActivity,
                        remoteAddress: session.remoteAddress
                    });
                }
            }
            thenDo(result);
        });
    }


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// session management

    this.whenOnline = function(thenDo) {
        if (this.isConnected()) { thenDo(); return; }
        listen(this, 'established', thenDo, 'call', {
            removeAfterUpdate: true});
    }

    this.connectionEstablished = function(msg) {
        // In case we have removed the connection already
        if (!this.webSocket || !this.sessionId) return;
        this._status = 'connected';
        this.trackerId = msg.data && msg.data.tracker && msg.data.tracker.id;
        listen(this.webSocket, 'closed', this, 'connectionClosed', {
            removeAfterUpdate: true});
        signal(this, 'established', this);
        this.startReportingActivities();
        console.log('%s established', this.toString(true));
    }

    this.connectionClosed = function() {
        if (this.sessionId && this.status() === 'connected') { this._status = 'connecting'; signal(this, 'connecting'); this.register(); }
        else { this._status = 'disconnected'; signal(this, 'closed'); }
        console.log('%s closed', this.toString(true));
    }

    this.connectionError = function(err) {
        console.log('connection error in %s:\n%o', this.toString(true),
            err && err.message ? err.message : err);
    }

    this.register = function(actions) {
        // sends a request to the session tracker to register a connection
        // pointing to this session connection/id
        if (!this.sessionId) this.sessionId = 'client-session:' + uuid();
        var session = this;
        setTimeout(function timeoutCheck() {
            if (session.isConnected() || !session.sessionId) return;
            session.resetConnection();
            session.register();
        }, this.registerTimeout
            /*Numbers.random(timeoutCheckPeriod-5, timeoutCheckPeriod+5)*/ // to balance server load
            );
        actions && (this.actions = actions);
        this.whenOnline(this.listen.bind(this));
        this.send('registerClient', {
            id: this.sessionId,
            worldURL: document.URL,
            user: this.username || 'anonymous',
            lastActivity: window.LastEvent && window.LastEvent.timeStamp,
            timeOfCreation: this.timeOfCreation,
        }, this.connectionEstablished.bind(this));
    }

    this.unregister = function() {
        if (this.sessionId) this.sendTo(this.trackerId, 'unregisterClient', {});
        this.resetConnection();
        this.sessionId = null;
        this.trackerId = null;
        this.stopReportingActivities();
    }

    this.initServerToServerConnect = function(serverURL, options, cb) {
        options = options || {}
        var url = serverURL.toString().replace(/^http/, 'ws')
        this.sendTo(this.trackerId, 'initServerToServerConnect', {url: url, options: options}, cb);
    }

    this.initServerToServerDisconnect = function(cb) {
        this.sendTo(this.trackerId, 'initServerToServerDisconnect', {}, cb);
    }


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// specific messages

    this.dispatchLivelyMessageMyself = function(msg) {
        this.dispatchLivelyMessage(msg, this);
    }

    this.dispatchLivelyMessage = function(msg, session) {
        var actions = this.getActions(),
            action = actions[msg.action];
        if (action) action(msg, session);
        else if (actions.messageNotUnderstood) actions.messageNotUnderstood(msg, session);
    }

    this.getActions = function() {
        // return Object.extend(Object.extend({}, lively.net.SessionTracker.defaultActions), this.actions);
        return extend({}, this.actions);
    }

    this.addActions = function(actions) {
        return extend(this.actions, actions);
    }

    this.remoteEval = function(targetId, expression, thenDo) {
        this.sendTo(targetId, 'remoteEvalRequest', {expr: expression}, thenDo);
    }

    this.openForRequests = function() {
        if (!this.actions) this.actions = {};
        this.listen();
    }

    this.sendObjectTo = function(targetId, obj, options, callback) {
        if (!Object.isFunction(obj.copy)) { throw new Error('object needs to support #copy for being send'); }
        var stringifiedCopy = obj.copy(true/*stringify*/);
        if (!Object.isString(stringifiedCopy)) { throw new Error('object needs to return a string to copy(true)'); }
        var withObjectDo = options.withObjectDo;
        if (Object.isFunction(withObjectDo)) withObjectDo = '(' + String(withObjectDo) + ')';
        this.sendTo(targetId, 'copyObject', {object: stringifiedCopy, withObjectDo: withObjectDo}, callback);
    }


// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// reporting

    this.startReportingActivities = function() {
        var session = this;
        function report() {
            function next() { session._reportActivitiesTimer = setTimeout(report, session.activityTimeReportDelay); }
            if (!session.isConnected()) return;
            var timeStamp = window.LastEvent && window.LastEvent.timeStamp;
            if (!timeStamp || timeStamp === session._lastReportedActivity) { next(); return; }
            session._lastReportedActivity = timeStamp;
            session.sendTo(session.trackerId, 'reportActivity', {lastActivity: timeStamp}, next);
        }
        report();
    }

    this.stopReportingActivities = function() {
        clearTimeout(this._reportActivitiesTimer);
        delete this._reportActivitiesTimer;
    }

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// debugging

    this.status = function() { return this._status; }

    this.toString = function(shortForm) {
        if (!this.webSocket || !this.webSocket.isOpen() || shortForm) {
            return f("Session connection to %s", this.sessionTrackerURL);
        }
        return f("Session %s to %s\n  id: %s\n  user: %s",
            this.status(), this.sessionTrackerURL, this.sessionId, this.username);
    }


}).call(Connection.prototype);

// -=-=-=-
// exports
// -=-=-=-

module.exports = {
    WebSocket: WebSocketHelper,
    Connection: Connection,
};

},{"./base":2,"events":8,"util":11}],4:[function(require,module,exports){

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// debug helper -- inspecting

function inspect(obj, options, depth) {
    options = options || {};
    depth = depth || 0;
    if (!obj) { return print(obj); }

    // print function
    if (typeof obj === 'function') {
        function argNames(func) {
            if (func.superclass) return [];
            var names = String(func).match(/^[\s\(]*function[^(]*\(([^)]*)\)/)[1].
                    replace(/\/\/.*?[\r\n]|\/\*(?:.|[\r\n])*?\*\//g, '').
                    replace(/\s+/g, '').split(',');

            return names.length == 1 && !names[0] ? [] : names;
        }
        return options.printFunctionSource ? String(obj) :
            'function' + (obj.name ? ' ' + obj.name : '')
          + '(' + argNames(obj).join(',') + ') {/*...*/}';
    }
    // print "primitive"
    switch (obj.constructor) {
        case String:
        case Boolean:
        case RegExp:
        case Number: return print(obj);
    };

    if (typeof obj.serializeExpr === 'function') {
        return obj.serializeExpr();
    }

    var isArray = obj && Array.isArray(obj),
        openBr = isArray ? '[' : '{', closeBr = isArray ? ']' : '}';
    if (options.maxDepth && depth >= options.maxDepth) return openBr + '/*...*/' + closeBr;

    var printedProps = [];
    if (isArray) {
        printedProps = obj.map(function(ea) { return inspect(ea, options, depth); });
    } else {
        printedProps = Object.keys(obj)
           // .select(function(key) { return obj.hasOwnProperty(key); })
            .sort(function(a, b) {
                var aIsFunc = typeof obj[a] === 'function', bIsFunc = typeof obj[b] === 'function';
                if (aIsFunc === bIsFunc) {
                    if (a < b)  return -1;
                    if (a > b) return 1;
                    return 0;
                };
                return aIsFunc ? 1 : -1;
            })
            .map(function(key, i) {
                if (isArray) inspect(obj[key], options, depth + 1);
                var printedVal = inspect(obj[key], options, depth + 1);
                return format('%s: %s',
                    options.escapeKeys ? print(key) : key, printedVal);
            });
    }

    if (printedProps.length === 0) { return openBr + closeBr; }

    var printedPropsJoined = printedProps.join(','),
        useNewLines = !isArray
                   && (!options.minLengthForNewLine
                    || printedPropsJoined.length >= options.minLengthForNewLine),
        indent = doIndent('', options.indent || '  ', depth),
        propIndent = doIndent('', options.indent || '  ', depth + 1),
        startBreak = useNewLines ? '\n' + propIndent: '',
        endBreak = useNewLines ? '\n' + indent : '';
    if (useNewLines) printedPropsJoined = printedProps.join(',' + startBreak);
    return openBr + startBreak + printedPropsJoined + endBreak + closeBr;
}

function print(obj) {
    if (obj && Array.isArray(obj)) {
        return '[' + obj.map(function(ea) { return print(ea); }) + ']';
    }
    if (typeof obj !== "string") {
        return String(obj);
    }
    var result = String(obj);
    result = result.replace(/\n/g, '\\n\\\n');
    result = result.replace(/(")/g, '\\$1');
    result = '\"' + result + '\"';
    return result;
}

function format() {
    var objects = makeArray(arguments);
    var format = objects.shift();
    if (!format) { console.log("Error in Strings>>formatFromArray, first arg is undefined"); };

    function appendText(object, string) {
        return "" + object;
    }

    function appendObject(object, string) {
        return "" + object;
    }

    function appendInteger(value, string) {
        return value.toString();
    }

    function appendFloat(value, string, precision) {
        if (precision > -1) return value.toFixed(precision);
        else return value.toString();
    }

    function appendObject(value, string) { return inspect(value); }

    var appenderMap = {s: appendText, d: appendInteger, i: appendInteger, f: appendFloat, o: appendObject};
    var reg = /((^%|[^\\]%)(\d+)?(\.)([a-zA-Z]))|((^%|[^\\]%)([a-zA-Z]))/;

    function parseFormat(fmt) {
        var oldFmt = fmt;
        var parts = [];

        for (var m = reg.exec(fmt); m; m = reg.exec(fmt)) {
            var type = m[8] || m[5],
                appender = type in appenderMap ? appenderMap[type] : appendObject,
                precision = m[3] ? parseInt(m[3]) : (m[4] == "." ? -1 : 0);
            parts.push(fmt.substr(0, m[0][0] == "%" ? m.index : m.index + 1));
            parts.push({appender: appender, precision: precision});

            fmt = fmt.substr(m.index + m[0].length);
        }
        if (fmt)
            parts.push(fmt.toString());

        return parts;
    };

    var parts = parseFormat(format),
        str = "",
        objIndex = 0;

    for (var i = 0; i < parts.length; ++i) {
        var part = parts[i];
        if (part && typeof(part) == "object") {
            var object = objects[objIndex++];
            str += (part.appender || appendText)(object, str, part.precision);
        } else {
            str += appendText(part, str);
        }
    }
    return str;
}

function makeArray(iterable) {
    if (!iterable) return [];
    if (iterable.toArray) return iterable.toArray();
    var length = iterable.length,
        results = new Array(length);
    while (length--) results[length] = iterable[length];
    return results;
}

function doIndent(str, indentString, depth) {
    if (!depth || depth <= 0) return str;
    while (depth > 0) { depth--; str = indentString + str; }
    return str;
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

module.exports = {
    inspect: inspect,
    format: format
}

},{}],5:[function(require,module,exports){

var lv = {
    noConflict: function(globalName) {
        if (globalName) window[globalName] = lv;
        return lv;
    }
}

var helperFns  = require('./browser-helper');
Object.keys(helperFns).forEach(function(k) { lv[k] = helperFns[k]; });

module.exports = lv;
},{"./browser-helper":4}],6:[function(require,module,exports){
// helper
function signatureOf(name, func) {
    var source = String(func),
        match = source.match(/function\s*[a-zA-Z0-9_$]*\s*\(([^\)]*)\)/),
        params = (match && match[1]) || '';
    return name + '(' + params + ')';
}

function isClass(obj) {
    if (obj === obj
      || obj === Array
      || obj === Function
      || obj === String
      || obj === Boolean
      || obj === Date
      || obj === RegExp
      || obj === Number) return true;
    return (obj instanceof Function)
        && ((obj.superclass !== undefined)
         || (obj._superclass !== undefined));
}

function pluck(list, prop) { return list.map(function(ea) { return ea[prop]; }); }

function getObjectForCompletion(evalFunc, stringToEval, thenDo) {
    // thenDo = function(err, obj, startLetters)
    var idx = stringToEval.lastIndexOf('.'),
        startLetters = '';
    if (idx >= 0) {
        startLetters = stringToEval.slice(idx+1);
        stringToEval = stringToEval.slice(0,idx);
    }
    var completions = [];
    try {
        var obj = evalFunc(stringToEval);
    } catch (e) {
        thenDo(e, null, null);
    }
    thenDo(null, obj, startLetters);
}

function propertyExtract(excludes, obj, extractor) {
    // show(''+excludes)
    return Object.getOwnPropertyNames(obj)
        .filter(function(key) { return excludes.indexOf(key) === -1; })
        .map(extractor)
        .filter(function(ea) { return !!ea; })
        .sort(function(a,b) {
            return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
}

function getMethodsOf(excludes, obj) {
    return propertyExtract(excludes, obj, function(key) {
        if (obj.__lookupGetter__(key) || typeof obj[key] !== 'function') return null;
        return {name: key, completion: signatureOf(key, obj[key])}; })
}

function getAttributesOf(excludes, obj) {
    return propertyExtract(excludes, obj, function(key) {
        if (!obj.__lookupGetter__(key) && typeof obj[key] === 'function') return null;
        return {name: key, completion: key}; })
}

function getProtoChain(obj) {
    var protos = [], proto = obj;
    while (obj) { protos.push(obj); obj = obj.__proto__ }
    return protos;
}

function getDescriptorOf(originalObj, proto) {
    if (originalObj === proto) {
        var descr = originalObj.toString()
        if (descr.length > 50) descr = descr.slice(0,50) + '...';
        return descr;
    }
    var klass = proto.hasOwnProperty('constructor') && proto.constructor;
    if (!klass) return 'prototype';
    if (typeof klass.type === 'string' && klass.type.length) return klass.type;
    if (typeof klass.name === 'string' && klass.name.length) return klass.name;
    return "anonymous class";
}

function getCompletions(evalFunc, string, thenDo) {
    // thendo = function(err, completions/*ARRAY*/)
    // eval string and for the resulting object find attributes and methods,
    // grouped by its prototype / class chain
    // if string is something like "foo().bar.baz" then treat "baz" as start
    // letters = filter for properties of foo().bar
    // ("foo().bar.baz." for props of the result of the complete string)
    getObjectForCompletion(evalFunc, string, function(err, obj, startLetters) {
        if (err) { thenDo(err); return }
        var excludes = [];
        var completions = getProtoChain(obj).map(function(proto) {
            var descr = getDescriptorOf(obj, proto),
                methodsAndAttributes = getMethodsOf(excludes, proto)
                    .concat(getAttributesOf(excludes, proto));
            excludes = excludes.concat(pluck(methodsAndAttributes, 'name'));
            return [descr, pluck(methodsAndAttributes, 'completion')];
        });
        thenDo(err, completions, startLetters);
    })
}

module.exports = getCompletions;
},{}],7:[function(require,module,exports){
var getCompletions = require('./completion');

module.exports = {

    reportServices: function(msg, session) {
        session.answer(msg, {services: Object.keys(session.getActions())});
    },

    remoteEvalRequest: function(msg, session) {
        var result;
        if (false && !Config.get('lively2livelyAllowRemoteEval')) {
            result = 'remote eval disabled';
        } else {
            try {
                result = eval(msg.data.expr);
            } catch(e) {
                result = e + '\n' + e.stack;
            }
        }
        session.answer(msg, {result: String(result)});
    },

    completions: function(msg, session) {
        getCompletions(
            function(code) { return eval(code); },
            msg.data.expr,
            function(err, completions, startLetters) {
                console.log(completions);
                session.answer(msg, {
                    error: err ? String(err) : null,
                    completions: completions,
                    prefix: startLetters
                });
            });
    },

    messageNotUnderstood: function(msg, session) {
        console.error('Lively2Lively message not understood:\n%o', msg);
        session.answer(msg, {error: 'messageNotUnderstood'});
    }

}

},{"./completion":6}],8:[function(require,module,exports){
var process=require("__browserify_process");if (!process.EventEmitter) process.EventEmitter = function () {};

var EventEmitter = exports.EventEmitter = process.EventEmitter;
var isArray = typeof Array.isArray === 'function'
    ? Array.isArray
    : function (xs) {
        return Object.prototype.toString.call(xs) === '[object Array]'
    }
;
function indexOf (xs, x) {
    if (xs.indexOf) return xs.indexOf(x);
    for (var i = 0; i < xs.length; i++) {
        if (x === xs[i]) return i;
    }
    return -1;
}

// By default EventEmitters will print a warning if more than
// 10 listeners are added to it. This is a useful default which
// helps finding memory leaks.
//
// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
var defaultMaxListeners = 10;
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!this._events) this._events = {};
  this._events.maxListeners = n;
};


EventEmitter.prototype.emit = function(type) {
  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events || !this._events.error ||
        (isArray(this._events.error) && !this._events.error.length))
    {
      if (arguments[1] instanceof Error) {
        throw arguments[1]; // Unhandled 'error' event
      } else {
        throw new Error("Uncaught, unspecified 'error' event.");
      }
      return false;
    }
  }

  if (!this._events) return false;
  var handler = this._events[type];
  if (!handler) return false;

  if (typeof handler == 'function') {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        var args = Array.prototype.slice.call(arguments, 1);
        handler.apply(this, args);
    }
    return true;

  } else if (isArray(handler)) {
    var args = Array.prototype.slice.call(arguments, 1);

    var listeners = handler.slice();
    for (var i = 0, l = listeners.length; i < l; i++) {
      listeners[i].apply(this, args);
    }
    return true;

  } else {
    return false;
  }
};

// EventEmitter is defined in src/node_events.cc
// EventEmitter.prototype.emit() is also defined there.
EventEmitter.prototype.addListener = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('addListener only takes instances of Function');
  }

  if (!this._events) this._events = {};

  // To avoid recursion in the case that type == "newListeners"! Before
  // adding it to the listeners, first emit "newListeners".
  this.emit('newListener', type, listener);

  if (!this._events[type]) {
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  } else if (isArray(this._events[type])) {

    // Check for listener leak
    if (!this._events[type].warned) {
      var m;
      if (this._events.maxListeners !== undefined) {
        m = this._events.maxListeners;
      } else {
        m = defaultMaxListeners;
      }

      if (m && m > 0 && this._events[type].length > m) {
        this._events[type].warned = true;
        console.error('(node) warning: possible EventEmitter memory ' +
                      'leak detected. %d listeners added. ' +
                      'Use emitter.setMaxListeners() to increase limit.',
                      this._events[type].length);
        console.trace();
      }
    }

    // If we've already got an array, just append.
    this._events[type].push(listener);
  } else {
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  var self = this;
  self.on(type, function g() {
    self.removeListener(type, g);
    listener.apply(this, arguments);
  });

  return this;
};

EventEmitter.prototype.removeListener = function(type, listener) {
  if ('function' !== typeof listener) {
    throw new Error('removeListener only takes instances of Function');
  }

  // does not use listeners(), so no side effect of creating _events[type]
  if (!this._events || !this._events[type]) return this;

  var list = this._events[type];

  if (isArray(list)) {
    var i = indexOf(list, listener);
    if (i < 0) return this;
    list.splice(i, 1);
    if (list.length == 0)
      delete this._events[type];
  } else if (this._events[type] === listener) {
    delete this._events[type];
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  if (arguments.length === 0) {
    this._events = {};
    return this;
  }

  // does not use listeners(), so no side effect of creating _events[type]
  if (type && this._events && this._events[type]) this._events[type] = null;
  return this;
};

EventEmitter.prototype.listeners = function(type) {
  if (!this._events) this._events = {};
  if (!this._events[type]) this._events[type] = [];
  if (!isArray(this._events[type])) {
    this._events[type] = [this._events[type]];
  }
  return this._events[type];
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (typeof emitter._events[type] === 'function')
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

},{"__browserify_process":12}],9:[function(require,module,exports){

/**
 * Object#toString() ref for stringify().
 */

var toString = Object.prototype.toString;

/**
 * Array#indexOf shim.
 */

var indexOf = typeof Array.prototype.indexOf === 'function'
  ? function(arr, el) { return arr.indexOf(el); }
  : function(arr, el) {
      for (var i = 0; i < arr.length; i++) {
        if (arr[i] === el) return i;
      }
      return -1;
    };

/**
 * Array.isArray shim.
 */

var isArray = Array.isArray || function(arr) {
  return toString.call(arr) == '[object Array]';
};

/**
 * Object.keys shim.
 */

var objectKeys = Object.keys || function(obj) {
  var ret = [];
  for (var key in obj) ret.push(key);
  return ret;
};

/**
 * Array#forEach shim.
 */

var forEach = typeof Array.prototype.forEach === 'function'
  ? function(arr, fn) { return arr.forEach(fn); }
  : function(arr, fn) {
      for (var i = 0; i < arr.length; i++) fn(arr[i]);
    };

/**
 * Array#reduce shim.
 */

var reduce = function(arr, fn, initial) {
  if (typeof arr.reduce === 'function') return arr.reduce(fn, initial);
  var res = initial;
  for (var i = 0; i < arr.length; i++) res = fn(res, arr[i]);
  return res;
};

/**
 * Cache non-integer test regexp.
 */

var isint = /^[0-9]+$/;

function promote(parent, key) {
  if (parent[key].length == 0) return parent[key] = {};
  var t = {};
  for (var i in parent[key]) t[i] = parent[key][i];
  parent[key] = t;
  return t;
}

function parse(parts, parent, key, val) {
  var part = parts.shift();
  // end
  if (!part) {
    if (isArray(parent[key])) {
      parent[key].push(val);
    } else if ('object' == typeof parent[key]) {
      parent[key] = val;
    } else if ('undefined' == typeof parent[key]) {
      parent[key] = val;
    } else {
      parent[key] = [parent[key], val];
    }
    // array
  } else {
    var obj = parent[key] = parent[key] || [];
    if (']' == part) {
      if (isArray(obj)) {
        if ('' != val) obj.push(val);
      } else if ('object' == typeof obj) {
        obj[objectKeys(obj).length] = val;
      } else {
        obj = parent[key] = [parent[key], val];
      }
      // prop
    } else if (~indexOf(part, ']')) {
      part = part.substr(0, part.length - 1);
      if (!isint.test(part) && isArray(obj)) obj = promote(parent, key);
      parse(parts, obj, part, val);
      // key
    } else {
      if (!isint.test(part) && isArray(obj)) obj = promote(parent, key);
      parse(parts, obj, part, val);
    }
  }
}

/**
 * Merge parent key/val pair.
 */

function merge(parent, key, val){
  if (~indexOf(key, ']')) {
    var parts = key.split('[')
      , len = parts.length
      , last = len - 1;
    parse(parts, parent, 'base', val);
    // optimize
  } else {
    if (!isint.test(key) && isArray(parent.base)) {
      var t = {};
      for (var k in parent.base) t[k] = parent.base[k];
      parent.base = t;
    }
    set(parent.base, key, val);
  }

  return parent;
}

/**
 * Parse the given obj.
 */

function parseObject(obj){
  var ret = { base: {} };
  forEach(objectKeys(obj), function(name){
    merge(ret, name, obj[name]);
  });
  return ret.base;
}

/**
 * Parse the given str.
 */

function parseString(str){
  return reduce(String(str).split('&'), function(ret, pair){
    var eql = indexOf(pair, '=')
      , brace = lastBraceInKey(pair)
      , key = pair.substr(0, brace || eql)
      , val = pair.substr(brace || eql, pair.length)
      , val = val.substr(indexOf(val, '=') + 1, val.length);

    // ?foo
    if ('' == key) key = pair, val = '';
    if ('' == key) return ret;

    return merge(ret, decode(key), decode(val));
  }, { base: {} }).base;
}

/**
 * Parse the given query `str` or `obj`, returning an object.
 *
 * @param {String} str | {Object} obj
 * @return {Object}
 * @api public
 */

exports.parse = function(str){
  if (null == str || '' == str) return {};
  return 'object' == typeof str
    ? parseObject(str)
    : parseString(str);
};

/**
 * Turn the given `obj` into a query string
 *
 * @param {Object} obj
 * @return {String}
 * @api public
 */

var stringify = exports.stringify = function(obj, prefix) {
  if (isArray(obj)) {
    return stringifyArray(obj, prefix);
  } else if ('[object Object]' == toString.call(obj)) {
    return stringifyObject(obj, prefix);
  } else if ('string' == typeof obj) {
    return stringifyString(obj, prefix);
  } else {
    return prefix + '=' + encodeURIComponent(String(obj));
  }
};

/**
 * Stringify the given `str`.
 *
 * @param {String} str
 * @param {String} prefix
 * @return {String}
 * @api private
 */

function stringifyString(str, prefix) {
  if (!prefix) throw new TypeError('stringify expects an object');
  return prefix + '=' + encodeURIComponent(str);
}

/**
 * Stringify the given `arr`.
 *
 * @param {Array} arr
 * @param {String} prefix
 * @return {String}
 * @api private
 */

function stringifyArray(arr, prefix) {
  var ret = [];
  if (!prefix) throw new TypeError('stringify expects an object');
  for (var i = 0; i < arr.length; i++) {
    ret.push(stringify(arr[i], prefix + '[' + i + ']'));
  }
  return ret.join('&');
}

/**
 * Stringify the given `obj`.
 *
 * @param {Object} obj
 * @param {String} prefix
 * @return {String}
 * @api private
 */

function stringifyObject(obj, prefix) {
  var ret = []
    , keys = objectKeys(obj)
    , key;

  for (var i = 0, len = keys.length; i < len; ++i) {
    key = keys[i];
    if (null == obj[key]) {
      ret.push(encodeURIComponent(key) + '=');
    } else {
      ret.push(stringify(obj[key], prefix
        ? prefix + '[' + encodeURIComponent(key) + ']'
        : encodeURIComponent(key)));
    }
  }

  return ret.join('&');
}

/**
 * Set `obj`'s `key` to `val` respecting
 * the weird and wonderful syntax of a qs,
 * where "foo=bar&foo=baz" becomes an array.
 *
 * @param {Object} obj
 * @param {String} key
 * @param {String} val
 * @api private
 */

function set(obj, key, val) {
  var v = obj[key];
  if (undefined === v) {
    obj[key] = val;
  } else if (isArray(v)) {
    v.push(val);
  } else {
    obj[key] = [v, val];
  }
}

/**
 * Locate last brace in `str` within the key.
 *
 * @param {String} str
 * @return {Number}
 * @api private
 */

function lastBraceInKey(str) {
  var len = str.length
    , brace
    , c;
  for (var i = 0; i < len; ++i) {
    c = str[i];
    if (']' == c) brace = false;
    if ('[' == c) brace = true;
    if ('=' == c && !brace) return i;
  }
}

/**
 * Decode `str`.
 *
 * @param {String} str
 * @return {String}
 * @api private
 */

function decode(str) {
  try {
    return decodeURIComponent(str.replace(/\+/g, ' '));
  } catch (err) {
    return str;
  }
}

},{}],10:[function(require,module,exports){
var punycode = { encode : function (s) { return s } };

exports.parse = urlParse;
exports.resolve = urlResolve;
exports.resolveObject = urlResolveObject;
exports.format = urlFormat;

function arrayIndexOf(array, subject) {
    for (var i = 0, j = array.length; i < j; i++) {
        if(array[i] == subject) return i;
    }
    return -1;
}

var objectKeys = Object.keys || function objectKeys(object) {
    if (object !== Object(object)) throw new TypeError('Invalid object');
    var keys = [];
    for (var key in object) if (object.hasOwnProperty(key)) keys[keys.length] = key;
    return keys;
}

// Reference: RFC 3986, RFC 1808, RFC 2396

// define these here so at least they only have to be
// compiled once on the first module load.
var protocolPattern = /^([a-z0-9.+-]+:)/i,
    portPattern = /:[0-9]+$/,
    // RFC 2396: characters reserved for delimiting URLs.
    delims = ['<', '>', '"', '`', ' ', '\r', '\n', '\t'],
    // RFC 2396: characters not allowed for various reasons.
    unwise = ['{', '}', '|', '\\', '^', '~', '[', ']', '`'].concat(delims),
    // Allowed by RFCs, but cause of XSS attacks.  Always escape these.
    autoEscape = ['\''],
    // Characters that are never ever allowed in a hostname.
    // Note that any invalid chars are also handled, but these
    // are the ones that are *expected* to be seen, so we fast-path
    // them.
    nonHostChars = ['%', '/', '?', ';', '#']
      .concat(unwise).concat(autoEscape),
    nonAuthChars = ['/', '@', '?', '#'].concat(delims),
    hostnameMaxLen = 255,
    hostnamePartPattern = /^[a-zA-Z0-9][a-z0-9A-Z_-]{0,62}$/,
    hostnamePartStart = /^([a-zA-Z0-9][a-z0-9A-Z_-]{0,62})(.*)$/,
    // protocols that can allow "unsafe" and "unwise" chars.
    unsafeProtocol = {
      'javascript': true,
      'javascript:': true
    },
    // protocols that never have a hostname.
    hostlessProtocol = {
      'javascript': true,
      'javascript:': true
    },
    // protocols that always have a path component.
    pathedProtocol = {
      'http': true,
      'https': true,
      'ftp': true,
      'gopher': true,
      'file': true,
      'http:': true,
      'ftp:': true,
      'gopher:': true,
      'file:': true
    },
    // protocols that always contain a // bit.
    slashedProtocol = {
      'http': true,
      'https': true,
      'ftp': true,
      'gopher': true,
      'file': true,
      'http:': true,
      'https:': true,
      'ftp:': true,
      'gopher:': true,
      'file:': true
    },
    querystring = require('querystring');

function urlParse(url, parseQueryString, slashesDenoteHost) {
  if (url && typeof(url) === 'object' && url.href) return url;

  if (typeof url !== 'string') {
    throw new TypeError("Parameter 'url' must be a string, not " + typeof url);
  }

  var out = {},
      rest = url;

  // cut off any delimiters.
  // This is to support parse stuff like "<http://foo.com>"
  for (var i = 0, l = rest.length; i < l; i++) {
    if (arrayIndexOf(delims, rest.charAt(i)) === -1) break;
  }
  if (i !== 0) rest = rest.substr(i);


  var proto = protocolPattern.exec(rest);
  if (proto) {
    proto = proto[0];
    var lowerProto = proto.toLowerCase();
    out.protocol = lowerProto;
    rest = rest.substr(proto.length);
  }

  // figure out if it's got a host
  // user@server is *always* interpreted as a hostname, and url
  // resolution will treat //foo/bar as host=foo,path=bar because that's
  // how the browser resolves relative URLs.
  if (slashesDenoteHost || proto || rest.match(/^\/\/[^@\/]+@[^@\/]+/)) {
    var slashes = rest.substr(0, 2) === '//';
    if (slashes && !(proto && hostlessProtocol[proto])) {
      rest = rest.substr(2);
      out.slashes = true;
    }
  }

  if (!hostlessProtocol[proto] &&
      (slashes || (proto && !slashedProtocol[proto]))) {
    // there's a hostname.
    // the first instance of /, ?, ;, or # ends the host.
    // don't enforce full RFC correctness, just be unstupid about it.

    // If there is an @ in the hostname, then non-host chars *are* allowed
    // to the left of the first @ sign, unless some non-auth character
    // comes *before* the @-sign.
    // URLs are obnoxious.
    var atSign = arrayIndexOf(rest, '@');
    if (atSign !== -1) {
      // there *may be* an auth
      var hasAuth = true;
      for (var i = 0, l = nonAuthChars.length; i < l; i++) {
        var index = arrayIndexOf(rest, nonAuthChars[i]);
        if (index !== -1 && index < atSign) {
          // not a valid auth.  Something like http://foo.com/bar@baz/
          hasAuth = false;
          break;
        }
      }
      if (hasAuth) {
        // pluck off the auth portion.
        out.auth = rest.substr(0, atSign);
        rest = rest.substr(atSign + 1);
      }
    }

    var firstNonHost = -1;
    for (var i = 0, l = nonHostChars.length; i < l; i++) {
      var index = arrayIndexOf(rest, nonHostChars[i]);
      if (index !== -1 &&
          (firstNonHost < 0 || index < firstNonHost)) firstNonHost = index;
    }

    if (firstNonHost !== -1) {
      out.host = rest.substr(0, firstNonHost);
      rest = rest.substr(firstNonHost);
    } else {
      out.host = rest;
      rest = '';
    }

    // pull out port.
    var p = parseHost(out.host);
    var keys = objectKeys(p);
    for (var i = 0, l = keys.length; i < l; i++) {
      var key = keys[i];
      out[key] = p[key];
    }

    // we've indicated that there is a hostname,
    // so even if it's empty, it has to be present.
    out.hostname = out.hostname || '';

    // validate a little.
    if (out.hostname.length > hostnameMaxLen) {
      out.hostname = '';
    } else {
      var hostparts = out.hostname.split(/\./);
      for (var i = 0, l = hostparts.length; i < l; i++) {
        var part = hostparts[i];
        if (!part) continue;
        if (!part.match(hostnamePartPattern)) {
          var newpart = '';
          for (var j = 0, k = part.length; j < k; j++) {
            if (part.charCodeAt(j) > 127) {
              // we replace non-ASCII char with a temporary placeholder
              // we need this to make sure size of hostname is not
              // broken by replacing non-ASCII by nothing
              newpart += 'x';
            } else {
              newpart += part[j];
            }
          }
          // we test again with ASCII char only
          if (!newpart.match(hostnamePartPattern)) {
            var validParts = hostparts.slice(0, i);
            var notHost = hostparts.slice(i + 1);
            var bit = part.match(hostnamePartStart);
            if (bit) {
              validParts.push(bit[1]);
              notHost.unshift(bit[2]);
            }
            if (notHost.length) {
              rest = '/' + notHost.join('.') + rest;
            }
            out.hostname = validParts.join('.');
            break;
          }
        }
      }
    }

    // hostnames are always lower case.
    out.hostname = out.hostname.toLowerCase();

    // IDNA Support: Returns a puny coded representation of "domain".
    // It only converts the part of the domain name that
    // has non ASCII characters. I.e. it dosent matter if
    // you call it with a domain that already is in ASCII.
    var domainArray = out.hostname.split('.');
    var newOut = [];
    for (var i = 0; i < domainArray.length; ++i) {
      var s = domainArray[i];
      newOut.push(s.match(/[^A-Za-z0-9_-]/) ?
          'xn--' + punycode.encode(s) : s);
    }
    out.hostname = newOut.join('.');

    out.host = (out.hostname || '') +
        ((out.port) ? ':' + out.port : '');
    out.href += out.host;
  }

  // now rest is set to the post-host stuff.
  // chop off any delim chars.
  if (!unsafeProtocol[lowerProto]) {

    // First, make 100% sure that any "autoEscape" chars get
    // escaped, even if encodeURIComponent doesn't think they
    // need to be.
    for (var i = 0, l = autoEscape.length; i < l; i++) {
      var ae = autoEscape[i];
      var esc = encodeURIComponent(ae);
      if (esc === ae) {
        esc = escape(ae);
      }
      rest = rest.split(ae).join(esc);
    }

    // Now make sure that delims never appear in a url.
    var chop = rest.length;
    for (var i = 0, l = delims.length; i < l; i++) {
      var c = arrayIndexOf(rest, delims[i]);
      if (c !== -1) {
        chop = Math.min(c, chop);
      }
    }
    rest = rest.substr(0, chop);
  }


  // chop off from the tail first.
  var hash = arrayIndexOf(rest, '#');
  if (hash !== -1) {
    // got a fragment string.
    out.hash = rest.substr(hash);
    rest = rest.slice(0, hash);
  }
  var qm = arrayIndexOf(rest, '?');
  if (qm !== -1) {
    out.search = rest.substr(qm);
    out.query = rest.substr(qm + 1);
    if (parseQueryString) {
      out.query = querystring.parse(out.query);
    }
    rest = rest.slice(0, qm);
  } else if (parseQueryString) {
    // no query string, but parseQueryString still requested
    out.search = '';
    out.query = {};
  }
  if (rest) out.pathname = rest;
  if (slashedProtocol[proto] &&
      out.hostname && !out.pathname) {
    out.pathname = '/';
  }

  //to support http.request
  if (out.pathname || out.search) {
    out.path = (out.pathname ? out.pathname : '') +
               (out.search ? out.search : '');
  }

  // finally, reconstruct the href based on what has been validated.
  out.href = urlFormat(out);
  return out;
}

// format a parsed object into a url string
function urlFormat(obj) {
  // ensure it's an object, and not a string url.
  // If it's an obj, this is a no-op.
  // this way, you can call url_format() on strings
  // to clean up potentially wonky urls.
  if (typeof(obj) === 'string') obj = urlParse(obj);

  var auth = obj.auth || '';
  if (auth) {
    auth = auth.split('@').join('%40');
    for (var i = 0, l = nonAuthChars.length; i < l; i++) {
      var nAC = nonAuthChars[i];
      auth = auth.split(nAC).join(encodeURIComponent(nAC));
    }
    auth += '@';
  }

  var protocol = obj.protocol || '',
      host = (obj.host !== undefined) ? auth + obj.host :
          obj.hostname !== undefined ? (
              auth + obj.hostname +
              (obj.port ? ':' + obj.port : '')
          ) :
          false,
      pathname = obj.pathname || '',
      query = obj.query &&
              ((typeof obj.query === 'object' &&
                objectKeys(obj.query).length) ?
                 querystring.stringify(obj.query) :
                 '') || '',
      search = obj.search || (query && ('?' + query)) || '',
      hash = obj.hash || '';

  if (protocol && protocol.substr(-1) !== ':') protocol += ':';

  // only the slashedProtocols get the //.  Not mailto:, xmpp:, etc.
  // unless they had them to begin with.
  if (obj.slashes ||
      (!protocol || slashedProtocol[protocol]) && host !== false) {
    host = '//' + (host || '');
    if (pathname && pathname.charAt(0) !== '/') pathname = '/' + pathname;
  } else if (!host) {
    host = '';
  }

  if (hash && hash.charAt(0) !== '#') hash = '#' + hash;
  if (search && search.charAt(0) !== '?') search = '?' + search;

  return protocol + host + pathname + search + hash;
}

function urlResolve(source, relative) {
  return urlFormat(urlResolveObject(source, relative));
}

function urlResolveObject(source, relative) {
  if (!source) return relative;

  source = urlParse(urlFormat(source), false, true);
  relative = urlParse(urlFormat(relative), false, true);

  // hash is always overridden, no matter what.
  source.hash = relative.hash;

  if (relative.href === '') {
    source.href = urlFormat(source);
    return source;
  }

  // hrefs like //foo/bar always cut to the protocol.
  if (relative.slashes && !relative.protocol) {
    relative.protocol = source.protocol;
    //urlParse appends trailing / to urls like http://www.example.com
    if (slashedProtocol[relative.protocol] &&
        relative.hostname && !relative.pathname) {
      relative.path = relative.pathname = '/';
    }
    relative.href = urlFormat(relative);
    return relative;
  }

  if (relative.protocol && relative.protocol !== source.protocol) {
    // if it's a known url protocol, then changing
    // the protocol does weird things
    // first, if it's not file:, then we MUST have a host,
    // and if there was a path
    // to begin with, then we MUST have a path.
    // if it is file:, then the host is dropped,
    // because that's known to be hostless.
    // anything else is assumed to be absolute.
    if (!slashedProtocol[relative.protocol]) {
      relative.href = urlFormat(relative);
      return relative;
    }
    source.protocol = relative.protocol;
    if (!relative.host && !hostlessProtocol[relative.protocol]) {
      var relPath = (relative.pathname || '').split('/');
      while (relPath.length && !(relative.host = relPath.shift()));
      if (!relative.host) relative.host = '';
      if (!relative.hostname) relative.hostname = '';
      if (relPath[0] !== '') relPath.unshift('');
      if (relPath.length < 2) relPath.unshift('');
      relative.pathname = relPath.join('/');
    }
    source.pathname = relative.pathname;
    source.search = relative.search;
    source.query = relative.query;
    source.host = relative.host || '';
    source.auth = relative.auth;
    source.hostname = relative.hostname || relative.host;
    source.port = relative.port;
    //to support http.request
    if (source.pathname !== undefined || source.search !== undefined) {
      source.path = (source.pathname ? source.pathname : '') +
                    (source.search ? source.search : '');
    }
    source.slashes = source.slashes || relative.slashes;
    source.href = urlFormat(source);
    return source;
  }

  var isSourceAbs = (source.pathname && source.pathname.charAt(0) === '/'),
      isRelAbs = (
          relative.host !== undefined ||
          relative.pathname && relative.pathname.charAt(0) === '/'
      ),
      mustEndAbs = (isRelAbs || isSourceAbs ||
                    (source.host && relative.pathname)),
      removeAllDots = mustEndAbs,
      srcPath = source.pathname && source.pathname.split('/') || [],
      relPath = relative.pathname && relative.pathname.split('/') || [],
      psychotic = source.protocol &&
          !slashedProtocol[source.protocol];

  // if the url is a non-slashed url, then relative
  // links like ../.. should be able
  // to crawl up to the hostname, as well.  This is strange.
  // source.protocol has already been set by now.
  // Later on, put the first path part into the host field.
  if (psychotic) {

    delete source.hostname;
    delete source.port;
    if (source.host) {
      if (srcPath[0] === '') srcPath[0] = source.host;
      else srcPath.unshift(source.host);
    }
    delete source.host;
    if (relative.protocol) {
      delete relative.hostname;
      delete relative.port;
      if (relative.host) {
        if (relPath[0] === '') relPath[0] = relative.host;
        else relPath.unshift(relative.host);
      }
      delete relative.host;
    }
    mustEndAbs = mustEndAbs && (relPath[0] === '' || srcPath[0] === '');
  }

  if (isRelAbs) {
    // it's absolute.
    source.host = (relative.host || relative.host === '') ?
                      relative.host : source.host;
    source.hostname = (relative.hostname || relative.hostname === '') ?
                      relative.hostname : source.hostname;
    source.search = relative.search;
    source.query = relative.query;
    srcPath = relPath;
    // fall through to the dot-handling below.
  } else if (relPath.length) {
    // it's relative
    // throw away the existing file, and take the new path instead.
    if (!srcPath) srcPath = [];
    srcPath.pop();
    srcPath = srcPath.concat(relPath);
    source.search = relative.search;
    source.query = relative.query;
  } else if ('search' in relative) {
    // just pull out the search.
    // like href='?foo'.
    // Put this after the other two cases because it simplifies the booleans
    if (psychotic) {
      source.hostname = source.host = srcPath.shift();
      //occationaly the auth can get stuck only in host
      //this especialy happens in cases like
      //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
      var authInHost = source.host && arrayIndexOf(source.host, '@') > 0 ?
                       source.host.split('@') : false;
      if (authInHost) {
        source.auth = authInHost.shift();
        source.host = source.hostname = authInHost.shift();
      }
    }
    source.search = relative.search;
    source.query = relative.query;
    //to support http.request
    if (source.pathname !== undefined || source.search !== undefined) {
      source.path = (source.pathname ? source.pathname : '') +
                    (source.search ? source.search : '');
    }
    source.href = urlFormat(source);
    return source;
  }
  if (!srcPath.length) {
    // no path at all.  easy.
    // we've already handled the other stuff above.
    delete source.pathname;
    //to support http.request
    if (!source.search) {
      source.path = '/' + source.search;
    } else {
      delete source.path;
    }
    source.href = urlFormat(source);
    return source;
  }
  // if a url ENDs in . or .., then it must get a trailing slash.
  // however, if it ends in anything else non-slashy,
  // then it must NOT get a trailing slash.
  var last = srcPath.slice(-1)[0];
  var hasTrailingSlash = (
      (source.host || relative.host) && (last === '.' || last === '..') ||
      last === '');

  // strip single dots, resolve double dots to parent dir
  // if the path tries to go above the root, `up` ends up > 0
  var up = 0;
  for (var i = srcPath.length; i >= 0; i--) {
    last = srcPath[i];
    if (last == '.') {
      srcPath.splice(i, 1);
    } else if (last === '..') {
      srcPath.splice(i, 1);
      up++;
    } else if (up) {
      srcPath.splice(i, 1);
      up--;
    }
  }

  // if the path is allowed to go above the root, restore leading ..s
  if (!mustEndAbs && !removeAllDots) {
    for (; up--; up) {
      srcPath.unshift('..');
    }
  }

  if (mustEndAbs && srcPath[0] !== '' &&
      (!srcPath[0] || srcPath[0].charAt(0) !== '/')) {
    srcPath.unshift('');
  }

  if (hasTrailingSlash && (srcPath.join('/').substr(-1) !== '/')) {
    srcPath.push('');
  }

  var isAbsolute = srcPath[0] === '' ||
      (srcPath[0] && srcPath[0].charAt(0) === '/');

  // put the host back
  if (psychotic) {
    source.hostname = source.host = isAbsolute ? '' :
                                    srcPath.length ? srcPath.shift() : '';
    //occationaly the auth can get stuck only in host
    //this especialy happens in cases like
    //url.resolveObject('mailto:local1@domain1', 'local2@domain2')
    var authInHost = source.host && arrayIndexOf(source.host, '@') > 0 ?
                     source.host.split('@') : false;
    if (authInHost) {
      source.auth = authInHost.shift();
      source.host = source.hostname = authInHost.shift();
    }
  }

  mustEndAbs = mustEndAbs || (source.host && srcPath.length);

  if (mustEndAbs && !isAbsolute) {
    srcPath.unshift('');
  }

  source.pathname = srcPath.join('/');
  //to support request.http
  if (source.pathname !== undefined || source.search !== undefined) {
    source.path = (source.pathname ? source.pathname : '') +
                  (source.search ? source.search : '');
  }
  source.auth = relative.auth || source.auth;
  source.slashes = source.slashes || relative.slashes;
  source.href = urlFormat(source);
  return source;
}

function parseHost(host) {
  var out = {};
  var port = portPattern.exec(host);
  if (port) {
    port = port[0];
    out.port = port.substr(1);
    host = host.substr(0, host.length - port.length);
  }
  if (host) out.hostname = host;
  return out;
}

},{"querystring":9}],11:[function(require,module,exports){
var events = require('events');

exports.isArray = isArray;
exports.isDate = function(obj){return Object.prototype.toString.call(obj) === '[object Date]'};
exports.isRegExp = function(obj){return Object.prototype.toString.call(obj) === '[object RegExp]'};


exports.print = function () {};
exports.puts = function () {};
exports.debug = function() {};

exports.inspect = function(obj, showHidden, depth, colors) {
  var seen = [];

  var stylize = function(str, styleType) {
    // http://en.wikipedia.org/wiki/ANSI_escape_code#graphics
    var styles =
        { 'bold' : [1, 22],
          'italic' : [3, 23],
          'underline' : [4, 24],
          'inverse' : [7, 27],
          'white' : [37, 39],
          'grey' : [90, 39],
          'black' : [30, 39],
          'blue' : [34, 39],
          'cyan' : [36, 39],
          'green' : [32, 39],
          'magenta' : [35, 39],
          'red' : [31, 39],
          'yellow' : [33, 39] };

    var style =
        { 'special': 'cyan',
          'number': 'blue',
          'boolean': 'yellow',
          'undefined': 'grey',
          'null': 'bold',
          'string': 'green',
          'date': 'magenta',
          // "name": intentionally not styling
          'regexp': 'red' }[styleType];

    if (style) {
      return '\u001b[' + styles[style][0] + 'm' + str +
             '\u001b[' + styles[style][1] + 'm';
    } else {
      return str;
    }
  };
  if (! colors) {
    stylize = function(str, styleType) { return str; };
  }

  function format(value, recurseTimes) {
    // Provide a hook for user-specified inspect functions.
    // Check that value is an object with an inspect function on it
    if (value && typeof value.inspect === 'function' &&
        // Filter out the util module, it's inspect function is special
        value !== exports &&
        // Also filter out any prototype objects using the circular check.
        !(value.constructor && value.constructor.prototype === value)) {
      return value.inspect(recurseTimes);
    }

    // Primitive types cannot have properties
    switch (typeof value) {
      case 'undefined':
        return stylize('undefined', 'undefined');

      case 'string':
        var simple = '\'' + JSON.stringify(value).replace(/^"|"$/g, '')
                                                 .replace(/'/g, "\\'")
                                                 .replace(/\\"/g, '"') + '\'';
        return stylize(simple, 'string');

      case 'number':
        return stylize('' + value, 'number');

      case 'boolean':
        return stylize('' + value, 'boolean');
    }
    // For some reason typeof null is "object", so special case here.
    if (value === null) {
      return stylize('null', 'null');
    }

    // Look up the keys of the object.
    var visible_keys = Object_keys(value);
    var keys = showHidden ? Object_getOwnPropertyNames(value) : visible_keys;

    // Functions without properties can be shortcutted.
    if (typeof value === 'function' && keys.length === 0) {
      if (isRegExp(value)) {
        return stylize('' + value, 'regexp');
      } else {
        var name = value.name ? ': ' + value.name : '';
        return stylize('[Function' + name + ']', 'special');
      }
    }

    // Dates without properties can be shortcutted
    if (isDate(value) && keys.length === 0) {
      return stylize(value.toUTCString(), 'date');
    }

    var base, type, braces;
    // Determine the object type
    if (isArray(value)) {
      type = 'Array';
      braces = ['[', ']'];
    } else {
      type = 'Object';
      braces = ['{', '}'];
    }

    // Make functions say that they are functions
    if (typeof value === 'function') {
      var n = value.name ? ': ' + value.name : '';
      base = (isRegExp(value)) ? ' ' + value : ' [Function' + n + ']';
    } else {
      base = '';
    }

    // Make dates with properties first say the date
    if (isDate(value)) {
      base = ' ' + value.toUTCString();
    }

    if (keys.length === 0) {
      return braces[0] + base + braces[1];
    }

    if (recurseTimes < 0) {
      if (isRegExp(value)) {
        return stylize('' + value, 'regexp');
      } else {
        return stylize('[Object]', 'special');
      }
    }

    seen.push(value);

    var output = keys.map(function(key) {
      var name, str;
      if (value.__lookupGetter__) {
        if (value.__lookupGetter__(key)) {
          if (value.__lookupSetter__(key)) {
            str = stylize('[Getter/Setter]', 'special');
          } else {
            str = stylize('[Getter]', 'special');
          }
        } else {
          if (value.__lookupSetter__(key)) {
            str = stylize('[Setter]', 'special');
          }
        }
      }
      if (visible_keys.indexOf(key) < 0) {
        name = '[' + key + ']';
      }
      if (!str) {
        if (seen.indexOf(value[key]) < 0) {
          if (recurseTimes === null) {
            str = format(value[key]);
          } else {
            str = format(value[key], recurseTimes - 1);
          }
          if (str.indexOf('\n') > -1) {
            if (isArray(value)) {
              str = str.split('\n').map(function(line) {
                return '  ' + line;
              }).join('\n').substr(2);
            } else {
              str = '\n' + str.split('\n').map(function(line) {
                return '   ' + line;
              }).join('\n');
            }
          }
        } else {
          str = stylize('[Circular]', 'special');
        }
      }
      if (typeof name === 'undefined') {
        if (type === 'Array' && key.match(/^\d+$/)) {
          return str;
        }
        name = JSON.stringify('' + key);
        if (name.match(/^"([a-zA-Z_][a-zA-Z_0-9]*)"$/)) {
          name = name.substr(1, name.length - 2);
          name = stylize(name, 'name');
        } else {
          name = name.replace(/'/g, "\\'")
                     .replace(/\\"/g, '"')
                     .replace(/(^"|"$)/g, "'");
          name = stylize(name, 'string');
        }
      }

      return name + ': ' + str;
    });

    seen.pop();

    var numLinesEst = 0;
    var length = output.reduce(function(prev, cur) {
      numLinesEst++;
      if (cur.indexOf('\n') >= 0) numLinesEst++;
      return prev + cur.length + 1;
    }, 0);

    if (length > 50) {
      output = braces[0] +
               (base === '' ? '' : base + '\n ') +
               ' ' +
               output.join(',\n  ') +
               ' ' +
               braces[1];

    } else {
      output = braces[0] + base + ' ' + output.join(', ') + ' ' + braces[1];
    }

    return output;
  }
  return format(obj, (typeof depth === 'undefined' ? 2 : depth));
};


function isArray(ar) {
  return Array.isArray(ar) ||
         (typeof ar === 'object' && Object.prototype.toString.call(ar) === '[object Array]');
}


function isRegExp(re) {
  typeof re === 'object' && Object.prototype.toString.call(re) === '[object RegExp]';
}


function isDate(d) {
  return typeof d === 'object' && Object.prototype.toString.call(d) === '[object Date]';
}

function pad(n) {
  return n < 10 ? '0' + n.toString(10) : n.toString(10);
}

var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep',
              'Oct', 'Nov', 'Dec'];

// 26 Feb 16:19:34
function timestamp() {
  var d = new Date();
  var time = [pad(d.getHours()),
              pad(d.getMinutes()),
              pad(d.getSeconds())].join(':');
  return [d.getDate(), months[d.getMonth()], time].join(' ');
}

exports.log = function (msg) {};

exports.pump = null;

var Object_keys = Object.keys || function (obj) {
    var res = [];
    for (var key in obj) res.push(key);
    return res;
};

var Object_getOwnPropertyNames = Object.getOwnPropertyNames || function (obj) {
    var res = [];
    for (var key in obj) {
        if (Object.hasOwnProperty.call(obj, key)) res.push(key);
    }
    return res;
};

var Object_create = Object.create || function (prototype, properties) {
    // from es5-shim
    var object;
    if (prototype === null) {
        object = { '__proto__' : null };
    }
    else {
        if (typeof prototype !== 'object') {
            throw new TypeError(
                'typeof prototype[' + (typeof prototype) + '] != \'object\''
            );
        }
        var Type = function () {};
        Type.prototype = prototype;
        object = new Type();
        object.__proto__ = prototype;
    }
    if (typeof properties !== 'undefined' && Object.defineProperties) {
        Object.defineProperties(object, properties);
    }
    return object;
};

exports.inherits = function(ctor, superCtor) {
  ctor.super_ = superCtor;
  ctor.prototype = Object_create(superCtor.prototype, {
    constructor: {
      value: ctor,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
};

var formatRegExp = /%[sdj%]/g;
exports.format = function(f) {
  if (typeof f !== 'string') {
    var objects = [];
    for (var i = 0; i < arguments.length; i++) {
      objects.push(exports.inspect(arguments[i]));
    }
    return objects.join(' ');
  }

  var i = 1;
  var args = arguments;
  var len = args.length;
  var str = String(f).replace(formatRegExp, function(x) {
    if (x === '%%') return '%';
    if (i >= len) return x;
    switch (x) {
      case '%s': return String(args[i++]);
      case '%d': return Number(args[i++]);
      case '%j': return JSON.stringify(args[i++]);
      default:
        return x;
    }
  });
  for(var x = args[i]; i < len; x = args[++i]){
    if (x === null || typeof x !== 'object') {
      str += ' ' + x;
    } else {
      str += ' ' + exports.inspect(x);
    }
  }
  return str;
};

},{"events":8}],12:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            if (ev.source === window && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

},{}]},{},[1])
;