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
      desc: '扫码后首先看到此页。输入昵称并进入会场，大屏「在场」人数增加，入场名单出现该昵称。',
    },
    wait: {
      title: '2. 等待开始',
      desc: '入场成功后进入等待页。可看到在场/已摇人数。iPhone 需点「开启动作感应」授权。',
    },
    shake: {
      title: '3. 摇一摇抢位',
      desc: '主持人点「开始」后进入此页。用力摇手机，或点「模拟摇一摇」。第一次有效摇动会计入名次。',
    },
    shaken: {
      title: '4. 已记录名次',
      desc: '摇到后立刻本地反馈，并显示当前名次。大屏奖项柱状图会实时增长，并把人名填进对应奖级。',
    },
    result: {
      title: '5. 查看结果',
      desc: '主持人分段揭晓结束后，手机显示最终奖品名称、名次与昵称。',
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
