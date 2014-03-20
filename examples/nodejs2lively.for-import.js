// This example code is a ready made nodejs l2l connect. Just require this file,
// it will auto connect and register to the supplied l2l server behind baseURL.
// You can then send messages to and from the nodejs process.

// To try it out run:
// node -e "require('./nodejs2lively.for-import')"

var options = {
    baseURL: process.env.L2L_SERVERURL || 'http://lively-web.org:8080',
    name: process.env.L2L_CLIENTNAME || 'l2l-from-nodejs'
};

var services = require("../lib/default-services");
var connectedSession;

require('../nodejs-connect')(options, function(err, session) {
    if (err) { console.error(err); return; }
    console.log("Connected via %s", session);

    connectedSession = session;

    // message dispatch
    session.on('lively-message', function(msg, connection) {
        if (msg.action in services) services[msg.action](msg, session);
        else services.messageNotUnderstood(msg, session);
    });

    // register session so it can receive messages
    session.register();

    process.on('exit', function(code) { // cleanup
        if (session && session.isOpen())  session.unregister();
    });
});

module.exports = {
    get session() { return connectedSession; }
}
