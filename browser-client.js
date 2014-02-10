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
console.log('connecting... %s', url);
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

    this.getSessions = function(cb) {
        // if timeout specified throttle requests so that they happen at most
        // timeout-often
        var to = this.getSessionsCacheInvalidationTimeout;
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
        signal(this, 'established');
        this.startReportingActivities();
        console.log('%s established', this.toString(true));
    }

    this.connectionClosed = function() {
        if (this.sessionId && this.status() === 'connected') { this._status = 'connecting'; this.register(); }
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
        withObjectDo = options.withObjectDo;
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
