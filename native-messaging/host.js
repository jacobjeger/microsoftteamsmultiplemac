#!/usr/bin/env node

// TeamsHub Native Messaging Host
// Bridges Chrome extension ↔ TeamsHub Electron app via localhost HTTP API

const http = require('http');

const TEAMSHUB_PORT = 47847;
const TEAMSHUB_URL = `http://127.0.0.1:${TEAMSHUB_PORT}`;

// Read a native messaging message from stdin (length-prefixed JSON)
function readMessage() {
  return new Promise((resolve, reject) => {
    const header = Buffer.alloc(4);
    let bytesRead = 0;

    process.stdin.on('readable', function onReadable() {
      while (bytesRead < 4) {
        const chunk = process.stdin.read(4 - bytesRead);
        if (chunk === null) return;
        chunk.copy(header, bytesRead);
        bytesRead += chunk.length;
      }

      const messageLength = header.readUInt32LE(0);
      if (messageLength === 0) {
        resolve(null);
        return;
      }

      let message = '';
      let msgBytesRead = 0;

      function readBody() {
        const data = process.stdin.read(messageLength - msgBytesRead);
        if (data === null) return;
        message += data.toString('utf8');
        msgBytesRead += data.length;
        if (msgBytesRead >= messageLength) {
          process.stdin.removeListener('readable', onReadable);
          try {
            resolve(JSON.parse(message));
          } catch (e) {
            reject(new Error('Invalid JSON: ' + message));
          }
        }
      }

      readBody();
      if (msgBytesRead < messageLength) {
        process.stdin.on('readable', readBody);
      }
    });
  });
}

// Write a native messaging response to stdout
function writeMessage(message) {
  const json = JSON.stringify(message);
  const buf = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  process.stdout.write(header);
  process.stdout.write(buf);
}

// Make HTTP request to TeamsHub
function httpRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: TEAMSHUB_PORT,
      path: path,
      method: method,
      headers: { 'Content-Type': 'application/json' },
      timeout: 5000,
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ raw: data });
        }
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Main loop
async function main() {
  while (true) {
    try {
      const message = await readMessage();
      if (message === null) break;

      let response;

      switch (message.action) {
        case 'ping':
          response = await httpRequest('GET', '/ping').catch(() => ({ status: 'offline' }));
          break;

        case 'get-accounts':
          response = await httpRequest('GET', '/accounts').catch(() => ({ error: 'TeamsHub not running' }));
          break;

        case 'open-url':
          response = await httpRequest('POST', '/open-url', {
            url: message.url,
            accountId: message.accountId,
          }).catch((err) => ({ error: err.message }));
          break;

        case 'set-domain-mapping':
          response = await httpRequest('POST', '/set-domain-mapping', {
            domain: message.domain,
            accountId: message.accountId,
          }).catch((err) => ({ error: err.message }));
          break;

        case 'get-domain-mappings':
          response = await httpRequest('GET', '/domain-mappings').catch(() => ({ error: 'TeamsHub not running' }));
          break;

        default:
          response = { error: 'Unknown action: ' + message.action };
      }

      writeMessage(response);
    } catch (err) {
      writeMessage({ error: err.message });
    }
  }
}

main().catch((err) => {
  process.stderr.write('TeamsHub host error: ' + err.message + '\n');
  process.exit(1);
});
