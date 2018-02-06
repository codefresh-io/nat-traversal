# nat-traversal [![NPM version](https://img.shields.io/npm/v/nat-traversal.svg?style=flat)](https://www.npmjs.com/package/nat-traversal) [![NPM downloads](https://img.shields.io/npm/dm/nat-traversal.svg?style=flat)](https://npmjs.org/package/nat-traversal)

>  nat-traversal is a Node.js package that contains a relay server and client that can be used to perform NAT traversal, i.e. expose any TCP/IP service running behind a NAT. This includes services that use HTTP and SSH.

Developed in [Codefresh](https://www.codefresh.io).

### Features

* Programmatic and CLI usage
* Supports TLS connections between relay server and client (using pfx or key/cert, optional passphrase)
* Automatically generate self-signed key/cert if none configured, using <a href="https://www.npmjs.com/package/pem">pem</a>
* Supports TLS connections from client apps (connection initiators) to relay server
* Supports TLS connections from relay client to target server (connection receiver)
* Supports TLS identity verification
* Supports shared-secret authentication between client and server
* Supports multiple connections
* Keeps connections alive
* Verbose mode (by default) and silent mode

### Installation

To install from <a href="https://www.npmjs.com/package/nat-traversal">npm</a>
```bash
yarn add nat-traversal
```

## CLI Usage

The relay server is meant to be executed on a server visible on the internet, as follows

```bash
nat-traversal-server [--publicHost [IP]] --publicPort 10081 [--relayHost [IP]] --relayPort 10080 [--relaySecret key] [--relayTls] [--relayPfx file] [--relayKey file] [--relayCert file] [--relayPassphrase passphrase] [--publicTls] [--publicPfx file] [--publicKey file] [--publicCert file] [--publicPassphrase passphrase]  [--silent]
```

`relayHost` specifies the IP address to listen at (bind to). Node.js listens on unspecified IPv6 address `::` by default.
`relayPort` is the port where the relay server will listen for incoming connections from the relay client.
`publicHost` specifies the IP address to listen at (bind to). Node.js listens on unspecified IPv6 address `::` by default.
`publicPort` is the port where internet clients can connect to the service exposed through the relay.

`relaySecret` specifies a shared secret key used to authorize relay clients.

`relayTls` option enables secure communication with relay client using TLS.
`relayCertCN` option sets the Common Name for the server if auto-generating TLS certificates, for the verifyCerts option on the client. This should probably be the relay endpoint hostname.
`relayPfx` option specifies a PFX file used to establish TLS on the relay endpoint
`relayKey` option specifies a private key file used to establish TLS on the relay endpoint
`relayCert` option specifies a certificate key file used to establish TLS on the relay endpoint
`relayPassphrase` specifies password used to protect pfx/key/cert on the relay endpoint

`publicTls` option enables secure communication with public client using TLS.
`publicCertCN` option sets the Common Name for the server if auto-generating TLS certificates, for the verifyCerts option on the client. This should probably be the public endpoint hostname.
`publicPfx` option specifies a PFX file used to establish TLS on the public endpoint
`publicKey` option specifies a private key file used to establish TLS on the public endpoint
`publicCert` option specifies a certificate key file used to establish TLS on the public endpoint
`publicPassphrase` specifies password used to protect pfx/key/cert on the public endpoint

`silent` silence outputted logs as the server is executed.

The relay client is meant to be executed on a machine behind a NAT, as follows

```bash
nat-traversal-client --targetHost TARGETHOST --targetPort 80 --relayHost RELAYHOST --relayPort 10080 [--relayNumConn count] [--relaySecret key] [--relayTls] [--relayVerifyCert] [--publicTls] [--publicVerifyCert] [--silent]
```

`targetHost` is any target server to expose behind the NAT.
`targetPort` is the port of the target server.
`relayServer` is the host name or IP address of the relay server.
`relayPort` is the relay server port where the client will connect.

`relaySecret` specifies a shared secret key relay client sends to server for the purpose of authorization.
`relayNumConn` is the number of unused connections relay client maintains with the server. As soon as it detects data
activity on a socket, it establishes another connection. Servicing internet clients that don't transfer any data may
lead to denial of service.

`relayTls` enables secure TLS communication with the relay server.
`relayVerifyCert` enables checking for valid server certificate on the relay server.

`publicTls` enables secure TLS communication with the relay server.
`publicVerifyCert` enables checking for valid server certificate on the relay server.

`silent` silence outputted logs as the client is executed.

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
            silent: false
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
            silent: false
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
