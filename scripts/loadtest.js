#!/usr/bin/env node
/**
 * 本地压测：模拟 N 个手机 WebSocket 同时入场并狂点。
 * 用法：
 *   node scripts/loadtest.js
 *   node scripts/loadtest.js --host 127.0.0.1 --port 8780 --clients 200 --seconds 20
 *
 * 先另开终端启动服务：npm start
 * 大屏浏览器打开 /screen 并「开始摇一摇」后，再跑本脚本（或脚本会先 create_screen 再 start）。
 */
const http = require('http');
const crypto = require('crypto');
const { performance } = require('perf_hooks');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { host: '127.0.0.1', port: 8780, clients: 200, seconds: 20, rps: 8 };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    const v = args[i + 1];
    if (k === '--host') out.host = v;
    if (k === '--port') out.port = Number(v);
    if (k === '--clients') out.clients = Number(v);
    if (k === '--seconds') out.seconds = Number(v);
    if (k === '--rps') out.rps = Number(v);
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
    req.on('upgrade', (res, socket) => {
      let buf = Buffer.alloc(0);
      const api = {
        socket,
        send(obj) {
          const payload = Buffer.from(JSON.stringify(obj), 'utf8');
          const h = Buffer.alloc(2);
          h[0] = 0x81;
          h[1] = payload.length;
          // client frames must be masked
          const mask = crypto.randomBytes(4);
          const masked = Buffer.alloc(payload.length);
          for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i % 4];
          const header = Buffer.alloc(6);
          header[0] = 0x81;
          header[1] = 0x80 | payload.length;
          mask.copy(header, 2);
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
      socket.on('data', () => {
        /* drain */
      });
      resolve(api);
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  const opt = parseArgs();
  console.log('压测参数', opt);

  const health = await new Promise((resolve, reject) => {
    http
      .get({ host: opt.host, port: opt.port, path: '/api/health' }, (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve(d));
      })
      .on('error', reject);
  });
  console.log('health', health);

  const screen = await wsConnect(opt.host, opt.port);
  let roomId = null;
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('screen_ready timeout')), 5000);
    screen.socket.on('data', (chunk) => {
      // 极简：从文本里抠 roomId
      const s = chunk.toString('utf8');
      const m = s.match(/"roomId":"(room_[a-f0-9]+)"/);
      if (m) {
        roomId = m[1];
        clearTimeout(t);
        resolve();
      }
    });
    screen.send({ type: 'create_screen' });
  });
  console.log('room', roomId);
  screen.send({ type: 'host', action: 'start' });

  const clients = [];
  const t0 = performance.now();
  for (let i = 0; i < opt.clients; i++) {
    const c = await wsConnect(opt.host, opt.port);
    c.send({ type: 'join_player', roomId, nickname: `压测${i}` });
    clients.push(c);
    if ((i + 1) % 50 === 0) console.log(`已连接 ${i + 1}/${opt.clients}`);
  }
  console.log(`连接完成 ${(performance.now() - t0).toFixed(0)}ms`);

  const interval = Math.max(20, Math.floor(1000 / opt.rps));
  let shakes = 0;
  const endAt = Date.now() + opt.seconds * 1000;
  const timers = clients.map((c, idx) =>
    setInterval(() => {
      if (Date.now() > endAt) return;
      c.send({ type: 'shake' });
      shakes += 1;
    }, interval + (idx % 7))
  );

  await new Promise((r) => setTimeout(r, opt.seconds * 1000 + 500));
  timers.forEach(clearInterval);
  clients.forEach((c) => c.close());
  screen.close();

  console.log('');
  console.log('=== 结果 ===');
  console.log(`客户端: ${opt.clients}`);
  console.log(`持续: ${opt.seconds}s`);
  console.log(`发出 shake 约: ${shakes}`);
  console.log(`平均约 ${(shakes / opt.seconds).toFixed(0)} msg/s`);
  console.log('若过程中服务未崩溃、大屏仍可操作，基本可支撑同场规模。');
  console.log('请在跑压测时另开终端看 CPU：top -pid $(lsof -ti:8780)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
