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
            document.removeEventListener('onbeforeunload', l2l.disconnect); })
    
        session.register();
        session.openForRequests();
        session.whenOnline(function() {
            session.addActions(services);
            thenDo && thenDo(null, session);
        });
    },

    disconnect: function() {
        var s = lv.l2l.session;
        if (s) { s.unregister(); lv.l2l.session = null; }
    }
}

// currently supported:
// baseURL, name, autoload
function optionsFromScript() {
    var scriptName = "lively2lively-browserified.js",
        options = {},
        scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
        var src = scripts[i].src;
        if (src.indexOf(scriptName) === -1) continue;
        var optionsMatch = src.match(/\?(.*)/);
        if (!optionsMatch || !optionsMatch[1]) break;
        optionsMatch[1].split('&').forEach(function(opt) {
            var kv = opt.split('=');
            options[kv[0]] = kv[1] && kv[1] === 'false' ? false : kv[1];
        });
        break;
    }
    return options;
}

(function autoload() {
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
