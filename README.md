# nat-traversal [![NPM version](https://img.shields.io/npm/v/nat-traversal.svg?style=flat)](https://www.npmjs.com/package/nat-traversal) [![NPM downloads](https://img.shields.io/npm/dm/nat-traversal.svg?style=flat)](https://npmjs.org/package/nat-traversal)

>  nat-traversal is a Node.js package that contains a relay server and client that can be used to perform NAT traversal, i.e. expose any TCP/IP service running behind a NAT. This includes services that use HTTP and SSH.

Developed in [Codefresh](https://www.codefresh.io).

### Features

* Programmatic and CLI usage
* Supports TLS connections between relay server and client (using pfx or key/cert, optional passphrase)
* Automatically generate self-signed key/cert if none configured, using <a href="https://www.npmjs.com/package/pem">pem</a>
* Supports TLS identity verification
* Supports secret authentication between client and server
* Supports multiple connections
* Keeps connections alive
* Quiet mode (by default) and verbose mode

### Installation

To install from <a href="https://www.npmjs.com/package/nat-traversal">npm</a>
```bash
yarn add nat-traversal
```

## CLI Usage

The relay server is meant to be executed on a server visible on the internet, as follows

```bash
nat-traversal-server --relayPort 10080 --servicePort 10081 [--hostname [IP]] [--secret key] [--tls] [--pfx file] [--passphrase passphrase] [--verbose]
```

`relayPort` is the port where the relay server will listen for incoming connections from the relay client.
`servicePort` is the port where internet clients can connect to the service exposed through the relay.
Optionally, `hostname` specifies the IP address to listen at (bind to). Node.js listens on unspecified IPv6 address `::` by default.

`secret` specifies a shared secret key used to authorize relay clients.
`tls` option enables secure communication with relay client using TLS.
`pfx` option specifies a private key file used to establish TLS.
`passphrase` specifies password used to protect private key.
`verbose` outputs logs as the server is executed.

The relay client is meant to be executed on a machine behind a NAT, as follows

```bash
nat-traversal-client --host HIDDENSERVICE --port 80 --relayHost host --relayPort port [--numConn count] [--secret key] [--tls] [--rejectUnauthorized] [--verbose]
```

`host` is any server visible to the machine behind the NAT.
`port` is the port of the service you want to expose through the relay.

`relayServer` is the host name or IP address of the server visible on the internet executing the relay server.
`relayPort` is the relay server port where the client will connect.
`numConn` is the number of unused connections relay client maintains with the server. As soon as it detects data
activity on a socket, it establishes another connection. Servicing internet clients that don't transfer any data may
lead to denial of service.

`secret` specifies a shared secret key relay client sends to server for the purpose of authorization.
`tls` enables secure TLS communication with the relay server.
`rejectUnauthorized` enables checking for valid server certificate.
`verbose` outputs logs as the client is executed.

## Library Usage

Create and start a NAT traversal server thus:

```javascript
const { NATTraversalServer } = require('nat-traversal');
const natTraversalServer =
    new NATTraversalServer(
        10080,
        10081,
        {
            host: "0.0.0.0",
            tls: true,
            pfx: "/path/to/pfx/file",
            passphrase: "password of pfx file",
            secret: "a secret sent to the server",
            verbose: false
        }
    );
natTraversalServer.start();
```

Terminate NAT traversal server:

```javascript
natTraversalServer.terminate();
```

Create and start a NAT traversal client thus:

```javascript
const { NATTraversalClient } = require('nat-traversal');
const natTraversalClient =
    new NATTraversalClient(
        "hostname",
        80,
        "relayserver",
        10080,
        {
            numConn: 5,
            tls: true,
            secret: "a secret sent to the server",
            verbose: false
        }
    );
natTraversalServer.start();
```

Terminate NAT traversal client:

```javascript
natTraversalClient.terminate();
```

## Author

**Alon Diamant (advance512)**

* [github/advance512](https://github.com/advance512)
* [Homepage](http://www.alondiamant.com)

This package is a heavily refactored (to ES6+ standards) and updated version of <a href="https://github.com/tewarid/node-tcp-relay">node-tcp-relay</a> by <a href="https://github.com/tewarid">tewarid</a> (Devendra Tewari).

## Alternatives

* node-tcp-relay
* ssh -R
* VPN
