const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { upgrade } = require('./lib/ws');
const { RoomManager } = require('./lib/room');
const { getPrizeConfig, getLanSettings, setLanUrl, getScreenSettings, normalizeBaseUrl } = require('./lib/db');
const { ensureCerts } = require('./lib/certs');
const { saveRoomsSnapshot, loadRoomsSnapshot } = require('./lib/persist');

const PORT = Number(process.env.PORT) || 8780;
const HTTPS_PORT = Number(process.env.HTTPS_PORT) || PORT + 1;
const ENABLE_HTTPS_FOR_SHAKE = false;
const PUBLIC_DIR = path.join(__dirname, 'public');
const STARTED_AT = Date.now();
const PERSIST_INTERVAL_MS = 2000;

let shuttingDown = false;
let persistTimer = null;
let persistQueued = false;

const rooms = new RoomManager({
  onDirty: () => {
    persistQueued = true;
  },
});

function flushPersist(force = false) {
  if (!force && !persistQueued) return;
  persistQueued = false;
  try {
    saveRoomsSnapshot(rooms.serialize());
  } catch (err) {
    console.error('[persist] save failed:', err.message);
  }
}

persistTimer = setInterval(() => flushPersist(false), PERSIST_INTERVAL_MS);
if (persistTimer.unref) persistTimer.unref();

const restored = rooms.restoreFromSnapshot(loadRoomsSnapshot());
if (restored > 0) {
  console.log(`[persist] restored ${restored} room(s) from snapshot`);
}

let httpsReady = false;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function resolvePublicBaseUrl() {
  const fromEnv = normalizeBaseUrl(
    process.env.PUBLIC_URL || process.env.BASE_URL || process.env.LAN_URL || ''
  );
  if (fromEnv) return fromEnv;
  const railwayDomain =
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    process.env.RAILWAY_STATIC_URL ||
    '';
  if (railwayDomain) {
    const host = String(railwayDomain)
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/$/, '');
    if (host) return normalizeBaseUrl(`https://${host}`);
  }
  return '';
}

function getAccessInfo() {
  const cloudUrl = resolvePublicBaseUrl();
  if (cloudUrl) {
    const isHttps = cloudUrl.startsWith('https:');
    return {
      mode: 'cloud',
      port: PORT,
      httpsPort: null,
      baseUrl: cloudUrl,
      lanUrls: [cloudUrl],
      source: 'env',
      usable: true,
      httpsEnabled: isHttps,
      tapOnly: !ENABLE_HTTPS_FOR_SHAKE,
      preferHttp: false,
      config: getPrizeConfig(),
      screenSettings: getScreenSettings(),
      hint: `公网地址：${cloudUrl}（手机可直接扫码，无需同一 WiFi）`,
    };
  }

  // 点按模式走 HTTP；真摇模式才推本机 HTTPS
  const useHttps = ENABLE_HTTPS_FOR_SHAKE && httpsReady;
  const lan = useHttps
    ? getLanSettings(HTTPS_PORT, { protocol: 'https', forceHttps: true })
    : getLanSettings(PORT, { protocol: 'http', forceHttps: false });
  return {
    mode: 'lan',
    port: PORT,
    httpsPort: useHttps ? HTTPS_PORT : null,
    baseUrl: lan.baseUrl || null,
    lanUrls: lan.lanUrls,
    source: lan.source,
    usable: lan.usable,
    httpsEnabled: useHttps,
    tapOnly: !ENABLE_HTTPS_FOR_SHAKE,
    preferHttp: !useHttps,
    config: getPrizeConfig(),
    screenSettings: getScreenSettings(),
    hint: lan.usable
      ? useHttps
        ? `手机请用 HTTPS 扫码：${lan.baseUrl}（首次需点「继续访问」）`
        : `手机扫码：${lan.baseUrl}（点按计数，HTTP）`
      : '未检测到局域网 IP，请手动填写本机局域网地址。',
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/screen') urlPath = '/screen/index.html';
  if (urlPath === '/m' || urlPath === '/mobile') urlPath = '/mobile/index.html';
  if (urlPath === '/preview') urlPath = '/preview/index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  const publicRoot = path.normalize(PUBLIC_DIR + path.sep);
  if (filePath !== path.normalize(PUBLIC_DIR) && !filePath.startsWith(publicRoot)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}

function handleHostAction(room, action) {
  if (action === 'start') return room.start();
  if (action === 'lock') return room.lock();
  if (action === 'reveal_next' || action === 'start_countdown') return room.startRevealCountdown();
  if (action === 'reveal_tier_done') return room.finishRevealTier();
  if (action === 'reset') return room.resetAll();
  return { ok: false, message: '未知操作' };
}

function lanPayload() {
  const info = getAccessInfo();
  return {
    mode: info.mode,
    baseUrl: info.baseUrl || null,
    lanUrls: info.lanUrls,
    usable: info.usable,
    source: info.source,
    httpsEnabled: info.httpsEnabled,
    httpsPort: info.httpsPort,
    tapOnly: info.tapOnly,
    preferHttp: !!info.preferHttp,
  };
}

function onSocket(ws) {
  ws.onMessage = (msg) => {
    if (!msg || typeof msg !== 'object') return;
    if (shuttingDown && (msg.type === 'create_screen')) {
      ws.send({ type: 'error', message: '服务正在重启，请稍后重试' });
      return;
    }
    const type = msg.type;

    if (type === 'create_screen') {
      const room = rooms.createRoom();
      room.addScreen(ws);
      ws.send({
        type: 'screen_ready',
        roomId: room.id,
        config: room.config,
        screenSettings: getScreenSettings(),
        ...lanPayload(),
      });
      return;
    }

    if (type === 'join_screen') {
      const room = rooms.get(msg.roomId);
      if (!room) {
        ws.send({ type: 'error', message: '房间不存在' });
        return;
      }
      room.addScreen(ws);
      ws.send({ type: 'lan_info', ...lanPayload() });
      return;
    }

    if (type === 'join_player') {
      const room = rooms.get(msg.roomId);
      if (!room) {
        ws.send({ type: 'error', message: '房间不存在或已结束' });
        return;
      }
      room.addPlayer(ws, msg.nickname);
      return;
    }

    if (type === 'sync') {
      const room = rooms.get(ws.roomId || msg.roomId);
      if (!room) {
        ws.send({ type: 'error', message: '房间不存在' });
        return;
      }
      if (ws.role === 'screen') {
        room.addScreen(ws);
        ws.send({ type: 'lan_info', ...lanPayload() });
        return;
      }
      if (ws.role === 'player') {
        const player = room.players.get(ws.playerId);
        if (player) room.sendPlayerFullSync(player);
        return;
      }
      return;
    }

    if (type === 'host') {
      const room = rooms.get(ws.roomId);
      if (!room || ws.role !== 'screen') {
        ws.send({ type: 'error', message: '无主持权限' });
        return;
      }
      const result = handleHostAction(room, msg.action);
      if (!result.ok) {
        ws.send({ type: 'error', message: result.message || '操作失败' });
      }
      return;
    }

    if (type === 'shake') {
      const room = rooms.get(ws.roomId);
      if (!room || ws.role !== 'player') {
        ws.send({ type: 'error', message: '请先加入房间' });
        return;
      }
      room.shake(ws);
    }
  };

  ws.onClose = () => {
    const room = rooms.get(ws.roomId);
    if (!room) return;
    if (ws.role === 'screen') room.removeScreen(ws);
    if (ws.role === 'player') room.removePlayer(ws);
  };
}

async function handleRequest(req, res) {
  const urlPath = (req.url || '/').split('?')[0];

  if (urlPath === '/api/health' || urlPath === '/health') {
    const access = getAccessInfo();
    const stats = rooms.stats();
    sendJson(res, 200, {
      ok: !shuttingDown,
      shuttingDown,
      mode: access.mode,
      httpsEnabled: access.httpsEnabled,
      httpsPort: access.httpsPort,
      baseUrl: access.baseUrl || null,
      uptimeMs: Date.now() - STARTED_AT,
      rooms: stats.rooms,
      players: stats.players,
      screens: stats.screens,
      serverNow: Date.now(),
    });
    return;
  }

  if (urlPath === '/api/config') {
    sendJson(res, 200, getPrizeConfig());
    return;
  }

  if (urlPath === '/api/screen-settings') {
    sendJson(res, 200, getScreenSettings());
    return;
  }

  if (urlPath === '/api/meta') {
    sendJson(res, 200, getAccessInfo());
    return;
  }

  if (urlPath === '/api/lan-url') {
    if (req.method === 'GET') {
      sendJson(res, 200, getAccessInfo());
      return;
    }
    if (req.method === 'POST') {
      try {
        const body = await readBody(req);
        const result = setLanUrl(body.baseUrl || body.url || body.lanUrl || '');
        if (!result.ok) {
          sendJson(res, 400, result);
          return;
        }
        sendJson(res, 200, { ...result, ...getAccessInfo() });
      } catch {
        sendJson(res, 400, { ok: false, message: '请求体必须是 JSON' });
      }
      return;
    }
    res.writeHead(405);
    res.end('Method Not Allowed');
    return;
  }

  // 兼容旧接口名
  if (urlPath === '/api/public-url') {
    if (req.method === 'GET') {
      sendJson(res, 200, getAccessInfo());
      return;
    }
    if (req.method === 'POST') {
      try {
        const body = await readBody(req);
        const result = setLanUrl(body.publicUrl || body.baseUrl || body.url || '');
        if (!result.ok) {
          sendJson(res, 400, result);
          return;
        }
        sendJson(res, 200, { ...result, publicUrl: result.baseUrl, ...getAccessInfo() });
      } catch {
        sendJson(res, 400, { ok: false, message: '请求体必须是 JSON' });
      }
      return;
    }
  }

  serveStatic(req, res);
}

function attachUpgrade(server) {
  server.on('upgrade', (req, socket, head) => {
    if ((req.url || '').split('?')[0] !== '/ws') {
      socket.destroy();
      return;
    }
    upgrade(req, socket, head, onSocket);
  });
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch(() => {
    res.writeHead(500);
    res.end('Internal Error');
  });
});
attachUpgrade(server);

const certs = ENABLE_HTTPS_FOR_SHAKE ? ensureCerts() : { ok: false };
let httpsServer = null;
if (certs.ok) {
  httpsReady = true;
  httpsServer = https.createServer({ key: certs.key, cert: certs.cert }, (req, res) => {
    handleRequest(req, res).catch(() => {
      res.writeHead(500);
      res.end('Internal Error');
    });
  });
  attachUpgrade(httpsServer);
}

server.listen(PORT, '0.0.0.0', () => {
  const access = getAccessInfo();
  console.log('');
  if (access.mode === 'cloud') {
    console.log('摇一摇抽奖服务已启动（公网 / Railway）');
    console.log(`  大屏: ${access.baseUrl}/screen`);
    console.log(`  手机: 扫大屏二维码（${access.baseUrl}）`);
  } else {
    console.log('摇一摇抽奖服务已启动（局域网模式）');
    console.log(`  本机大屏(HTTP): http://127.0.0.1:${PORT}/screen`);
    if (access.httpsEnabled) {
      console.log(`  手机扫码(HTTPS): 端口 ${HTTPS_PORT}（传感器需要 https）`);
      console.log('  手机首次打开会提示证书不安全 → 点「高级/继续访问」即可');
    } else {
      console.log('  玩法：点按计数（HTTP，无证书警告）');
    }
  }
  if (access.lanUrls && access.lanUrls.length) {
    for (const base of access.lanUrls) {
      console.log(`  手机页:   ${base}/m`);
    }
    console.log(`  二维码将使用: ${access.baseUrl}`);
  } else if (access.mode !== 'cloud') {
    console.log('  未自动检测到局域网 IP，请在大屏手动填写');
  }
  if (access.mode === 'lan') {
    console.log('  请让手机连接与电脑相同的 WiFi');
  }
  console.log(`  奖项配置: data/config.json`);
  console.log('');
});

if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
    console.log(`  HTTPS 已监听: 0.0.0.0:${HTTPS_PORT}`);
  });
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] received ${signal}, saving rooms…`);
  try {
    flushPersist(true);
  } catch (err) {
    console.error('[shutdown] persist failed:', err.message);
  }
  const closeServer = (srv) =>
    new Promise((resolve) => {
      if (!srv) return resolve();
      srv.close(() => resolve());
      setTimeout(resolve, 3000);
    });
  Promise.all([closeServer(server), closeServer(httpsServer)]).then(() => {
    console.log('[shutdown] bye');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
