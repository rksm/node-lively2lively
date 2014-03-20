// This example is the simplest case of connecting to a lively2lively network and
// sending a message to an existing paricipant in it. After sending the message the
// connection is closed again.

// where do we want to send a message to? Either use env var L2LTRACKERID or
// commandline arg
var targetSessionId = process.env.L2LTRACKERID || process.argv[2];
var options = {baseURL: "http://localhost:9001", name: 'test-connection'};

require('../nodejs-connect')(options, function(err, session) {
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
