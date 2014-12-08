// updated on 2014-12-07

// helper
function signatureOf(name, func) {
    var source = String(func),
        match = source.match(/function\s*[a-zA-Z0-9_$]*\s*\(([^\)]*)\)/),
        params = (match && match[1]) || '';
    return name + '(' + params + ')';
}

function isClass(obj) {
    if (obj === obj
      || obj === Array
      || obj === Function
      || obj === String
      || obj === Boolean
      || obj === Date
      || obj === RegExp
      || obj === Number) return true;
    return (obj instanceof Function)
        && ((obj.superclass !== undefined)
         || (obj._superclass !== undefined));
}

function pluck(list, prop) { return list.map(function(ea) { return ea[prop]; }); }

function getObjectForCompletion(evalFunc, stringToEval, thenDo) {
    // thenDo = function(err, obj, startLetters)
    var idx = stringToEval.lastIndexOf('.'),
        startLetters = '';
    if (idx >= 0) {
        startLetters = stringToEval.slice(idx+1);
        stringToEval = stringToEval.slice(0,idx);
    } else {
        startLetters = stringToEval;
        stringToEval = 'Global';
    }
    var completions = [];
    try {
        var obj = evalFunc(stringToEval);
    } catch (e) {
        thenDo(e, null, null);
    }
    thenDo(null, obj, startLetters);
}

function propertyExtract(excludes, obj, extractor) {
    // show(''+excludes)
    return Object.getOwnPropertyNames(obj)
        .filter(function(key) { return excludes.indexOf(key) === -1; })
        .map(extractor)
        .filter(function(ea) { return !!ea; })
        .sort(function(a,b) {
            return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
}

function getMethodsOf(excludes, obj) {
    return propertyExtract(excludes, obj, function(key) {

        if ((obj.__lookupGetter__ && obj.__lookupGetter__(key)) || typeof obj[key] !== 'function') return null;
        return {name: key, completion: signatureOf(key, obj[key])}; })
}

function getAttributesOf(excludes, obj) {
    return propertyExtract(excludes, obj, function(key) {
        if ((obj.__lookupGetter__ && !obj.__lookupGetter__(key)) && typeof obj[key] === 'function') return null;
        return {name: key, completion: key}; })
}

function getProtoChain(obj) {
    var protos = [], proto = obj;
    while (obj) { protos.push(obj); obj = obj.__proto__ }
    return protos;
}

function getDescriptorOf(originalObj, proto) {
    function shorten(s, len) {
        if (s.length > len) s = s.slice(0,len) + '...';
        return s.replace(/\n/g, '').replace(/\s+/g, ' ');
    }

    var stringified;
    try { stringified = String(originalObj); } catch (e) { stringified = "{/*...*/}"; }

    if (originalObj === proto) {
        if (typeof originalObj !== 'function') return shorten(stringified, 50);
        var funcString = stringified,
            body = shorten(funcString.slice(funcString.indexOf('{')+1, funcString.lastIndexOf('}')), 50);
        return signatureOf(originalObj.displayName || originalObj.name || 'function', originalObj) + ' {' + body + '}';
    }

    var klass = proto.hasOwnProperty('constructor') && proto.constructor;
    if (!klass) return 'prototype';
    if (typeof klass.type === 'string' && klass.type.length) return shorten(klass.type, 50);
    if (typeof klass.name === 'string' && klass.name.length) return shorten(klass.name, 50);
    return "anonymous class";
}

function getCompletionsOfObj(obj, thenDo) {
    var err, completions;
    try {
        var excludes = [];
        completions = getProtoChain(obj).map(function(proto) {
            var descr = getDescriptorOf(obj, proto),
                methodsAndAttributes = getMethodsOf(excludes, proto)
                    .concat(getAttributesOf(excludes, proto));
            excludes = excludes.concat(pluck(methodsAndAttributes, 'name'));
            return [descr, pluck(methodsAndAttributes, 'completion')];
        });
    } catch (e) { err = e; }
    thenDo(err, completions);
}

function getCompletions(evalFunc, string, thenDo) {
    // thendo = function(err, completions/*ARRAY*/)
    // eval string and for the resulting object find attributes and methods,
    // grouped by its prototype / class chain
    // if string is something like "foo().bar.baz" then treat "baz" as start
    // letters = filter for properties of foo().bar
    // ("foo().bar.baz." for props of the result of the complete string)
    getObjectForCompletion(evalFunc, string, function(err, obj, startLetters) {
        if (err) { thenDo(err); return }
        var excludes = [];
        var completions = getProtoChain(obj).map(function(proto) {
            var descr = getDescriptorOf(obj, proto),
                methodsAndAttributes = getMethodsOf(excludes, proto)
                    .concat(getAttributesOf(excludes, proto));
            excludes = excludes.concat(pluck(methodsAndAttributes, 'name'));
            return [descr, pluck(methodsAndAttributes, 'completion')];
        });
        thenDo(err, completions, startLetters);
    })
}

module.exports = getCompletions;