#!/usr/bin/env node

const { argv } = require('optimist')
  .usage('Usage: $0 ' +
         '--targetHost [host] --targetPort [port] --relayHost [host] --relayPort [port] ' +
         '[--targetTls] [--targetVerifyCert] [--relayTls] [--relayVerifyCert] ' +
         '[--relaySecret [key]] [--relayNumConn [count]] [--silent]')
  .demand(['targetHost', 'targetPort', 'relayHost', 'relayPort'])
  .default('targetTls', false)
  .default('targetVerifyCert', true)
  .default('relayTls', true)
  .default('relayVerifyCert', true)
  .default('relaySecret', null)
  .default('relayNumConn', 1)
  .default('silent', false);

const options = {
  targetTls: argv.targetTls,
  targetVerifyCert: argv.targetVerifyCert,
  relayTls: argv.relayTls,
  relayVerifyCert: argv.relayVerifyCert,
  relaySecret: argv.relaySecret,
  relayNumConn: argv.relayNumConn,
  silent: argv.silent,
};

if (!options.silent) {
  console.log('Starting NAT traversal client.');

  let targetConnectionType;
  if (options.targetTls) {
    if (options.targetVerifyCert) {
      targetConnectionType = 'TLS with cert verification';
    } else {
      targetConnectionType = 'TLS without cert verification';
    }
  } else {
    targetConnectionType = 'TCP';
  }

  let relayConnectionType;
  if (options.relayTls) {
    if (options.relayVerifyCert) {
      relayConnectionType = 'TLS with cert verification';
    } else {
      relayConnectionType = 'TLS without cert verification';
    }
  } else {
    relayConnectionType = 'TCP';
  }

  console.log(`Target endpoint is ${argv.targetHost}:${argv.targetPort}, connection will be ${targetConnectionType}.`);
  console.log(`Relay endpoint is ${argv.relayHost}:${argv.relayPort}, connection will be ${relayConnectionType}.`);
  console.log(`Relay connection ${options.relaySecret ? 'WILL' : 'WILL NOT'} use secret.`);
  console.log(`Relay will have ${options.relayNumConn} connections available.`);
}

const { NATTraversalClient } = require('./index.js');

const natTraversalClient = new NATTraversalClient(
  argv.targetHost,
  argv.targetPort,
  argv.relayHost,
  argv.relayPort,
  options,
);
natTraversalClient.start();

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception: ', err);
});

process.on('SIGINT', () => {
  if (!options.silent) {
    console.log('Terminating.');
  }
  natTraversalClient.terminate();
});
