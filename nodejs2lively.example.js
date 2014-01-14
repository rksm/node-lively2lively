// where do we want to send a message to?
var targetSessionId = process.argv[2];
var session = new (require('./index').WebSocketClient)("http://localhost:9001/nodejs/SessionTracker/connect", {
    protocol: 'lively-json',
    sender: "I-am-not-a-Lively",
    debugLevel: 10 // no debug output
});

session.on('connect', function() {
    session.send({
        action: 'askFor',
        data: {query: "I'm an alien. Talk to me!!!"},
        target: targetSessionId
    }, function functionName(answer) {
        console.log('Answer: ', answer);
        session.close();
    });
});

session.connect();
