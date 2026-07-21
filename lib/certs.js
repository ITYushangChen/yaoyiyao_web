const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CERT_DIR = path.join(__dirname, '..', 'data', 'certs');
const KEY_PATH = path.join(CERT_DIR, 'key.pem');
const CERT_PATH = path.join(CERT_DIR, 'cert.pem');

function ensureCerts() {
  if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
    return {
      ok: true,
      key: fs.readFileSync(KEY_PATH),
      cert: fs.readFileSync(CERT_PATH),
      created: false,
    };
  }

  fs.mkdirSync(CERT_DIR, { recursive: true });
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-keyout',
        KEY_PATH,
        '-out',
        CERT_PATH,
        '-days',
        '825',
        '-nodes',
        '-subj',
        '/CN=yaoyiyao-lan',
      ],
      { stdio: 'ignore' }
    );
  } catch {
    return { ok: false, message: '无法生成证书（需要 openssl）' };
  }

  if (!fs.existsSync(KEY_PATH) || !fs.existsSync(CERT_PATH)) {
    return { ok: false, message: '证书文件未生成' };
  }

  return {
    ok: true,
    key: fs.readFileSync(KEY_PATH),
    cert: fs.readFileSync(CERT_PATH),
    created: true,
  };
}

module.exports = { ensureCerts, KEY_PATH, CERT_PATH };
