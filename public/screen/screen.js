(() => {
  const $ = (id) => document.getElementById(id);

  const phasePill = $('phasePill');
  const joinedCount = $('joinedCount');
  const screenMain = $('screenMain');
  const stageQr = $('stageQr');
  const waitingDemo = $('waitingDemo');
  const waitingDemoVideo = $('waitingDemoVideo');
  const doneFwCanvas = $('doneFwCanvas');
  const waitingRoster = $('waitingRoster');
  const waitingRosterList = $('waitingRosterList');
  const waitingRosterTrack = $('waitingRosterTrack');
  const waitingRosterTitle = $('waitingRosterTitle');
  const waitingRosterEmpty = $('waitingRosterEmpty');
  const stageIdle = $('stageIdle');
  let rosterScrollRaf = 0;
  let rosterScrollOffset = 0;
  let rosterLastNamesKey = '';
  const stageRoll = $('stageRoll');
  const liveBoard = $('liveBoard');
  const liveBoardList = $('liveBoardList');
  const liveBoardEmpty = $('liveBoardEmpty');
  const liveBoardTitle = $('liveBoardTitle');
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
  const qrWifiTip = $('qrWifiTip');
  const screenBg = $('screenBg');
  const bgm = $('bgm');

  const btnStart = $('btnStart');
  const btnCountdown = $('btnCountdown');
  const btnReset = $('btnReset');

  let ws = null;
  let mobileUrl = '';
  let baseUrl = '';
  let lanReady = false;
  let accessMode = 'lan';
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
  let energyBarMax = 200;
  let roundEndsAt = null;
  let clockOffset = 0; // serverNow - Date.now()
  let urgencySeconds = 5;
  let roundTickTimer = null;
  let lastShownLeft = null;

  const params = new URLSearchParams(location.search);
  const paramBase = (params.get('lan') || params.get('base') || '').replace(/\/$/, '');
  const LS_KEY = 'yaoyiyao_lan_url';
  const ROOM_KEY = 'yaoyiyao_room_id';
  let roomId = params.get('room') || sessionStorage.getItem(ROOM_KEY) || null;

  const PHASE_TEXT = {
    waiting: '等待开始',
    starting: '即将开始',
    open: '冲榜进行中',
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

  function isPrivateHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    if (isLoopbackHost(host)) return true;
    if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
    return false;
  }

  function pickBestBase(fromServer, urls, preferHttp) {
    // 公网 https 页（Railway）永远用当前域名，避免被 preferHttp / 内网 IP 带偏
    if (location.protocol === 'https:' && !isPrivateHost(location.hostname)) {
      return location.origin;
    }

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
    const n = c.finalTopCount || 5;
    return { top: `前 ${n} 名` };
  }

  function setQrWifiTipVisible(visible) {
    if (!qrWifiTip) return;
    qrWifiTip.classList.toggle('hidden', !visible);
  }

  function applyLanFromServer(msg) {
    const onPublicHttps =
      location.protocol === 'https:' && !isPrivateHost(location.hostname);
    // 云端（Railway 等）用 https；仅局域网点按模式才拒收 https 旧缓存
    const preferHttp =
      !onPublicHttps &&
      (msg.preferHttp === true ||
        (msg.mode === 'lan' && (msg.tapOnly || msg.httpsEnabled === false)));
    // 本机/内网 IP 一律按局域网显示 WiFi 提示（避免 LAN_URL 误标成 cloud）
    const onPrivateHost = isPrivateHost(location.hostname);
    accessMode =
      msg.mode === 'lan' || onPrivateHost
        ? 'lan'
        : msg.mode === 'cloud' || onPublicHttps
          ? 'cloud'
          : 'lan';
    baseUrl = pickBestBase(msg.baseUrl, msg.lanUrls, preferHttp);
    lanReady = isUsableLanUrl(baseUrl);
    stageQr.classList.toggle('is-blocked', !lanReady);
    qrTip.textContent = lanReady
      ? accessMode === 'cloud'
        ? '手机扫码加入本场（公网，无需同一 WiFi）'
        : '手机扫码加入本场'
      : '请用公网域名打开大屏，或与手机连接同一 WiFi 后刷新';
    setQrWifiTipVisible(accessMode === 'lan' && currentPhase === 'waiting');
    if (lanReady) {
      localStorage.setItem(LS_KEY, baseUrl);
      refreshQr();
    } else if (preferHttp) {
      localStorage.removeItem(LS_KEY);
    }
    updateButtons(currentPhase);
  }

  function showDoneBoard(state) {
    const finalTop =
      state.finalTop ||
      (Array.isArray(state.winners) ? state.winners : null) ||
      (state.winners && state.winners.top) ||
      (lastWinners && lastWinners.top) ||
      [];
    lastWinners = state.winners || { top: finalTop };
    lastPrizes = state.prizes || lastPrizes || prizesFromState(state);
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
    renderFinalTop(finalTop);
    updateLayout('done');
    setDoneFireworksVisible(true);
    unlockMusic();
    playMusic('done');
  }

  const FW_COLORS = ['#e2b857', '#f5c84a', '#fff4c8', '#3d8f6a', '#7fd4a8', '#ff7b6b', '#ffd0c8', '#9ecbff'];
  let doneFwRaf = 0;
  let doneFwTimer = 0;
  let doneFwRunning = false;
  let doneFwOnResize = null;

  function stopDoneFireworks() {
    doneFwRunning = false;
    cancelAnimationFrame(doneFwRaf);
    clearTimeout(doneFwTimer);
    doneFwRaf = 0;
    doneFwTimer = 0;
    document.body.classList.remove('is-done-fireworks');
    if (doneFwCanvas) {
      doneFwCanvas.classList.add('hidden');
      const ctx = doneFwCanvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, doneFwCanvas.width, doneFwCanvas.height);
    }
    if (doneFwOnResize) {
      window.removeEventListener('resize', doneFwOnResize);
      doneFwOnResize = null;
    }
  }

  function startDoneFireworks() {
    if (!doneFwCanvas) return;
    if (doneFwRunning) return;
    doneFwRunning = true;
    document.body.classList.add('is-done-fireworks');
    doneFwCanvas.classList.remove('hidden');
    const ctx = doneFwCanvas.getContext('2d');
    if (!ctx) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = window.innerWidth;
      const h = window.innerHeight;
      doneFwCanvas.width = Math.max(1, Math.floor(w * dpr));
      doneFwCanvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    doneFwOnResize = resize;
    window.addEventListener('resize', resize);

    const rockets = [];
    const sparks = [];
    const burst = (x, y) => {
      const color = FW_COLORS[(Math.random() * FW_COLORS.length) | 0];
      const n = 36 + ((Math.random() * 24) | 0);
      for (let i = 0; i < n; i += 1) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.25;
        const speed = 2.2 + Math.random() * 4.6;
        sparks.push({
          x,
          y,
          vx: Math.cos(a) * speed,
          vy: Math.sin(a) * speed,
          life: 0.85 + Math.random() * 0.7,
          color,
          size: 1.6 + Math.random() * 2.2,
        });
      }
    };
    const launch = () => {
      if (!doneFwRunning) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      const count = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < count; i += 1) {
        rockets.push({
          x: w * (0.12 + Math.random() * 0.76),
          y: h + 8,
          vx: (Math.random() - 0.5) * 1.6,
          vy: -(6.2 + Math.random() * 3.2),
          color: FW_COLORS[(Math.random() * FW_COLORS.length) | 0],
          targetY: h * (0.12 + Math.random() * 0.38),
        });
      }
      doneFwTimer = setTimeout(launch, 280 + Math.random() * 420);
    };

    const tick = () => {
      if (!doneFwRunning) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);

      for (let i = rockets.length - 1; i >= 0; i -= 1) {
        const r = rockets[i];
        r.x += r.vx;
        r.y += r.vy;
        r.vy += 0.055;
        ctx.beginPath();
        ctx.fillStyle = r.color;
        ctx.shadowColor = r.color;
        ctx.shadowBlur = 8;
        ctx.arc(r.x, r.y, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        if (r.y <= r.targetY || r.vy >= 0) {
          burst(r.x, r.y);
          rockets.splice(i, 1);
        }
      }

      for (let i = sparks.length - 1; i >= 0; i -= 1) {
        const s = sparks[i];
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.04;
        s.vx *= 0.99;
        s.life -= 0.014;
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

      doneFwRaf = requestAnimationFrame(tick);
    };

    launch();
    setTimeout(launch, 120);
    setTimeout(launch, 260);
    doneFwRaf = requestAnimationFrame(tick);
  }

  function setDoneFireworksVisible(show) {
    if (show) {
      applyBackground('done');
      startDoneFireworks();
    } else {
      stopDoneFireworks();
    }
  }

  function applyBackground(mode) {
    if (!screenBg || !screenSettings) return;
    // 等待页用视频、结束页用烟花，都不显示原来的背景图
    if (
      document.body.classList.contains('is-waiting-video') ||
      mode === 'waiting' ||
      mode === 'done' ||
      document.body.classList.contains('is-done-fireworks')
    ) {
      screenBg.style.backgroundImage = 'none';
      screenBg.style.background = mode === 'done' || document.body.classList.contains('is-done-fireworks')
        ? '#070b09'
        : '#0c1210';
      return;
    }
    const key = mode === 'reveal' ? 'backgroundReveal' : 'backgroundDefault';
    const url = screenSettings[key];
    if (url) {
      screenBg.style.background = `url("${url}") center/cover no-repeat, ${BG_FALLBACK[mode === 'reveal' ? 'reveal' : 'default']}`;
    } else {
      screenBg.style.backgroundImage = 'none';
      screenBg.style.background = BG_FALLBACK[mode === 'reveal' ? 'reveal' : 'default'];
    }
  }

  function playMusic(mode) {
    if (!bgm || !screenSettings) return;
    if (!musicUnlocked && mode !== 'done') return;
    const key =
      mode === 'reveal' ? 'musicReveal' : mode === 'done' ? 'musicDone' : 'musicDefault';
    const src = screenSettings[key];
    if (!src) return;
    if (bgm.getAttribute('src') !== src) {
      bgm.src = src;
      bgm.load();
    }
    bgm.loop = mode !== 'done';
    const play = () => bgm.play().catch(() => {});
    if (bgm.readyState >= 2) play();
    else bgm.addEventListener('canplay', play, { once: true });
  }

  function unlockMusic() {
    if (musicUnlocked) {
      // already unlocked — keep current track unless none
      if (bgm && (!bgm.src || bgm.paused) && currentPhase !== 'done') playMusic('default');
      return;
    }
    musicUnlocked = true;
    playMusic(currentPhase === 'done' ? 'done' : currentPhase === 'starting' ? 'reveal' : 'default');
  }

  function tierLabel(tier) {
    if (tier === 'top') return '前五名';
    return '名次';
  }

  function qrSizeForPhase(phase) {
    if (phase === 'open') return 440;
    if (phase === 'waiting') return 300;
    return 280;
  }

  function setWaitingDemoVisible(show) {
    document.body.classList.toggle('is-waiting-video', !!show);
    if (waitingDemo) waitingDemo.classList.toggle('hidden', !show);
    if (show) {
      applyBackground('waiting');
    } else if (currentPhase && currentPhase !== 'waiting') {
      applyBackground(
        currentPhase === 'done'
          ? 'done'
          : currentPhase === 'revealing'
            ? 'reveal'
            : 'default'
      );
    }
    if (!waitingDemoVideo) return;
    if (show) {
      waitingDemoVideo.currentTime = 0;
      const play = () => waitingDemoVideo.play().catch(() => {});
      if (waitingDemoVideo.readyState >= 2) play();
      else waitingDemoVideo.addEventListener('canplay', play, { once: true });
    } else {
      waitingDemoVideo.pause();
    }
  }

  function updateLayout(phase) {
    if (!screenMain) return;
    const modes = ['waiting', 'open', 'locked', 'reveal', 'done'];
    modes.forEach((m) => screenMain.classList.remove(`mode-${m}`));
    let mode = 'waiting';
    if (phase === 'revealing' || phase === 'starting') mode = 'reveal';
    else if (phase === 'done') mode = 'done';
    else if (phase === 'open' || phase === 'locked') mode = 'open';
    else if (phase === 'waiting') mode = 'waiting';
    screenMain.classList.add(`mode-${mode}`);

    if (phase === 'done') setDoneFireworksVisible(true);
    else stopDoneFireworks();

    const showQr = phase === 'waiting' || phase === 'open' || phase === 'locked';
    stageQr.classList.toggle('hidden', !showQr || phase === 'starting');
    setWaitingDemoVisible(phase === 'waiting');
    setWaitingRosterVisible(phase === 'waiting');
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
    btnStart.textContent = phase === 'done' ? '再来一轮' : '开始幸运多一点';
    if (phase === 'starting') btnStart.disabled = true;
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

  function stopRosterScroll() {
    cancelAnimationFrame(rosterScrollRaf);
    rosterScrollRaf = 0;
    rosterScrollOffset = 0;
    if (waitingRosterTrack) waitingRosterTrack.style.transform = 'translateY(0)';
  }

  function setWaitingRosterVisible(show) {
    if (waitingRoster) waitingRoster.classList.toggle('hidden', !show);
    if (!show) stopRosterScroll();
  }

  function startRosterScrollIfNeeded() {
    stopRosterScroll();
    if (!waitingRosterList || !waitingRosterTrack) return;
    const viewH = waitingRosterList.clientHeight;
    const contentH = waitingRosterTrack.scrollHeight / (waitingRosterTrack.dataset.looped === '1' ? 2 : 1);
    if (contentH <= viewH + 4) return;

    // 复制一份实现无缝循环下滚
    if (waitingRosterTrack.dataset.looped !== '1') {
      waitingRosterTrack.innerHTML += waitingRosterTrack.innerHTML;
      waitingRosterTrack.dataset.looped = '1';
    }
    const loopH = waitingRosterTrack.scrollHeight / 2;
    const speed = 28; // px/s
    let last = performance.now();
    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      rosterScrollOffset += speed * dt;
      if (rosterScrollOffset >= loopH) rosterScrollOffset -= loopH;
      waitingRosterTrack.style.transform = `translateY(${-rosterScrollOffset}px)`;
      rosterScrollRaf = requestAnimationFrame(tick);
    };
    rosterScrollRaf = requestAnimationFrame(tick);
  }

  function renderWaitingRoster(names) {
    if (!waitingRosterTrack && !waitingRosterList) return;
    const list = (names || []).filter(Boolean);
    const key = list.join('\n');
    if (waitingRosterTitle) waitingRosterTitle.textContent = `已入场 · ${list.length}`;
    if (waitingRosterEmpty) {
      waitingRosterEmpty.classList.toggle('hidden', list.length > 0);
      waitingRosterEmpty.textContent = list.length ? '' : '等待扫码加入…';
    }
    if (!waitingRosterTrack) return;
    if (key === rosterLastNamesKey && waitingRosterTrack.childElementCount) {
      startRosterScrollIfNeeded();
      return;
    }
    rosterLastNamesKey = key;
    stopRosterScroll();
    waitingRosterTrack.dataset.looped = '0';
    waitingRosterTrack.innerHTML = list
      .map((name) => `<div class="roster-name">${escapeHtml(name)}</div>`)
      .join('');
    // 布局完成后再判断是否需要循环滚动
    requestAnimationFrame(() => startRosterScrollIfNeeded());
  }

  function liveRowKey(r, i) {
    return String(r.playerId || r.id || r.nickname || `idx-${i}`);
  }

  function createLiveRowEl(r, i, cap) {
    const count = Number(r.shakeCount) || 0;
    const pct = Math.max(0, Math.min(100, Math.round((count / cap) * 1000) / 10));
    const barPct = count > 0 ? Math.max(2, pct) : 0;
    const rank = r.rank || i + 1;
    const key = liveRowKey(r, i);
    const el = document.createElement('div');
    el.className = `live-row is-new${rank <= 3 ? ` live-rank-${rank}` : ''}`;
    el.dataset.key = key;
    el.dataset.rank = String(rank);
    el.innerHTML = `
      <div class="live-medal" aria-hidden="true">${rank}</div>
      <div class="live-row-body">
        <div class="live-row-head">
          <span class="live-row-name"></span>
          <span class="live-row-count"><b></b><small>次</small></span>
        </div>
        <div class="live-bar-track">
          <div class="live-bar-fill"></div>
        </div>
      </div>`;
    const nameEl = el.querySelector('.live-row-name');
    nameEl.textContent = r.nickname || '未知';
    nameEl.title = r.nickname || '';
    el.querySelector('.live-row-count b').textContent = String(count);
    el.querySelector('.live-bar-track').setAttribute('aria-label', `能量 ${pct}%`);
    el.querySelector('.live-bar-fill').style.width = `${barPct}%`;
    el.addEventListener(
      'animationend',
      () => {
        el.classList.remove('is-new');
      },
      { once: true }
    );
    return el;
  }

  function patchLiveRowEl(el, r, i, cap) {
    const count = Number(r.shakeCount) || 0;
    const pct = Math.max(0, Math.min(100, Math.round((count / cap) * 1000) / 10));
    const barPct = count > 0 ? Math.max(2, pct) : 0;
    const rank = r.rank || i + 1;
    el.dataset.rank = String(rank);
    el.classList.remove('live-rank-1', 'live-rank-2', 'live-rank-3');
    if (rank <= 3) el.classList.add(`live-rank-${rank}`);
    const medal = el.querySelector('.live-medal');
    if (medal && medal.textContent !== String(rank)) medal.textContent = String(rank);
    const nameEl = el.querySelector('.live-row-name');
    if (nameEl && nameEl.textContent !== (r.nickname || '未知')) {
      nameEl.textContent = r.nickname || '未知';
      nameEl.title = r.nickname || '';
    }
    const countB = el.querySelector('.live-row-count b');
    if (countB && countB.textContent !== String(count)) countB.textContent = String(count);
    const small = el.querySelector('.live-row-count small');
    const track = el.querySelector('.live-bar-track');
    if (track) track.setAttribute('aria-label', `能量 ${pct}%`);
    const fill = el.querySelector('.live-bar-fill');
    if (fill) {
      const next = `${barPct}%`;
      // 只在变化时更新，避免无意义重绘；宽度只增不减闪回（同人次数只升）
      if (fill.style.width !== next) fill.style.width = next;
    }
  }

  function renderLiveBoard(list) {
    if (!liveBoardList) return;
    if (liveBoard) liveBoard.classList.remove('hidden');
    const rows = (list || []).slice(0, 20);
    const cap = Math.max(1, Number(energyBarMax) || 200);
    if (liveBoardTitle) liveBoardTitle.textContent = '实时能量 · Top 20';
    if (liveBoardEmpty) liveBoardEmpty.classList.toggle('hidden', rows.length > 0);

    const prev = new Map();
    liveBoardList.querySelectorAll('.live-row[data-key]').forEach((el) => {
      prev.set(el.dataset.key, el);
    });

    const frag = document.createDocumentFragment();
    const used = new Set();
    rows.forEach((r, i) => {
      const key = liveRowKey(r, i);
      used.add(key);
      let el = prev.get(key);
      if (el) {
        patchLiveRowEl(el, r, i, cap);
      } else {
        el = createLiveRowEl(r, i, cap);
      }
      frag.appendChild(el);
    });
    // 移除掉榜行
    prev.forEach((el, key) => {
      if (!used.has(key)) el.remove();
    });
    // 按新名次顺序挂回（appendChild 移动已有节点，不销毁，能量柱不会回 0）
    liveBoardList.appendChild(frag);
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

  function renderFinalTop(list) {
    rollWinners.innerHTML = '';
    // 服务端已按并列整组截取，这里不再强行只取 5 条
    const rows = list || [];
    if (!rows.length) {
      rollWinners.innerHTML = '<p style="color:var(--muted)">暂无上榜</p>';
      return;
    }
    const col = document.createElement('div');
    col.className = 'roll-tier-col roll-tier-top';
    rows.forEach((w, i) => {
      const rank = w.rank || i + 1;
      const rankClass = rank <= 5 ? `final-rank-${rank}` : 'final-rank-more';
      const card = document.createElement('div');
      card.className = `roll-winner-card ${rankClass}`;
      card.style.animationDelay = `${Math.min(i, 12) * 70}ms`;
      const countHtml =
        w.shakeCount != null
          ? `<span class="count">${Number(w.shakeCount)}<small>次</small></span>`
          : '';
      card.innerHTML = `
        <div class="rank-badge">第 ${rank} 名</div>
        <div class="name-row">
          <span class="name">${escapeHtml(w.nickname)}</span>
          ${countHtml}
        </div>
      `;
      col.appendChild(card);
    });
    rollWinners.appendChild(col);
  }

  function renderAllWinners(winners, prizes) {
    // 兼容旧结构；新流程走 renderFinalTop
    if (Array.isArray(winners)) {
      renderFinalTop(winners);
      return;
    }
    if (winners && winners.top) {
      renderFinalTop(winners.top);
      return;
    }
    renderFinalTop([]);
  }

  function renderTopChart(list) {
    if (!rollChart) return;
    const rows = (list || []).slice(0, 20);
    rollNamesLabel.textContent = '实时冲榜 · Top 20';
    if (!rows.length) {
      rollChart.innerHTML = '<p style="color:var(--muted);margin:0">暂无数据</p>';
      return;
    }
    const max = Math.max(...rows.map((r) => Number(r.shakeCount) || 0), 1);
    rollChart.innerHTML = rows
      .map((r, i) => {
        const count = Number(r.shakeCount) || 0;
        const pct = Math.max(6, Math.round((count / max) * 100));
        return `
          <div class="roll-bar-row" style="animation-delay:${i * 30}ms">
            <span class="roll-bar-rank">${r.rank || i + 1}</span>
            <span class="roll-bar-name" title="${escapeHtml(r.nickname)}">${escapeHtml(r.nickname)}</span>
            <div class="roll-bar-track"><div class="roll-bar-fill" style="width:${pct}%"></div></div>
            <span class="roll-bar-count">${count}</span>
          </div>
        `;
      })
      .join('');
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
    rollPrize.textContent = prizes.top || '冲榜揭晓';
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

  function runStartIntro(payload) {
    stopRollAnimation();
    stopRoundTick();
    if (roundTimer) roundTimer.classList.add('hidden');
    if (liveBoard) liveBoard.classList.add('hidden');
    stageQr.classList.add('hidden');
    stageIdle.classList.add('hidden');
    stageRoll.classList.remove('hidden');
    if (rollFinal) rollFinal.classList.add('hidden');
    if (rollLive) {
      rollLive.classList.remove('hidden');
      rollLive.classList.add('is-intro-only');
    }
    if (rollHalfBottom) rollHalfBottom.classList.add('hidden');

    const intro = payload.intro && payload.intro.length ? payload.intro : ['3', '2', '1', 'GO!'];
    const stepMs = payload.introStepMs || 1000;
    if (payload.serverNow) clockOffset = payload.serverNow - Date.now();

    currentPhase = 'starting';
    phasePill.textContent = PHASE_TEXT.starting;
    updateButtons('starting');
    applyBackground('reveal');
    setStatus('开场倒计时 · 大屏与手机同步');

    if (rollStep) rollStep.textContent = '预备开始';
    if (rollPrize) rollPrize.textContent = '马上开始';
    if (rollCountdownLabel) rollCountdownLabel.textContent = '预备…';
    if (rollCountdown) rollCountdown.classList.add('is-intro');

    const openAt = payload.openAt || Date.now() + intro.length * stepMs;
    const now = Date.now() + clockOffset;
    const elapsed = Math.max(0, now - (openAt - intro.length * stepMs));
    let i = Math.min(intro.length - 1, Math.floor(elapsed / stepMs));

    const tick = () => {
      if (currentPhase !== 'starting') return;
      if (i >= intro.length) {
        if (rollCountdownLabel) rollCountdownLabel.textContent = '开始！';
        return;
      }
      const step = intro[i];
      if (rollCountdown) {
        rollCountdown.textContent = step;
        rollCountdown.classList.add('is-intro');
        rollCountdown.classList.toggle('is-go', String(step).toUpperCase() === 'GO!');
      }
      if (rollCountdownLabel) {
        rollCountdownLabel.textContent =
          String(step).toUpperCase() === 'GO!' ? '开始！' : '预备…';
      }
      i += 1;
      introTimer = setTimeout(tick, stepMs);
    };
    tick();
  }

  function showIdle(state) {
    if (state.phase === 'starting') {
      if (state.startIntro) runStartIntro(state.startIntro);
      return;
    }

    stageRoll.classList.add('hidden');
    applyBackground(state.phase === 'done' ? 'done' : 'default');

    if (state.phase === 'waiting' || state.phase === 'open' || state.phase === 'locked') {
      stageIdle.classList.add('hidden');
      stageQr.classList.remove('hidden');
      setWaitingDemoVisible(state.phase === 'waiting');
      setWaitingRosterVisible(state.phase === 'waiting');
      if (state.phase === 'waiting') {
        renderWaitingRoster(state.joinedPreview || []);
      }
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
        qrTip.textContent = lanReady
          ? accessMode === 'cloud'
            ? '手机扫码加入本场（公网，无需同一 WiFi）'
            : '手机扫码加入本场'
          : '网络未就绪';
      } else if (state.phase === 'open') {
        qrTip.textContent = '倒计时中 · 请猛点冲分！';
      } else {
        qrTip.textContent = '已锁定';
      }
      setQrWifiTipVisible(accessMode === 'lan' && state.phase === 'waiting');
      return;
    }

    stageQr.classList.add('hidden');
    setWaitingDemoVisible(false);
    setWaitingRosterVisible(false);
    setQrWifiTipVisible(false);
    if (liveBoard) liveBoard.classList.add('hidden');
    if (roundTimer) roundTimer.classList.add('hidden');
    stageIdle.classList.remove('hidden');

    if (state.phase === 'revealing' && !revealBusy) {
      stageTitle.textContent = '揭晓完成';
      stageDesc.textContent = '名单已公布';
    } else if (state.phase === 'done') {
      stageTitle.textContent = '本轮已结束';
      stageDesc.textContent = '可开始新一轮。';
      setDoneFireworksVisible(true);
      playMusic('done');
    }
    renderJoinedCloud(state.joinedPreview);
  }

  function applyState(state) {
    if (state.config && Number(state.config.energyBarMax) > 0) {
      energyBarMax = Number(state.config.energyBarMax);
    }
    phasePill.textContent = PHASE_TEXT[state.phase] || state.phase;
    joinedCount.textContent = state.participantCount ?? 0;
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

    if (state.phase === 'starting') {
      if (state.startIntro) runStartIntro(state.startIntro);
      return;
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

  let reconnectAttempt = 0;
  let pingTimer = null;

  function persistRoom(id) {
    roomId = id || null;
    if (roomId) sessionStorage.setItem(ROOM_KEY, roomId);
    else sessionStorage.removeItem(ROOM_KEY);
  }

  function applyServerClock(msg) {
    if (msg && msg.serverNow) clockOffset = msg.serverNow - Date.now();
  }

  function stopPing() {
    clearInterval(pingTimer);
    pingTimer = null;
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    }, 20000);
  }

  function createOrJoinScreen() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(roomId ? { type: 'join_screen', roomId } : { type: 'create_screen' }));
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    ws = new WebSocket(wsUrl());
    ws.addEventListener('open', () => {
      reconnectAttempt = 0;
      setStatus('已连接');
      startPing();
      createOrJoinScreen();
    });
    ws.addEventListener('message', (ev) => {
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
        applyServerClock(msg);
        applyState(msg);
        return;
      }
      if (msg.type === 'start_intro') {
        applyServerClock(msg);
        runStartIntro(msg);
        unlockMusic();
        playMusic('reveal');
        return;
      }
      if (msg.type === 'round_timer') {
        stopRollAnimation();
        if (stageRoll) stageRoll.classList.add('hidden');
        if (rollLive) {
          rollLive.classList.remove('is-intro-only');
          rollLive.classList.add('hidden');
        }
        if (rollFinal) rollFinal.classList.add('hidden');
        stageQr.classList.remove('hidden');
        stageIdle.classList.add('hidden');
        setWaitingRosterVisible(false);
        setWaitingDemoVisible(false);
        applyServerClock(msg);
        syncRoundTimer(msg);
        phasePill.textContent = PHASE_TEXT.open;
        currentPhase = 'open';
        updateButtons('open');
        renderLiveBoard(msg.topShakers || msg.participants || []);
        applyBackground('default');
        unlockMusic();
        playMusic('default');
        setStatus('倒计时开始 · 看右侧能量条！');
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
          finalTop: msg.finalTop || msg.topShakers || (msg.winners && msg.winners.top) || [],
          prizes: msg.prizes || lastPrizes,
          config: msg.config || {},
        });
        updateButtons('done');
        setStatus('时间到 · 前五名出炉！');
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
        setStatus('前五名已揭晓');
      }
    });
    ws.addEventListener('close', () => {
      stopPing();
      setStatus('连接断开，重连中…');
      clearTimeout(reconnectTimer);
      const delay = Math.min(10000, 1000 * Math.pow(2, reconnectAttempt));
      reconnectAttempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    });
  }

  function host(action) {
    unlockMusic();
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setStatus('尚未连接服务器，正在重连…');
      connect();
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
  loadScreenSettings().then(() => {
    updateButtons('waiting');
    connect();
  });
})();
