#!/usr/bin/env node
/**
 * 200 人可视压测：入场 → 等你打开大屏 → 自动开局狂点。
 *   node scripts/demo-200.js
 *   node scripts/demo-200.js --wait 20 --count 200
 *   node scripts/demo-200.js --base https://yaoyiyaoweb-production.up.railway.app --count 200 --wait 25
 */
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { performance } = require('perf_hooks');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    base: 'http://127.0.0.1:8780',
    host: '',
    port: 0,
    count: 200,
    wait: 20,
    joinConcurrency: 25,
  };
  for (let i = 0; i < args.length; i++) {
    const k = args[i];
    const v = args[i + 1];
    if (k === '--base') out.base = v;
    if (k === '--host') out.host = v;
    if (k === '--port') out.port = Number(v);
    if (k === '--count') out.count = Number(v);
    if (k === '--wait') out.wait = Number(v);
    if (k === '--join-concurrency') out.joinConcurrency = Number(v);
  }
  if (out.host) {
    const port = out.port || 8780;
    out.base = `http://${out.host}:${port}`;
  }
  return out;
}

function resolveTarget(base) {
  const u = new URL(base);
  const isHttps = u.protocol === 'https:';
  return {
    base: `${u.protocol}//${u.host}`,
    host: u.hostname,
    port: u.port ? Number(u.port) : isHttps ? 443 : 80,
    isHttps,
  };
}

function wsConnect(target) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const lib = target.isHttps ? https : http;
    const req = lib.request({
      host: target.host,
      port: target.port,
      path: '/ws',
      headers: {
        Host: target.host,
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': key,
      },
    });
    req.setTimeout(15000, () => {
      req.destroy(new Error('ws connect timeout'));
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
          const masked = (buf[1] & 0x80) !== 0;
          let len = buf[1] & 0x7f;
          let off = 2;
          if (len === 126) {
            if (buf.length < 4) return;
            len = buf.readUInt16BE(2);
            off = 4;
          } else if (len === 127) {
            return;
          }
          const maskLen = masked ? 4 : 0;
          if (buf.length < off + maskLen + len) return;
          let payload = buf.subarray(off + maskLen, off + maskLen + len);
          if (masked) {
            const m = buf.subarray(off, off + 4);
            const unmasked = Buffer.alloc(len);
            for (let i = 0; i < len; i++) unmasked[i] = payload[i] ^ m[i % 4];
            payload = unmasked;
          }
          buf = buf.subarray(off + maskLen + len);
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

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  const n = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: n }, () => runner()));
  return results;
}

async function main() {
  const opt = parseArgs();
  const target = resolveTarget(opt.base);
  const t0 = performance.now();

  console.log('');
  console.log('=== 幸运多一点 · 200 人公网/本机压测 ===');
  console.log(`目标: ${target.base}  (${target.isHttps ? 'HTTPS/WSS' : 'HTTP/WS'})`);
  console.log(`人数: ${opt.count}  开局前等待: ${opt.wait}s  入场并发: ${opt.joinConcurrency}`);

  const screen = await wsConnect(target);
  const roomId = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('create_screen timeout')), 12000);
    screen.onJson((msg) => {
      if (msg.roomId && (msg.type === 'screen_ready' || msg.type === 'state')) {
        clearTimeout(t);
        resolve(msg.roomId);
      }
    });
    screen.send({ type: 'create_screen' });
  });

  const url = `${target.base}/screen?room=${roomId}`;
  console.log('');
  console.log(`房间: ${roomId}`);
  console.log(`请立刻打开大屏: ${url}`);
  console.log('');
  console.log(`正在灌入 ${opt.count} 人…`);

  const ids = Array.from({ length: opt.count }, (_, i) => i + 1);
  let joined = 0;
  let joinFail = 0;
  const joinStart = performance.now();
  const clients = await mapPool(ids, opt.joinConcurrency, async (i) => {
    try {
      const c = await wsConnect(target);
      c.send({
        type: 'join_player',
        roomId,
        nickname: `嘉宾${String(i).padStart(3, '0')}`,
      });
      joined += 1;
      if (joined % 50 === 0 || joined === opt.count) {
        console.log(`  已入场 ${joined}/${opt.count}` + (joinFail ? `（失败 ${joinFail}）` : ''));
      }
      return c;
    } catch (err) {
      joinFail += 1;
      console.warn(`  入场失败 #${i}: ${err.message || err}`);
      return null;
    }
  });
  const live = clients.filter(Boolean);
  const joinMs = performance.now() - joinStart;
  console.log(
    `入场完成：成功 ${live.length} / 失败 ${joinFail} · 耗时 ${(joinMs / 1000).toFixed(1)}s`
  );
  console.log(`等待 ${opt.wait} 秒给你看名单，然后自动开局狂点…`);
  await sleep(opt.wait * 1000);

  // 点击上传率：发出 / ACK 入账 / 限流丢弃 / 服务端 totalShakes
  const stats = {
    sent: 0,
    sendErr: 0,
    ackOk: 0,
    ackRateLimited: 0,
    ackOther: 0,
    errors: 0,
    serverTotalShakes: 0,
    serverPhase: '',
    lastServerAt: 0,
  };

  screen.onJson((msg) => {
    if (msg.type === 'state' && typeof msg.totalShakes === 'number') {
      stats.serverTotalShakes = msg.totalShakes;
      stats.serverPhase = msg.phase || stats.serverPhase;
      stats.lastServerAt = Date.now();
    }
  });

  for (const c of live) {
    c.onJson((msg) => {
      if (msg.type === 'shaken') {
        if (msg.rateLimited) stats.ackRateLimited += 1;
        else stats.ackOk += 1;
      } else if (msg.type === 'error') {
        stats.errors += 1;
      }
    });
  }

  console.log('开局！');
  screen.send({ type: 'host', action: 'start' });
  await sleep(4500);

  const stopFlags = live.map(() => false);
  const loops = live.map((c, idx) => {
    const baseRps = 2 + Math.random() * 12;
    const burstBias = Math.random();
    const tick = () => {
      if (stopFlags[idx]) return;
      try {
        c.send({ type: 'shake' });
        stats.sent += 1;
      } catch {
        stats.sendErr += 1;
      }
      let delay = 1000 / (baseRps * (0.55 + burstBias * 0.7));
      delay *= 0.65 + Math.random() * 0.9;
      if (Math.random() < 0.08) delay += 120 + Math.random() * 280;
      setTimeout(tick, Math.max(45, Math.floor(delay)));
    };
    setTimeout(tick, Math.floor(Math.random() * 400));
    return () => {
      stopFlags[idx] = true;
    };
  });

  console.log('狂点中（每人随机速度）…统计上传 ACK / 服务端入账');
  await sleep(17000);
  loops.forEach((stop) => stop());

  // 再等一会儿收齐 ACK + 最终 state
  await sleep(2000);
  const totalSec = ((performance.now() - t0) / 1000).toFixed(1);
  const ackTotal = stats.ackOk + stats.ackRateLimited;
  const uploadRate = stats.sent > 0 ? ((stats.ackOk / stats.sent) * 100).toFixed(2) : '0.00';
  const ackRate = stats.sent > 0 ? ((ackTotal / stats.sent) * 100).toFixed(2) : '0.00';
  const serverRate =
    stats.sent > 0 ? ((stats.serverTotalShakes / stats.sent) * 100).toFixed(2) : '0.00';

  console.log('');
  console.log('--- 点击上传统计 ---');
  console.log(`客户端发出:     ${stats.sent}` + (stats.sendErr ? `（写失败 ${stats.sendErr}）` : ''));
  console.log(`ACK 入账:       ${stats.ackOk}`);
  console.log(`ACK 限流丢弃:   ${stats.ackRateLimited}（服务端上限 15 次/秒/人）`);
  console.log(`错误回包:       ${stats.errors}`);
  console.log(`服务端 totalShakes: ${stats.serverTotalShakes}（phase=${stats.serverPhase || '-'}）`);
  console.log(`入账率(ACK成功/发出):     ${uploadRate}%`);
  console.log(`回包率(ACK总数/发出):     ${ackRate}%`);
  console.log(`服务端入账率(total/发出): ${serverRate}%`);

  console.log('');
  console.log('等待揭晓…连接保持 25 秒后退出');
  await sleep(25000);

  // 揭晓后再读一次服务端总分（若有）
  if (stats.serverTotalShakes > 0) {
    const finalServerRate =
      stats.sent > 0 ? ((stats.serverTotalShakes / stats.sent) * 100).toFixed(2) : '0.00';
    console.log(`结束时服务端 totalShakes: ${stats.serverTotalShakes}（入账率 ${finalServerRate}%）`);
  }

  live.forEach((c) => c.close());
  screen.close();
  console.log('');
  console.log('=== 压测结束 ===');
  console.log(
    `总耗时 ${totalSec}s · 入场 ${live.length}/${opt.count} · 发出 ${stats.sent} · 入账 ${stats.ackOk}（${uploadRate}%）`
  );
  console.log(`大屏: ${url}`);
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
