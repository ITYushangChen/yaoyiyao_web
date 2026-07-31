const crypto = require('crypto');
const { getPrizeConfig, getScreenSettings, saveRoundResult } = require('./db');

const PHASE = {
  WAITING: 'waiting',
  STARTING: 'starting',
  OPEN: 'open',
  LOCKED: 'locked',
  REVEALING: 'revealing',
  DONE: 'done',
};

/** 揭晓顺序（兼容旧流程；现已改为直接出最终榜） */
const REVEAL_ORDER = ['top'];

/** 开场同步倒计时（大屏 + 手机一起） */
const START_INTRO = ['3', '2', '1', 'GO!'];
const START_INTRO_STEP_MS = 1000;

/** 每人每秒最多计入次数（防刷） */
const SHAKE_MAX_PER_SEC = 15;
/** 排名重算合并窗口 */
const RANK_REBUILD_MS = 100;

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

function prizeLabel(tier, config) {
  if (!tier) return '未上榜';
  if (tier === 'top') return '前五名';
  return '未上榜';
}

class Room {
  constructor(roomId, options = {}) {
    this.id = roomId;
    this.phase = PHASE.WAITING;
    this.config = getPrizeConfig();
    this.players = new Map(); // playerId -> player
    this.screens = new Set();
    this.rankList = []; // ordered playerIds by shakeCount
    this.revealIndex = -1;
    this.revealedTiers = new Set();
    this.revealBusy = false;
    this.currentRevealTier = null;
    this.createdAt = Date.now();
    this.roundEndsAt = null;
    this.roundDuration = 0;
    this._screenThrottle = null;
    this._pendingScreenPush = false;
    this._revealTimer = null;
    this._roundTimer = null;
    this._startIntroTimer = null;
    this._playerThrottle = null;
    this._pendingPlayerProgress = false;
    this._rankDirty = false;
    this._rankTimer = null;
    this.startIntro = null;
    this.onDirty = typeof options.onDirty === 'function' ? options.onDirty : null;
  }

  markDirty() {
    if (this.onDirty) this.onDirty(this);
  }

  clearRevealTimer() {
    if (this._revealTimer) {
      clearTimeout(this._revealTimer);
      this._revealTimer = null;
    }
  }

  clearRoundTimer() {
    if (this._roundTimer) {
      clearTimeout(this._roundTimer);
      this._roundTimer = null;
    }
  }

  clearStartIntroTimer() {
    if (this._startIntroTimer) {
      clearTimeout(this._startIntroTimer);
      this._startIntroTimer = null;
    }
  }

  clearRankTimer() {
    if (this._rankTimer) {
      clearTimeout(this._rankTimer);
      this._rankTimer = null;
    }
  }

  clearAllTimers() {
    this.clearRevealTimer();
    this.clearRoundTimer();
    this.clearStartIntroTimer();
    this.clearRankTimer();
  }

  buildStartIntroPayload(now = Date.now()) {
    const stepMs = START_INTRO_STEP_MS;
    const intro = START_INTRO.slice();
    const openAt = now + intro.length * stepMs;
    this.startIntro = { intro, introStepMs: stepMs, openAt, serverNow: now };
    return {
      type: 'start_intro',
      phase: PHASE.STARTING,
      intro,
      introStepMs: stepMs,
      openAt,
      serverNow: now,
    };
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

    let totalShakes = 0;
    for (const p of this.players.values()) {
      totalShakes += p.shakeCount || 0;
    }

    const base = {
      type: 'state',
      roomId: this.id,
      phase: this.phase,
      config: this.config,
      participantCount: this.players.size,
      shakenCount: this.rankList.length,
      totalShakes,
      roundEndsAt: this.roundEndsAt,
      roundDuration: this.roundDuration,
      serverNow: Date.now(),
      urgencySeconds: getScreenSettings().urgencySeconds,
      startIntro: this.phase === PHASE.STARTING ? this.startIntro : null,
      revealTier: this.currentRevealTier,
      revealStep: this.revealedTiers.size + (this.revealBusy ? 1 : 0),
      revealTotal: REVEAL_ORDER.length,
      revealedTiers: [...this.revealedTiers],
      revealBusy: this.revealBusy,
      nextRevealTier: this.getNextRevealTier(),
      topShakers: this.getTopShakers(this.config.liveTopCount || 20),
      finalTop: this.getTopShakers(this.config.finalTopCount || 5),
    };

    if (forRole === 'screen') {
      const showLiveRanking =
        this.phase === PHASE.OPEN ||
        this.phase === PHASE.LOCKED ||
        this.phase === PHASE.REVEALING ||
        this.phase === PHASE.DONE;
      const liveTop = this.config.liveTopCount || 20;
      return {
        ...base,
        // 只下发实时榜，避免 200 人全量名单撑爆带宽
        participants: showLiveRanking ? participants.slice(0, liveTop) : [],
        joinedPreview: [...this.players.values()].slice(-16).map((p) => p.nickname),
        winners: this.phase === PHASE.DONE ? this.getWinners() : { top: [] },
        finalTop: this.getTopShakers(this.config.finalTopCount || 5),
        prizeBoard: this.getPrizeBoard(),
      };
    }

    return base;
  }

  playerStatePayload(player, type = 'joined') {
    return {
      type,
      roomId: this.id,
      playerId: player.id,
      nickname: player.nickname,
      phase: this.phase,
      config: this.config,
      shakeCount: player.shakeCount || 0,
      rank: player.rank,
      roundEndsAt: this.roundEndsAt,
      roundDuration: this.roundDuration,
      serverNow: Date.now(),
      urgencySeconds: getScreenSettings().urgencySeconds,
      startIntro: this.phase === PHASE.STARTING ? this.startIntro : null,
      participantCount: this.players.size,
      shakenCount: this.rankList.length,
    };
  }

  sendPlayerFullSync(player) {
    if (!player || !player.ws || !player.ws.isOpen()) return;
    player.ws.send(this.playerStatePayload(player, 'joined'));
    player.ws.send(this.playerStatePayload(player, 'sync'));
    if (this.phase === PHASE.STARTING && this.startIntro) {
      player.ws.send({ type: 'start_intro', phase: PHASE.STARTING, ...this.startIntro });
    }
    if (this.phase === PHASE.OPEN && this.roundEndsAt) {
      player.ws.send({
        type: 'round_timer',
        phase: PHASE.OPEN,
        roundEndsAt: this.roundEndsAt,
        roundDuration: this.roundDuration,
        serverNow: Date.now(),
        urgencySeconds: getScreenSettings().urgencySeconds,
      });
    }
    if (player.shakeCount > 0) {
      player.ws.send({
        type: 'shaken',
        rank: player.rank,
        shakeCount: player.shakeCount,
        already: true,
        nickname: player.nickname,
      });
    }
  }

  /** 点击次数 Top N */
  getTopShakers(limit = 20) {
    const n = Math.max(1, Number(limit) || 20);
    return this.rankList.slice(0, n).map((id, index) => {
      const p = this.players.get(id);
      return {
        playerId: id,
        nickname: p ? p.nickname : '未知',
        rank: index + 1,
        shakeCount: p ? p.shakeCount : 0,
      };
    });
  }

  /** 按点击次数重排（次数多优先；同次数先达到者优先） */
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
    this._rankDirty = false;
  }

  scheduleRankRebuild() {
    this._rankDirty = true;
    if (this._rankTimer) return;
    this._rankTimer = setTimeout(() => {
      this._rankTimer = null;
      if (!this._rankDirty) return;
      this.rebuildRankList();
      this.broadcastScreenThrottled();
      this.broadcastPlayerProgressThrottled();
      this.markDirty();
    }, RANK_REBUILD_MS);
  }

  /** 最终榜：仅前 N 名（默认 5） */
  getWinners() {
    const finalTop = this.config.finalTopCount || 5;
    const top = this.getTopShakers(finalTop).map((row) => ({
      ...row,
      tier: 'top',
      prize: row.rank <= finalTop ? `第 ${row.rank} 名` : '未上榜',
    }));
    return { top };
  }

  /** 兼容旧字段：展示最终前五摘要 */
  getPrizeBoard() {
    const finalTop = this.config.finalTopCount || 5;
    const people = this.getTopShakers(finalTop);
    return {
      top: {
        tier: 'top',
        name: `前 ${finalTop} 名`,
        max: finalTop,
        filled: people.length,
        people: people.map((p) => ({ nickname: p.nickname, rank: p.rank, shakeCount: p.shakeCount })),
      },
    };
  }

  prizeName(tier) {
    if (tier === 'top') return `前 ${this.config.finalTopCount || 5} 名`;
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
        this.sendPlayerFullSync(p);
        this.broadcastScreenThrottled();
        this.markDirty();
        return p;
      }
    }

    if (
      this.phase !== PHASE.WAITING &&
      this.phase !== PHASE.STARTING &&
      this.phase !== PHASE.OPEN
    ) {
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
      lastShakeAt: null,
      shakeWindowStart: 0,
      shakeWindowCount: 0,
      rank: null,
    };
    this.players.set(playerId, player);
    ws.roomId = this.id;
    ws.role = 'player';
    ws.playerId = playerId;

    this.sendPlayerFullSync(player);

    this.broadcastScreenThrottled();
    this.broadcastPlayers({
      type: 'lobby',
      participantCount: this.players.size,
      shakenCount: this.rankList.length,
      phase: this.phase,
      serverNow: Date.now(),
    });
    this.markDirty();

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
    this.markDirty();
  }

  beginOpenRound() {
    const screen = getScreenSettings();
    const seconds = screen.countdownSeconds || 20;
    const now = Date.now();
    this.phase = PHASE.OPEN;
    this.startIntro = null;
    this.roundDuration = seconds;
    this.roundEndsAt = now + seconds * 1000;
    this._roundTimer = setTimeout(() => {
      this._roundTimer = null;
      this.autoReveal();
    }, seconds * 1000);

    this.broadcastAll();
    const timerPayload = {
      type: 'round_timer',
      phase: PHASE.OPEN,
      roundEndsAt: this.roundEndsAt,
      roundDuration: this.roundDuration,
      serverNow: now,
      urgencySeconds: screen.urgencySeconds,
    };
    this.broadcastScreens(timerPayload);
    this.broadcastPlayers(timerPayload);
    this.markDirty();
  }

  start() {
    if (this.phase !== PHASE.WAITING && this.phase !== PHASE.DONE) {
      return { ok: false, message: '当前阶段无法开始' };
    }
    // 每轮开始时重新读取配置，改 config.json 后无需重启进程
    this.config = getPrizeConfig();
    this.clearAllTimers();
    if (this.phase === PHASE.DONE) {
      this.resetKeepPlayers();
    }
    this.phase = PHASE.STARTING;
    this.rankList = [];
    this.revealIndex = -1;
    this.revealedTiers = new Set();
    this.revealBusy = false;
    this.currentRevealTier = null;
    this.roundEndsAt = null;
    this.roundDuration = 0;
    for (const p of this.players.values()) {
      p.shakeCount = 0;
      p.lastShakeAt = null;
      p.shakenAt = null;
      p.rank = null;
    }

    const now = Date.now();
    const introPayload = this.buildStartIntroPayload(now);
    this.broadcastAll();
    this.broadcastScreens(introPayload);
    this.broadcastPlayers(introPayload);

    const delay = Math.max(0, introPayload.openAt - Date.now());
    this._startIntroTimer = setTimeout(() => {
      this._startIntroTimer = null;
      if (this.phase !== PHASE.STARTING) return;
      this.beginOpenRound();
    }, delay);

    this.markDirty();
    return { ok: true };
  }

  /** 倒计时到 0：直接开奖，不再走 3·2·1 动画 */
  autoReveal() {
    if (this.phase !== PHASE.OPEN) return { ok: false, message: '当前不在冲榜阶段' };
    this.clearRoundTimer();
    this.rebuildRankList();
    this.roundEndsAt = null;

    for (const tier of REVEAL_ORDER) {
      this.revealedTiers.add(tier);
    }
    this.revealIndex = REVEAL_ORDER.length - 1;
    this.revealBusy = false;
    this.currentRevealTier = null;
    this.phase = PHASE.DONE;

    const screen = getScreenSettings();
    const finalTop = this.getTopShakers(this.config.finalTopCount || 5);
    const winners = this.getWinners();

    this.persistResults();
    this.notifyPlayerResults();

    const payload = {
      type: 'round_end',
      winners,
      finalTop,
      topShakers: finalTop,
      prizes: { top: this.prizeName('top') },
      screenSettings: screen,
      config: this.config,
    };
    this.broadcastScreens(payload);
    this.broadcastPlayers(payload);
    this.broadcastScreens(this.snapshot('screen'));
    this.broadcastPlayers({
      type: 'phase',
      phase: PHASE.DONE,
      revealedTiers: [...this.revealedTiers],
      serverNow: Date.now(),
    });
    this.markDirty();
    return { ok: true, done: true };
  }

  lock() {
    if (this.phase !== PHASE.OPEN) {
      return { ok: false, message: '请先开始幸运多一点' };
    }
    this.rebuildRankList();
    this.phase = PHASE.LOCKED;
    this.broadcastAll();
    this.markDirty();
    return { ok: true };
  }

  startRevealCountdown() {
    // 兼容旧按钮：立刻开奖（与倒计时到 0 相同）
    if (this.phase === PHASE.OPEN) {
      return this.autoReveal();
    }
    if (this.phase === PHASE.LOCKED) {
      this.phase = PHASE.OPEN;
      return this.autoReveal();
    }
    return { ok: false, message: '当前阶段无法开奖' };
  }

  finishRevealTier() {
    if (!this.revealBusy) {
      return { ok: false, message: '没有进行中的揭晓' };
    }
    this.clearRevealTimer();
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
    this.markDirty();
    return { ok: true, done: true };
  }

  revealNext() {
    return this.startRevealCountdown();
  }

  shake(ws) {
    if (this.phase !== PHASE.OPEN) {
      const tip =
        this.phase === PHASE.WAITING
          ? '尚未开始'
          : this.phase === PHASE.STARTING
            ? '倒计时中，请稍候'
            : '本轮已截止';
      ws.send({ type: 'error', message: tip });
      return;
    }

    const player = this.players.get(ws.playerId);
    if (!player) {
      ws.send({ type: 'error', message: '未加入房间' });
      return;
    }

    const now = Date.now();
    if (!player.shakeWindowStart || now - player.shakeWindowStart >= 1000) {
      player.shakeWindowStart = now;
      player.shakeWindowCount = 0;
    }
    if (player.shakeWindowCount >= SHAKE_MAX_PER_SEC) {
      ws.send({
        type: 'shaken',
        rank: player.rank,
        shakeCount: player.shakeCount || 0,
        already: false,
        rateLimited: true,
        nickname: player.nickname,
        serverTime: now,
      });
      return;
    }

    player.shakeWindowCount += 1;
    player.lastShakeAt = now;
    player.shakeCount = (player.shakeCount || 0) + 1;
    if (!player.shakenAt) player.shakenAt = now;

    // 先回 ACK（用近似排名），排名合并重算后再推大屏
    ws.send({
      type: 'shaken',
      rank: player.rank,
      shakeCount: player.shakeCount,
      already: false,
      nickname: player.nickname,
      serverTime: now,
    });

    this.scheduleRankRebuild();
  }

  resetKeepPlayers() {
    this.clearAllTimers();
    this.phase = PHASE.WAITING;
    this.rankList = [];
    this.revealIndex = -1;
    this.revealedTiers = new Set();
    this.revealBusy = false;
    this.currentRevealTier = null;
    this.roundEndsAt = null;
    this.roundDuration = 0;
    this.startIntro = null;
    for (const p of this.players.values()) {
      p.shakeCount = 0;
      p.lastShakeAt = null;
      p.shakenAt = null;
      p.rank = null;
    }
  }

  resetAll() {
    this.resetKeepPlayers();
    this.broadcastAll();
    this.markDirty();
    return { ok: true };
  }

  toJSON() {
    return {
      id: this.id,
      phase: this.phase,
      config: this.config,
      createdAt: this.createdAt,
      roundEndsAt: this.roundEndsAt,
      roundDuration: this.roundDuration,
      startIntro: this.startIntro,
      rankList: this.rankList,
      revealIndex: this.revealIndex,
      revealedTiers: [...this.revealedTiers],
      revealBusy: this.revealBusy,
      currentRevealTier: this.currentRevealTier,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        nickname: p.nickname,
        shakeCount: p.shakeCount || 0,
        shakenAt: p.shakenAt,
        lastShakeAt: p.lastShakeAt,
        rank: p.rank,
      })),
      savedAt: Date.now(),
    };
  }

  restoreTimers() {
    this.clearAllTimers();
    const now = Date.now();
    if (this.phase === PHASE.STARTING && this.startIntro && this.startIntro.openAt) {
      const delay = Math.max(0, this.startIntro.openAt - now);
      this._startIntroTimer = setTimeout(() => {
        this._startIntroTimer = null;
        if (this.phase !== PHASE.STARTING) return;
        this.beginOpenRound();
      }, delay);
      return;
    }
    if (this.phase === PHASE.OPEN && this.roundEndsAt) {
      const delay = this.roundEndsAt - now;
      if (delay <= 0) {
        this.autoReveal();
      } else {
        this._roundTimer = setTimeout(() => {
          this._roundTimer = null;
          this.autoReveal();
        }, delay);
      }
    }
  }

  static fromJSON(data, options = {}) {
    if (!data || !data.id) return null;
    const room = new Room(data.id, options);
    room.phase = data.phase || PHASE.WAITING;
    room.config = data.config || getPrizeConfig();
    room.createdAt = data.createdAt || Date.now();
    room.roundEndsAt = data.roundEndsAt || null;
    room.roundDuration = data.roundDuration || 0;
    room.startIntro = data.startIntro || null;
    room.rankList = Array.isArray(data.rankList) ? data.rankList : [];
    room.revealIndex = data.revealIndex != null ? data.revealIndex : -1;
    room.revealedTiers = new Set(data.revealedTiers || []);
    room.revealBusy = !!data.revealBusy;
    room.currentRevealTier = data.currentRevealTier || null;
    room.players = new Map();
    for (const p of data.players || []) {
      if (!p || !p.id || !p.nickname) continue;
      room.players.set(p.id, {
        id: p.id,
        nickname: p.nickname,
        ws: null,
        shakeCount: p.shakeCount || 0,
        shakenAt: p.shakenAt || null,
        lastShakeAt: p.lastShakeAt || null,
        shakeWindowStart: 0,
        shakeWindowCount: 0,
        rank: p.rank || null,
      });
    }
    room.rebuildRankList();
    return room;
  }

  persistResults() {
    saveRoundResult({
      roomId: this.id,
      config: this.config,
      winners: this.getWinners(),
      finalTop: this.getTopShakers(this.config.finalTopCount || 5),
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
    const finalTop = this.config.finalTopCount || 5;
    for (const [id, p] of this.players) {
      if (!p.ws || !p.ws.isOpen()) continue;
      const onPodium = p.rank && p.rank <= finalTop;
      p.ws.send({
        type: 'result',
        rank: p.rank,
        shakeCount: p.shakeCount || 0,
        tier: onPodium ? 'top' : null,
        prize: onPodium ? `第 ${p.rank} 名` : p.rank ? `第 ${p.rank} 名` : '未上榜',
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
      roundEndsAt: this.roundEndsAt,
      roundDuration: this.roundDuration,
      serverNow: Date.now(),
      urgencySeconds: getScreenSettings().urgencySeconds,
      startIntro: this.phase === PHASE.STARTING ? this.startIntro : null,
    });
  }

  broadcastScreenThrottled() {
    this._pendingScreenPush = true;
    if (this._screenThrottle) return;
    this._screenThrottle = setTimeout(() => {
      this._screenThrottle = null;
      if (!this._pendingScreenPush) return;
      this._pendingScreenPush = false;
      if (this._rankDirty) this.rebuildRankList();
      this.broadcastScreens(this.snapshot('screen'));
    }, 120);
  }

  /** 全员 progress 节流：避免 200 人狂点时 O(n²) 广播打满 */
  broadcastPlayerProgressThrottled() {
    this._pendingPlayerProgress = true;
    if (this._playerThrottle) return;
    this._playerThrottle = setTimeout(() => {
      this._playerThrottle = null;
      if (!this._pendingPlayerProgress) return;
      this._pendingPlayerProgress = false;
      let totalShakes = 0;
      for (const p of this.players.values()) {
        totalShakes += p.shakeCount || 0;
      }
      this.broadcastPlayers({
        type: 'progress',
        shakenCount: this.rankList.length,
        totalShakes,
        participantCount: this.players.size,
        phase: this.phase,
        serverNow: Date.now(),
      });
    }, 250);
  }
}

class RoomManager {
  constructor(options = {}) {
    this.rooms = new Map();
    this.onDirty = typeof options.onDirty === 'function' ? options.onDirty : null;
  }

  _bind(room) {
    room.onDirty = this.onDirty;
    return room;
  }

  createRoom() {
    const id = makeId('room');
    const room = this._bind(new Room(id, { onDirty: this.onDirty }));
    this.rooms.set(id, room);
    if (this.onDirty) this.onDirty(room);
    return room;
  }

  get(roomId) {
    return this.rooms.get(roomId) || null;
  }

  getOrCreate(roomId) {
    if (roomId && this.rooms.has(roomId)) return this.rooms.get(roomId);
    return this.createRoom();
  }

  stats() {
    let players = 0;
    let screens = 0;
    for (const room of this.rooms.values()) {
      players += room.players.size;
      screens += room.screens.size;
    }
    return {
      rooms: this.rooms.size,
      players,
      screens,
    };
  }

  serialize() {
    return {
      version: 1,
      savedAt: Date.now(),
      rooms: [...this.rooms.values()].map((r) => r.toJSON()),
    };
  }

  restoreFromSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.rooms)) return 0;
    let restored = 0;
    for (const data of snapshot.rooms) {
      // 过旧快照（超过 6 小时）丢弃
      if (data.savedAt && Date.now() - data.savedAt > 6 * 60 * 60 * 1000) continue;
      if (data.phase === PHASE.DONE || data.phase === PHASE.WAITING) {
        // waiting 无玩家可跳过；done 保留短时间方便大屏刷新
        if (data.phase === PHASE.WAITING && !(data.players && data.players.length)) continue;
      }
      const room = this._bind(Room.fromJSON(data, { onDirty: this.onDirty }));
      if (!room) continue;
      this.rooms.set(room.id, room);
      room.restoreTimers();
      restored += 1;
    }
    return restored;
  }
}

module.exports = {
  RoomManager,
  Room,
  PHASE,
  REVEAL_ORDER,
  prizeLabel,
  SHAKE_MAX_PER_SEC,
};
