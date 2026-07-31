# 资源目录

把背景图、音乐放到这里，并在 `data/screen.json` 填写路径（以 `/assets/` 开头）。

## 目录建议

```text
public/assets/
├── bg/                 # 大屏背景图
│   └── stage-bg.jpg
└── audio/              # 背景音乐
    ├── waiting.wav     # 等待 / 冲分阶段
    ├── drumroll.wav    # 开场倒计时
    └── celebrate.wav   # 结束庆功（自动播放）
```

## `data/screen.json` 示例

```json
{
  "backgroundDefault": "/assets/bg/stage-bg.jpg",
  "backgroundReveal": "/assets/bg/stage-bg.jpg",
  "backgroundDone": "/assets/bg/stage-bg.jpg",
  "musicDefault": "/assets/audio/waiting.wav",
  "musicReveal": "/assets/audio/drumroll.wav",
  "musicDone": "/assets/audio/celebrate.wav",
  "countdownSeconds": 20,
  "urgencySeconds": 5
}
```

浏览器策略要求：需在大屏先点一次按钮（如「开始幸运多一点」）后才能出声；结束后会自动播放庆功音乐。

## 排名配置（`data/config.json`）

```json
{
  "liveTopCount": 20,
  "finalTopCount": 5
}
```

- `liveTopCount`：游戏进行中大屏实时展示前多少名  
- `finalTopCount`：结束后大屏揭晓前多少名  
