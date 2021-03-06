const util = require('util');
const fs = require('fs');
const { EventEmitter } = require('events');
const net = require('net');
const tls = require('tls');

let socketPipeId = 1;

class SocketPipe {
  constructor(targetHost, targetPort, relayHost, relayPort, options) {

    // This class is an event emitter. Initialize it
    EventEmitter.call(this);

    this.id = socketPipeId;
    socketPipeId += 1;

    this.targetHost = targetHost;
    this.targetPort = targetPort;
    this.relayHost = relayHost;
    this.relayPort = relayPort;
    this.options = options;

    this.targetSocket = undefined;
    this.targetSocketPending = true;
    this.buffer = [];

    if (!this.options.silent) {
      console.log(`[relay:${this.id}] Created new pending SocketPipe.`);
    }

    this._openRelayEnd();

  }

  _openRelayEnd() {

    // Use TLS?
    if (this.options.relayTls) {

      if (!this.options.silent) {
        console.log(`[relay:${this.id}] Socket pipe will use TLS connection to connect to relay server.`);
      }

      const tlsOptions = {
        rejectUnauthorized: this.options.relayVerifyCert,
        key: this.options.relayClientKey,
        cert: this.options.relayClientCert,
      };

      const caCert = (
        this.options.relayCaCert ? fs.readFileSync(this.options.relayCaCert, 'utf8') : undefined
      );

      if (caCert) {
        tlsOptions.ca = caCert;
        if (!this.options.silent) {
          console.log(`[relay:${this.id}] Using inutted CA certificate (${this.options.relayCaCert}).`);
        }
      }

      this.relaySocket =
        tls.connect(
          this.relayPort,
          this.relayHost,
          tlsOptions,
          () => {
            if (!this.options.silent) {
              console.log(`[relay:${this.id}] Created new TLS connection.`);
            }

            // Configure socket for keeping connections alive
            this.relaySocket.setKeepAlive(true, 120 * 1000);
            if (this.options.relayTimeout) {
              this.relaySocket.setTimeout(this.options.relayTimeout);
            }

            this._requestAuthorization();
          },
        );

    } else {

      if (!this.options.silent) {
        console.log(`[relay:${this.id}] Socket pipe will TCP connection to connect to relay server.`);
      }

      // Or use TCP
      this.relaySocket = new net.Socket();

      this.relaySocket.connect(
        this.relayPort,
        this.relayHost,
        () => {
          if (!this.options.silent) {
            console.log(`[relay:${this.id}] Created new TCP connection.`);
          }

          // Configure socket for keeping connections alive
          this.relaySocket.setKeepAlive(true, 120 * 1000);
          if (this.options.relayTimeout) {
            this.relaySocket.setTimeout(this.options.relayTimeout);
          }

          this._requestAuthorization();

        },
      );

    }

    // We have a relay socket - now register its handlers

    // On data
    this.relaySocket.on(
      'data',
      (data) => {

        // Got data - do we have a target socket?
        if (this.targetSocket === undefined) {

          // Create a target socket for the relay socket - connecting to the target
          this._openTargetEnd();

          this.emit('pair');
        }

        // Is the target socket still connecting? If so, are we buffering data?
        if (this.targetSocketPending) {

          // Store the data until we have a target socket
          this.buffer[this.buffer.length] = data;

        } else {

          try {
            // Or just pass it directly
            this.targetSocket.write(data);
          } catch (ex) {
            console.error(`[relay:${this.id}] Error writing to target socket: `, ex);
          }

        }
      },
    );

    // On closing
    this.relaySocket.on(
      'close',
      (hadError) => {

        if (hadError) {
          console.error(`[relay:${this.id}] Relay socket closed with error.`);
        }

        if (this.targetSocket !== undefined) {

          // Destroy the other socket
          this.targetSocket.destroy();

        } else {

          // Signal we are closing - server closed the connection
          this.emit('close');
        }
      },
    );

    this.relaySocket.on('timeout', () => {

      console.error(`[target:${this.id}] Target socket had timeout after ${this.options.targetTimeout} seconds.`);
      this.terminate();

    });


    this.relaySocket.on('error', (error) => {
      console.error(`[relay:${this.id}] Error with relay socket: `, error);
      this.terminate();
    });

  }

  _requestAuthorization() {

    // Got a secret?
    if (this.options.relaySecret) {
      if (!this.options.silent) {
        console.log(`[relay:${this.id}] Sending authorization to relay server and waiting for incoming data.`);
      }

      try {
        // Write it to the relay!
        this.relaySocket.write(this.options.relaySecret);
      } catch (ex) {
        console.error(`[relay:${this.id}] Error writing to relay socket: `, ex);
      }

    }

  }

  _handleTargetEndConnection() {
    if (!this.options.silent) {
      console.log(`[target:${this.id}] Successfully connected via ${this.options.targetTls ? 'TLS' : 'TCP'} ` +
                  `to target ${this.targetHost}:${this.targetPort}.`);
    }

    // Configure socket for keeping connections alive
    this.targetSocket.setKeepAlive(true, 120 * 1000);
    if (this.options.targetTimeout) {
      this.targetSocket.setTimeout(this.options.targetTimeout);
    }

    // Connected, not pending anymore
    this.targetSocketPending = false;

    // And if we have any buffered data, forward it
    try {
      for (const bufferItem of this.buffer) {
        this.targetSocket.write(bufferItem);
      }
    } catch (ex) {
      console.error(`[target:${this.id}] Error writing to target socket: `, ex);
    }

    // Clear the array
    this.buffer.length = 0;
  }

  _openTargetEnd() {

    if (!this.options.silent) {
      console.log(`[relay:${this.id}] Authorized by relay server. Creating new connection ` +
                  `to target ${this.targetHost}:${this.targetPort}...`);
    }

    // Use TLS?
    if (this.options.targetTls) {

      if (!this.options.silent) {
        console.log(`[target:${this.id}] Socket pipe will use TLS connection to connect to target server.`);
      }

      this.targetSocket =
        tls.connect(
          this.targetPort,
          this.targetHost,
          {
            ca: (
              this.options.targetCaCert ? fs.readFileSync(this.options.targetCaCert, 'utf8') : undefined
            ),
            rejectUnauthorized: this.options.targetVerifyCert,
          },
          () => {
            this._handleTargetEndConnection();
          },
        );

    } else {

      if (!this.options.silent) {
        console.log(`[target:${this.id}] Socket pipe will TCP connection to connect to target server.`);
      }

      // Or use TCP
      this.targetSocket = new net.Socket();

      this.targetSocket.connect(
        this.targetPort,
        this.targetHost,
        () => {
          this._handleTargetEndConnection();
        },
      );
    }

    // Got data from the target socket?
    this.targetSocket.on('data', (data) => {

      try {
        // Forward it!
        this.relaySocket.write(data);
      } catch (ex) {
        console.error(`target:${this.id}] Error writing to target socket: `, ex);
      }

    });

    this.targetSocket.on('timeout', () => {

      console.error(`[target:${this.id}] Target socket had timeout after ${this.options.targetTimeout} seconds.`);
      this.terminate();

    });

    this.targetSocket.on('error', (hadError) => {

      if (hadError) {
        console.error(`[target:${this.id}] Target socket was closed with error: `, hadError);
      }

      this.terminate();
    });

  }

  terminate() {

    if (!this.options.silent) {
      console.log(`[relay:${this.id}] Terminating socket pipe...`);
    }

    this.removeAllListeners();
    this.relaySocket.destroy();
  }
}

util.inherits(SocketPipe, EventEmitter);


class NATTraversalClient {

  constructor(targetHost, targetPort, relayHost, relayPort, options = {
    targetTls: false,
    targetVerifyCert: true,
    targetCaCert: null,
    targetTimeout: 120000,
    relayTls: true,
    relayVerifyCert: false,
    relayCaCert: null,
    relayClientCert: null,
    relayClientKey: null,
    relaySecret: null,
    relayNumConn: 1,
    relayTimeout: 120000,
    silent: false,
  }) {

    this.targetHost = targetHost;
    this.targetPort = targetPort;
    this.relayHost = relayHost;
    this.relayPort = relayPort;
    this.options = options;

    this.socketPipes = [];
  }

  start() {
    // Create pending socketPipes
    for (let i = 0; i < this.options.relayNumConn; i += 1) {
      this._createSocketPipe(this.targetHost, this.targetPort, this.relayHost, this.relayPort, this.options);
    }
  }

  terminate() {
    this.terminating = true;
    for (const socketPipe of this.socketPipes) {
      socketPipe.terminate();
    }
  }

  _createSocketPipe(targetHost, targetPort, relayHost, relayPort, options) {

    // Create a new socketPipe
    const socketPipe = new SocketPipe(targetHost, targetPort, relayHost, relayPort, options);
    this.socketPipes.push(socketPipe);

    socketPipe.on(
      'pair',
      () => {

        // Create a new pending socketPipe
        this._createSocketPipe(targetHost, targetPort, relayHost, relayPort, options);
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
            this._createSocketPipe(targetHost, targetPort, relayHost, relayPort, options);
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

}

module.exports = {
  NATTraversalClient,
};
