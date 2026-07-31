#!/usr/bin/env node
/**
 * 本机可视演示：200 人入场 → 等你打开大屏 → 自动开局狂点。
 *   node scripts/demo-200.js
 *   node scripts/demo-200.js --wait 20 --count 200
 */
const http = require('http');
const crypto = require('crypto');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { host: '127.0.0.1', port: 8780, count: 200, wait: 15, rps: 6 };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    const v = args[i + 1];
    if (k === '--host') out.host = v;
    if (k === '--port') out.port = Number(v);
    if (k === '--count') out.count = Number(v);
    if (k === '--wait') out.wait = Number(v);
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
    req.on('upgrade', (_res, socket) => {
      let buf = Buffer.alloc(0);
      const listeners = [];
      const api = {
        socket,
        onJson(fn) {
          listeners.push(fn);
        },
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
      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 2) {
          const finOpcode = buf[0];
          const opcode = finOpcode & 0x0f;
          let len = buf[1] & 0x7f;
          let off = 2;
          if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            off = 4;
          } else if (len === 127) {
            return; // ignore huge
          }
          if (buf.length < off + len) return;
          const payload = buf.subarray(off, off + len);
          buf = buf.subarray(off + len);
          if (opcode === 0x1) {
            try {
              const msg = JSON.parse(payload.toString('utf8'));
              for (const fn of listeners) fn(msg);
            } catch {
              /* ignore */
            }
          }
        }
      });
      socket.on('error', () => {});
      resolve(api);
    });
    req.on('error', reject);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const opt = parseArgs();
  console.log('');
  console.log('=== 幸运多一点 · 200 人可视演示 ===');

  const screen = await wsConnect(opt.host, opt.port);
  const roomId = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('create_screen timeout')), 8000);
    screen.onJson((msg) => {
      if (msg.roomId && (msg.type === 'screen_ready' || msg.type === 'state')) {
        clearTimeout(t);
        resolve(msg.roomId);
      }
    });
    screen.send({ type: 'create_screen' });
  });

  const url = `http://${opt.host}:${opt.port}/screen?room=${roomId}`;
  console.log(`房间: ${roomId}`);
  console.log(`请立刻打开大屏: ${url}`);
  console.log(`正在灌入 ${opt.count} 人…`);

  const clients = [];
  for (let i = 1; i <= opt.count; i++) {
    const c = await wsConnect(opt.host, opt.port);
    c.send({
      type: 'join_player',
      roomId,
      nickname: `嘉宾${String(i).padStart(3, '0')}`,
    });
    clients.push(c);
    if (i % 50 === 0) console.log(`  已入场 ${i}/${opt.count}`);
  }
  console.log(`入场完成：${clients.length} 人（右侧名单应开始滚动）`);
  console.log(`等待 ${opt.wait} 秒给你看名单，然后自动开局狂点…`);
  await sleep(opt.wait * 1000);

  console.log('开局！');
  screen.send({ type: 'host', action: 'start' });
  // 等 3·2·1 进 open
  await sleep(4500);

  // 每人随机点击节奏：约 2~14 次/秒，再叠加抖动，避免成绩整齐划一
  let shakes = 0;
  const stopFlags = clients.map(() => false);
  const loops = clients.map((c, idx) => {
    const baseRps = 2 + Math.random() * 12; // 2~14
    const burstBias = Math.random(); // 有人偏猛点、有人偏慢
    const tick = () => {
      if (stopFlags[idx]) return;
      c.send({ type: 'shake' });
      shakes += 1;
      // 间隔：基础节奏 + 随机抖动；偶尔短暂停顿
      let delay = 1000 / (baseRps * (0.55 + burstBias * 0.7));
      delay *= 0.65 + Math.random() * 0.9;
      if (Math.random() < 0.08) delay += 120 + Math.random() * 280;
      setTimeout(tick, Math.max(45, Math.floor(delay)));
    };
    // 错峰起步，避免同一毫秒齐射
    setTimeout(tick, Math.floor(Math.random() * 400));
    return () => {
      stopFlags[idx] = true;
    };
  });

  console.log('狂点中（每人随机速度）…请看大屏 Top 20 / 并列揭晓');
  await sleep(17000);
  loops.forEach((stop) => stop());

  console.log(`本轮发出点击约 ${shakes} 次`);
  console.log('等待揭晓…连接保持 25 秒后退出');
  await sleep(25000);

  clients.forEach((c) => c.close());
  screen.close();
  console.log('演示结束。');
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
