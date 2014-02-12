var Connection = require('./lib/browser-client').Connection,
    url        = require("url"),
    services   = require('./lib/default-services'),
    lv         = require('./lib/browser-lively-interface').noConflict('lv');

function connect(options, thenDo) {
    options = options || {};

    var baseURL    = options.baseURL || "http://localhost:9001/",
        connectURL = url.resolve(baseURL, "nodejs/SessionTracker/connect"),
        name       = options.name || "browser-alien",
        session    = lv.l2lSession = new Connection({
            sessionTrackerURL: connectURL,
            username: name,
            getSessionsCacheInvalidationTimeout: 10*1000
        });

    function unregister() { lv.l2lSession = null; session.unregister(); }
    document.addEventListener('onbeforeunload', unregister);
    session.reactTo('closed', function() {
        document.removeEventListener('onbeforeunload', unregister); })

    session.register();
    session.openForRequests();
    session.whenOnline(function() {
        session.addActions(services);
        thenDo(null, session);
    });
}

// -=-=-=-
// exports
// -=-=-=-

module.exports = connect;
