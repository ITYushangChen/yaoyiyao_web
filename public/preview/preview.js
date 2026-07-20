(() => {
  const panels = {
    join: document.getElementById('pvJoin'),
    wait: document.getElementById('pvWait'),
    shake: document.getElementById('pvShake'),
    shaken: document.getElementById('pvShaken'),
    result: document.getElementById('pvResult'),
  };

  const copy = {
    join: {
      title: '1. 填写微信昵称入场',
      desc: '扫码后首先看到此页。填写微信昵称（或微信内一键授权）进入会场，大屏「在场」人数增加。',
    },
    wait: {
      title: '2. 等待开始',
      desc: '入场成功后进入等待页。可看到在场/已摇人数。iPhone 需点「开启动作感应」授权。',
    },
    shake: {
      title: '3. 摇一摇冲榜',
      desc: '主持人点「开始」后进入此页。用力连摇手机，摇动次数越多排名越高。',
    },
    shaken: {
      title: '4. 实时名次与次数',
      desc: '每次有效摇动都会累加次数并刷新名次。手机显示当前名次与已摇次数。',
    },
    result: {
      title: '5. 查看结果',
      desc: '倒计时下半屏展示 Top10 柱状图，结束后手机显示最终奖品、名次与摇动次数。',
    },
  };

  const capTitle = document.getElementById('capTitle');
  const capDesc = document.getElementById('capDesc');
  const buttons = [...document.querySelectorAll('.step-btn')];

  function show(step) {
    Object.entries(panels).forEach(([key, el]) => {
      el.classList.toggle('hidden', key !== step);
    });
    buttons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.step === step);
    });
    const c = copy[step];
    capTitle.textContent = c.title;
    capDesc.textContent = c.desc;
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => show(btn.dataset.step));
  });

  show('join');
})();
