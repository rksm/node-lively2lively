var Connection = require('./lib/browser-client').Connection,
    url        = require("url"),
    services   = require('./lib/default-services'),
    lv         = require('./lib/browser-lively-interface').noConflict('lv');

var l2l = {
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
            document.removeEventListener('onbeforeunload', l2l.disconnect); });

        session.register();
        session.openForRequests();
        session.whenOnline(function() {
            session.addActions(services);
            if (thenDo) thenDo(null, session);
        });
    },

    disconnect: function() {
        var s = lv.l2l.session;
        if (s) { s.unregister(); lv.l2l.session = null; }
    }
};

// -=-=-=-
// exports
// -=-=-=-

module.exports = lv.l2l = l2l;
