(() => {
  const $ = (id) => document.getElementById(id);

  const phasePill = $('phasePill');
  const joinedCount = $('joinedCount');
  const shakenCount = $('shakenCount');
  const screenMain = $('screenMain');
  const stageQr = $('stageQr');
  const stageIdle = $('stageIdle');
  const stageRoll = $('stageRoll');
  const liveBoard = $('liveBoard');
  const liveBoardList = $('liveBoardList');
  const liveBoardEmpty = $('liveBoardEmpty');
  const roundTimer = $('roundTimer');
  const roundTimerNum = $('roundTimerNum');
  const roundTimerLabel = $('roundTimerLabel');
  const stageTitle = $('stageTitle');
  const stageDesc = $('stageDesc');
  const joinedCloud = $('joinedCloud');
  const rollStep = $('rollStep');
  const rollPrize = $('rollPrize');
  const rollCountdown = $('rollCountdown');
  const rollChart = $('rollChart');
  const rollFinal = $('rollFinal');
  const rollWinners = $('rollWinners');
  const rollLive = $('rollLive');
  const rollHalfBottom = $('rollHalfBottom');
  const rollCountdownLabel = $('rollCountdownLabel');
  const rollNamesLabel = $('rollNamesLabel');
  const statusMsg = $('statusMsg');
  const qrTip = $('qrTip');
  const screenBg = $('screenBg');
  const bgm = $('bgm');

  const btnStart = $('btnStart');
  const btnCountdown = $('btnCountdown');
  const btnMusic = $('btnMusic');
  const btnReset = $('btnReset');

  let ws = null;
  let mobileUrl = '';
  let baseUrl = '';
  let lanReady = false;
  let reconnectTimer = null;
  let currentPhase = 'waiting';
  let revealBusy = false;
  let nextRevealTier = null;
  let screenSettings = null;
  let musicUnlocked = false;
  let countdownTimer = null;
  let introTimer = null;
  let lastWinners = null;
  let lastPrizes = null;
  let roundEndsAt = null;
  let clockOffset = 0; // serverNow - Date.now()
  let urgencySeconds = 5;
  let roundTickTimer = null;
  let lastShownLeft = null;

  const params = new URLSearchParams(location.search);
  const paramBase = (params.get('lan') || params.get('base') || '').replace(/\/$/, '');
  const LS_KEY = 'yaoyiyao_lan_url';
  const ROOM_KEY = 'yaoyiyao_room_id';
  let roomId = sessionStorage.getItem(ROOM_KEY) || null;

  const PHASE_TEXT = {
    waiting: '等待开始',
    open: '摇动进行中',
    locked: '待揭晓',
    revealing: '揭晓进行中',
    done: '本轮结束',
  };

  const BG_FALLBACK = {
    default:
      'radial-gradient(1200px 600px at 15% -10%, rgba(226,184,87,0.15), transparent 55%), linear-gradient(165deg, #0c1210, #152019)',
    reveal:
      'radial-gradient(900px 500px at 50% 0%, rgba(226,184,87,0.22), transparent 60%), linear-gradient(165deg, #141008, #0c1210)',
    done:
      'radial-gradient(1000px 500px at 80% 20%, rgba(61,143,106,0.2), transparent 55%), linear-gradient(165deg, #101816, #0c1210)',
  };

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  function setStatus(text) {
    statusMsg.textContent = text || '';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isLoopbackHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  }

  function normalizeBaseUrl(input) {
    const raw = String(input || '').trim().replace(/\/$/, '');
    if (!raw) return '';
    try {
      const u = new URL(raw.includes('://') ? raw : `http://${raw}`);
      return `${u.protocol}//${u.host}`;
    } catch {
      return '';
    }
  }

  function isUsableLanUrl(url) {
    const n = normalizeBaseUrl(url);
    if (!n) return false;
    try {
      return !isLoopbackHost(new URL(n).hostname);
    } catch {
      return false;
    }
  }

  function pickBestBase(fromServer, urls, preferHttp) {
    // 点按模式禁止沿用旧的 https 缓存（8781 已关会导致手机「网络出错」）
    const ok = (raw) => {
      const n = normalizeBaseUrl(raw);
      if (!isUsableLanUrl(n)) return '';
      if (preferHttp) {
        try {
          if (new URL(n).protocol === 'https:') return '';
        } catch {
          return '';
        }
      }
      return n;
    };
    const candidates = [
      paramBase,
      !isLoopbackHost(location.hostname) ? location.origin : '',
      fromServer || '',
      localStorage.getItem(LS_KEY) || '',
      (urls && urls[0]) || '',
    ];
    for (const c of candidates) {
      const n = ok(c);
      if (n) return n;
    }
    return ok(fromServer) || ok((urls && urls[0]) || '') || '';
  }

  function prizesFromState(state) {
    const c = state.config || {};
    const board = state.prizeBoard || {};
    return {
      first: c.firstPrizeName || board.first?.name || '一等奖',
      second: c.secondPrizeName || board.second?.name || '二等奖',
      third: c.thirdPrizeName || board.third?.name || '三等奖',
    };
  }

  function applyLanFromServer(msg) {
    // 云端（Railway 等）用 https；仅局域网点按模式才拒收 https 旧缓存
    const preferHttp =
      msg.preferHttp === true ||
      (msg.mode === 'lan' && (msg.tapOnly || msg.httpsEnabled === false));
    baseUrl = pickBestBase(msg.baseUrl, msg.lanUrls, preferHttp);
    lanReady = isUsableLanUrl(baseUrl);
    stageQr.classList.toggle('is-blocked', !lanReady);
    qrTip.textContent = lanReady
      ? msg.mode === 'cloud'
        ? '手机扫码加入本场（公网）'
        : '手机扫码加入本场'
      : '请与手机连接同一 WiFi 后刷新本页';
    if (lanReady) {
      localStorage.setItem(LS_KEY, baseUrl);
      refreshQr();
    } else if (preferHttp) {
      localStorage.removeItem(LS_KEY);
    }
    updateButtons(currentPhase);
  }

  function showDoneBoard(state) {
    const winners = state.winners || lastWinners;
    const prizes = lastPrizes || prizesFromState(state);
    if (!winners) {
      showIdle(state);
      return;
    }
    lastWinners = winners;
    lastPrizes = prizes;
    stageQr.classList.add('hidden');
    stageIdle.classList.add('hidden');
    if (liveBoard) liveBoard.classList.add('hidden');
    if (roundTimer) roundTimer.classList.add('hidden');
    stageRoll.classList.remove('hidden');
    if (rollLive) {
      rollLive.classList.add('hidden');
      rollLive.classList.remove('is-intro-only');
    }
    if (rollHalfBottom) rollHalfBottom.classList.add('hidden');
    rollFinal.classList.remove('hidden');
    renderAllWinners(winners, prizes);
    updateLayout('done');
    applyBackground('done');
    playMusic('done');
  }

  function applyBackground(mode) {
    if (!screenBg || !screenSettings) return;
    const key =
      mode === 'reveal'
        ? 'backgroundReveal'
        : mode === 'done'
          ? 'backgroundDone'
          : 'backgroundDefault';
    const url = screenSettings[key];
    if (url) {
      screenBg.style.background = `url("${url}") center/cover no-repeat, ${BG_FALLBACK[mode === 'reveal' ? 'reveal' : mode === 'done' ? 'done' : 'default']}`;
    } else {
      screenBg.style.backgroundImage = 'none';
      screenBg.style.background = BG_FALLBACK[mode === 'reveal' ? 'reveal' : mode === 'done' ? 'done' : 'default'];
    }
  }

  function playMusic(mode) {
    if (!bgm || !screenSettings || !musicUnlocked) return;
    const key =
      mode === 'reveal' ? 'musicReveal' : mode === 'done' ? 'musicDone' : 'musicDefault';
    const src = screenSettings[key];
    if (!src) return;
    if (bgm.getAttribute('src') !== src) bgm.src = src;
    bgm.play().catch(() => {});
  }

  function unlockMusic() {
    if (musicUnlocked) return;
    musicUnlocked = true;
    playMusic('default');
  }

  function tierLabel(tier) {
    if (tier === 'first') return '一等奖';
    if (tier === 'second') return '二等奖';
    if (tier === 'third') return '三等奖';
    return '奖项';
  }

  function qrSizeForPhase(phase) {
    if (phase === 'open') return 440;
    if (phase === 'waiting') return 300;
    return 280;
  }

  function updateLayout(phase) {
    if (!screenMain) return;
    const modes = ['waiting', 'open', 'locked', 'reveal', 'done'];
    modes.forEach((m) => screenMain.classList.remove(`mode-${m}`));
    let mode = 'waiting';
    if (phase === 'revealing') mode = 'reveal';
    else if (phase === 'done') mode = 'done';
    else if (phase === 'open' || phase === 'locked') mode = 'open';
    else if (phase === 'waiting') mode = 'waiting';
    screenMain.classList.add(`mode-${mode}`);

    const showQr = phase === 'waiting' || phase === 'open' || phase === 'locked';
    stageQr.classList.toggle('hidden', !showQr);
    if (liveBoard) {
      liveBoard.classList.toggle('hidden', !(phase === 'open' || phase === 'locked'));
    }
    if (roundTimer) {
      roundTimer.classList.toggle('hidden', phase !== 'open');
    }
    if (showQr && mobileUrl) {
      renderQrInto('qrBox', mobileUrl, qrSizeForPhase(phase === 'locked' ? 'open' : phase));
    }
  }

  let hasShakers = false;

  function updateButtons(phase) {
    currentPhase = phase;
    const canEarly = phase === 'open' && !revealBusy && !!roundEndsAt;
    btnStart.disabled = !(phase === 'waiting' || phase === 'done') || !lanReady;
    btnCountdown.classList.toggle('hidden', !canEarly);
    btnCountdown.disabled = !canEarly;
    btnCountdown.textContent = '提前开奖';
    btnMusic.classList.toggle('hidden', phase !== 'done');
    btnStart.textContent = phase === 'done' ? '再来一轮' : '开始摇一摇';
    updateLayout(phase);
  }

  function stopRoundTick() {
    clearInterval(roundTickTimer);
    roundTickTimer = null;
    lastShownLeft = null;
  }

  function paintRoundTimer(left) {
    if (!roundTimer || !roundTimerNum) return;
    roundTimerNum.textContent = String(Math.max(0, left));
    const urgent = left > 0 && left <= urgencySeconds;
    roundTimer.classList.toggle('is-urgent', urgent);
    if (urgent) {
      const t = (urgencySeconds - left) / Math.max(1, urgencySeconds - 1);
      const rem = 5.5 + t * 5.5;
      roundTimerNum.style.fontSize = `clamp(${rem * 0.55}rem, ${8 + t * 8}vw, ${rem}rem)`;
      if (roundTimerLabel) roundTimerLabel.textContent = left <= 3 ? '即将开奖！' : '秒后开奖';
    } else {
      roundTimerNum.style.fontSize = '';
      if (roundTimerLabel) roundTimerLabel.textContent = '秒后开奖';
    }
  }

  function syncRoundTimer(msg) {
    if (msg.serverNow) clockOffset = msg.serverNow - Date.now();
    if (msg.urgencySeconds) urgencySeconds = msg.urgencySeconds;
    if (msg.roundEndsAt) {
      roundEndsAt = msg.roundEndsAt;
      startRoundTick();
    } else {
      roundEndsAt = null;
      stopRoundTick();
      if (roundTimer) roundTimer.classList.add('hidden');
    }
  }

  function startRoundTick() {
    stopRoundTick();
    if (!roundEndsAt) return;
    const tick = () => {
      const now = Date.now() + clockOffset;
      const left = Math.max(0, Math.ceil((roundEndsAt - now) / 1000));
      if (left !== lastShownLeft) {
        lastShownLeft = left;
        paintRoundTimer(left);
      }
      if (roundTimer && currentPhase === 'open') roundTimer.classList.remove('hidden');
      if (left <= 0) stopRoundTick();
    };
    tick();
    roundTickTimer = setInterval(tick, 200);
  }

  function renderQrInto(elId, text, size) {
    const el = $(elId);
    if (!el || !text) return;
    el.innerHTML = '';
    if (typeof QRCode === 'undefined') {
      el.textContent = '二维码未加载';
      return;
    }
    new QRCode(el, {
      text,
      width: size,
      height: size,
      colorDark: '#152019',
      colorLight: '#f7f3ea',
      correctLevel: QRCode.CorrectLevel.M,
    });
  }

  function refreshQr() {
    if (!roomId || !lanReady || !baseUrl) return;
    mobileUrl = `${baseUrl}/m?room=${encodeURIComponent(roomId)}`;
    renderQrInto('qrBox', mobileUrl, qrSizeForPhase(currentPhase));
    setStatus(`房间 ${roomId} · 扫码已就绪`);
  }

  function renderJoinedCloud(names) {
    joinedCloud.innerHTML = '';
    (names || []).forEach((name, i) => {
      const span = document.createElement('span');
      span.textContent = name;
      span.style.animationDelay = `${Math.min(i, 8) * 40}ms`;
      joinedCloud.appendChild(span);
    });
  }

  function renderLiveBoard(list) {
    if (!liveBoardList) return;
    const rows = (list || []).slice(0, 5);
    const max = Math.max(...rows.map((r) => Number(r.shakeCount) || 0), 1);
    liveBoardList.innerHTML = rows
      .map((r, i) => {
        const count = Number(r.shakeCount) || 0;
        const pct = Math.max(8, Math.round((count / max) * 100));
        const rank = r.rank || i + 1;
        return `
      <div class="live-row live-rank-${rank}" data-rank="${rank}">
        <div class="live-medal" aria-hidden="true">${rank}</div>
        <div class="live-row-body">
          <div class="live-row-head">
            <span class="live-row-name" title="${escapeHtml(r.nickname)}">${escapeHtml(r.nickname)}</span>
            <span class="live-row-count"><b>${count}</b><small>次</small></span>
          </div>
          <div class="live-bar-track">
            <div class="live-bar-fill" style="--bar:${pct}%"></div>
          </div>
        </div>
      </div>`;
      })
      .join('');
    if (liveBoardEmpty) {
      liveBoardEmpty.classList.toggle('hidden', rows.length > 0);
    }
    requestAnimationFrame(() => {
      liveBoardList.querySelectorAll('.live-bar-fill').forEach((el) => {
        el.style.width = getComputedStyle(el).getPropertyValue('--bar');
      });
    });
  }

  function stopRollAnimation() {
    clearInterval(countdownTimer);
    clearTimeout(introTimer);
    countdownTimer = null;
    introTimer = null;
    rollCountdown.classList.remove('is-go', 'is-intro');
  }

  function showRollView() {
    stageQr.classList.add('hidden');
    stageIdle.classList.add('hidden');
    if (liveBoard) liveBoard.classList.add('hidden');
    if (roundTimer) roundTimer.classList.add('hidden');
    stageRoll.classList.remove('hidden');
    if (rollLive) {
      rollLive.classList.remove('hidden');
      rollLive.classList.add('is-intro-only');
    }
    if (rollHalfBottom) rollHalfBottom.classList.add('hidden');
    rollFinal.classList.add('hidden');
    updateLayout('revealing');
    applyBackground('reveal');
    playMusic('reveal');
  }

  function finishRollLocally() {
    stopRollAnimation();
    host('reveal_tier_done');
  }

  function renderAllWinners(winners, prizes) {
    rollWinners.innerHTML = '';
    const tiers = [
      { key: 'first', label: prizes?.first || '一等奖' },
      { key: 'second', label: prizes?.second || '二等奖' },
      { key: 'third', label: prizes?.third || '三等奖' },
    ];
    let any = false;
    tiers.forEach((tier) => {
      const list = (winners && winners[tier.key]) || [];
      const col = document.createElement('div');
      col.className = `roll-tier-col roll-tier-${tier.key}`;
      const title = document.createElement('h3');
      title.textContent = tier.label;
      col.appendChild(title);
      if (!list.length) {
        const empty = document.createElement('p');
        empty.className = 'roll-tier-empty';
        empty.textContent = '暂无';
        col.appendChild(empty);
      } else {
        any = true;
        list.forEach((w, i) => {
          const card = document.createElement('div');
          card.className = 'roll-winner-card';
          card.style.animationDelay = `${i * 60}ms`;
          const shakes = w.shakeCount != null ? ` · ${w.shakeCount} 次` : '';
          card.innerHTML = `
            <div class="rank">第 ${w.rank} 名${shakes}</div>
            <div class="name">${escapeHtml(w.nickname)}</div>
          `;
          col.appendChild(card);
        });
      }
      rollWinners.appendChild(col);
    });
    if (!any) {
      rollWinners.innerHTML = '<p style="color:var(--muted)">暂无中奖者</p>';
    }
  }

  function renderTopChart(list) {
    if (!rollChart) return;
    const rows = (list || []).slice(0, 5);
    rollNamesLabel.textContent = '摇动实力榜 · Top 5';
    if (!rows.length) {
      rollChart.innerHTML = '<p style="color:var(--muted);margin:0">暂无摇动数据</p>';
      return;
    }
    const max = Math.max(...rows.map((r) => Number(r.shakeCount) || 0), 1);
    rollChart.innerHTML = rows
      .map((r, i) => {
        const count = Number(r.shakeCount) || 0;
        const pct = Math.max(6, Math.round((count / max) * 100));
        return `
          <div class="roll-bar-row" style="animation-delay:${i * 45}ms">
            <span class="roll-bar-rank">${r.rank || i + 1}</span>
            <span class="roll-bar-name" title="${escapeHtml(r.nickname)}">${escapeHtml(r.nickname)}</span>
            <div class="roll-bar-track"><div class="roll-bar-fill" style="width:${pct}%"></div></div>
            <span class="roll-bar-count">${count}</span>
          </div>
        `;
      })
      .join('');
    // 触发宽度动画：先置 0 再设回
    requestAnimationFrame(() => {
      rollChart.querySelectorAll('.roll-bar-fill').forEach((el) => {
        const w = el.style.width;
        el.style.width = '0';
        requestAnimationFrame(() => {
          el.style.width = w;
        });
      });
    });
  }

  function showTopChart(list) {
    if (rollLive) rollLive.classList.remove('is-intro-only');
    if (rollHalfBottom) rollHalfBottom.classList.remove('hidden');
    renderTopChart(list);
  }

  function startTenCountdown(seconds, onDone) {
    let left = seconds;
    rollCountdown.classList.remove('is-go', 'is-intro');
    rollCountdown.textContent = String(left);
    rollCountdownLabel.textContent = '秒后公布最终名单';
    rollStep.textContent = '揭晓进行中';
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      left -= 1;
      rollCountdown.textContent = String(Math.max(0, left));
      if (left <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        onDone();
      }
    }, 1000);
  }

  function runIntroThenCountdown(payload) {
    const intro = payload.intro && payload.intro.length ? payload.intro : ['3', '2', '1', 'GO!'];
    const stepMs = payload.introStepMs || 1000;
    const seconds = payload.countdownSeconds || screenSettings?.countdownSeconds || 10;
    const prizes = payload.prizes || {};
    const topShakers = payload.topShakers || [];

    // 阶段一：全屏只播 3 → 2 → 1 → GO!
    if (rollLive) rollLive.classList.add('is-intro-only');
    if (rollHalfBottom) rollHalfBottom.classList.add('hidden');

    rollStep.textContent = '预备开始';
    rollPrize.textContent = [prizes.first, prizes.second, prizes.third]
      .filter(Boolean)
      .join(' · ') || '一 · 二 · 三等奖';
    rollCountdownLabel.textContent = '预备…';
    rollCountdown.classList.add('is-intro');

    let i = 0;
    const tickIntro = () => {
      if (i >= intro.length) {
        // 阶段二：上半 10 秒倒计时 + 下半 Top10 柱状图
        showTopChart(topShakers);
        startTenCountdown(seconds, () => {
          stopRollAnimation();
          if (rollLive) {
            rollLive.classList.add('hidden');
            rollLive.classList.remove('is-intro-only');
          }
          rollFinal.classList.remove('hidden');
          renderAllWinners(payload.winners, prizes);
          setStatus('三个奖项已同时揭晓');
          setTimeout(finishRollLocally, 2800);
        });
        return;
      }
      const step = intro[i];
      rollCountdown.textContent = step;
      rollCountdown.classList.add('is-intro');
      rollCountdown.classList.toggle('is-go', String(step).toUpperCase() === 'GO!');
      rollCountdownLabel.textContent = String(step).toUpperCase() === 'GO!' ? '开始！' : '预备…';
      i += 1;
      introTimer = setTimeout(tickIntro, stepMs);
    };
    tickIntro();
  }

  function startRollAnimation(payload) {
    stopRollAnimation();
    revealBusy = true;
    showRollView();
    runIntroThenCountdown(payload);
    updateButtons(currentPhase);
  }

  function showIdle(state) {
    stageRoll.classList.add('hidden');
    applyBackground(state.phase === 'done' ? 'done' : 'default');

    if (state.phase === 'waiting' || state.phase === 'open' || state.phase === 'locked') {
      stageIdle.classList.add('hidden');
      stageQr.classList.remove('hidden');
      if (liveBoard) {
        liveBoard.classList.toggle('hidden', state.phase === 'waiting');
      }
      if (roundTimer) {
        roundTimer.classList.toggle('hidden', state.phase !== 'open');
      }
      if (state.phase === 'open' || state.phase === 'locked') {
        renderLiveBoard(state.topShakers || state.participants || []);
      }
      if (state.phase === 'waiting') {
        qrTip.textContent = lanReady ? '手机扫码加入本场' : '网络未就绪';
      } else if (state.phase === 'open') {
        qrTip.textContent = '倒计时中 · 请大力摇一摇！';
      } else {
        qrTip.textContent = '已锁定';
      }
      return;
    }

    stageQr.classList.add('hidden');
    if (liveBoard) liveBoard.classList.add('hidden');
    if (roundTimer) roundTimer.classList.add('hidden');
    stageIdle.classList.remove('hidden');

    if (state.phase === 'revealing' && !revealBusy) {
      stageTitle.textContent = '揭晓完成';
      stageDesc.textContent = '名单已公布';
    } else if (state.phase === 'done') {
      stageTitle.textContent = '本轮已结束';
      stageDesc.textContent = '可切换庆功音乐，或开始新一轮。';
      applyBackground('done');
      playMusic('done');
    }
    renderJoinedCloud(state.joinedPreview);
  }

  function applyState(state) {
    phasePill.textContent = PHASE_TEXT[state.phase] || state.phase;
    joinedCount.textContent = state.participantCount ?? 0;
    shakenCount.textContent =
      state.totalShakes != null ? state.totalShakes : state.shakenCount ?? 0;
    hasShakers = (state.shakenCount || 0) > 0 || (state.totalShakes || 0) > 0;
    revealBusy = !!state.revealBusy;
    nextRevealTier = state.nextRevealTier || null;

    if (state.phase === 'open' && state.roundEndsAt) {
      syncRoundTimer(state);
    } else if (state.phase !== 'open') {
      roundEndsAt = null;
      stopRoundTick();
    }

    updateButtons(state.phase);

    if (state.phase === 'open' || state.phase === 'locked') {
      renderLiveBoard(state.topShakers || state.participants || []);
    }

    if (state.phase === 'revealing' && (revealBusy || !stageRoll.classList.contains('hidden'))) {
      return;
    }
    if (state.phase === 'done') {
      if (state.winners) lastWinners = state.winners;
      showDoneBoard(state);
      return;
    }
    if (!revealBusy) showIdle(state);
  }

  function persistRoom(id) {
    roomId = id || null;
    if (roomId) sessionStorage.setItem(ROOM_KEY, roomId);
    else sessionStorage.removeItem(ROOM_KEY);
  }

  function createOrJoinScreen() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(roomId ? { type: 'join_screen', roomId } : { type: 'create_screen' }));
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket(wsUrl());
    ws.addEventListener('open', () => {
      setStatus('已连接');
      createOrJoinScreen();
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === 'error') {
        setStatus(msg.message || '出错了');
        // 刷新后房间已失效：清掉缓存并新建
        if (roomId && /房间不存在/.test(msg.message || '')) {
          persistRoom(null);
          createOrJoinScreen();
        }
        return;
      }
      if (msg.type === 'screen_ready') {
        persistRoom(msg.roomId);
        if (msg.screenSettings) screenSettings = msg.screenSettings;
        applyLanFromServer(msg);
        applyBackground('default');
        return;
      }
      if (msg.type === 'lan_info') {
        applyLanFromServer(msg);
        return;
      }
      if (msg.type === 'state') {
        applyState(msg);
        return;
      }
      if (msg.type === 'round_timer') {
        syncRoundTimer(msg);
        phasePill.textContent = PHASE_TEXT.open;
        currentPhase = 'open';
        updateButtons('open');
        setStatus('倒计时开始 · 摇起来！');
        return;
      }
      if (msg.type === 'round_end') {
        stopRoundTick();
        roundEndsAt = null;
        if (msg.screenSettings) screenSettings = msg.screenSettings;
        if (msg.winners) lastWinners = msg.winners;
        if (msg.prizes) lastPrizes = msg.prizes;
        phasePill.textContent = PHASE_TEXT.done;
        revealBusy = false;
        showDoneBoard({
          phase: 'done',
          winners: msg.winners || lastWinners,
          config: msg.config || {},
        });
        btnMusic.classList.remove('hidden');
        updateButtons('done');
        setStatus('时间到 · 开奖！');
        return;
      }
      if (msg.type === 'reveal_roll') {
        if (msg.screenSettings) screenSettings = msg.screenSettings;
        if (msg.winners) lastWinners = msg.winners;
        if (msg.prizes) lastPrizes = msg.prizes;
        phasePill.textContent = PHASE_TEXT.revealing;
        startRollAnimation(msg);
        return;
      }
      if (msg.type === 'all_revealed') {
        if (msg.screenSettings) screenSettings = msg.screenSettings;
        if (msg.winners) lastWinners = msg.winners;
        phasePill.textContent = PHASE_TEXT.done;
        revealBusy = false;
        showDoneBoard({ phase: 'done', winners: msg.winners || lastWinners, config: {} });
        btnMusic.classList.remove('hidden');
        setStatus('三个奖项已全部揭晓');
      }
    });
    ws.addEventListener('close', () => {
      setStatus('连接断开，重连中…');
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 1200);
    });
  }

  function host(action) {
    unlockMusic();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setStatus('尚未连接服务器');
      return;
    }
    ws.send(JSON.stringify({ type: 'host', action }));
  }

  async function loadScreenSettings() {
    try {
      const res = await fetch('/api/screen-settings');
      screenSettings = await res.json();
      applyBackground('default');
    } catch {
      screenSettings = { countdownSeconds: 10 };
    }
  }

  btnStart.addEventListener('click', () => {
    unlockMusic();
    lastWinners = null;
    lastPrizes = null;
    host('start');
  });
  btnCountdown.addEventListener('click', () => host('start_countdown'));
  btnReset.addEventListener('click', () => {
    if (confirm('确定重置本轮？')) {
      lastWinners = null;
      lastPrizes = null;
      stopRollAnimation();
      stopRoundTick();
      roundEndsAt = null;
      host('reset');
    }
  });
  btnMusic.addEventListener('click', () => {
    unlockMusic();
    playMusic('done');
    setStatus('已切换庆功背景音乐');
  });

  loadScreenSettings().then(() => {
    updateButtons('waiting');
    connect();
  });
})();
