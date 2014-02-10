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
