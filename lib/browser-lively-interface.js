
var lv = {
    noConflict: function(globalName) {
        if (globalName) window[globalName] = lv;
        return lv;
    }
}

var helperFns  = require('./browser-helper');
Object.keys(helperFns).forEach(function(k) { lv[k] = helperFns[k]; });

module.exports = lv;