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
