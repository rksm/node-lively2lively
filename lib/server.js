// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// TODO: Unfinished!
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

var http         = require('http'),
    util         = require('util'),
    EventEmitter = require('events').EventEmitter,
    websocket    = require("websocket"),
    port         = 3009;

function createServer() {
    return http.createServer().listen(port);
}

function WebSocketListener(options) {
    options = options || {
        autoAcceptConnections: false, // origin check
        // FIXME better use Infinity
        maxReceivedFrameSize: NaN, // default: 0x10000 64KiB // we don't want to care for now...
        maxReceivedMessageSize: NaN // default: 0x100000 1MiB
    }
    var init = this.init.bind(this, options);
    var server = createServer();
    init(server);
    this.requestHandler = {};
}

util.inherits(WebSocketListener, websocket.server);

(function() {
    
    this.init = function(options, server) {
        options = options || {};
        if (this._started) this.shutDown();
        var existingListener = server.websocketHandler;
        if (existingListener) { server.removeAllListeners('upgrade'); }
        options.httpServer = server;
        websocket.server.call(this, options); // super call
        server.on('close', this.shutDown.bind(this));
        this.on('request', this.dispatchRequest.bind(this));
        this._started = true;
    }

    this.registerSubhandler = function(options) {
      this.requestHandler[options.path] = options.handler;
    }

    this.unregisterSubhandler = function(options) {
      if (options.path) {
        delete this.requestHandler[options.path];
      }
    }

    this.originIsAllowed = function(origin) { return true }
    
    this.findHandler = function(request) {
        var path = request.resourceURL.path,
            handler = this.requestHandler[path];
        if (handler) return handler;
        request.reject();
        console.warn('Got websocket request to %s but found no handler for responding\n%s', path, i(request, null, 0));
        return null;
    }

    this.shutDown = function(request) {
        log(this.debugLevel, 'Stopping websocket listener');
        Object.keys(this.requestHandler).forEach(function(path) {
            this.unregisterSubhandler(path); }, this);
        websocket.server.prototype.shutDown.call(this);
    }

    this.dispatchRequest = function(request) {
        if (!this.originIsAllowed(request.origin)) {
            request.reject();
            log(this.debugLevel, 'Connection from origin %s rejected.', request.origin);
            return;
        }
        var handler = this.findHandler(request);
        try {
            handler && handler(request);
        } catch(e) {
            console.warn('Error handling websocket request: %s', e);
        }
    }

}).call(WebSocketListener.prototype);

WebSocketListener.forLively = function() {
    return this._instance = this._instance ?
        this._instance : new WebSocketListener();
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

function WebSocketServer(options) {
    options = options || {};
    EventEmitter.call(this);
    this.sender = options.sender || null;
    this.connections = [];
    this.debugLevel = options.debugLevel !== undefined ?  options.debugLevel : 1;
    this.route = '';
    this.subserver = null;
    this.requiresSender = false;
}

util.inherits(WebSocketServer, EventEmitter);

(function() {

    this.listen = function(options) {
        // options: {route: STRING, subserver: OBJECT, websocketImpl: OBJECT}
        // protocol and the actions automatically extracted from messages send
        // in this protocol
        var webSocketServer = this;
        this.route = options.route;
        this.subserver = options.subserver;
        this.websocketImpl = WebSocketListener.forLively();
        this.websocketImpl.registerSubhandler({
            path: options.route,
            handler: webSocketServer.accept.bind(webSocketServer)
        });
        this.subserver && this.subserver.on('close', function() { webSocketServer.close(); });
        return webSocketServer;
    }

    this.close = function() {
        this.removeConnections();
        if (!this.websocketImpl) return;
        this.websocketImpl.unregisterSubhandler({path: this.route});
    }

    this.accept = function(request) {
        var c = request.accept('lively-json', request.origin), server = this;
        c.request = request;

        c.on('close', function(msg) {
            if (c.id) log(this.debugLevel, 'websocket %s closed', c.id)
            else log(this.debugLevel, 'a websocket connection was closed');
            server.removeConnection(c);
        });

        // a msg object should be valid JSON and follow the format:
        // {sender: ID, action: STRING, data: OBJECT}
        c.on('message', function(msg) {
            var data;
            server.emit('message', data);
            try {
                data = JSON.parse(msg.utf8Data);
            } catch(e) {
                console.warn('%s could not read incoming message %s', server, i(msg));
                return;
            }
            onLivelyJSONMessage(server, c, data);
        });

        c.send = function(msg, callback) { return sendLivelyMessage(server, c, msg, callback); }

        this.addConnection(c, request);

        return c;
    }

    this.removeConnection = function(c) {
        if (!c) return;
        var id = typeof c === 'string' && c;
        if (id) {
            this.getConnections(id).forEach(function(c) { this.removeConnection(c); }, this);
            return;
        }
        c && c.close();
        var idx = this.connections.indexOf(c);
        if (idx === -1) return;
        this.connections.splice(idx, 1);
    }

    this.removeConnections = function() {
        [].concat(this.connections).forEach(function(c) { this.removeConnection(c); }, this);
    }

    this.getConnection = function(id) {
        return this.getConnections(id)[0];
    }

    this.getConnections = function(id) {
        if (!id) return [].concat(this.connections);
        return this.connections.filter(function(c) { return c.id === id; })
    }

    this.addConnection = function(c) {
        if (c.id) {
            var existing = this.getConnections(c.id);
            existing.forEach(function(ea) { this.removeConnection(ea); }, this);
        }
        this.connections.push(c);
        return c;
    }

    this.toString = function() {
        return util.f('WebSocketServer(%s, %s connections)', this.route, this.connections.length);
    }

}).call(WebSocketServer.prototype);
