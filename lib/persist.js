const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SNAPSHOT_PATH = path.join(DATA_DIR, 'rooms-snapshot.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function saveRoomsSnapshot(payload) {
  ensureDataDir();
  const tmp = `${SNAPSHOT_PATH}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
  fs.renameSync(tmp, SNAPSHOT_PATH);
}

function loadRoomsSnapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return null;
    const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function clearRoomsSnapshot() {
  try {
    if (fs.existsSync(SNAPSHOT_PATH)) fs.unlinkSync(SNAPSHOT_PATH);
  } catch {
    /* ignore */
  }
}

module.exports = {
  SNAPSHOT_PATH,
  saveRoomsSnapshot,
  loadRoomsSnapshot,
  clearRoomsSnapshot,
};
