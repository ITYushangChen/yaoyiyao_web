const https = require('https');
const crypto = require('crypto');
const { getWechatSettings } = require('./db');

const pendingStates = new Map(); // state -> { roomId, createdAt }

function cleanupStates() {
  const now = Date.now();
  for (const [key, val] of pendingStates) {
    if (now - val.createdAt > 10 * 60 * 1000) pendingStates.delete(key);
  }
}

function httpsGetJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

function isWechatConfigured() {
  const cfg = getWechatSettings();
  return !!(cfg.enabled && cfg.appId && cfg.appSecret && cfg.oauthBaseUrl);
}

function getPublicConfig() {
  const cfg = getWechatSettings();
  return {
    enabled: isWechatConfigured(),
    appId: isWechatConfigured() ? cfg.appId : '',
  };
}

function createOAuthState(roomId) {
  cleanupStates();
  const state = crypto.randomBytes(12).toString('hex');
  pendingStates.set(state, {
    roomId: String(roomId || ''),
    createdAt: Date.now(),
  });
  return state;
}

function consumeOAuthState(state) {
  const item = pendingStates.get(state);
  if (!item) return null;
  pendingStates.delete(state);
  return item;
}

function buildAuthorizeUrl(roomId) {
  const cfg = getWechatSettings();
  if (!isWechatConfigured()) {
    return { ok: false, message: '未配置微信公众号，请填写 data/wechat.json' };
  }
  const state = createOAuthState(roomId);
  const redirectUri = encodeURIComponent(`${cfg.oauthBaseUrl}/api/wechat/callback`);
  const url =
    `https://open.weixin.qq.com/connect/oauth2/authorize` +
    `?appid=${encodeURIComponent(cfg.appId)}` +
    `&redirect_uri=${redirectUri}` +
    `&response_type=code` +
    `&scope=snsapi_userinfo` +
    `&state=${state}` +
    `#wechat_redirect`;
  return { ok: true, url, state };
}

async function exchangeCodeForUser(code) {
  const cfg = getWechatSettings();
  if (!isWechatConfigured()) {
    return { ok: false, message: '微信未配置' };
  }
  const tokenUrl =
    `https://api.weixin.qq.com/sns/oauth2/access_token` +
    `?appid=${encodeURIComponent(cfg.appId)}` +
    `&secret=${encodeURIComponent(cfg.appSecret)}` +
    `&code=${encodeURIComponent(code)}` +
    `&grant_type=authorization_code`;

  const token = await httpsGetJson(tokenUrl);
  if (!token.access_token || !token.openid) {
    return {
      ok: false,
      message: token.errmsg || '微信授权失败',
      errcode: token.errcode,
    };
  }

  const infoUrl =
    `https://api.weixin.qq.com/sns/userinfo` +
    `?access_token=${encodeURIComponent(token.access_token)}` +
    `&openid=${encodeURIComponent(token.openid)}` +
    `&lang=zh_CN`;
  const info = await httpsGetJson(infoUrl);
  if (!info.openid) {
    return {
      ok: false,
      message: info.errmsg || '获取微信昵称失败',
      errcode: info.errcode,
    };
  }

  return {
    ok: true,
    openId: info.openid,
    nickname: String(info.nickname || '微信用户').slice(0, 32),
    avatar: info.headimgurl || '',
  };
}

module.exports = {
  isWechatConfigured,
  getPublicConfig,
  buildAuthorizeUrl,
  consumeOAuthState,
  exchangeCodeForUser,
};
