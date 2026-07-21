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
  const mJoined = $('mJoined');
  const mShaken = $('mShaken');
  const btnEnable = $('btnEnable');
  const sensorMsg = $('sensorMsg');

  const shakeOrb = $('shakeOrb');
  const shakeTitle = $('shakeTitle');
  const shakeHint = $('shakeHint');
  const myShakeCountEl = $('myShakeCount');
  const orbCount = $('orbCount');
  const orbFill = $('orbFill');
  const myPowerFill = $('myPowerFill');
  const myPowerPips = $('myPowerPips');
  const tapFx = $('tapFx');
  const btnManualShake = $('btnManualShake');
  const btnEnableShake = $('btnEnableShake');
  const sensorMsgShake = $('sensorMsgShake');
  const mRoundTimer = $('mRoundTimer');
  const mRoundTimerNum = $('mRoundTimerNum');
  const mRoundTimerLabel = $('mRoundTimerLabel');

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
  let roundEndsAt = null;
  let clockOffset = 0;
  let urgencySeconds = 5;
  let roundTickTimer = null;
  let lastShownLeft = null;
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
      if (onOpen) onOpen();
    });
    ws.addEventListener('message', onMessage);
    ws.addEventListener('close', () => {
      if (!joinedNickname) return;
      setTimeout(() => {
        connect(() => {
          send({ type: 'join_player', roomId, nickname: joinedNickname });
        });
      }, 1200);
    });
  }

  function send(obj) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(obj));
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
    const tiers = [
      { key: 'first', label: prizes?.first || '一等奖' },
      { key: 'second', label: prizes?.second || '二等奖' },
      { key: 'third', label: prizes?.third || '三等奖' },
    ];
    tiers.forEach((tier) => {
      const list = (winners && winners[tier.key]) || [];
      const col = document.createElement('div');
      col.className = 'm-tier-col';
      const title = document.createElement('h3');
      title.textContent = tier.label;
      col.appendChild(title);
      if (!list.length) {
        const empty = document.createElement('p');
        empty.className = 'm-tier-empty';
        empty.textContent = '暂无';
        col.appendChild(empty);
      } else {
        list.forEach((w) => {
          const row = document.createElement('div');
          row.className = 'person';
          const shakes = w.shakeCount != null ? ` · ${w.shakeCount} 次` : '';
          row.innerHTML = `<strong>第 ${w.rank} 名</strong> · ${escapeHtml(w.nickname)}${shakes}`;
          col.appendChild(row);
        });
      }
      mRollWinners.appendChild(col);
    });
  }

  function renderTopChart(list) {
    if (!mRollChart) return;
    const rows = (list || []).slice(0, 5);
    mRollNamesLabel.textContent = '实力榜 · Top 5';
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
    mRollPrize.textContent =
      [prizes.first, prizes.second, prizes.third].filter(Boolean).join(' · ') || '一 · 二 · 三等奖';
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
            mMyResultHint.textContent = `你的排名：第 ${myRank} 名 · 摇了 ${myShakeCount} 次`;
          } else {
            mMyResultHint.textContent = '本轮未成功摇到';
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
    if (myShakeCountEl) {
      myShakeCountEl.textContent = String(myShakeCount);
      if (popped) {
        myShakeCountEl.classList.remove('is-pop');
        void myShakeCountEl.offsetWidth;
        myShakeCountEl.classList.add('is-pop');
      }
    }
    if (orbCount) {
      orbCount.textContent = String(myShakeCount);
      if (popped) {
        orbCount.classList.remove('is-pop');
        void orbCount.offsetWidth;
        orbCount.classList.add('is-pop');
      }
    }

    // 能量条：每 20 次一格循环涨满，视觉上持续推进
    const cycle = 20;
    const inCycle = myShakeCount % cycle;
    const pct = myShakeCount === 0 ? 0 : Math.max(6, Math.round(((inCycle || cycle) / cycle) * 100));
    if (myPowerFill) myPowerFill.style.width = `${pct}%`;
    if (orbFill) orbFill.style.height = `${pct}%`;

    // 小圆点：最多 10 个，表示当前进度段
    if (myPowerPips) {
      const lit = Math.min(10, Math.ceil(pct / 10));
      myPowerPips.innerHTML = Array.from({ length: 10 }, (_, i) =>
        `<span class="pip${i < lit ? ' on' : ''}"></span>`
      ).join('');
    }

    shakeTitle.textContent = myShakeCount > 0 ? '继续点！' : '猛点圆球冲分';
    shakeHint.textContent =
      myShakeCount > 0 ? `已点 ${myShakeCount} 次 · 只看自己的成绩` : '只看自己的次数 · 点得越多越亮';
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

  function applyPhase(next) {
    phase = next;

    if (phase === 'revealing') {
      if (panelReveal.classList.contains('hidden')) {
        waitStatus.textContent = myShakeCount ? (myRank ? `第 ${myRank} 名` : '已摇到') : '未摇到';
        waitHint.textContent = '揭晓即将开始，请看大屏与本机倒计时';
        show(panelWait);
      }
      return;
    }

    if (phase === 'open') {
      waitStatus.textContent = '可以点了';
      waitHint.textContent = '倒计时中，猛点圆球冲分！';
      updateShakeUi();
      show(panelShake);
      if (roundEndsAt) {
        if (mRoundTimer) mRoundTimer.classList.remove('hidden');
      }
      maybeRequestSensorUi();
      return;
    }

    if (phase === 'locked') {
      waitStatus.textContent = myShakeCount ? `已点 ${myShakeCount} 次` : '还没点';
      waitHint.textContent = myShakeCount
        ? `你点了 ${myShakeCount} 次，等待开奖`
        : '等待开奖';
      show(panelWait);
      return;
    }

    if (phase === 'done') {
      stopRoundTick();
      if (!panelResult.classList.contains('hidden') || !mRollFinal.classList.contains('hidden')) {
        return;
      }
      waitStatus.textContent = '本轮结束';
      waitHint.textContent = '请看大屏名单';
      show(panelWait);
      return;
    }

    stopRoundTick();
    if (mRoundTimer) mRoundTimer.classList.add('hidden');
    waitStatus.textContent = '已入场';
    waitHint.textContent = '等待主持人开始…';
    btnEnable.classList.toggle('hidden', sensorReady);
    show(panelWait);
  }

  function onMessage(ev) {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }

    if (msg.type === 'error') {
      setJoinError(msg.message || '出错了');
      sensorMsg.textContent = msg.message || '';
      return;
    }

    if (msg.type === 'joined') {
      joinedNickname = msg.nickname;
      setJoinError('');
      phase = msg.phase;
      myShakeCount = msg.shakeCount || 0;
      updateShakeUi();
      if (msg.roundEndsAt) syncRoundTimer(msg);
      maybeRequestSensorUi();
      applyPhase(msg.phase);
      return;
    }

    if (msg.type === 'lobby' || msg.type === 'progress' || msg.type === 'phase') {
      if (typeof msg.participantCount === 'number') mJoined.textContent = msg.participantCount;
      if (typeof msg.shakenCount === 'number') mShaken.textContent = msg.shakenCount;
      if (msg.roundEndsAt) syncRoundTimer(msg);
      if (msg.phase && msg.phase !== 'revealing') applyPhase(msg.phase);
      else if (msg.phase === 'revealing') phase = 'revealing';
      return;
    }

    if (msg.type === 'shaken') {
      myShakeCount = msg.shakeCount || myShakeCount + 1;
      myRank = msg.rank;
      shakeOrb.classList.remove('active');
      void shakeOrb.offsetWidth;
      shakeOrb.classList.add('active');
      if (navigator.vibrate) navigator.vibrate(18);
      spawnTapFx();
      updateShakeUi({ pop: true });
      show(panelShake);
      return;
    }

    if (msg.type === 'reveal_roll') {
      startRevealRoll(msg);
      return;
    }

    if (msg.type === 'round_timer') {
      syncRoundTimer(msg);
      applyPhase('open');
      return;
    }

    if (msg.type === 'round_end') {
      stopRoundTick();
      roundEndsAt = null;
      phase = 'done';
      stopRevealTimers();
      show(panelReveal);
      mRollLive.classList.add('hidden');
      mRollFinal.classList.remove('hidden');
      renderAllWinners(msg.winners, msg.prizes || {});
      if (pendingPersonalResult) {
        mMyResultHint.textContent = pendingPersonalResult;
      } else if (myRank) {
        mMyResultHint.textContent = `你的排名：第 ${myRank} 名 · 摇了 ${myShakeCount} 次`;
      } else {
        mMyResultHint.textContent = '本轮未成功摇到';
      }
      return;
    }

    if (msg.type === 'reveal') {
      applyPhase('revealing');
      return;
    }

    if (msg.type === 'result') {
      pendingPersonalResult = msg.prize
        ? `你的结果：${msg.prize}${msg.rank ? ` · 全场第 ${msg.rank} 名` : ''}${
            msg.shakeCount != null ? ` · 摇了 ${msg.shakeCount} 次` : ''
          }`
        : '本轮未中奖';
      resultPrize.textContent = msg.prize || '未中奖';
      resultRank.textContent = msg.rank
        ? `全场第 ${msg.rank} 名${msg.shakeCount != null ? ` · 摇了 ${msg.shakeCount} 次` : ''}`
        : '本轮未成功摇到';
      resultName.textContent = msg.nickname ? `昵称：${msg.nickname}` : '';
      phase = 'done';
      if (!mRollFinal.classList.contains('hidden') && !panelReveal.classList.contains('hidden')) {
        mMyResultHint.textContent = pendingPersonalResult;
      } else if (panelReveal.classList.contains('hidden')) {
        show(panelResult);
      }
    }
  }

  function setSensorMsg(text) {
    if (sensorMsg) sensorMsg.textContent = text || '';
    if (sensorMsgShake) sensorMsgShake.textContent = text || '';
  }

  function showEnableButtons(show) {
    btnEnable.classList.toggle('hidden', !show);
    if (btnEnableShake) btnEnableShake.classList.toggle('hidden', !show);
  }

  function fireShake(source) {
    if (phase !== 'open') return;
    const now = Date.now();
    if (source === 'tap') {
      lastTapFire = now;
      // 仅极短压制，避免「点一下」立刻被同一次触碰震动重复记
      suppressMotionUntil = now + MOTION_SUPPRESS_AFTER_TAP_MS;
    } else if (now < suppressMotionUntil) {
      return;
    }
    // 真摇：无冷却，传感器每帧够阈值就上报
    if (source === 'motion') lastMotionFire = now;
    lastShakeFire = now;
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
        setSensorMsg('没收到摇动传感器数据（局域网 http 常见）。请点圆球或下方按钮计数');
        showEnableButtons(needsMotionPermission());
      } else if (!sensorReady) {
        sensorReady = true;
        setSensorMsg('动作感应正常，用力摇手机！');
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
      showEnableButtons(false);
      setSensorMsg('当前为点按模式：猛点圆球或下方按钮计数');
      return;
    }

    if (sensorListening && sensorReady) {
      showEnableButtons(false);
      setSensorMsg('动作感应已开启，用力摇手机！');
      return;
    }

    // 局域网 http 下，Chrome/Safari 常直接不提供 DeviceMotionEvent
    if (typeof DeviceMotionEvent === 'undefined') {
      showEnableButtons(false);
      if (isInsecureLan()) {
        setSensorMsg(
          '当前是 http，浏览器禁用了摇动传感器。请重新扫描大屏二维码（https），首次点「继续访问」；或先点圆球计数'
        );
      } else {
        setSensorMsg('浏览器未开放动作感应，请点圆球或下方按钮计数');
      }
      return;
    }

    if (isInsecureLan()) {
      // 有 API 但 http 下经常收不到事件
      setSensorMsg('建议使用 https 扫码以启用真摇；也可直接点圆球计数');
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
      setSensorMsg('可摇手机；若无反应请点圆球计数');
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
      setSensorMsg('动作感应已开启，用力摇手机！');
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

  btnEnable.addEventListener('click', enableSensor);
  if (btnEnableShake) btnEnableShake.addEventListener('click', enableSensor);

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
