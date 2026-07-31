#!/usr/bin/env node
/**
 * 本地灌入 N 个已入场昵称（仅 join，不开始游戏）。
 * 用法：
 *   node scripts/seed-roster.js
 *   node scripts/seed-roster.js --room room_xxx --count 200
 *   node scripts/seed-roster.js --keep   # 保持连接，方便看滚动
 */
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { host: '127.0.0.1', port: 8780, count: 200, room: '', keep: false };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    const v = args[i + 1];
    if (k === '--host') out.host = v;
    if (k === '--port') out.port = Number(v);
    if (k === '--count') out.count = Number(v);
    if (k === '--room') out.room = v;
    if (k === '--keep') out.keep = true;
  }
  return out;
}

function wsConnect(host, port) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host,
      port,
      path: '/ws',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': key,
      },
    });
    req.on('upgrade', (_res, socket) => {
      const api = {
        socket,
        send(obj) {
          const payload = Buffer.from(JSON.stringify(obj), 'utf8');
          const mask = crypto.randomBytes(4);
          const masked = Buffer.alloc(payload.length);
          for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
          let header;
          if (payload.length < 126) {
            header = Buffer.alloc(6);
            header[0] = 0x81;
            header[1] = 0x80 | payload.length;
            mask.copy(header, 2);
          } else {
            header = Buffer.alloc(8);
            header[0] = 0x81;
            header[1] = 0x80 | 126;
            header.writeUInt16BE(payload.length, 2);
            mask.copy(header, 4);
          }
          socket.write(Buffer.concat([header, masked]));
        },
        close() {
          try {
            socket.end();
          } catch {
            /* ignore */
          }
        },
      };
      socket.on('data', () => {});
      socket.on('error', () => {});
      resolve(api);
    });
    req.on('error', reject);
    req.end();
  });
}

function latestRoomFromSnapshot() {
  try {
    const p = path.join(__dirname, '..', 'data', 'rooms-snapshot.json');
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    const rooms = (data.rooms || []).slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const waiting = rooms.find((r) => r.phase === 'waiting') || rooms[0];
    return waiting ? waiting.id : '';
  } catch {
    return '';
  }
}

async function resolveRoom(opt) {
  if (opt.room) return opt.room;
  const fromFile = latestRoomFromSnapshot();
  if (fromFile) return fromFile;

  const screen = await wsConnect(opt.host, opt.port);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('create_screen timeout')), 5000);
    screen.socket.on('data', (chunk) => {
      const m = chunk.toString('utf8').match(/"roomId":"(room_[a-f0-9]+)"/);
      if (m) {
        clearTimeout(t);
        resolve(m[1]);
      }
    });
    screen.send({ type: 'create_screen' });
  });
}

async function main() {
  const opt = parseArgs();
  const roomId = await resolveRoom(opt);
  console.log(`房间 ${roomId}，灌入 ${opt.count} 人…`);

  const clients = [];
  for (let i = 1; i <= opt.count; i++) {
    const c = await wsConnect(opt.host, opt.port);
    c.send({ type: 'join_player', roomId, nickname: `嘉宾${String(i).padStart(3, '0')}` });
    clients.push(c);
    if (i % 50 === 0) console.log(`已加入 ${i}/${opt.count}`);
  }
  console.log(`完成：${clients.length} 人已入场`);

  if (opt.keep) {
    console.log('保持连接中（Ctrl+C 退出）…');
    process.on('SIGINT', () => {
      clients.forEach((c) => c.close());
      process.exit(0);
    });
    await new Promise(() => {});
  } else {
    // 稍等大屏刷新后再断开；若服务端离线即踢人，可用 --keep
    await new Promise((r) => setTimeout(r, 3000));
    clients.forEach((c) => c.close());
    console.log('已断开（若名单瞬间变少，请加 --keep 保持在线）');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
