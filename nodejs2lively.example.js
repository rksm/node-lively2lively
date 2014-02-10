// where do we want to send a message to?
var targetSessionId = process.argv[2];
var options = {baseURL: "http://localhost:9001", name: 'test-connection'};

require('./nodejs-connect')(options, function(err, session) {
    if (err) { console.error(err); return; }
    console.log("Connected via %s", session);
    session.send({
        action: 'askFor',
        data: {query: "I'm an alien. Talk to me!!!"},
        target: targetSessionId
    }, function functionName(answer) {
        console.log('Answer: ', answer);
        session.close();
    });
});