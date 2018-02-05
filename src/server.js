const util = require('util');
const EventEmitter = require('events').EventEmitter;
const net = require('net');
const tls = require('tls');
const fs = require('fs');

let socketPipeId = 1;

class SocketPipe {

  constructor(socket, options) {

    // This class is an event emitter. Initialize it
    EventEmitter.call(this);

    this.id = socketPipeId;
    socketPipeId += 1;

    this.socket = socket;
    this.options = options || {};
    this.pairedSocket = undefined;
    this.authorized = false;

    // Used only if we are waiting for a secret
    this.buffer = [];

    // Do we want timeouts?
    this._prepareTimeoutHandler();

    // Begin handling events
    this._registerSocketEventHandlers();

  }

  activate(pairedSocket) {

    if (this.pairedSocket) {
      throw new Error(`[${this.id}] Attempted to pair socket more than once.`);
    }

    if (this.options.verbose) {
      console.log(`[${this.id}] Socket pipe activated!`);
    }

    this.pairedSocket = pairedSocket;

    // Configure socket for keeping connections alive
    this.pairedSocket.setKeepAlive(true, 120 * 1000);

    // If we have any data in the buffer, write it
    this.writeBuffer();
  }

  _registerSocketEventHandlers() {

    // Configure socket for keeping connections alive
    this.socket.setKeepAlive(true, 120 * 1000);

    // New data
    this.socket.on(
      'data',
      (data) => {

        // Do we want to check for the secret? Are we authorized?
        if (!this.authorized) {

          if (this.options.verbose) {
            console.log(`[${this.id}] Socket pipe not yet authorized, storing data.`);
          }

          // Append the new data to the end of the data buffer
          this.buffer[this.buffer.length] = data;

          // Verify authorization
          this._verifyAuthorization();

        } else {

          // Not authorized - write directly to the socket
          try {

            this.pairedSocket.write(data);

          } catch (ex) {
            console.error(`[${this.id}] Error writing to paired socket: `, ex);
          }

        }

      },
    );

    this.socket.on(
      'close',
      (hadError) => {

        if (hadError) {
          console.error(`[${this.id}] Socket was closed with error: `, hadError);
        }

        // Destroy the paired socket too
        if (this.pairedSocket !== undefined) {
          this.pairedSocket.destroy();
        }

        // Mark this socketPipe is closing
        this.emit('close');

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
          console.error(`[${this.id}] Closing socket due to timeout.`);

          this.socket.destroy();
          this.emit('close');
        }
      },
      this.options.timeout,
    );

  }

  _verifyAuthorization() {

    // Do we have a secret set?
    if (this.options.secret) {

      // Yep. Verify it
      const keyLen = this.options.secret.length;
      if (this.buffer[0].length >= keyLen &&
          this.buffer[0].toString(undefined, 0, keyLen) === this.options.secret) {

        // Great!
        // Remove the secret
        this.buffer[0] = this.buffer[0].slice(keyLen);

        if (this.options.verbose) {
          console.log(`[${this.id}] Received valid secret: authorized connection.`);
        }

      } else {

        // Bad secret?
        console.error(`[${this.id}] Invalid secret received from incoming connection.`);

        // Destroy the socket, no more traffic
        this.socket.destroy();

        return;
      }
    } else {

      // No secret - nothing to check
      // eslint-disable-next-line no-lonely-if
      if (this.options.verbose) {
        console.log(`[${this.id}] No secret defined - authorizing by default.`);
      }

    }

    // Mark ourselves as authorized
    this.authorized = true;

    // And raise an event, to continue creating the socketPipe
    this.emit('authorized');

  }

  writeBuffer() {

    if (this.authorized && this.buffer.length > 0) {

      try {

        for (const bufferItem of this.buffer) {
          this.pairedSocket.write(bufferItem);
        }

      } catch (ex) {
        console.error(`[${this.id}] Error writing to paired socket: `, ex);
      }

      // Clear the array
      this.buffer.length = 0;

    }

  }
}

util.inherits(SocketPipe, EventEmitter);


class SocketListener {

  constructor(port, options) {

    // This class is an event emitter. Initialize it
    EventEmitter.call(this);

    this.port = port;
    this.options = options || {};
    this.pendingSocketPipes = [];
    this.activeSocketPipes = [];

    let listeningServer;
    if (this.options.tls === true) {
      // Support TLS?
      listeningServer = this._createTLSServer();
    } else {
      // Simple TCP
      listeningServer = this._createTCPServer();

    }

    // Start listening...
    this.relayServer = listeningServer;
    this.relayServer.listen(port, options.host);

  }

  _createTCPServer() {

    if (this.options.verbose) {
      console.log('Will listen to incoming TCP connections.');
    }

    return net.createServer((socket) => {

      if (this.options.verbose) {
        console.log(`Incoming TCP connection from ${socket.remoteAddress}:${socket.remotePort}`);
      }

      this._createSocketPipe(socket);

    });
  }

  _createTLSServer() {
    if (this.options.verbose) {
      console.log('Will listen to incoming TLS connections.');
    }

    const tlsOptions = {
      pfx: fs.readFileSync(this.options.pfx),
      passphrase: this.options.passphrase,
    };

    // Create the
    return tls.createServer(
      tlsOptions,
      (socket) => {

        if (this.options.verbose) {
          console.log(`Incoming TLS connection from ${socket.remoteAddress}:${socket.remotePort}`);
        }

        this._createSocketPipe(socket);

      },
    );
  }

  _createSocketPipe(socket) {

    const newSocketPipe = new SocketPipe(
      socket,
      {
        secret: this.options.secret,
        timeout: this.options.timeout,
        verbose: this.options.verbose,
      },
    );

    newSocketPipe.on('authorized', () => {
      if (this.options.verbose) {
        console.log(`[${newSocketPipe.id}] SocketPipe authorized.`);
      }
      this.emit('new', newSocketPipe);
    });

    newSocketPipe.on('close', () => {
      if (this.options.verbose) {
        console.log(`[${newSocketPipe.id}] SocketPipe closed connection`);
      }
      this._removeSocketPipe(newSocketPipe);
    });

  }

  activateSocketPipe(otherSocketListener, connectingSocketPipe) {

    // Do we have a pending socketPipe waiting?
    if (this._hasPendingSocketPipes()) {

      // Get the current pending socketPipe
      const pendingSocketPipe = this._getPendingSocketPipe();

      if (this.options.verbose) {
        console.log(
          `Activating pending SocketPipe: connecting SocketPipes ${
            pendingSocketPipe.id} and ${connectingSocketPipe.id}`);
      }

      // Pair the connecting socketPipe with the pending socketPipe, allow data flow in one direction
      connectingSocketPipe.activate(pendingSocketPipe.socket);
      this._addActiveSocketPipe(pendingSocketPipe);

      // And vice versa, for the second direction
      pendingSocketPipe.activate(connectingSocketPipe.socket);
      otherSocketListener._addActiveSocketPipe(connectingSocketPipe);

    } else {

      if (this.options.verbose) {
        console.log(`[${connectingSocketPipe.id}] SocketPipe will be pending until a client connection occurs`);
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
      console.log('Terminating SocketListener.');
    }

    this.relayServer.close();
    for (const socketPipe of this.pendingSocketPipes) {
      socketPipe.socket.destroy();
    }
    for (const socketPipe of this.activeSocketPipes) {
      socketPipe.socket.destroy();
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
      pfx: 'cert.pfx',
      passphrase: 'abcd',
    },
  ) {
    this.options = options || {};
    this.relayPort = relayPort;
    this.internetPort = internetPort;

    this.relaySocketListener = new SocketListener(this.relayPort, {
      host: options.host,
      secret: options.secret,
      tls: options.tls,
      pfx: options.pfx,
      passphrase: options.passphrase,
      verbose: options.verbose,
    });
    this.relaySocketListener.on('new', (connectingSocketPipe) => {

      if (this.options.verbose) {
        console.log(`[${connectingSocketPipe.id}] New socketPipe created by connection on relay socket.`);
      }

      this.internetSocketListener.activateSocketPipe(this.relaySocketListener, connectingSocketPipe);

    });

    this.internetSocketListener = new SocketListener(this.internetPort, {
      host: options.host,
      timeout: 20000,
      verbose: options.verbose,
    });
    this.internetSocketListener.on('new', (connectingSocketPipe) => {

      if (this.options.verbose) {
        console.log(`[${connectingSocketPipe.id}] New socketPipe created by connection on internet socket.`);
      }

      this.relaySocketListener.activateSocketPipe(this.internetSocketListener, connectingSocketPipe);

    });
  }

  terminate() {
    this.relaySocketListener.terminate();
    this.internetSocketListener.terminate();
  }

}

module.exports = {
  NATTraversalServer,
};

