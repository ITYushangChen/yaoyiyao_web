const http = require('http');
const fs = require('fs');
const path = require('path');
const { upgrade } = require('./lib/ws');
const { RoomManager } = require('./lib/room');
const { getPrizeConfig, getLanSettings, setLanUrl, getScreenSettings, getWechatSettings } = require('./lib/db');
const {
  getPublicConfig: getWechatPublicConfig,
  buildAuthorizeUrl,
  consumeOAuthState,
  exchangeCodeForUser,
  isWechatConfigured,
} = require('./lib/wechat');

const PORT = Number(process.env.PORT) || 8780;
const PUBLIC_DIR = path.join(__dirname, 'public');
const rooms = new RoomManager();

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
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function getAccessInfo() {
  const lan = getLanSettings(PORT);
  return {
    mode: 'lan',
    port: PORT,
    baseUrl: lan.baseUrl || null,
    lanUrls: lan.lanUrls,
    source: lan.source,
    usable: lan.usable,
    config: getPrizeConfig(),
    screenSettings: getScreenSettings(),
    wechat: getWechatPublicConfig(),
    hint: lan.usable
      ? `局域网地址：${lan.baseUrl}（手机需连接同一 WiFi）`
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

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function parseQuery(url) {
  const q = (url || '').split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/screen') urlPath = '/screen/index.html';
  if (urlPath === '/m' || urlPath === '/mobile') urlPath = '/mobile/index.html';
  if (urlPath === '/preview') urlPath = '/preview/index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, urlPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
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
  const lan = getLanSettings(PORT);
  return {
    mode: 'lan',
    baseUrl: lan.baseUrl || null,
    lanUrls: lan.lanUrls,
    usable: lan.usable,
    source: lan.source,
  };
}

function onSocket(ws) {
  ws.onMessage = (msg) => {
    if (!msg || typeof msg !== 'object') return;
    const type = msg.type;

    if (type === 'create_screen') {
      const room = rooms.createRoom();
      room.addScreen(ws);
      ws.send({
        type: 'screen_ready',
        roomId: room.id,
        config: room.config,
        screenSettings: getScreenSettings(),
        wechat: getWechatPublicConfig(),
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
      ws.send({ type: 'lan_info', ...lanPayload(), wechat: getWechatPublicConfig() });
      return;
    }

    if (type === 'join_player') {
      const room = rooms.get(msg.roomId);
      if (!room) {
        ws.send({ type: 'error', message: '房间不存在或已结束' });
        return;
      }
      room.addPlayer(ws, msg.nickname, {
        openId: msg.openId || '',
        fromWechat: !!msg.fromWechat,
      });
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

const server = http.createServer(async (req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  const query = parseQuery(req.url);

  if (urlPath === '/api/health') {
    sendJson(res, 200, { ok: true, mode: 'lan' });
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

  if (urlPath === '/api/wechat/config') {
    sendJson(res, 200, getWechatPublicConfig());
    return;
  }

  if (urlPath === '/api/wechat/oauth') {
    const roomId = query.room || '';
    const result = buildAuthorizeUrl(roomId);
    if (!result.ok) {
      sendJson(res, 400, result);
      return;
    }
    redirect(res, result.url);
    return;
  }

  if (urlPath === '/api/wechat/callback') {
    const code = query.code || '';
    const state = query.state || '';
    const pending = consumeOAuthState(state);
    const roomId = pending ? pending.roomId : '';
    const backBase = getWechatSettings().oauthBaseUrl || '';

    const failRedirect = (message) => {
      const q = new URLSearchParams({
        room: roomId,
        wx_error: message || '微信授权失败',
      });
      redirect(res, `${backBase}/m?${q.toString()}`);
    };

    if (!code) {
      failRedirect('未获得微信授权码');
      return;
    }

    try {
      const user = await exchangeCodeForUser(code);
      if (!user.ok) {
        failRedirect(user.message);
        return;
      }
      const q = new URLSearchParams({
        room: roomId,
        wx_nick: user.nickname,
        wx_openid: user.openId,
      });
      redirect(res, `${backBase}/m?${q.toString()}`);
    } catch {
      failRedirect('微信接口请求失败');
    }
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
});

server.on('upgrade', (req, socket, head) => {
  if ((req.url || '').split('?')[0] !== '/ws') {
    socket.destroy();
    return;
  }
  upgrade(req, socket, head, onSocket);
});

server.listen(PORT, '0.0.0.0', () => {
  const lan = getLanSettings(PORT);
  console.log('');
  console.log('摇一摇抽奖服务已启动（局域网模式）');
  console.log(`  本机大屏: http://127.0.0.1:${PORT}/screen`);
  if (lan.lanUrls.length) {
    for (const base of lan.lanUrls) {
      console.log(`  局域网:   ${base}/screen`);
      console.log(`  手机页:   ${base}/m`);
    }
    console.log(`  二维码将使用: ${lan.baseUrl}`);
  } else {
    console.log('  未自动检测到局域网 IP，请在大屏手动填写');
  }
  if (isWechatConfigured()) {
    console.log('  微信授权: 已启用（扫码后自动使用微信昵称）');
  } else {
    console.log('  微信授权: 未启用（可在 data/wechat.json 配置公众号）');
  }
  console.log('  请让手机连接与电脑相同的 WiFi');
  console.log(`  奖项配置: data/config.json`);
  console.log('');
});
