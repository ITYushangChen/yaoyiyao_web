# 大屏背景与音乐

将图片、音频放在本目录下，并在 `data/screen.json` 中填写路径（以 `/assets/` 开头）。

当前已配置背景图：`bg/stage-bg.jpg`（等待 / 揭晓 / 结束阶段共用）。

## 示例

```json
{
  "backgroundDefault": "/assets/bg/stage-bg.jpg",
  "backgroundReveal": "/assets/bg/stage-bg.jpg",
  "backgroundDone": "/assets/bg/stage-bg.jpg",
  "musicDefault": "/assets/audio/waiting.mp3",
  "musicReveal": "/assets/audio/drumroll.mp3",
  "musicDone": "/assets/audio/celebrate.mp3",
  "countdownSeconds": 10
}
```

留空则使用内置渐变背景、不播放音乐。

支持格式：jpg / png / webp / mp3
