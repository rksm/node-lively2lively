var Connection = require('./browser-client').Connection,
    url = require("url");

function connect(options, thenDo) {
    options = options || {};
    
    var baseURL = options.baseURL || "http://localhost:9001/",
        connectURL = url.resolve(baseURL, "nodejs/SessionTracker/connect"),
        name = options.name || "browser-alien",
        session = new Connection({
            sessionTrackerURL: connectURL,
            username: name,
            getSessionsCacheInvalidationTimeout: 10*1000
        });

    session.register();
    session.openForRequests();
    session.whenOnline(function() { thenDo(null, session); });
}

// -=-=-=-
// exports
// -=-=-=-

module.exports = connect;
