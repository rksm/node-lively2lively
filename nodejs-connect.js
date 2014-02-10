var Client = require('./nodejs-client').Client,
    url = require("url");

function connect(options, thenDo) {
    var baseURL = url.parse(options.baseURL || "http://localhost:9001/"),
        connectURL = baseURL.resolve("nodejs/SessionTracker/connect"),
        name = options.name || "I-am-not-a-Lively",
        session = new Client(connectURL, {
            protocol: 'lively-json',
            sender: name,
            debugLevel: 10 // no debug output
        });

    session.on('connect', function() { thenDo(null, session); });
    session.connect();
}

// -=-=-=-
// exports
// -=-=-=-

module.exports = connect;
