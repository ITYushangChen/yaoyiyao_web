const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const RESULTS_PATH = path.join(DATA_DIR, 'results.json');
const LAN_PATH = path.join(DATA_DIR, 'lan.json');
const SCREEN_PATH = path.join(DATA_DIR, 'screen.json');
const WECHAT_PATH = path.join(DATA_DIR, 'wechat.json');

const DEFAULT_CONFIG = {
  firstPrizeCount: 1,
  firstPrizeName: '一等奖 · 大奖礼盒',
  secondPrizeCount: 3,
  secondPrizeName: '二等奖 · 精美周边',
  thirdPrizeCount: 10,
  thirdPrizeName: '三等奖 · 纪念小礼',
};

const DEFAULT_LAN = {
  mode: 'lan',
  baseUrl: '',
};

const DEFAULT_SCREEN = {
  backgroundDefault: '',
  backgroundReveal: '',
  backgroundDone: '',
  musicDefault: '',
  musicReveal: '',
  musicDone: '',
  countdownSeconds: 10,
};

const DEFAULT_WECHAT = {
  enabled: false,
  appId: '',
  appSecret: '',
  oauthBaseUrl: '',
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

function detectLanAddresses(port) {
  const list = [];
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    if (!entries) continue;
    for (const net of entries) {
      if (net.family === 'IPv4' && !net.internal) {
        list.push(`http://${net.address}:${port}`);
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
  const name = (key, fallback) => {
    const v = String(cfg[key] == null ? '' : cfg[key]).trim();
    return v || fallback;
  };
  return {
    firstPrizeCount: Number(cfg.firstPrizeCount) || DEFAULT_CONFIG.firstPrizeCount,
    firstPrizeName: name('firstPrizeName', DEFAULT_CONFIG.firstPrizeName),
    secondPrizeCount: Number(cfg.secondPrizeCount) || DEFAULT_CONFIG.secondPrizeCount,
    secondPrizeName: name('secondPrizeName', DEFAULT_CONFIG.secondPrizeName),
    thirdPrizeCount: Number(cfg.thirdPrizeCount) || DEFAULT_CONFIG.thirdPrizeCount,
    thirdPrizeName: name('thirdPrizeName', DEFAULT_CONFIG.thirdPrizeName),
  };
}

function getLanSettings(port) {
  ensureDataDir();
  if (!fs.existsSync(LAN_PATH)) {
    writeJson(LAN_PATH, DEFAULT_LAN);
  }
  const cfg = readJson(LAN_PATH, DEFAULT_LAN);
  const detected = detectLanAddresses(port);
  const fromEnv = normalizeBaseUrl(process.env.LAN_URL || process.env.BASE_URL || '');
  const fromFile = normalizeBaseUrl(cfg.baseUrl);
  const preferred = fromEnv || fromFile || detected[0] || '';
  return {
    mode: 'lan',
    baseUrl: preferred,
    lanUrls: detected,
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
  return {
    backgroundDefault: String(cfg.backgroundDefault || '').trim(),
    backgroundReveal: String(cfg.backgroundReveal || '').trim(),
    backgroundDone: String(cfg.backgroundDone || '').trim(),
    musicDefault: String(cfg.musicDefault || '').trim(),
    musicReveal: String(cfg.musicReveal || '').trim(),
    musicDone: String(cfg.musicDone || '').trim(),
    countdownSeconds: sec >= 3 && sec <= 60 ? sec : DEFAULT_SCREEN.countdownSeconds,
  };
}

function getWechatSettings() {
  ensureDataDir();
  if (!fs.existsSync(WECHAT_PATH)) {
    writeJson(WECHAT_PATH, DEFAULT_WECHAT);
  }
  const cfg = readJson(WECHAT_PATH, DEFAULT_WECHAT);
  return {
    enabled: !!cfg.enabled,
    appId: String(cfg.appId || '').trim(),
    appSecret: String(cfg.appSecret || '').trim(),
    oauthBaseUrl: normalizeBaseUrl(cfg.oauthBaseUrl || ''),
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
  getWechatSettings,
  normalizeBaseUrl,
  isUsableLanUrl,
  detectLanAddresses,
  saveRoundResult,
  DEFAULT_CONFIG,
  DEFAULT_LAN,
  DEFAULT_SCREEN,
  DEFAULT_WECHAT,
};
