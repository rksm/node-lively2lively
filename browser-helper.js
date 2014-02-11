
// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
// debug helper -- inspecting

function inspect(obj, options, depth) {
    options = options || {};
    depth = depth || 0;
    if (!obj) { return print(obj); }

    // print function
    if (typeof obj === 'function') {
        function argNames(func) {
            if (func.superclass) return [];
            var names = String(func).match(/^[\s\(]*function[^(]*\(([^)]*)\)/)[1].
                    replace(/\/\/.*?[\r\n]|\/\*(?:.|[\r\n])*?\*\//g, '').
                    replace(/\s+/g, '').split(',');

            return names.length == 1 && !names[0] ? [] : names;
        }
        return options.printFunctionSource ? String(obj) :
            'function' + (obj.name ? ' ' + obj.name : '')
          + '(' + argNames(obj).join(',') + ') {/*...*/}';
    }
    // print "primitive"
    switch (obj.constructor) {
        case String:
        case Boolean:
        case RegExp:
        case Number: return print(obj);
    };

    if (typeof obj.serializeExpr === 'function') {
        return obj.serializeExpr();
    }

    var isArray = obj && Array.isArray(obj),
        openBr = isArray ? '[' : '{', closeBr = isArray ? ']' : '}';
    if (options.maxDepth && depth >= options.maxDepth) return openBr + '/*...*/' + closeBr;

    var printedProps = [];
    if (isArray) {
        printedProps = obj.map(function(ea) { return inspect(ea, options, depth); });
    } else {
        printedProps = Object.keys(obj)
           // .select(function(key) { return obj.hasOwnProperty(key); })
            .sort(function(a, b) {
                var aIsFunc = typeof obj[a] === 'function', bIsFunc = typeof obj[b] === 'function';
                if (aIsFunc === bIsFunc) {
                    if (a < b)  return -1;
                    if (a > b) return 1;
                    return 0;
                };
                return aIsFunc ? 1 : -1;
            })
            .map(function(key, i) {
                if (isArray) inspect(obj[key], options, depth + 1);
                var printedVal = inspect(obj[key], options, depth + 1);
                return format('%s: %s',
                    options.escapeKeys ? print(key) : key, printedVal);
            });
    }

    if (printedProps.length === 0) { return openBr + closeBr; }

    var printedPropsJoined = printedProps.join(','),
        useNewLines = !isArray
                   && (!options.minLengthForNewLine
                    || printedPropsJoined.length >= options.minLengthForNewLine),
        indent = indent('', options.indent || '  ', depth),
        propIndent = indent('', options.indent || '  ', depth + 1),
        startBreak = useNewLines ? '\n' + propIndent: '',
        endBreak = useNewLines ? '\n' + indent : '';
    if (useNewLines) printedPropsJoined = printedProps.join(',' + startBreak);
    return openBr + startBreak + printedPropsJoined + endBreak + closeBr;
}

function print(obj) {
    if (obj && Array.isArray(obj)) {
        return '[' + obj.map(function(ea) { return print(ea); }) + ']';
    }
    if (typeof obj !== "string") {
        return String(obj);
    }
    var result = String(obj);
    result = result.replace(/\n/g, '\\n\\\n');
    result = result.replace(/(")/g, '\\$1');
    result = '\"' + result + '\"';
    return result;
}

function format() {
    var objects = makeArray(arguments);
    var format = objects.shift();
    if (!format) { console.log("Error in Strings>>formatFromArray, first arg is undefined"); };

    function appendText(object, string) {
        return "" + object;
    }

    function appendObject(object, string) {
        return "" + object;
    }

    function appendInteger(value, string) {
        return value.toString();
    }

    function appendFloat(value, string, precision) {
        if (precision > -1) return value.toFixed(precision);
        else return value.toString();
    }

    function appendObject(value, string) { return inspect(value); }

    var appenderMap = {s: appendText, d: appendInteger, i: appendInteger, f: appendFloat, o: appendObject};
    var reg = /((^%|[^\\]%)(\d+)?(\.)([a-zA-Z]))|((^%|[^\\]%)([a-zA-Z]))/;

    function parseFormat(fmt) {
        var oldFmt = fmt;
        var parts = [];

        for (var m = reg.exec(fmt); m; m = reg.exec(fmt)) {
            var type = m[8] || m[5],
                appender = type in appenderMap ? appenderMap[type] : appendObject,
                precision = m[3] ? parseInt(m[3]) : (m[4] == "." ? -1 : 0);
            parts.push(fmt.substr(0, m[0][0] == "%" ? m.index : m.index + 1));
            parts.push({appender: appender, precision: precision});

            fmt = fmt.substr(m.index + m[0].length);
        }
        if (fmt)
            parts.push(fmt.toString());

        return parts;
    };

    var parts = parseFormat(format),
        str = "",
        objIndex = 0;

    for (var i = 0; i < parts.length; ++i) {
        var part = parts[i];
        if (part && typeof(part) == "object") {
            var object = objects[objIndex++];
            str += (part.appender || appendText)(object, str, part.precision);
        } else {
            str += appendText(part, str);
        }
    }
    return str;
}

function makeArray(iterable) {
    if (!iterable) return [];
    if (iterable.toArray) return iterable.toArray();
    var length = iterable.length,
        results = new Array(length);
    while (length--) results[length] = iterable[length];
    return results;
}

function indent(str, indentString, depth) {
    if (!depth || depth <= 0) return str;
    while (depth > 0) { depth--; str = indentString + str; }
    return str;
}

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

module.exports = {
    inspect: inspect
}
