(() => {
  const $ = (id) => document.getElementById(id);

  const panelJoin = $('panelJoin');
  const panelWait = $('panelWait');
  const panelShake = $('panelShake');
  const panelReveal = $('panelReveal');
  const panelResult = $('panelResult');

  const nicknameInput = $('nickname');
  const roomLabel = $('roomLabel');
  const btnJoin = $('btnJoin');
  const joinMsg = $('joinMsg');

  const waitStatus = $('waitStatus');
  const waitHint = $('waitHint');

  const shakeOrb = $('shakeOrb');
  const shakeTitle = $('shakeTitle');
  const shakeHint = $('shakeHint');
  const orbCount = $('orbCount');
  const orbFill = $('orbFill');
  const tapFx = $('tapFx');
  const btnManualShake = $('btnManualShake');
  const mRoundTimer = $('mRoundTimer');
  const mRoundTimerNum = $('mRoundTimerNum');
  const mRoundTimerLabel = $('mRoundTimerLabel');
  const mStartCd = $('mStartCd');
  const mStartCdNum = $('mStartCdNum');
  const mStartCdLabel = $('mStartCdLabel');

  const mRollLive = $('mRollLive');
  const mRollFinal = $('mRollFinal');
  const mRollBottom = $('mRollBottom');
  const mRollStep = $('mRollStep');
  const mRollPrize = $('mRollPrize');
  const mRollCountdown = $('mRollCountdown');
  const mRollLabel = $('mRollLabel');
  const mRollNamesLabel = $('mRollNamesLabel');
  const mRollChart = $('mRollChart');
  const mRollWinners = $('mRollWinners');
  const mMyResultHint = $('mMyResultHint');

  const resultPrize = $('resultPrize');
  const resultRank = $('resultRank');
  const resultName = $('resultName');
  const resultKicker = $('resultKicker');
  const fwCanvas = $('fwCanvas');

  const params = new URLSearchParams(location.search);
  const roomId = params.get('room') || '';
  roomLabel.textContent = roomId || '未指定（请扫大屏二维码）';

  let ws = null;
  let phase = 'waiting';
  let sensorReady = false;
  let sensorListening = false;
  let myRank = null;
  let myShakeCount = 0;
  let lastShakeFire = 0;
  let joinedNickname = '';
  let countdownTimer = null;
  let introTimer = null;
  let pendingPersonalResult = null;
  let pendingIsTopWinner = false;
  let fwRaf = 0;
  let fwTimer = 0;
  let fwRunning = false;
  let roundEndsAt = null;
  let clockOffset = 0;
  let urgencySeconds = 5;
  let roundTickTimer = null;
  let lastShownLeft = null;
  let startIntroTimer = null;
  let startIntroOpenAt = null;
  let lastAx = null;
  let lastAy = null;
  let lastAz = null;
  let motionEventCount = 0;
  let motionWatchTimer = null;
  let lastTapFire = 0;
  let lastMotionFire = 0;
  let suppressMotionUntil = 0;
  let lastTouchTapAt = 0;
  const activeTapPointers = new Set();

  // false = 仅点按（HTTP 可用，无证书警告）；true = 启用真摇传感器（需 HTTPS）
  // 下面整段传感器逻辑保留，改回 true 即可恢复摇手机
  const ENABLE_SHAKE_SENSOR = false;

  // 真摇相关参数（仅 ENABLE_SHAKE_SENSOR=true 时使用）
  const MOTION_SCORE_MIN = 1.2;
  const MOTION_COOLDOWN_MS = 0;
  const MOTION_SUPPRESS_AFTER_TAP_MS = 80;
  const GHOST_MOUSE_IGNORE_MS = 450;

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  function show(panel) {
    [panelJoin, panelWait, panelShake, panelReveal, panelResult].forEach((el) => {
      el.classList.toggle('hidden', el !== panel);
    });
  }

  function setJoinError(text) {
    joinMsg.textContent = text || '';
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  const FW_COLORS = ['#e2b857', '#f5c84a', '#fff4c8', '#3d8f6a', '#7fd4a8', '#ff7b6b', '#ffd0c8'];

  function stopFireworks() {
    fwRunning = false;
    cancelAnimationFrame(fwRaf);
    clearTimeout(fwTimer);
    fwRaf = 0;
    fwTimer = 0;
    if (fwCanvas) {
      const ctx = fwCanvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, fwCanvas.width, fwCanvas.height);
    }
  }

  function startFireworks() {
    if (!fwCanvas || fwRunning) return;
    fwRunning = true;
    const ctx = fwCanvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const rect = panelResult.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      fwCanvas.width = Math.max(1, Math.floor(rect.width * dpr));
      fwCanvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const rockets = [];
    const sparks = [];
    const burst = (x, y) => {
      const color = FW_COLORS[(Math.random() * FW_COLORS.length) | 0];
      const n = 28 + ((Math.random() * 18) | 0);
      for (let i = 0; i < n; i += 1) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.2;
        const speed = 1.6 + Math.random() * 3.4;
        sparks.push({
          x,
          y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          life: 0.75 + Math.random() * 0.55,
          color,
          size: 1.4 + Math.random() * 1.8,
        });
      }
    };
    const launch = () => {
      if (!fwRunning) return;
      const w = panelResult.clientWidth || 320;
      const h = panelResult.clientHeight || 480;
      rockets.push({
        x: w * (0.18 + Math.random() * 0.64),
        y: h,
        vx: (Math.random() - 0.5) * 1.2,
        vy: -(5.2 + Math.random() * 2.4),
        color: FW_COLORS[(Math.random() * FW_COLORS.length) | 0],
        targetY: h * (0.18 + Math.random() * 0.28),
      });
      fwTimer = setTimeout(launch, 420 + Math.random() * 520);
    };

    const tick = () => {
      if (!fwRunning) return;
      const w = panelResult.clientWidth || 320;
      const h = panelResult.clientHeight || 480;
      ctx.clearRect(0, 0, w, h);

      for (let i = rockets.length - 1; i >= 0; i -= 1) {
        const r = rockets[i];
        r.x += r.vx;
        r.y += r.vy;
        r.vy += 0.045;
        ctx.beginPath();
        ctx.fillStyle = r.color;
        ctx.arc(r.x, r.y, 2.2, 0, Math.PI * 2);
        ctx.fill();
        if (r.y <= r.targetY || r.vy >= 0) {
          burst(r.x, r.y);
          rockets.splice(i, 1);
        }
      }

      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const s = sparks[i];
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.035;
        s.vx *= 0.99;
        s.life -= 0.016;
        if (s.life <= 0) {
          sparks.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = Math.max(0, Math.min(1, s.life));
        ctx.beginPath();
        ctx.fillStyle = s.color;
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      fwRaf = requestAnimationFrame(tick);
    };

    launch();
    setTimeout(launch, 180);
    setTimeout(launch, 360);
    fwRaf = requestAnimationFrame(tick);

    // 约 12 秒后停止新发射，粒子自然消散
    setTimeout(() => {
      clearTimeout(fwTimer);
      fwTimer = 0;
      setTimeout(stopFireworks, 2500);
    }, 12000);
  }

  function showCongrats(msg) {
    const rank = Number(msg.rank) || 0;
    pendingIsTopWinner = true;
    pendingPersonalResult = `恭喜！你是第 ${rank} 名${
      msg.shakeCount != null ? ` · 点了 ${msg.shakeCount} 次` : ''
    }`;
    if (resultKicker) resultKicker.textContent = '恭喜上榜';
    resultPrize.textContent = '恭喜你！';
    resultRank.textContent = rank > 0 ? `你是第 ${rank} 名` : '你已进入前五名';
    resultName.textContent = [
      msg.nickname ? `昵称：${msg.nickname}` : '',
      msg.shakeCount != null ? `本轮 ${msg.shakeCount} 次` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    phase = 'done';
    stopRevealTimers();
    show(panelResult);
    stopFireworks();
    requestAnimationFrame(() => startFireworks());
    if (navigator.vibrate) navigator.vibrate([40, 40, 80]);
  }

  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let pendingOptimistic = 0;

  function applyServerClock(msg) {
    if (msg && msg.serverNow) clockOffset = msg.serverNow - Date.now();
  }

  function stopHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function startHeartbeat() {
    stopHeartbeat();
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        send({ type: 'ping' });
      }
    }, 20000);
  }

  function scheduleReconnect() {
    if (!joinedNickname) return;
    clearTimeout(reconnectTimer);
    const delay = Math.min(10000, 1000 * Math.pow(2, reconnectAttempt));
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      connect(() => {
        send({ type: 'join_player', roomId, nickname: joinedNickname });
      });
    }, delay);
  }

  function connect(onOpen) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (onOpen) onOpen();
      return;
    }
    if (ws && ws.readyState === WebSocket.CONNECTING) {
      ws.addEventListener('open', () => onOpen && onOpen(), { once: true });
      return;
    }

    ws = new WebSocket(wsUrl());
    ws.addEventListener('open', () => {
      reconnectAttempt = 0;
      startHeartbeat();
      if (onOpen) onOpen();
    });
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', () => {
      stopHeartbeat();
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      /* close handler will reconnect */
    });
  }

  function send(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
  }

  function applyJoinedOrSync(msg) {
    joinedNickname = msg.nickname || joinedNickname;
    setJoinError('');
    applyServerClock(msg);
    if (typeof msg.shakeCount === 'number') {
      myShakeCount = msg.shakeCount;
      pendingOptimistic = 0;
    }
    if (msg.rank != null) myRank = msg.rank;
    if (msg.roundEndsAt) syncRoundTimer(msg);
    else if (msg.phase && msg.phase !== 'open') {
      roundEndsAt = null;
      stopRoundTick();
      if (mRoundTimer) mRoundTimer.classList.add('hidden');
    }
    maybeRequestSensorUi();
    if (msg.phase) {
      applyPhase(msg.phase);
      if (msg.phase === 'starting' && msg.startIntro) runStartIntro(msg.startIntro);
    }
    updateShakeUi();
  }

  function stopRevealTimers() {
    clearInterval(countdownTimer);
    clearTimeout(introTimer);
    countdownTimer = null;
    introTimer = null;
    mRollCountdown.classList.remove('is-go', 'is-intro');
  }

  function renderAllWinners(winners, prizes) {
    mRollWinners.innerHTML = '';
    const list = Array.isArray(winners)
      ? winners
      : (winners && (winners.top || winners.first)) || [];
    const rows = list || [];
    const col = document.createElement('div');
    col.className = 'm-tier-col';
    const title = document.createElement('h3');
    title.textContent = prizes?.top || '本轮前五名';
    col.appendChild(title);
    if (!rows.length) {
      const empty = document.createElement('p');
      empty.className = 'm-tier-empty';
      empty.textContent = '暂无上榜';
      col.appendChild(empty);
    } else {
      rows.forEach((w) => {
        const row = document.createElement('div');
        row.className = 'person';
        const shakes = w.shakeCount != null ? ` · ${w.shakeCount} 次` : '';
        row.innerHTML = `<strong>第 ${w.rank} 名</strong> · ${escapeHtml(w.nickname)}${shakes}`;
        col.appendChild(row);
      });
    }
    mRollWinners.appendChild(col);
  }

  function renderTopChart(list) {
    if (!mRollChart) return;
    const rows = (list || []).slice(0, 20);
    mRollNamesLabel.textContent = '实时冲榜 · Top 20';
    if (!rows.length) {
      mRollChart.innerHTML = '<p class="m-tier-empty">暂无数据</p>';
      return;
    }
    const max = Math.max(...rows.map((r) => Number(r.shakeCount) || 0), 1);
    mRollChart.innerHTML = rows
      .map((r, i) => {
        const count = Number(r.shakeCount) || 0;
        const pct = Math.max(8, Math.round((count / max) * 100));
        return `
          <div class="m-bar-row">
            <span class="m-bar-rank">${r.rank || i + 1}</span>
            <span class="m-bar-name">${escapeHtml(r.nickname)}</span>
            <div class="m-bar-track"><div class="m-bar-fill" style="width:${pct}%"></div></div>
            <span class="m-bar-count">${count}</span>
          </div>
        `;
      })
      .join('');
  }

  function showTopChart(list) {
    if (mRollLive) mRollLive.classList.remove('is-intro-only');
    if (mRollBottom) mRollBottom.classList.remove('hidden');
    renderTopChart(list);
  }

  function startTenCountdown(seconds, onDone) {
    let left = seconds;
    mRollCountdown.classList.remove('is-go', 'is-intro');
    mRollCountdown.textContent = String(left);
    mRollLabel.textContent = '秒后公布最终名单';
    mRollStep.textContent = '揭晓进行中';
    clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      left -= 1;
      mRollCountdown.textContent = String(Math.max(0, left));
      if (left <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        onDone();
      }
    }, 1000);
  }

  function startRevealRoll(payload) {
    stopRevealTimers();
    phase = 'revealing';
    show(panelReveal);
    mRollLive.classList.remove('hidden');
    mRollLive.classList.add('is-intro-only');
    if (mRollBottom) mRollBottom.classList.add('hidden');
    mRollFinal.classList.add('hidden');

    const intro = payload.intro && payload.intro.length ? payload.intro : ['3', '2', '1', 'GO!'];
    const stepMs = payload.introStepMs || 1000;
    const seconds = payload.countdownSeconds || 10;
    const prizes = payload.prizes || {};
    const topShakers = payload.topShakers || [];

    mRollStep.textContent = '预备开始';
    mRollPrize.textContent = '冲榜进行中';
    mRollLabel.textContent = '预备…';
    mRollCountdown.classList.add('is-intro');

    let i = 0;
    const tickIntro = () => {
      if (i >= intro.length) {
        showTopChart(topShakers);
        startTenCountdown(seconds, () => {
          stopRevealTimers();
          mRollLive.classList.add('hidden');
          mRollLive.classList.remove('is-intro-only');
          mRollFinal.classList.remove('hidden');
          renderAllWinners(payload.winners, prizes);
          if (pendingPersonalResult) {
            mMyResultHint.textContent = pendingPersonalResult;
          } else if (myRank) {
            mMyResultHint.textContent = `你的排名：第 ${myRank} 名 · 点了 ${myShakeCount} 次`;
          } else {
            mMyResultHint.textContent = '本轮未上榜';
          }
        });
        return;
      }
      const step = intro[i];
      mRollCountdown.textContent = step;
      mRollCountdown.classList.add('is-intro');
      mRollCountdown.classList.toggle('is-go', String(step).toUpperCase() === 'GO!');
      mRollLabel.textContent = String(step).toUpperCase() === 'GO!' ? '开始！' : '预备…';
      i += 1;
      introTimer = setTimeout(tickIntro, stepMs);
    };
    tickIntro();
  }

  function updateShakeUi(opts = {}) {
    const popped = !!opts.pop;
    if (orbCount) {
      orbCount.textContent = String(myShakeCount);
      if (popped) {
        orbCount.classList.remove('is-pop');
        void orbCount.offsetWidth;
        orbCount.classList.add('is-pop');
      }
    }

    // 圆球内填充随次数轻微变化（每 20 次一循环）
    const cycle = 20;
    const inCycle = myShakeCount % cycle;
    const pct = myShakeCount === 0 ? 0 : Math.max(6, Math.round(((inCycle || cycle) / cycle) * 100));
    if (orbFill) orbFill.style.height = `${pct}%`;

    if (phase === 'starting') {
      shakeTitle.textContent = '看这里！马上开始';
      shakeHint.textContent = '圆球会跳动 · 倒计时结束后开始幸运多一点';
      return;
    }
    shakeTitle.textContent = myShakeCount > 0 ? '继续点！' : '幸运多一点 · 猛点冲分';
    shakeHint.textContent =
      myShakeCount > 0
        ? `已点 ${myShakeCount} 次 · 只看自己的成绩`
        : phase === 'open'
          ? '倒计时中 · 幸运多一点'
          : '只看自己的次数 · 点得越多排名越高';
  }

  function spawnTapFx() {
    if (!tapFx) return;
    const el = document.createElement('span');
    el.className = 'tap-plus';
    el.textContent = '+1';
    const x = 30 + Math.random() * 40;
    const y = 25 + Math.random() * 35;
    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    tapFx.appendChild(el);
    setTimeout(() => el.remove(), 700);
  }

  function setTapBounce(on) {
    if (shakeOrb) shakeOrb.classList.toggle('is-bounce', !!on);
    if (btnManualShake) btnManualShake.classList.toggle('is-bounce', !!on);
  }

  function stopStartIntro() {
    clearTimeout(startIntroTimer);
    startIntroTimer = null;
    startIntroOpenAt = null;
    if (mStartCd) mStartCd.classList.add('hidden');
  }

  function paintStartCd(step) {
    if (!mStartCd || !mStartCdNum) return;
    mStartCd.classList.remove('hidden');
    const text = String(step);
    const isGo = text.toUpperCase() === 'GO!';
    mStartCdNum.textContent = text;
    mStartCdNum.classList.remove('is-go');
    void mStartCdNum.offsetWidth;
    mStartCdNum.classList.toggle('is-go', isGo);
    if (mStartCdLabel) mStartCdLabel.textContent = isGo ? '开始！' : '预备…';
  }

  function runStartIntro(payload) {
    stopStartIntro();
    stopRoundTick();
    if (mRoundTimer) mRoundTimer.classList.add('hidden');

    const intro = payload.intro && payload.intro.length ? payload.intro : ['3', '2', '1', 'GO!'];
    const stepMs = payload.introStepMs || 1000;
    if (payload.serverNow) clockOffset = payload.serverNow - Date.now();
    startIntroOpenAt = payload.openAt || Date.now() + intro.length * stepMs;

    phase = 'starting';
    show(panelShake);
    setTapBounce(true);
    updateShakeUi();
    shakeTitle.textContent = '看这里！马上开始';
    shakeHint.textContent = '圆球会跳动 · 倒计时结束后开始幸运多一点';

    const now = Date.now() + clockOffset;
    const elapsed = Math.max(0, now - (startIntroOpenAt - intro.length * stepMs));
    let i = Math.min(intro.length - 1, Math.floor(elapsed / stepMs));

    const tick = () => {
      if (phase !== 'starting') return;
      if (i >= intro.length) {
        stopStartIntro();
        return;
      }
      paintStartCd(intro[i]);
      i += 1;
      startIntroTimer = setTimeout(tick, stepMs);
    };
    tick();
  }

  function stopRoundTick() {
    clearInterval(roundTickTimer);
    roundTickTimer = null;
    lastShownLeft = null;
  }

  function paintMobileTimer(left) {
    if (!mRoundTimer || !mRoundTimerNum) return;
    mRoundTimerNum.textContent = String(Math.max(0, left));
    const urgent = left > 0 && left <= urgencySeconds;
    mRoundTimer.classList.toggle('is-urgent', urgent);
    if (urgent) {
      const t = (urgencySeconds - left) / Math.max(1, urgencySeconds - 1);
      mRoundTimerNum.style.fontSize = `${2.8 + t * 2.2}rem`;
      if (mRoundTimerLabel) mRoundTimerLabel.textContent = left <= 3 ? '即将开奖！' : '秒后开奖';
    } else {
      mRoundTimerNum.style.fontSize = '';
      if (mRoundTimerLabel) mRoundTimerLabel.textContent = '秒后开奖';
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
      if (mRoundTimer) mRoundTimer.classList.add('hidden');
    }
  }

  function startRoundTick() {
    stopRoundTick();
    if (!roundEndsAt) return;
    if (mRoundTimer) mRoundTimer.classList.remove('hidden');
    const tick = () => {
      const now = Date.now() + clockOffset;
      const left = Math.max(0, Math.ceil((roundEndsAt - now) / 1000));
      if (left !== lastShownLeft) {
        lastShownLeft = left;
        paintMobileTimer(left);
      }
      if (left <= 0) stopRoundTick();
    };
    tick();
    roundTickTimer = setInterval(tick, 200);
  }

  function clearPersonalResult() {
    pendingPersonalResult = null;
    pendingIsTopWinner = false;
    stopFireworks();
  }

  function applyPhase(next) {
    phase = next;

    if (phase === 'waiting' || phase === 'starting' || phase === 'open') {
      clearPersonalResult();
    }

    if (phase === 'revealing') {
      stopStartIntro();
      setTapBounce(false);
      if (panelReveal.classList.contains('hidden')) {
        waitStatus.textContent = myShakeCount ? (myRank ? `第 ${myRank} 名` : '已上榜') : '未上榜';
        waitHint.textContent = '揭晓即将开始，请看大屏与本机倒计时';
        show(panelWait);
      }
      return;
    }

    if (phase === 'starting') {
      show(panelShake);
      setTapBounce(true);
      if (mRoundTimer) mRoundTimer.classList.add('hidden');
      updateShakeUi();
      shakeTitle.textContent = '看这里！马上开始';
      shakeHint.textContent = '圆球会跳动 · 倒计时结束后开始幸运多一点';
      return;
    }

    if (phase === 'open') {
      stopStartIntro();
      waitStatus.textContent = '可以点了';
      waitHint.textContent = '倒计时中，幸运多一点！';
      updateShakeUi();
      show(panelShake);
      setTapBounce(true);
      shakeTitle.textContent = myShakeCount > 0 ? '继续点！' : '幸运多一点 · 猛点冲分';
      shakeHint.textContent =
        myShakeCount > 0 ? `已点 ${myShakeCount} 次 · 只看自己的成绩` : '倒计时中 · 点跳动的圆球冲分';
      if (roundEndsAt) {
        if (mRoundTimer) mRoundTimer.classList.remove('hidden');
      }
      maybeRequestSensorUi();
      return;
    }

    if (phase === 'locked') {
      stopStartIntro();
      setTapBounce(false);
      waitStatus.textContent = myShakeCount ? `已点 ${myShakeCount} 次` : '还没点';
      waitHint.textContent = myShakeCount
        ? `你点了 ${myShakeCount} 次，等待开奖`
        : '等待开奖';
      show(panelWait);
      return;
    }

    if (phase === 'done') {
      stopStartIntro();
      stopRoundTick();
      setTapBounce(false);
      if (pendingIsTopWinner) {
        if (panelResult.classList.contains('hidden')) show(panelResult);
        return;
      }
      if (!panelResult.classList.contains('hidden') || !mRollFinal.classList.contains('hidden')) {
        return;
      }
      waitStatus.textContent = '本轮结束';
      waitHint.textContent = '请看大屏名单';
      show(panelWait);
      return;
    }

    stopStartIntro();
    stopRoundTick();
    setTapBounce(false);
    if (mRoundTimer) mRoundTimer.classList.add('hidden');
    waitStatus.textContent = '已入场';
    waitHint.textContent = '等待主持人开始…';
    show(panelWait);
  }

  function onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }

    if (msg.type === 'pong') {
      applyServerClock(msg);
      return;
    }

    if (msg.type === 'error') {
      setJoinError(msg.message || '出错了');
      return;
    }

    if (msg.type === 'joined' || msg.type === 'sync') {
      applyJoinedOrSync(msg);
      return;
    }

    if (msg.type === 'start_intro') {
      applyServerClock(msg);
      runStartIntro(msg);
      return;
    }

    if (msg.type === 'lobby' || msg.type === 'progress' || msg.type === 'phase') {
      applyServerClock(msg);
      if (msg.roundEndsAt) syncRoundTimer(msg);
      if (msg.phase && msg.phase !== 'revealing') applyPhase(msg.phase);
      else if (msg.phase === 'revealing') phase = 'revealing';
      return;
    }

    if (msg.type === 'round_timer') {
      applyServerClock(msg);
      syncRoundTimer(msg);
      applyPhase('open');
      return;
    }

    if (msg.type === 'shaken') {
      const wasOptimistic = pendingOptimistic > 0;
      if (typeof msg.shakeCount === 'number') {
        myShakeCount = msg.shakeCount;
        pendingOptimistic = 0;
      }
      myRank = msg.rank;
      if (!msg.rateLimited && !wasOptimistic) {
        shakeOrb.classList.remove('active');
        void shakeOrb.offsetWidth;
        shakeOrb.classList.add('active');
        if (navigator.vibrate) navigator.vibrate(18);
        spawnTapFx();
        updateShakeUi({ pop: true });
      } else {
        updateShakeUi();
      }
      show(panelShake);
      return;
    }

    if (msg.type === 'reveal_roll') {
      startRevealRoll(msg);
      return;
    }

    if (msg.type === 'round_end') {
      stopRoundTick();
      roundEndsAt = null;
      phase = 'done';
      stopRevealTimers();
      // 前五名看专属恭喜页；其他人看前五名单
      if (pendingIsTopWinner) {
        if (panelResult.classList.contains('hidden')) show(panelResult);
        return;
      }
      show(panelReveal);
      mRollLive.classList.add('hidden');
      mRollFinal.classList.remove('hidden');
      renderAllWinners(msg.finalTop || msg.topShakers || msg.winners, msg.prizes || { top: '本轮前五名' });
      if (pendingPersonalResult) {
        mMyResultHint.textContent = pendingPersonalResult;
      } else if (myRank) {
        mMyResultHint.textContent = `你的排名：第 ${myRank} 名 · 点了 ${myShakeCount} 次`;
      } else {
        mMyResultHint.textContent = '本轮未上榜';
      }
      return;
    }

    if (msg.type === 'reveal') {
      applyPhase('revealing');
      return;
    }

    if (msg.type === 'result') {
      if (msg.rank) myRank = msg.rank;
      if (typeof msg.shakeCount === 'number') myShakeCount = msg.shakeCount;
      const isTop = msg.tier === 'top' && Number(msg.rank) > 0;
      if (isTop) {
        showCongrats(msg);
        return;
      }
      pendingIsTopWinner = false;
      stopFireworks();
      pendingPersonalResult = msg.rank
        ? `你的结果：第 ${msg.rank} 名${
            msg.shakeCount != null ? ` · 点了 ${msg.shakeCount} 次` : ''
          }`
        : '本轮未上榜';
      phase = 'done';
      if (!mRollFinal.classList.contains('hidden') && !panelReveal.classList.contains('hidden')) {
        mMyResultHint.textContent = pendingPersonalResult;
      }
    }
  }

  function setSensorMsg() {
    /* 点按模式不展示感应提示 */
  }

  function showEnableButtons() {
    /* 点按模式不展示感应按钮 */
  }

  function fireShake(source) {
    if (phase !== 'open') return;
    const now = Date.now();
    if (source === 'tap') {
      lastTapFire = now;
      suppressMotionUntil = now + MOTION_SUPPRESS_AFTER_TAP_MS;
    } else if (now < suppressMotionUntil) {
      return;
    }
    if (source === 'motion') lastMotionFire = now;
    lastShakeFire = now;

    // 弱网乐观加分，等服务端 ACK 校正
    pendingOptimistic += 1;
    myShakeCount += 1;
    updateShakeUi({ pop: true });
    spawnTapFx();
    if (shakeOrb) {
      shakeOrb.classList.remove('active');
      void shakeOrb.offsetWidth;
      shakeOrb.classList.add('active');
    }
    if (navigator.vibrate) navigator.vibrate(12);

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connect(() => {
        if (joinedNickname) send({ type: 'join_player', roomId, nickname: joinedNickname });
        send({ type: 'shake' });
      });
      return;
    }
    send({ type: 'shake' });
  }

  function usableAccel(acc) {
    if (!acc) return null;
    const x = acc.x;
    const y = acc.y;
    const z = acc.z;
    if (x == null && y == null && z == null) return null;
    return { x: x || 0, y: y || 0, z: z || 0 };
  }

  function hypot3(x, y, z) {
    return Math.sqrt(x * x + y * y + z * z);
  }

  /** 综合线性加速度 / 重力偏离 / 帧间变化，取最大强度 */
  function motionScore(event) {
    let score = 0;
    const linear = usableAccel(event.acceleration);
    const withG = usableAccel(event.accelerationIncludingGravity);

    if (linear) {
      score = Math.max(score, hypot3(linear.x, linear.y, linear.z));
    }

    if (withG) {
      const mag = hypot3(withG.x, withG.y, withG.z);
      // 相对重力的偏离（静止约 9.8）
      score = Math.max(score, Math.abs(mag - 9.8));
      if (lastAx != null) {
        score = Math.max(
          score,
          hypot3(withG.x - lastAx, withG.y - lastAy, withG.z - lastAz)
        );
      }
      lastAx = withG.x;
      lastAy = withG.y;
      lastAz = withG.z;
    }

    return score;
  }

  function onMotion(event) {
    motionEventCount += 1;
    if (Date.now() < suppressMotionUntil) return;
    const score = motionScore(event);
    if (score >= MOTION_SCORE_MIN) {
      fireShake('motion');
    }
  }

  function onTapPointerDown(e) {
    if (phase !== 'open') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    // 触摸后浏览器常再合成一次 mouse 事件，会把 1 次点成 2 次
    if (e.pointerType === 'touch') {
      lastTouchTapAt = Date.now();
    } else if (
      e.pointerType === 'mouse' &&
      Date.now() - lastTouchTapAt < GHOST_MOUSE_IGNORE_MS
    ) {
      return;
    }

    // 同一指按下只计 1 次；抬起后可立刻再点（不限制连点间隔）
    if (activeTapPointers.has(e.pointerId)) return;
    activeTapPointers.add(e.pointerId);
    suppressMotionUntil = Date.now() + MOTION_SUPPRESS_AFTER_TAP_MS;
    fireShake('tap');
  }

  function onTapPointerEnd(e) {
    activeTapPointers.delete(e.pointerId);
  }

  function startMotionWatch() {
    clearTimeout(motionWatchTimer);
    motionEventCount = 0;
    motionWatchTimer = setTimeout(() => {
      if (!sensorListening) return;
      if (motionEventCount === 0) {
        sensorReady = false;
        setSensorMsg('没收到传感器数据（局域网 http 常见）。请点圆球或下方按钮计数');
        showEnableButtons(needsMotionPermission());
      } else if (!sensorReady) {
        sensorReady = true;
        setSensorMsg('动作感应正常；也可点圆球计数');
      }
    }, 2500);
  }

  function attachMotionListener() {
    if (sensorListening) return;
    window.addEventListener('devicemotion', onMotion, { passive: true });
    sensorListening = true;
    startMotionWatch();
  }

  function needsMotionPermission() {
    return (
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function'
    );
  }

  function isInsecureLan() {
    const host = location.hostname;
    const loopback = host === 'localhost' || host === '127.0.0.1' || host === '::1';
    return location.protocol === 'http:' && !loopback;
  }

  function maybeRequestSensorUi() {
    // 点按模式：不启用传感器，代码保留便于日后恢复
    if (!ENABLE_SHAKE_SENSOR) {
      return;
    }

    if (sensorListening && sensorReady) {
      showEnableButtons(false);
      setSensorMsg('动作感应已开启；也可点圆球计数');
      return;
    }

    // 局域网 http 下，Chrome/Safari 常直接不提供 DeviceMotionEvent
    if (typeof DeviceMotionEvent === 'undefined') {
      showEnableButtons(false);
      if (isInsecureLan()) {
        setSensorMsg(
          '当前是 http，浏览器禁用了动作传感器。请重新扫描大屏二维码（https），首次点「继续访问」；或先点圆球计数'
        );
      } else {
        setSensorMsg('浏览器未开放动作感应，请点圆球或下方按钮计数');
      }
      return;
    }

    if (isInsecureLan()) {
      // 有 API 但 http 下经常收不到事件
      setSensorMsg('建议使用 https 扫码；也可直接点圆球计数');
    }

    if (needsMotionPermission() && !sensorListening) {
      showEnableButtons(true);
      setSensorMsg('请先点「开启动作感应」授权（iPhone 必做）');
      return;
    }

    // Android 等：直接监听；若无事件再提示点按
    attachMotionListener();
    showEnableButtons(false);
    if (!isInsecureLan()) {
      setSensorMsg('可使用动作感应；若无反应请点圆球计数');
    }
  }

  async function enableSensor() {
    if (!ENABLE_SHAKE_SENSOR) {
      setSensorMsg('当前为点按模式，请点圆球计数');
      return;
    }
    try {
      if (needsMotionPermission()) {
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== 'granted') {
          setSensorMsg('未获得权限，请点圆球或下方按钮参与');
          return;
        }
      }
      lastAx = lastAy = lastAz = null;
      lastMotionFire = 0;
      attachMotionListener();
      sensorReady = true;
      showEnableButtons(false);
      setSensorMsg('动作感应已开启；也可点圆球计数');
      if (phase === 'open') applyPhase('open');
    } catch {
      setSensorMsg('授权失败，请点圆球或下方按钮');
    }
  }

  btnJoin.addEventListener('click', () => {
    const nickname = nicknameInput.value.trim();
    if (!roomId) {
      setJoinError('缺少房间号，请重新扫描大屏二维码');
      return;
    }
    if (!nickname) {
      setJoinError('请填写昵称');
      return;
    }
    setJoinError('连接中…');
    connect(() => {
      send({ type: 'join_player', roomId, nickname });
    });
  });

  nicknameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnJoin.click();
  });

  // 阻止整页上下拖动（输入框 / 可滚动名单除外），避免点按时页面抖动
  const allowTouchScroll = (el) => {
    if (!el || !el.closest) return false;
    if (el.closest('input, textarea, [contenteditable="true"]')) return true;
    const scroller = el.closest('.m-roll-chart, .m-winners-all');
    return !!(scroller && scroller.scrollHeight > scroller.clientHeight + 1);
  };
  document.addEventListener(
    'touchmove',
    (e) => {
      if (!allowTouchScroll(e.target)) e.preventDefault();
    },
    { passive: false }
  );
  document.addEventListener(
    'gesturestart',
    (e) => {
      e.preventDefault();
    },
    { passive: false }
  );

  // 点按：每个 pointerId 只计一次；并压制随后的传感器误触发
  btnManualShake.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onTapPointerDown(e);
  });
  shakeOrb.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    onTapPointerDown(e);
  });
  window.addEventListener('pointerup', onTapPointerEnd);
  window.addEventListener('pointercancel', onTapPointerEnd);

  shakeOrb.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      suppressMotionUntil = Date.now() + MOTION_SUPPRESS_AFTER_TAP_MS;
      fireShake('tap');
    }
  });

  if (!roomId) {
    setJoinError('请用手机扫描大屏二维码进入');
  }
})();
