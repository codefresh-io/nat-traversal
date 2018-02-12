const util = require('util');
const { EventEmitter } = require('events');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const pem = require('pem');

let socketPipeId = 1;

class SocketPipe {

  constructor(socket, options, type, tunnelKey) {

    // This class is an event emitter. Initialize it
    EventEmitter.call(this);

    this.id = socketPipeId;
    socketPipeId += 1;

    this.socket = socket;
    this.options = options || {};
    this.pairedSocket = undefined;
    this.authorized = false;
    this.type = type;
    this.tunnelKey = tunnelKey;

    // Used only if we are waiting for a secret
    this.buffer = [];

  }

  toString() {
    return `${this.type}:${this.tunnelKey}:${this.id}`;
  }

  start() {

    // Begin handling events
    this._registerSocketEventHandlers();

  }

  terminate() {

    this.socket.destroy();
  }

  activate(pairedSocket) {

    if (this.pairedSocket) {
      throw new Error(`[${this}] Attempted to pair socket more than once.`);
    }

    if (!this.options.silent) {
      console.log(`[${this}] Socket pipe activated!`);
    }

    this.pairedSocket = pairedSocket;

    // Configure socket for keeping connections alive
    this.pairedSocket.setKeepAlive(true, 120 * 1000);
    if (this.options.timeout) {
      this.pairedSocket.setTimeout(this.options.timeout);
    }

    // If we have any data in the buffer, write it
    this._writeBuffer();
  }

  _registerSocketEventHandlers() {

    // Configure socket for keeping connections alive
    this.socket.setKeepAlive(true, 120 * 1000);
    if (this.options.timeout) {
      this.socket.setTimeout(this.options.timeout);
    }

    // Verify authorization immediately, if we can. If we can't, this will do nothing
    this._verifyAuthorization();

    // New data
    this.socket.on(
      'data',
      (data) => {

        // Do we want to check for the secret? Are we authorized?
        if (!this.authorized || !this.pairedSocket) {

          if (!this.options.silent) {
            console.log(`[${this}] Socket pipe not yet authorized, storing data.`);
          }

          // Append the new data to the end of the data buffer
          this.buffer[this.buffer.length] = data;

          // Verify authorization
          this._verifyAuthorization();

        } else {

          // Authorized - write directly to the socket
          try {

            this.pairedSocket.write(data);

          } catch (ex) {
            console.error(`[${this}] Error writing to paired socket: `, ex);
          }

        }

      },
    );

    this.socket.on(
      'close',
      (hadError) => {

        if (hadError) {
          console.error(`[${this}] Socket was closed due to error.`);
        }

        // Destroy the paired socket too
        if (this.pairedSocket !== undefined) {
          this.pairedSocket.destroy();
        }

        // Mark this socketPipe is closing
        this.emit('close');

      },
    );

    this.socket.on(
      'error',
      (err) => {
        console.error(`[${this}] Socket error: ${err}`);
      },
    );
  }

  _verifyAuthorization() {

    if (!this.authorized) {

      // Do we have a secret set?
      if (this.options.secret) {

        // If we haven't received any data - just return.
        if (this.buffer.length === 0) {
          return;
        }

        // Otherwise, we have data. Verify it
        const keyLen = this.options.secret.length;
        if (this.buffer[0].length >= keyLen &&
            this.buffer[0].toString(undefined, 0, keyLen) === this.options.secret) {

          // Great!
          // Remove the secret
          this.buffer[0] = this.buffer[0].slice(keyLen);

          if (!this.options.silent) {
            console.log(`[${this}] Received valid secret: authorized connection.`);
          }

        } else {

          // Bad secret?
          console.error(`[${this}] Invalid secret received from incoming connection.`);

          // Destroy the socket, no more traffic
          this.terminate();

          return;
        }

      } else {

        // No secret - nothing to check
        // eslint-disable-next-line no-lonely-if
        if (!this.options.silent) {
          console.log(`[${this}] No secret defined - authorizing by default.`);
        }

      }

      // Mark ourselves as authorized
      this.authorized = true;

      // And raise an event, to continue creating the socketPipe
      this.emit('authorized');

    }

  }

  _writeBuffer() {

    if (this.authorized && this.buffer.length > 0) {

      try {

        for (const bufferItem of this.buffer) {
          this.pairedSocket.write(bufferItem);
        }

      } catch (ex) {
        console.error(`[${this}] Error writing to paired socket: `, ex);
      }

      // Clear the array
      this.buffer.length = 0;

    }

  }
}

util.inherits(SocketPipe, EventEmitter);

class SocketListener {

  constructor(port, options, type) {

    // This class is an event emitter. Initialize it
    EventEmitter.call(this);

    this.port = port;
    this.options = options || {};
    this.pendingSocketPipes = {
      null: [],
    };
    this.activeSocketPipes = {
      null: [],
    };
    this.type = type;
  }

  toString() {
    return `${this.type}`;
  }

  async start() {
    let listeningServer;
    if (this.options.tls === true) {
      // Support TLS?
      listeningServer = await this._createTLSServer();
    } else {
      // Simple TCP
      listeningServer = this._createTCPServer();

    }

    // Start listening...
    this.relayServer = listeningServer;
    this.relayServer.listen(this.port, this.options.host);

    if (!this.options.silent) {
      console.log(`[${this}] Listening on port ${this.port}...`);
    }
  }

  _createTCPServer() {

    if (!this.options.silent) {
      console.log(`[${this}] Will listen to incoming TCP connections.`);
    }

    return net.createServer((socket) => {

      if (!this.options.silent) {
        console.log(`[${this}] Incoming TCP connection from ${socket.remoteAddress}:${socket.remotePort}`);
      }

      this._createSocketPipe(socket, this.type);

    });
  }

  async _createTLSServer() {

    if (!this.options.silent) {
      console.log(`[${this}] Will listen to incoming TLS connections.`);
    }

    let tlsOptions;
    if (this.options.pfx) {

      if (!this.options.silent) {
        console.log(`[${this}] Using pfx file: ${this.options.pfx}`);
      }

      tlsOptions = {
        pfx: fs.readFileSync(this.options.pfx),
        passphrase: this.options.passphrase,
      };

    } else if (this.options.key && this.options.cert) {

      if (!this.options.silent) {
        console.log(`[${this}] Using cert file: ${this.options.cert} and key file ${this.options.key}`);
      }

      tlsOptions = {
        key: fs.readFileSync(this.options.key, 'utf8'),
        cert: fs.readFileSync(this.options.cert, 'utf8'),
        passphrase: this.options.passphrase,
      };

    } else {

      if (!this.options.silent) {
        console.log(`[${this}] No pfx or key/cert configured - autogenerating TLS key/cert pair.`);
        console.log(`[${this}] Self-signing key/cert for common name ${this.options.tlsCommonName} ` +
                    'that will expire in 7 days.');
      }

      const createCertFunc = util.promisify(pem.createCertificate);

      const keys = await createCertFunc({
        days: 7,
        selfSigned: true,
        commonName: this.options.tlsCommonName,
      });

      tlsOptions = {
        key: keys.clientKey,
        cert: keys.certificate,
        ca: keys.serviceKey,
      };
    }

    tlsOptions = Object.assign({
      ca: (
        this.options.tlsCaCert ? fs.readFileSync(this.options.tlsCaCert, 'utf8') : undefined
      ),
      requestCert: this.options.tlsRequestCert,
      rejectUnauthorized: this.options.tlsRequestCert,
    }, tlsOptions);

    // Create the
    const createdServer = tls.createServer(
      tlsOptions,
      (socket) => {

        if (!this.options.silent) {
          console.log(`[${this}] Incoming TLS connection from ${socket.remoteAddress}:${socket.remotePort}`);
        }

        this._createSocketPipe(socket, this.type);

      },
    );

    createdServer.on('tlsClientError', (exception) => {
      console.error(`[${this}] Error creating TLS connection with client: `, exception);
    });

    return createdServer;
  }

  _createSocketPipe(socket, type) {

    let tunnelKey = null;
    if (this.options.tls) {
      tunnelKey = this.options.fnCertCnToTunnelKey(socket.getPeerCertificate().subject.CN);
    }

    const newSocketPipe = new SocketPipe(
      socket,
      {
        secret: this.options.secret,
        timeout: this.options.timeout,
        silent: this.options.silent,
      },
      type,
      tunnelKey,
    );

    newSocketPipe.on('authorized', () => {
      if (!this.options.silent) {
        console.log(`[${newSocketPipe}] SocketPipe authorized.`);
      }
      this.emit('new', newSocketPipe);
    });

    newSocketPipe.on('close', () => {
      if (!this.options.silent) {
        console.log(`[${newSocketPipe}] SocketPipe closed connection`);
      }
      this._removeSocketPipe(newSocketPipe);
    });

    newSocketPipe.start();

  }

  activateSocketPipe(otherSocketListener, connectingSocketPipe) {

    // Do we have a pending socketPipe waiting?
    if (this._hasPendingSocketPipes(connectingSocketPipe.tunnelKey)) {

      // Get the current pending socketPipe
      const pendingSocketPipe = this._getPendingSocketPipe(connectingSocketPipe.tunnelKey);

      if (!this.options.silent) {
        console.log(`[${this}] Activating pending SocketPipe: connecting SocketPipes ` +
                    `${pendingSocketPipe} and ${connectingSocketPipe}`);
      }

      // Pair the connecting socketPipe with the pending socketPipe, allow data flow in one direction
      connectingSocketPipe.activate(pendingSocketPipe.socket);
      this._addActiveSocketPipe(pendingSocketPipe);

      // And vice versa, for the second direction
      pendingSocketPipe.activate(connectingSocketPipe.socket);
      otherSocketListener._addActiveSocketPipe(connectingSocketPipe);

    } else {

      if (!this.options.silent) {
        console.log(`[${connectingSocketPipe}] SocketPipe will be pending until a parallel connection occurs`);
      }

      // If we don't then our new connecting socketPipe is now pending and waiting for another connecting socketPipe
      otherSocketListener._addPendingSocketPipe(connectingSocketPipe);

    }

  }

  _hasPendingSocketPipes(tunnelKey = null) {
    return tunnelKey in this.pendingSocketPipes && this.pendingSocketPipes[tunnelKey].length > 0;
  }

  _getPendingSocketPipe(tunnelKey = null) {
    const pendingSocketPipe = this.pendingSocketPipes[tunnelKey][0];
    this.pendingSocketPipes[tunnelKey].splice(0, 1);
    return pendingSocketPipe;
  }

  _addActiveSocketPipe(socketPipe) {
    const { tunnelKey } = socketPipe;
    if (!(
      tunnelKey in this.activeSocketPipes
    )) {
      this.activeSocketPipes[tunnelKey] = [];
    }
    this.activeSocketPipes[tunnelKey].push(socketPipe);
  }

  _addPendingSocketPipe(socketPipe) {
    const { tunnelKey } = socketPipe;
    if (!(
      tunnelKey in this.pendingSocketPipes
    )) {
      this.pendingSocketPipes[tunnelKey] = [];
    }
    this.pendingSocketPipes[tunnelKey].push(socketPipe);
  }

  _removeSocketPipe(newSocketPipe) {
    const { tunnelKey } = newSocketPipe;

    if (tunnelKey in this.pendingSocketPipes) {
      const i = this.pendingSocketPipes[tunnelKey].indexOf(newSocketPipe);
      if (i !== -1) {
        this.pendingSocketPipes[tunnelKey].splice(i, 1);
      }
    }

    if (tunnelKey in this.activeSocketPipes) {
      const i = this.activeSocketPipes[tunnelKey].indexOf(newSocketPipe);
      if (i !== -1) {
        this.activeSocketPipes[tunnelKey].splice(i, 1);
      }
    }
  }

  terminate() {

    if (!this.options.silent) {
      console.log(`[${this}] Terminating SocketListener.`);
    }

    this.relayServer.close();
    for (const tunnelKey of Object.keys(this.pendingSocketPipes)) {
      for (const socketPipe of this.pendingSocketPipes[tunnelKey]) {
        socketPipe.terminate();
      }
    }
    for (const tunnelKey of Object.keys(this.activeSocketPipes)) {
      for (const socketPipe of this.activeSocketPipes[tunnelKey]) {
        socketPipe.terminate();
      }
    }
    this.relayServer.unref();
  }
}

util.inherits(SocketListener, EventEmitter);

class NATTraversalServer {

  constructor(
    publicHost,
    publicPort,
    relayHost,
    relayPort,
    options = {
      publicTimeout: 120000,
      publicTls: false,
      publicCertCN: null,
      publicRequestCert: null,
      publicCaCert: null,
      publicPfx: null,
      publicPassphrase: null,
      publicKey: null,
      publicCert: null,
      relayTimeout: 120000,
      relayCertCN: null,
      relayRequestCert: null,
      relayCaCert: null,
      relayTls: true,
      relayPfx: null,
      relayPassphrase: null,
      relayKey: null,
      relayCert: null,
      relaySecret: null,
      silent: false,
      fnCertCnToTunnelKey: (certCn) => { return certCn; },
    },
  ) {
    this.options = options || {};

    if (!this.options.fnCertCnToTunnelKey) {
      this.options.fnCertCnToTunnelKey = (certCn) => { return certCn; };
    }

    this.publicHost = publicHost;
    this.publicPort = publicPort;
    this.relayHost = relayHost;
    this.relayPort = relayPort;
  }

  start() {

    this.relaySocketListener =
      new SocketListener(
        this.relayPort,
        {
          host: this.relayHost,
          timeout: this.options.relayTimeout,
          tls: this.options.relayTls,
          tlsCommonName: this.options.relayCertCN,
          tlsRequestCert: this.options.relayRequestCert,
          tlsCaCert: this.options.relayCaCert,
          pfx: this.options.relayPfx,
          passphrase: this.options.relayPassphrase,
          key: this.options.relayKey,
          cert: this.options.relayCert,
          secret: this.options.relaySecret,
          silent: this.options.silent,
          fnCertCnToTunnelKey: this.options.fnCertCnToTunnelKey,
        },
        'relay',
      );
    this.relaySocketListener.on('new', (connectingSocketPipe) => {

      this.publicSocketListener.activateSocketPipe(this.relaySocketListener, connectingSocketPipe);

    });
    this.relaySocketListener.start();

    this.publicSocketListener =
      new SocketListener(
        this.publicPort,
        {
          host: this.publicHost,
          timeout: this.options.publicTimeout,
          tls: this.options.publicTls,
          tlsCommonName: this.options.publicCertCN,
          tlsRequestCert: this.options.publicRequestCert,
          tlsCaCert: this.options.publicCaCert,
          pfx: this.options.publicPfx,
          passphrase: this.options.publicPassphrase,
          key: this.options.publicKey,
          cert: this.options.publicCert,
          secret: null,
          silent: this.options.silent,
          fnCertCnToTunnelKey: this.options.fnCertCnToTunnelKey,
        },
        'public',
      );
    this.publicSocketListener.on('new', (connectingSocketPipe) => {

      this.relaySocketListener.activateSocketPipe(this.publicSocketListener, connectingSocketPipe);

    });
    this.publicSocketListener.start();

  }

  terminate() {
    this.relaySocketListener.terminate();
    this.publicSocketListener.terminate();
  }

}

module.exports = {
  NATTraversalServer,
};

