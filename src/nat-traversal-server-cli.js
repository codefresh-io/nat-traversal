#!/usr/bin/env node

const { argv } = require('optimist')
  .usage('Usage: $0 --relayPort [port] --servicePort [port]'
         + ' [--host [IP]] [--secret [key]] [--tls] [--pfx [file]]'
         + ' [--passphrase [passphrase]] [--key [file]] [--cert [file]] [--verbose]')
  .demand(['relayPort', 'servicePort'])
  .string('secret')
  .default('tls', false)
  .string('pfx')
  .string('passphrase')
  .default('verbose', false);

const options = {
  host: argv.host,
  secret: argv.secret,
  tls: argv.tls,
  pfx: argv.pfx,
  passphrase: argv.passphrase,
  key: argv.key,
  cert: argv.cert,
  verbose: argv.verbose,
};

if (options.verbose) {
  console.log(`Starting NAT traversal server on relayPort ${argv.relayPort} and servicePort ${argv.servicePort}...`);
  console.log('Options:');
  console.log(JSON.stringify(options, null, 2));
}

const { NATTraversalServer } = require('./index.js');

const natTraversalServer = new NATTraversalServer(
  argv.relayPort,
  argv.servicePort,
  options,
);
natTraversalServer.start();

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception: ', err);
});

process.on('SIGINT', () => {
  if (options.verbose) {
    console.log('Terminating.');
  }
  natTraversalServer.terminate();
});
