const crypto = require('crypto');

/**
 * Minimal WebSocket server (RFC6455 text/ping frames) — no npm deps.
 */
const HEARTBEAT_MS = 20000;
const HEARTBEAT_TIMEOUT_MS = 60000;

function acceptKey(secWebSocketKey) {
  return crypto
    .createHash('sha1')
    .update(secWebSocketKey + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

function encodeTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }

  return Buffer.concat([header, payload]);
}

function encodePingFrame(payload = Buffer.alloc(0)) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || ''));
  if (data.length > 125) return encodePingFrame(Buffer.alloc(0));
  const frame = Buffer.alloc(2 + data.length);
  frame[0] = 0x89; // ping, fin
  frame[1] = data.length;
  data.copy(frame, 2);
  return frame;
}

function encodePongFrame(payload = Buffer.alloc(0)) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload || ''));
  if (data.length > 125) return encodePongFrame(Buffer.alloc(0));
  const frame = Buffer.alloc(2 + data.length);
  frame[0] = 0x8a;
  frame[1] = data.length;
  data.copy(frame, 2);
  return frame;
}

function decodeFrames(buffer, onMessage, onClose, onPing, onPong) {
  let offset = 0;
  const messages = [];

  while (offset + 2 <= buffer.length) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let payloadLen = second & 0x7f;
    let headerLen = 2;

    if (payloadLen === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      headerLen = 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buffer.length) break;
      const high = buffer.readUInt32BE(offset + 2);
      const low = buffer.readUInt32BE(offset + 6);
      if (high !== 0) {
        onClose();
        return { rest: Buffer.alloc(0), messages };
      }
      payloadLen = low;
      headerLen = 10;
    }

    const maskLen = masked ? 4 : 0;
    const total = headerLen + maskLen + payloadLen;
    if (offset + total > buffer.length) break;

    let payload = buffer.subarray(offset + headerLen + maskLen, offset + total);
    if (masked) {
      const mask = buffer.subarray(offset + headerLen, offset + headerLen + 4);
      const decoded = Buffer.alloc(payloadLen);
      for (let i = 0; i < payloadLen; i++) {
        decoded[i] = payload[i] ^ mask[i % 4];
      }
      payload = decoded;
    }

    offset += total;

    if (opcode === 0x8) {
      onClose();
      return { rest: Buffer.alloc(0), messages };
    }
    if (opcode === 0x9) {
      onPing(payload);
      continue;
    }
    if (opcode === 0xa) {
      if (onPong) onPong(payload);
      continue;
    }
    if (opcode === 0x1) {
      messages.push(payload.toString('utf8'));
    }
  }

  return { rest: buffer.subarray(offset), messages };
}

function upgrade(req, socket, head, onConnection) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey(key)}`,
    '',
    '',
  ].join('\r\n');

  socket.write(headers);
  if (head && head.length) socket.unshift(head);

  let buffer = Buffer.alloc(0);
  let closed = false;
  let closeNotified = false;
  let lastAlive = Date.now();
  let heartbeatTimer = null;

  const touch = () => {
    lastAlive = Date.now();
  };

  const conn = {
    send: null,
    close: null,
    ping: null,
    isOpen: () => !closed && !socket.destroyed,
    lastAlive: () => lastAlive,
    onMessage: null,
    onClose: null,
  };

  conn.send = (obj) => {
    if (closed || socket.destroyed) return;
    try {
      socket.write(encodeTextFrame(JSON.stringify(obj)));
    } catch {
      /* ignore */
    }
  };

  conn.ping = () => {
    if (closed || socket.destroyed) return;
    try {
      socket.write(encodePingFrame());
    } catch {
      /* ignore */
    }
  };

  const notifyClose = () => {
    if (closeNotified) return;
    closeNotified = true;
    closed = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (conn.onClose) conn.onClose();
  };

  conn.close = () => {
    if (closed) return;
    closed = true;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    try {
      socket.end();
    } catch {
      /* ignore */
    }
  };

  heartbeatTimer = setInterval(() => {
    if (closed || socket.destroyed) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      return;
    }
    if (Date.now() - lastAlive > HEARTBEAT_TIMEOUT_MS) {
      notifyClose();
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      return;
    }
    conn.ping();
  }, HEARTBEAT_MS);
  if (heartbeatTimer.unref) heartbeatTimer.unref();

  socket.on('data', (chunk) => {
    touch();
    buffer = Buffer.concat([buffer, chunk]);
    const { rest, messages } = decodeFrames(
      buffer,
      null,
      () => {
        notifyClose();
        conn.close();
      },
      (payload) => {
        touch();
        if (payload.length > 125) return;
        try {
          socket.write(encodePongFrame(payload));
        } catch {
          /* ignore */
        }
      },
      () => {
        touch();
      }
    );
    buffer = rest;
    for (const text of messages) {
      try {
        const data = JSON.parse(text);
        if (data && data.type === 'ping') {
          touch();
          conn.send({ type: 'pong', serverNow: Date.now() });
          continue;
        }
        if (data && data.type === 'pong') {
          touch();
          continue;
        }
        if (conn.onMessage) conn.onMessage(data);
      } catch {
        /* ignore bad json */
      }
    }
  });

  socket.on('close', () => {
    notifyClose();
  });

  socket.on('error', () => {
    notifyClose();
  });

  onConnection(conn);
}

module.exports = {
  upgrade,
  HEARTBEAT_MS,
  HEARTBEAT_TIMEOUT_MS,
};
