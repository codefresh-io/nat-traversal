const util = require('util');
const EventEmitter = require('events').EventEmitter;
const net = require('net');
const tls = require('tls');

let socketPipeId = 1;

class SocketPipe {
  constructor(host, port, relayHost, relayPort, options) {

    // This class is an event emitter. Initialize it
    EventEmitter.call(this);

    this.id = socketPipeId;
    socketPipeId += 1;

    this.host = host;
    this.port = port;
    this.relayHost = relayHost;
    this.relayPort = relayPort;
    this.options = options;
    this.serviceSocket = undefined;
    this.serviceSocketPending = true;
    this.buffer = [];

    if (this.options.verbose) {
      console.log(`[${this.id}] Created new pending SocketPipe.`);
    }

    this._openRelayEnd();

  }

  _openRelayEnd() {

    // Use TLS?
    if (this.options.tls) {

      if (this.options.verbose) {
        console.log(`[${this.id}] Socket pipe will use TLS connection to connect to relay server.`);
      }

      this.relaySocket =
        tls.connect(
          this.relayPort,
          this.relayHost,
          {
            rejectUnauthorized: this.options.rejectUnauthorized,
          },
          () => {
            if (this.options.verbose) {
              console.log(`[${this.id}] Created new TLS connection.`);
            }

            // Configure socket for keeping connections alive
            this.relaySocket.setKeepAlive(true, 120 * 1000);

            this._requestAuthorization();
          },
        );

    } else {

      if (this.options.verbose) {
        console.log(`[${this.id}] Socket pipe will TCP connection to connect to relay server.`);
      }

      // Or use TCP
      this.relaySocket = new net.Socket();

      this.relaySocket.connect(
        this.relayPort,
        this.relayHost,
        () => {
          if (this.options.verbose) {
            console.log(`[${this.id}] Created new TCP connection.`);
          }

          // Configure socket for keeping connections alive
          this.relaySocket.setKeepAlive(true, 120 * 1000);

          this._requestAuthorization();

        },
      );

    }

    // We have a relay socket - now register its handlers

    // On data
    this.relaySocket.on(
      'data',
      (data) => {

        // Got data - do we have a service socket?
        if (this.serviceSocket === undefined) {

          // Create a service socket for the relay socket - connecting to the target service
          this._openServiceEnd(this.host, this.port);

          this.emit('pair');
        }

        // Is the service socket still connecting? If so, are we buffering data?
        if (this.serviceSocketPending) {

          // Store the data until we have a service socket
          this.buffer[this.buffer.length] = data;

        } else {

          try {
            // Or just pass it directly
            this.serviceSocket.write(data);
          } catch (ex) {
            console.error(`[${this.id}] Error writing to service socket: `, ex);
          }

        }
      },
    );

    // On closing
    this.relaySocket.on(
      'close',
      (hadError) => {

        if (hadError) {
          console.error(`[${this.id}] Relay socket closed with error: `, hadError);
        }

        if (this.serviceSocket !== undefined) {

          // Destroy the other socket
          this.serviceSocket.destroy();

        } else {

          // Signal we are closing - server closed the connection
          this.emit('close');
        }
      },
    );

    this.relaySocket.on('error', (error) => {
      console.error(`[${this.id}] Error with relay socket: `, error);
    });

  }

  _requestAuthorization() {

    // Got a secret?
    if (this.options.secret) {
      if (this.options.verbose) {
        console.log(`[${this.id}] Sending authorization to relay service and waiting for incoming data.`);
      }

      try {
        // Write it to the relay!
        this.relaySocket.write(this.options.secret);
      } catch (ex) {
        console.error(`[${this.id}] Error writing to relay socket: `, ex);
      }

    }

  }

  _openServiceEnd(host, port) {

    if (this.options.verbose) {
      console.log(`[${this.id}] Authorized by relay server. Creating new connection to service ${host}:${port}...`);
    }

    // Create a new service socket
    this.serviceSocket = new net.Socket();

    // Connect it immediately
    this.serviceSocket.connect(
      port,
      host,
      () => {

        if (this.options.verbose) {
          console.log(`[${this.id}] Connected to service ${host}:${port}.`);
        }

        // Configure socket for keeping connections alive
        this.serviceSocket.setKeepAlive(true, 120 * 1000);

        // Connected, not pending anymore
        this.serviceSocketPending = false;

        // And if we have any buffered data, forward it
        try {
          for (const bufferItem of this.buffer) {
            this.serviceSocket.write(bufferItem);
          }
        } catch (ex) {
          console.error(`[${this.id}] Error writing to service socket: `, ex);
        }


        // Clear the array
        this.buffer.length = 0;
      },
    );

    // Got data from the service socket?
    this.serviceSocket.on('data', (data) => {

      try {
        // Forward it!
        this.relaySocket.write(data);
      } catch (ex) {
        console.error(`[${this.id}] Error writing to relay socket: `, ex);
      }

    });

    this.serviceSocket.on('error', (hadError) => {

      if (hadError) {
        console.error(`[${this.id}] Service socket was closed with error: `, hadError);
      }

      this.relaySocket.terminate();
    });

  }

  terminate() {

    if (this.options.verbose) {
      console.log(`[${this.id}] Terminating socket pipe...`);
    }

    this.removeAllListeners();
    this.relaySocket.destroy();
  }
}

util.inherits(SocketPipe, EventEmitter);


class NATTraversalClient {

  constructor(host, port, relayHost, relayPort, options) {

    this.host = host;
    this.port = port;
    this.relayHost = relayHost;
    this.relayPort = relayPort;

    this.options = options;

    this.socketPipes = [];

    // Create pending socketPipes
    for (let i = 0; i < this.options.numConn; i += 1) {
      this.createSocketPipe(host, port, relayHost, relayPort, options);
    }
  }

  createSocketPipe(host, port, relayHost, relayPort, options) {

    // Create a new socketPipe
    const socketPipe = new SocketPipe(host, port, relayHost, relayPort, options);
    this.socketPipes.push(socketPipe);

    socketPipe.on(
      'pair',
      () => {

        // Create a new pending socketPipe
        this.createSocketPipe(host, port, relayHost, relayPort, options);
      },
    );

    socketPipe.on(
      'close',
      () => {

        // Server closed the connection

        // Remove paired pipe
        this._removeSocketPipe(socketPipe);

        // Create a new replacement socketPipe, that is pending and waiting, if required
        setTimeout(
          () => {
            if (this.terminating) {
              return;
            }

            // Create a new pending socketPipe
            this.createSocketPipe(host, port, relayHost, relayPort, options);
          },
          5000,
        );
      },
    );

  }

  _removeSocketPipe(socketPipe) {

    // SocketPipe closed - is it still stored by us?
    const i = this.socketPipes.indexOf(socketPipe);

    // If so, remove it
    if (i !== -1) {
      this.socketPipes.splice(i, 1);
    }
  }

  terminate() {
    this.terminating = true;
    for (const socketPipe of this.socketPipes) {
      socketPipe.terminate();
    }
  }
}

module.exports = {
  NATTraversalClient,
};
