const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const RESULTS_PATH = path.join(DATA_DIR, 'results.json');
const LAN_PATH = path.join(DATA_DIR, 'lan.json');
const SCREEN_PATH = path.join(DATA_DIR, 'screen.json');

const DEFAULT_CONFIG = {
  liveTopCount: 20,
  finalTopCount: 5,
  energyBarMax: 200,
  /** 单房间最多入场人数（含已断开但仍占座的选手） */
  maxPlayers: 220,
};

const DEFAULT_LAN = {
  mode: 'lan',
  baseUrl: '',
};

const DEFAULT_SCREEN = {
  backgroundDefault: '',
  backgroundReveal: '',
  backgroundDone: '',
  musicDefault: '/assets/audio/waiting.wav',
  musicReveal: '/assets/audio/drumroll.wav',
  musicDone: '/assets/audio/celebrate.wav',
  countdownSeconds: 15,
  urgencySeconds: 5,
};

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return structuredClone(fallback);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return structuredClone(fallback);
  }
}

function writeJson(filePath, data) {
  ensureDataDir();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function normalizeBaseUrl(input) {
  const raw = String(input || '')
    .trim()
    .replace(/\/$/, '');
  if (!raw) return '';
  try {
    const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

function isLoopbackHost(hostname) {
  const host = String(hostname || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
}

/** 可用于手机扫码的局域网地址：允许 http + 内网 IP，禁止 127.0.0.1 */
function isUsableLanUrl(url) {
  const normalized = normalizeBaseUrl(url);
  if (!normalized) return false;
  try {
    const u = new URL(normalized);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (isLoopbackHost(u.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

function detectLanAddresses(port, protocol = 'http') {
  const list = [];
  const proto = protocol === 'https' ? 'https' : 'http';
  let nets;
  try {
    nets = os.networkInterfaces();
  } catch {
    return list;
  }
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      // Node 旧版 family 为数字 4/6，新版多为 'IPv4'/'IPv6'
      const isV4 = net.family === 'IPv4' || net.family === 4;
      if (isV4 && !net.internal) {
        list.push(`${proto}://${net.address}:${port}`);
      }
    }
  }
  return list;
}

function getPrizeConfig() {
  ensureDataDir();
  if (!fs.existsSync(CONFIG_PATH)) {
    writeJson(CONFIG_PATH, DEFAULT_CONFIG);
  }
  const cfg = readJson(CONFIG_PATH, DEFAULT_CONFIG);
  const liveTop = Number(cfg.liveTopCount);
  const finalTop = Number(cfg.finalTopCount);
  const energyMax = Number(cfg.energyBarMax);
  const maxPlayers = Number(cfg.maxPlayers);
  return {
    liveTopCount: liveTop > 0 ? liveTop : DEFAULT_CONFIG.liveTopCount,
    finalTopCount: finalTop > 0 ? finalTop : DEFAULT_CONFIG.finalTopCount,
    energyBarMax: energyMax > 0 ? energyMax : DEFAULT_CONFIG.energyBarMax,
    maxPlayers:
      maxPlayers >= 10 && maxPlayers <= 2000
        ? Math.floor(maxPlayers)
        : DEFAULT_CONFIG.maxPlayers,
  };
}

function getLanSettings(port, options = {}) {
  ensureDataDir();
  if (!fs.existsSync(LAN_PATH)) {
    writeJson(LAN_PATH, DEFAULT_LAN);
  }
  const cfg = readJson(LAN_PATH, DEFAULT_LAN);
  const protocol = options.protocol === 'https' ? 'https' : 'http';
  const detected = detectLanAddresses(port, protocol);
  const fromEnv = normalizeBaseUrl(process.env.LAN_URL || process.env.BASE_URL || '');
  let fromFile = normalizeBaseUrl(cfg.baseUrl);

  // 若启用了 HTTPS 手机口，自动把已保存的 http 局域网地址升到 https
  if (options.forceHttps && fromFile) {
    try {
      const u = new URL(fromFile);
      if (!isLoopbackHost(u.hostname)) {
        u.protocol = 'https:';
        u.port = String(port);
        fromFile = normalizeBaseUrl(u.toString());
      }
    } catch {
      /* ignore */
    }
  } else if (fromFile) {
    // 点按/HTTP 模式：把误存的 https 地址改回 http
    try {
      const u = new URL(fromFile);
      if (!isLoopbackHost(u.hostname)) {
        u.protocol = 'http:';
        u.port = String(port);
        fromFile = normalizeBaseUrl(u.toString());
      }
    } catch {
      /* ignore */
    }
  }

  const preferred = fromEnv || fromFile || detected[0] || '';
  return {
    mode: 'lan',
    baseUrl: preferred,
    lanUrls: detected,
    protocol,
    httpsEnabled: !!options.forceHttps,
    source: fromEnv ? 'env' : fromFile ? 'file' : detected[0] ? 'auto' : 'none',
    usable: isUsableLanUrl(preferred),
  };
}

function setLanUrl(url) {
  const normalized = normalizeBaseUrl(url);
  if (!normalized) {
    return { ok: false, message: '请填写有效地址，例如 http://192.168.1.8:8780' };
  }
  let host;
  try {
    host = new URL(normalized).hostname;
  } catch {
    return { ok: false, message: '地址格式不正确' };
  }
  if (isLoopbackHost(host)) {
    return { ok: false, message: '不能用 127.0.0.1，手机扫不到。请用本机局域网 IP' };
  }

  ensureDataDir();
  const current = readJson(LAN_PATH, DEFAULT_LAN);
  writeJson(LAN_PATH, {
    ...current,
    mode: 'lan',
    baseUrl: normalized,
    updatedAt: Date.now(),
  });

  return {
    ok: true,
    baseUrl: normalized,
    usable: true,
    source: 'file',
  };
}

function getScreenSettings() {
  ensureDataDir();
  if (!fs.existsSync(SCREEN_PATH)) {
    writeJson(SCREEN_PATH, DEFAULT_SCREEN);
  }
  const cfg = readJson(SCREEN_PATH, DEFAULT_SCREEN);
  const sec = Number(cfg.countdownSeconds);
  const urgency = Number(cfg.urgencySeconds);
  return {
    backgroundDefault: String(cfg.backgroundDefault || '').trim(),
    backgroundReveal: String(cfg.backgroundReveal || '').trim(),
    backgroundDone: String(cfg.backgroundDone || '').trim(),
    musicDefault: String(cfg.musicDefault || '').trim(),
    musicReveal: String(cfg.musicReveal || '').trim(),
    musicDone: String(cfg.musicDone || '').trim(),
    countdownSeconds: sec >= 5 && sec <= 120 ? sec : DEFAULT_SCREEN.countdownSeconds,
    urgencySeconds:
      urgency >= 1 && urgency <= 30 ? urgency : DEFAULT_SCREEN.urgencySeconds,
  };
}

function saveRoundResult(payload) {
  const list = readJson(RESULTS_PATH, []);
  list.push({
    ...payload,
    savedAt: Date.now(),
  });
  writeJson(RESULTS_PATH, list);
}

module.exports = {
  getPrizeConfig,
  getLanSettings,
  setLanUrl,
  getScreenSettings,
  normalizeBaseUrl,
  isUsableLanUrl,
  detectLanAddresses,
  saveRoundResult,
  DEFAULT_CONFIG,
  DEFAULT_LAN,
  DEFAULT_SCREEN,
};
