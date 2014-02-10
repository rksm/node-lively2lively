module.exports = {

    reportServices: function(msg, session) {
        session.answer(msg, {services: Object.keys(session.getActions())});
    },

    remoteEvalRequest: function(msg, session) {
        var result;
        if (false && !Config.get('lively2livelyAllowRemoteEval')) {
            result = 'remote eval disabled';
        } else {
            try {
                result = eval(msg.data.expr);
            } catch(e) {
                result = e + '\n' + e.stack;
            }
        }
        session.answer(msg, {result: String(result)});
    },

    messageNotUnderstood: function(msg, session) {
        console.error('Lively2Lively message not understood:\n%o', msg);
        session.answer(msg, {error: 'messageNotUnderstood'});
    }

}