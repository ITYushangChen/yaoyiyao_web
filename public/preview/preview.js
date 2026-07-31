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
      title: '1. 填写昵称入场',
      desc: '扫码后首先看到此页。输入昵称并进入会场，大屏「在场」人数增加。',
    },
    wait: {
      title: '2. 等待开始',
      desc: '入场成功后进入等待页，等待主持人开始。',
    },
    shake: {
      title: '3. 幸运多一点',
      desc: '主持人点「开始幸运多一点」后进入此页。猛点圆球，次数越多排名越高。',
    },
    shaken: {
      title: '4. 实时名次与次数',
      desc: '每次点击都会累加次数并刷新名次。手机显示当前名次与已点次数。',
    },
    result: {
      title: '5. 查看结果',
      desc: '结束后大屏揭晓前五名，手机显示你的最终名次与点击次数。',
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
    if (c) {
      capTitle.textContent = c.title;
      capDesc.textContent = c.desc;
    }
  }

  buttons.forEach((btn) => {
    btn.addEventListener('click', () => show(btn.dataset.step));
  });
})();
