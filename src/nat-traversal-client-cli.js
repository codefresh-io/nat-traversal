#!/usr/bin/env node

const { argv } = require('optimist')
  .usage('Usage: $0 --host [host] --port [port] --relayHost [host]'
         + ' --relayPort [port] [--numConn [count]] [--secret [key]] [--tls]'
         + ' [--rejectUnauthorized] [--verbose]')
  .demand(['host', 'port', 'relayHost', 'relayPort'])
  .default('numConn', 1)
  .default('tls', false)
  .default('rejectUnauthorized', false)
  .default('verbose', false);

const options = {
  numConn: argv.numConn,
  tls: argv.tls,
  secret: argv.secret,
  rejectUnauthorized: argv.rejectUnauthorized,
  verbose: argv.verbose,
};

if (options.verbose) {
  console.log(`Starting NAT traversal client. Target is host ${argv.host} port ${argv.port}, ` +
              `relay host is ${argv.relayHost} and port is ${argv.relayPort}.`);
  console.log('Options:');
  console.log(JSON.stringify(options, null, 2));
}

const { NATTraversalClient } = require('./index.js');

const natTraversalClient = new NATTraversalClient(
  argv.host,
  argv.port,
  argv.relayHost,
  argv.relayPort,
  options,
);
natTraversalClient.start();

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception: ', err);
});

process.on('SIGINT', () => {
  if (options.verbose) {
    console.log('Terminating.');
  }
  natTraversalClient.terminate();
});
