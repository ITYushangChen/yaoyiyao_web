const crypto = require('crypto');
const { getPrizeConfig, getScreenSettings, saveRoundResult } = require('./db');

const PHASE = {
  WAITING: 'waiting',
  OPEN: 'open',
  LOCKED: 'locked',
  REVEALING: 'revealing',
  DONE: 'done',
};

/** 揭晓顺序：先一等奖，再二等奖，再三等 */
const REVEAL_ORDER = ['first', 'second', 'third'];

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

function prizeLabel(tier, config) {
  if (!tier) return '未中奖';
  const cfg = config || {};
  if (tier === 'first') return cfg.firstPrizeName || '一等奖';
  if (tier === 'second') return cfg.secondPrizeName || '二等奖';
  if (tier === 'third') return cfg.thirdPrizeName || '三等奖';
  return '未中奖';
}

class Room {
  constructor(roomId) {
    this.id = roomId;
    this.phase = PHASE.WAITING;
    this.config = getPrizeConfig();
    this.players = new Map(); // playerId -> player
    this.screens = new Set();
    this.rankList = []; // ordered playerIds by server receive time
    this.revealIndex = -1;
    this.revealedTiers = new Set();
    this.revealBusy = false;
    this.currentRevealTier = null;
    this.createdAt = Date.now();
    this._screenThrottle = null;
    this._pendingScreenPush = false;
  }

  snapshot(forRole = 'screen') {
    const participants = this.rankList.map((id, index) => {
      const p = this.players.get(id);
      return {
        playerId: id,
        nickname: p ? p.nickname : '未知',
        rank: index + 1,
        shakeCount: p ? p.shakeCount : 0,
        shakenAt: p ? p.shakenAt : null,
      };
    });

    const base = {
      type: 'state',
      roomId: this.id,
      phase: this.phase,
      config: this.config,
      participantCount: this.players.size,
      shakenCount: this.rankList.length,
      revealTier: this.currentRevealTier,
      revealStep: this.revealedTiers.size + (this.revealBusy ? 1 : 0),
      revealTotal: REVEAL_ORDER.length,
      revealedTiers: [...this.revealedTiers],
      revealBusy: this.revealBusy,
      nextRevealTier: this.getNextRevealTier(),
      topShakers: this.getTopShakers(10),
    };

    if (forRole === 'screen') {
      const showFullRanking =
        this.phase === PHASE.LOCKED ||
        this.phase === PHASE.REVEALING ||
        this.phase === PHASE.DONE;
      return {
        ...base,
        // 开摇中同步奖项柱状进度与名单；完整排名表仍可在截止后查看
        participants: showFullRanking ? participants : [],
        joinedPreview: [...this.players.values()].slice(-16).map((p) => p.nickname),
        winners: this.getWinners(),
        prizeBoard: this.getPrizeBoard(),
      };
    }

    return base;
  }

  /** 摇动次数 Top N（用于倒计时柱状图） */
  getTopShakers(limit = 10) {
    return this.rankList.slice(0, limit).map((id, index) => {
      const p = this.players.get(id);
      return {
        playerId: id,
        nickname: p ? p.nickname : '未知',
        rank: index + 1,
        shakeCount: p ? p.shakeCount : 0,
      };
    });
  }

  /** 按摇动次数重排（次数多优先；同次数先达到者优先） */
  rebuildRankList() {
    const list = [...this.players.values()]
      .filter((p) => p.shakeCount > 0)
      .sort((a, b) => {
        if (b.shakeCount !== a.shakeCount) return b.shakeCount - a.shakeCount;
        return (a.shakenAt || 0) - (b.shakenAt || 0);
      });
    this.rankList = list.map((p) => p.id);
    list.forEach((p, index) => {
      p.rank = index + 1;
    });
  }

  getWinners() {
    const { firstPrizeCount: x, secondPrizeCount: y, thirdPrizeCount: g } = this.config;
    const list = this.rankList.map((id, index) => {
      const p = this.players.get(id);
      const rank = index + 1;
      let tier = null;
      if (rank <= x) tier = 'first';
      else if (rank <= x + y) tier = 'second';
      else if (rank <= x + y + g) tier = 'third';
      return {
        playerId: id,
        nickname: p ? p.nickname : '未知',
        rank,
        shakeCount: p ? p.shakeCount : 0,
        tier,
        prize: prizeLabel(tier, this.config),
      };
    });

    return {
      first: list.filter((i) => i.tier === 'first'),
      second: list.filter((i) => i.tier === 'second'),
      third: list.filter((i) => i.tier === 'third'),
    };
  }

  /** 大屏柱状图：各奖已占人数 / 名额 / 名单 */
  getPrizeBoard() {
    const winners = this.getWinners();
    const c = this.config;
    const pack = (tier, max, name) => {
      const people = winners[tier] || [];
      return {
        tier,
        name: name || prizeLabel(tier, c),
        max: Number(max) || 0,
        filled: people.length,
        people: people.map((p) => ({ nickname: p.nickname, rank: p.rank })),
      };
    };
    return {
      first: pack('first', c.firstPrizeCount, c.firstPrizeName),
      second: pack('second', c.secondPrizeCount, c.secondPrizeName),
      third: pack('third', c.thirdPrizeCount, c.thirdPrizeName),
    };
  }

  prizeName(tier) {
    return prizeLabel(tier, this.config);
  }

  getNextRevealTier() {
    return REVEAL_ORDER.find((t) => !this.revealedTiers.has(t)) || null;
  }

  getShakePool() {
    return this.rankList.map((id) => {
      const p = this.players.get(id);
      return p ? p.nickname : '未知';
    });
  }

  addScreen(ws) {
    this.screens.add(ws);
    ws.roomId = this.id;
    ws.role = 'screen';
    ws.send(this.snapshot('screen'));
  }

  removeScreen(ws) {
    this.screens.delete(ws);
  }

  addPlayer(ws, nickname) {
    const name = String(nickname || '').trim().slice(0, 16);
    if (!name) {
      ws.send({ type: 'error', message: '请输入昵称' });
      return null;
    }

    // Reconnect: same nickname reuses existing seat
    for (const p of this.players.values()) {
      if (p.nickname === name) {
        if (p.ws && p.ws.isOpen() && p.ws !== ws) {
          ws.send({ type: 'error', message: '昵称已被使用，请换一个' });
          return null;
        }
        p.ws = ws;
        ws.roomId = this.id;
        ws.role = 'player';
        ws.playerId = p.id;
        ws.send({
          type: 'joined',
          roomId: this.id,
          playerId: p.id,
          nickname: name,
          phase: this.phase,
          config: this.config,
          shakeCount: p.shakeCount || 0,
        });
        if (p.shakeCount > 0) {
          ws.send({
            type: 'shaken',
            rank: p.rank,
            shakeCount: p.shakeCount,
            already: true,
            nickname: name,
          });
        }
        this.broadcastScreenThrottled();
        return p;
      }
    }

    if (this.phase !== PHASE.WAITING && this.phase !== PHASE.OPEN) {
      ws.send({ type: 'error', message: '本轮已截止，无法加入' });
      return null;
    }

    const playerId = makeId('p');
    const player = {
      id: playerId,
      nickname: name,
      ws,
      shakeCount: 0,
      shakenAt: null,
      rank: null,
    };
    this.players.set(playerId, player);
    ws.roomId = this.id;
    ws.role = 'player';
    ws.playerId = playerId;

    ws.send({
      type: 'joined',
      roomId: this.id,
      playerId,
      nickname: name,
      phase: this.phase,
      config: this.config,
      shakeCount: 0,
    });

    this.broadcastScreenThrottled();
    this.broadcastPlayers({
      type: 'lobby',
      participantCount: this.players.size,
      shakenCount: this.rankList.length,
      phase: this.phase,
    });

    return player;
  }

  removePlayer(ws) {
    const playerId = ws.playerId;
    if (!playerId) return;
    const player = this.players.get(playerId);
    if (!player) return;

    // Keep ranking record if already shaken; just detach socket
    player.ws = null;
    if (!player.shakeCount) {
      this.players.delete(playerId);
    }
    this.broadcastScreenThrottled();
  }

  start() {
    if (this.phase !== PHASE.WAITING && this.phase !== PHASE.DONE) {
      return { ok: false, message: '当前阶段无法开始' };
    }
    // 每轮开始时重新读取配置，改 config.json 后无需重启进程
    this.config = getPrizeConfig();
    if (this.phase === PHASE.DONE) {
      this.resetKeepPlayers();
    }
    this.phase = PHASE.OPEN;
    this.rankList = [];
    this.revealIndex = -1;
    this.revealedTiers = new Set();
    this.revealBusy = false;
    this.currentRevealTier = null;
    for (const p of this.players.values()) {
      p.shakeCount = 0;
      p.lastShakeAt = null;
      p.shakenAt = null;
      p.rank = null;
    }
    this.broadcastAll();
    return { ok: true };
  }

  lock() {
    if (this.phase !== PHASE.OPEN) {
      return { ok: false, message: '请先开始摇一摇' };
    }
    this.rebuildRankList();
    this.phase = PHASE.LOCKED;
    this.broadcastAll();
    return { ok: true };
  }

  startRevealCountdown() {
    if (this.phase === PHASE.OPEN) {
      this.rebuildRankList();
      this.phase = PHASE.LOCKED;
    }
    if (this.phase !== PHASE.LOCKED && this.phase !== PHASE.REVEALING) {
      return { ok: false, message: '请先开始摇一摇' };
    }
    if (this.revealBusy) {
      return { ok: false, message: '揭晓进行中' };
    }
    if (this.revealedTiers.size >= REVEAL_ORDER.length) {
      return { ok: false, message: '本轮已揭晓完毕' };
    }
    this.rebuildRankList();
    const pool = this.getShakePool();
    if (!pool.length) {
      return { ok: false, message: '还没有人摇一摇，无法揭晓' };
    }

    const screen = getScreenSettings();
    const winners = this.getWinners();
    const topShakers = this.getTopShakers(10);
    this.phase = PHASE.REVEALING;
    this.revealBusy = true;
    this.currentRevealTier = 'all';

    const payload = {
      type: 'reveal_roll',
      mode: 'all',
      intro: ['3', '2', '1', 'GO!'],
      introStepMs: 1000,
      countdownSeconds: screen.countdownSeconds || 10,
      pool,
      topShakers,
      winners,
      prizes: {
        first: this.prizeName('first'),
        second: this.prizeName('second'),
        third: this.prizeName('third'),
      },
      config: this.config,
      screenSettings: screen,
    };

    // 大屏与手机同步收到同一条揭晓指令
    this.broadcastScreens(payload);
    this.broadcastPlayers(payload);
    this.broadcastScreens(this.snapshot('screen'));
    this.broadcastPlayers({
      type: 'phase',
      phase: this.phase,
      revealedTiers: [...this.revealedTiers],
    });
    return { ok: true, winners };
  }

  finishRevealTier() {
    if (!this.revealBusy) {
      return { ok: false, message: '没有进行中的揭晓' };
    }
    for (const tier of REVEAL_ORDER) {
      this.revealedTiers.add(tier);
    }
    this.revealIndex = REVEAL_ORDER.length - 1;
    this.revealBusy = false;
    this.currentRevealTier = null;
    this.phase = PHASE.DONE;

    this.persistResults();
    this.notifyPlayerResults();
    this.broadcastScreens({
      type: 'all_revealed',
      screenSettings: getScreenSettings(),
      winners: this.getWinners(),
    });
    this.broadcastScreens(this.snapshot('screen'));
    this.broadcastPlayers({
      type: 'phase',
      phase: PHASE.DONE,
      revealedTiers: [...this.revealedTiers],
    });
    return { ok: true, done: true };
  }

  revealNext() {
    return this.startRevealCountdown();
  }

  shake(ws) {
    if (this.phase !== PHASE.OPEN) {
      ws.send({ type: 'error', message: this.phase === PHASE.WAITING ? '尚未开始' : '本轮已截止' });
      return;
    }

    const player = this.players.get(ws.playerId);
    if (!player) {
      ws.send({ type: 'error', message: '未加入房间' });
      return;
    }

    const now = Date.now();
    // 客户端已有冷却；服务端再做一层限流，避免刷屏
    if (player.lastShakeAt && now - player.lastShakeAt < 280) {
      return;
    }
    player.lastShakeAt = now;
    player.shakeCount = (player.shakeCount || 0) + 1;
    if (!player.shakenAt) player.shakenAt = now;

    this.rebuildRankList();

    ws.send({
      type: 'shaken',
      rank: player.rank,
      shakeCount: player.shakeCount,
      already: false,
      nickname: player.nickname,
      serverTime: now,
    });

    this.broadcastScreenThrottled();
    this.broadcastPlayers({
      type: 'progress',
      shakenCount: this.rankList.length,
      participantCount: this.players.size,
      phase: this.phase,
      topShakers: this.getTopShakers(10),
    });
  }

  resetKeepPlayers() {
    this.phase = PHASE.WAITING;
    this.rankList = [];
    this.revealIndex = -1;
    this.revealedTiers = new Set();
    this.revealBusy = false;
    this.currentRevealTier = null;
    for (const p of this.players.values()) {
      p.shakeCount = 0;
      p.lastShakeAt = null;
      p.shakenAt = null;
      p.rank = null;
    }
  }

  resetAll() {
    this.resetKeepPlayers();
    // drop disconnected unsaken already handled; keep connected players
    this.broadcastAll();
    return { ok: true };
  }

  persistResults() {
    saveRoundResult({
      roomId: this.id,
      config: this.config,
      winners: this.getWinners(),
      ranking: this.rankList.map((id, index) => {
        const p = this.players.get(id);
        return {
          rank: index + 1,
          nickname: p ? p.nickname : '未知',
          shakeCount: p ? p.shakeCount : 0,
          shakenAt: p ? p.shakenAt : null,
        };
      }),
    });
  }

  notifyPlayerResults() {
    const winnersMap = new Map();
    const all = this.getWinners();
    for (const tier of ['first', 'second', 'third']) {
      for (const w of all[tier]) {
        winnersMap.set(w.playerId, w);
      }
    }

    for (const [id, p] of this.players) {
      if (!p.ws || !p.ws.isOpen()) continue;
      const w = winnersMap.get(id);
      p.ws.send({
        type: 'result',
        rank: p.rank,
        shakeCount: p.shakeCount || 0,
        tier: w ? w.tier : null,
        prize: w ? w.prize : '未中奖',
        nickname: p.nickname,
        phase: PHASE.DONE,
      });
    }
  }

  broadcastScreens(msg) {
    for (const ws of this.screens) {
      if (ws.isOpen()) ws.send(msg);
    }
  }

  broadcastPlayers(msg) {
    for (const p of this.players.values()) {
      if (p.ws && p.ws.isOpen()) p.ws.send(msg);
    }
  }

  broadcastAll() {
    this.broadcastScreens(this.snapshot('screen'));
    this.broadcastPlayers({
      type: 'phase',
      phase: this.phase,
      shakenCount: this.rankList.length,
      participantCount: this.players.size,
      config: this.config,
    });
  }

  broadcastScreenThrottled() {
    this._pendingScreenPush = true;
    if (this._screenThrottle) return;
    this._screenThrottle = setTimeout(() => {
      this._screenThrottle = null;
      if (!this._pendingScreenPush) return;
      this._pendingScreenPush = false;
      this.broadcastScreens(this.snapshot('screen'));
    }, 120);
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  createRoom() {
    const id = makeId('room');
    const room = new Room(id);
    this.rooms.set(id, room);
    return room;
  }

  get(roomId) {
    return this.rooms.get(roomId) || null;
  }

  getOrCreate(roomId) {
    if (roomId && this.rooms.has(roomId)) return this.rooms.get(roomId);
    return this.createRoom();
  }
}

module.exports = {
  RoomManager,
  PHASE,
  REVEAL_ORDER,
  prizeLabel,
};
