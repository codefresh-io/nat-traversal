const util = require('util');
const { EventEmitter } = require('events');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const pem = require('pem');

let socketPipeId = 1;

class SocketPipe {

  constructor(socket, options, type) {

    // This class is an event emitter. Initialize it
    EventEmitter.call(this);

    this.id = socketPipeId;
    socketPipeId += 1;

    this.socket = socket;
    this.options = options || {};
    this.pairedSocket = undefined;
    this.authorized = false;
    this.type = type;

    // Used only if we are waiting for a secret
    this.buffer = [];

  }

  toString() {
    return `${this.type}:${this.id}`;
  }

  start() {

    // Do we want timeouts?
    this._prepareTimeoutHandler();

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

    if (this.options.verbose) {
      console.log(`[${this}] Socket pipe activated!`);
    }

    this.pairedSocket = pairedSocket;

    // Configure socket for keeping connections alive
    this.pairedSocket.setKeepAlive(true, 120 * 1000);

    // If we have any data in the buffer, write it
    this._writeBuffer();
  }

  _registerSocketEventHandlers() {

    // Configure socket for keeping connections alive
    this.socket.setKeepAlive(true, 120 * 1000);

    // Verify authorization immediately, if we can. If we can't, this will do nothing
    this._verifyAuthorization();

    // New data
    this.socket.on(
      'data',
      (data) => {

        // Do we want to check for the secret? Are we authorized?
        if (!this.authorized || !this.pairedSocket) {

          if (this.options.verbose) {
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

  _prepareTimeoutHandler() {

    if (!this.options.timeout) {
      return;
    }

    setTimeout(
      () => {
        if (this.options.secret) {

          // Timeout?
          console.error(`[${this}] Closing socket due to timeout.`);

          this.terminate();
        }
      },
      this.options.timeout,
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

          if (this.options.verbose) {
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
        if (this.options.verbose) {
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
    this.pendingSocketPipes = [];
    this.activeSocketPipes = [];
    this.type = type;
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

    if (this.options.verbose) {
      console.log(`[${this.type}] Listening...`);
    }
  }

  _createTCPServer() {

    if (this.options.verbose) {
      console.log(`[${this.type}] Will listen to incoming TCP connections.`);
    }

    return net.createServer((socket) => {

      if (this.options.verbose) {
        console.log(`[${this.type}] Incoming TCP connection from ${socket.remoteAddress}:${socket.remotePort}`);
      }

      this._createSocketPipe(socket, this.type);

    });
  }

  async _createTLSServer() {

    if (this.options.verbose) {
      console.log(`[${this.type}] Will listen to incoming TLS connections.`);
    }

    let tlsOptions;
    if (this.options.pfx) {

      if (this.options.verbose) {
        console.log(`[${this.type}] Using pfx file: ${this.options.pfx}`);
      }

      tlsOptions = {
        pfx: fs.readFileSync(this.options.pfx),
        passphrase: this.options.passphrase,
      };

    } else if (this.options.key && this.options.cert) {

      if (this.options.verbose) {
        console.log(`[${this.type}] Using cert file: ${this.options.cert} and key file ${this.options.key}`);
      }

      tlsOptions = {
        key: fs.readFileSync(this.options.key),
        cert: fs.readFileSync(this.options.cert),
        passphrase: this.options.passphrase,
      };

    } else {

      if (this.options.verbose) {
        console.log(`[${this.type}] No pfx or key/cert configured - autogenerating TLS key/cert pair.`);
      }

      const createCertFunc = util.promisify(pem.createCertificate);

      const keys = await createCertFunc({ days: 7, selfSigned: true });

      tlsOptions = {
        key: keys.serviceKey,
        cert: keys.certificate,
      };
    }

    // Create the
    const createdServer = tls.createServer(
      tlsOptions,
      (socket) => {

        if (this.options.verbose) {
          console.log(`[${this.type}] Incoming TLS connection from ${socket.remoteAddress}:${socket.remotePort}`);
        }

        this._createSocketPipe(socket, this.type);

      },
    );

    return createdServer;
  }

  _createSocketPipe(socket, type) {

    const newSocketPipe = new SocketPipe(
      socket,
      {
        secret: this.options.secret,
        timeout: this.options.timeout,
        verbose: this.options.verbose,
      },
      type,
    );

    newSocketPipe.on('authorized', () => {
      if (this.options.verbose) {
        console.log(`[${newSocketPipe}] SocketPipe authorized.`);
      }
      this.emit('new', newSocketPipe);
    });

    newSocketPipe.on('close', () => {
      if (this.options.verbose) {
        console.log(`[${newSocketPipe}] SocketPipe closed connection`);
      }
      this._removeSocketPipe(newSocketPipe);
    });

    newSocketPipe.start();

  }

  activateSocketPipe(otherSocketListener, connectingSocketPipe) {

    // Do we have a pending socketPipe waiting?
    if (this._hasPendingSocketPipes()) {

      // Get the current pending socketPipe
      const pendingSocketPipe = this._getPendingSocketPipe();

      if (this.options.verbose) {
        console.log(`[${this.type}] Activating pending SocketPipe: connecting SocketPipes ${pendingSocketPipe
        } and ${connectingSocketPipe}`);
      }

      // Pair the connecting socketPipe with the pending socketPipe, allow data flow in one direction
      connectingSocketPipe.activate(pendingSocketPipe.socket);
      this._addActiveSocketPipe(pendingSocketPipe);

      // And vice versa, for the second direction
      pendingSocketPipe.activate(connectingSocketPipe.socket);
      otherSocketListener._addActiveSocketPipe(connectingSocketPipe);

    } else {

      if (this.options.verbose) {
        console.log(`[${connectingSocketPipe}] SocketPipe will be pending until a parallel connection occurs`);
      }

      // If we don't then our new connecting socketPipe is now pending and waiting for another connecting socketPipe
      otherSocketListener._addPendingSocketPipe(connectingSocketPipe);

    }

  }

  _getPendingSocketPipe() {
    const pendingSocketPipe = this.pendingSocketPipes[0];
    this.pendingSocketPipes.splice(0, 1);
    return pendingSocketPipe;
  }

  _addActiveSocketPipe(socketPipe) {
    this.activeSocketPipes.push(socketPipe);
  }

  _addPendingSocketPipe(socketPipe) {
    this.pendingSocketPipes.push(socketPipe);
  }

  _removeSocketPipe(newSocketPipe) {
    let i = this.pendingSocketPipes.indexOf(newSocketPipe);
    if (i !== -1) {
      this.pendingSocketPipes.splice(i, 1);
    } else {
      i = this.activeSocketPipes.indexOf(newSocketPipe);
      if (i !== -1) {
        this.activeSocketPipes.splice(i, 1);
      }
    }
  }

  _hasPendingSocketPipes() {
    return this.pendingSocketPipes.length > 0;
  }

  terminate() {

    if (this.options.verbose) {
      console.log(`[${this.type}] Terminating SocketListener.`);
    }

    this.relayServer.close();
    for (const socketPipe of this.pendingSocketPipes) {
      socketPipe.terminate();
    }
    for (const socketPipe of this.activeSocketPipes) {
      socketPipe.terminate();
    }
    this.relayServer.unref();
  }
}

util.inherits(SocketListener, EventEmitter);


class NATTraversalServer {

  constructor(
    relayPort,
    internetPort,
    options = {
      tls: false,
    },
  ) {
    this.options = options || {};
    this.relayPort = relayPort;
    this.internetPort = internetPort;
  }

  start() {

    this.relaySocketListener = new SocketListener(this.relayPort, this.options, 'relay');
    this.relaySocketListener.on('new', (connectingSocketPipe) => {

      this.internetSocketListener.activateSocketPipe(this.relaySocketListener, connectingSocketPipe);

    });
    this.relaySocketListener.start();

    this.internetSocketListener =
      new SocketListener(
        this.internetPort,
        {
          host: this.options.host,
          timeout: 20000,
          verbose: this.options.verbose,
        },
        'service',
      );
    this.internetSocketListener.on('new', (connectingSocketPipe) => {

      this.relaySocketListener.activateSocketPipe(this.internetSocketListener, connectingSocketPipe);

    });
    this.internetSocketListener.start();

  }

  terminate() {
    this.relaySocketListener.terminate();
    this.internetSocketListener.terminate();
  }

}

module.exports = {
  NATTraversalServer,
};

