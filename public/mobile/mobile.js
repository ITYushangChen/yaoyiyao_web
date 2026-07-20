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
  const btnManualShake = $('btnManualShake');

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
  let myRank = null;
  let myShakeCount = 0;
  let lastShakeFire = 0;
  let joinedNickname = '';
  let countdownTimer = null;
  let introTimer = null;
  let pendingPersonalResult = null;

  const SHAKE_THRESHOLD = 22;
  const SHAKE_COOLDOWN_MS = 450;

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
    const rows = (list || []).slice(0, 10);
    mRollNamesLabel.textContent = '摇动实力榜 · Top 10';
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

  function updateShakeUi() {
    if (myShakeCountEl) myShakeCountEl.textContent = String(myShakeCount);
    if (myShakeCount > 0) {
      shakeTitle.textContent = myRank ? `第 ${myRank} 名 · 已摇 ${myShakeCount} 次` : `已摇 ${myShakeCount} 次`;
      shakeHint.textContent = '继续摇！次数越多排名越高';
    }
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
      waitStatus.textContent = '可以摇了';
      waitHint.textContent = sensorReady
        ? '用力摇动手机，或点下方按钮'
        : '请先开启动作感应，或使用模拟按钮';
      btnEnable.classList.toggle('hidden', sensorReady);
      if (myShakeCount === 0) {
        shakeTitle.textContent = '用力摇手机';
        shakeHint.textContent = '摇得越多排名越高，冲刺前十！';
      } else {
        updateShakeUi();
      }
      show(panelShake);
      return;
    }

    if (phase === 'locked') {
      waitStatus.textContent = myShakeCount ? (myRank ? `第 ${myRank} 名` : '已摇到') : '未摇到';
      waitHint.textContent = myShakeCount
        ? `你摇了 ${myShakeCount} 次，等待主持人开始倒计时`
        : '等待主持人开始倒计时';
      show(panelWait);
      return;
    }

    if (phase === 'done') {
      if (!panelResult.classList.contains('hidden') || !mRollFinal.classList.contains('hidden')) {
        return;
      }
      waitStatus.textContent = '本轮结束';
      waitHint.textContent = '请看大屏名单';
      show(panelWait);
      return;
    }

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
      maybeRequestSensorUi();
      applyPhase(msg.phase);
      return;
    }

    if (msg.type === 'lobby' || msg.type === 'progress' || msg.type === 'phase') {
      if (typeof msg.participantCount === 'number') mJoined.textContent = msg.participantCount;
      if (typeof msg.shakenCount === 'number') mShaken.textContent = msg.shakenCount;
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
      if (navigator.vibrate) navigator.vibrate(30);
      updateShakeUi();
      show(panelShake);
      return;
    }

    if (msg.type === 'reveal_roll') {
      startRevealRoll(msg);
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

  function fireShake() {
    if (phase !== 'open') return;
    const now = Date.now();
    if (now - lastShakeFire < SHAKE_COOLDOWN_MS) return;
    lastShakeFire = now;
    send({ type: 'shake' });
  }

  function onMotion(event) {
    const acc = event.accelerationIncludingGravity || event.acceleration;
    if (!acc) return;
    const x = acc.x || 0;
    const y = acc.y || 0;
    const z = acc.z || 0;
    const mag = Math.sqrt(x * x + y * y + z * z);
    if (mag > SHAKE_THRESHOLD) fireShake();
  }

  function maybeRequestSensorUi() {
    const needsPermission =
      typeof DeviceMotionEvent !== 'undefined' &&
      typeof DeviceMotionEvent.requestPermission === 'function';

    if (!needsPermission && typeof DeviceMotionEvent !== 'undefined') {
      window.addEventListener('devicemotion', onMotion, { passive: true });
      sensorReady = true;
      sensorMsg.textContent = '动作感应已就绪';
      btnEnable.classList.add('hidden');
      return;
    }

    if (needsPermission) {
      btnEnable.classList.remove('hidden');
      sensorMsg.textContent = 'iOS 需要点击按钮授权动作感应';
      return;
    }

    btnEnable.classList.add('hidden');
    sensorMsg.textContent = '当前环境不支持动作感应，请用模拟按钮';
  }

  async function enableSensor() {
    try {
      if (
        typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function'
      ) {
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== 'granted') {
          sensorMsg.textContent = '未获得权限，可用模拟按钮参与';
          return;
        }
      }
      window.addEventListener('devicemotion', onMotion, { passive: true });
      sensorReady = true;
      sensorMsg.textContent = '动作感应已开启';
      btnEnable.classList.add('hidden');
      if (phase === 'open') applyPhase('open');
    } catch {
      sensorMsg.textContent = '授权失败，请使用模拟按钮';
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
  btnManualShake.addEventListener('click', fireShake);

  if (!roomId) {
    setJoinError('请用手机扫描大屏二维码进入');
  }
})();
