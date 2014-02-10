# node-2-lively

Connect any node.js application to a lively2lively network.

## Installation

```
$ git clone https://github.com/rksm/node-2-lively
$ cd node-2-lively
$ npm install
```

## Examples

### node.js

1. Open a Lively Web world, e.g. http://localhost:9001/blank.html.
2. In that world open a workspace and evaluate the expression `lively.net.SessionTracker.getSession().sessionId`. It should return something like _client-session:1791B0E9-8951-41DD-9D1E-C1645C8BC430_.
3. Start the example with `$ node nodejs2lively.example.js client-session:1791B0E9-8951-41DD-9D1E-C1645C8BC430` (replace the session id).

You should see a prompt in your lively world. When you answer it the output is
send back to your node server.

### Browser

<!--nodemon -w browser-connect.js -x browserify browser-connect.js -s lively2livelyConnect -o examples/lively2lively-browserified.js-->

1. Compile browser-connect.js via browserify: `browserify browser-connect.js -s lively2livelyConnect -o examples/lively2lively-browserified.js`
2. Serve and visit examples/browser-connect.html
