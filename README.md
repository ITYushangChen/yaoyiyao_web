# 摇一摇抽奖（局域网版）

大屏主持 + 手机扫码「摇一摇」排序抽奖系统。

- **网络**：局域网（手机与电脑连接**同一 WiFi**）
- **二维码**：使用本机局域网 IP（如 `http://192.168.1.8:8780`）
- **玩法**：累计摇动次数排序；前 X / Y / G 名分别为一 / 二 / 三等奖；倒计时展示 Top10 柱状图后揭晓
- **微信**：可选接入公众号网页授权，自动使用微信昵称
- **规模**：约 200 人同场

不需要公网域名即可本地游玩；若要用「自动微信昵称」，需配置公众号与 HTTPS 授权域名。

---

## 环境

- 可用的 `node`（系统已装 Node 18+，**或**使用 Cursor 自带 `helpers\node.exe`）
- 电脑与手机在同一 WiFi

---

## 启动

在项目目录打开 PowerShell 或 CMD：

```powershell
.\start.bat
```

> PowerShell 里必须写成 `.\start.bat`（点和文件名之间有反斜杠）。  
> 旧命令 `.\start-public.bat` 仍可用，会转调局域网启动。

启动成功后终端会打印类似：

```text
摇一摇抽奖服务已启动（局域网模式）
  本机大屏: http://127.0.0.1:8780/screen
  局域网:   http://192.168.1.8:8780/screen
  手机页:   http://192.168.1.8:8780/m
  二维码将使用: http://192.168.1.8:8780
  微信授权: 未启用（可在 data/wechat.json 配置公众号）
```

| 入口 | 地址 |
|------|------|
| 电脑大屏 | `http://127.0.0.1:8780/screen` |
| 局域网大屏 | `http://本机局域网IP:8780/screen` |
| 手机端 | 扫大屏二维码（`/m?room=房间号`） |
| 手机预览 | `http://127.0.0.1:8780/preview`（看扫码后手机界面长什么样） |

可选端口：

```powershell
set PORT=8080
.\start.bat
```

---

## 使用步骤

1. 运行 `.\start.bat` 启动服务  
2. 电脑打开 `http://127.0.0.1:8780/screen`  
3. 手机连接同一 WiFi，扫描大屏左侧二维码  
4. 填写**微信昵称**入场（若已配置公众号，微信内可一键授权自动获取）  
5. 主持人操作：**开始摇一摇** → 嘉宾用力连摇（**摇得越多排名越高**）→ **开始倒计时**（3·2·1·GO 后进入 10 秒；下半屏显示摇动次数 Top10 柱状图）  
6. 倒计时结束后同时显示全部获奖名单；可点 **切换庆功音乐** 或 **再来一轮**

---

## 微信昵称（可选）

编辑 `data/wechat.json`：

```json
{
  "enabled": true,
  "appId": "你的公众号AppID",
  "appSecret": "你的公众号AppSecret",
  "oauthBaseUrl": "https://你的已备案域名"
}
```

| 字段 | 含义 |
|------|------|
| `enabled` | 设为 `true` 开启微信网页授权 |
| `appId` / `appSecret` | 微信公众号（需为**服务号**，并开通网页授权） |
| `oauthBaseUrl` | 授权回调根地址（必须是微信后台配置的 **HTTPS 授权域名**，不能用局域网 IP） |

配置后：

1. 在微信公众平台 → 设置与开发 → 公众号设置 → 功能设置 → **网页授权域名** 填入域名  
2. 用内网穿透 / 反向代理把该域名转到本机 `8780` 端口  
3. 手机用**微信**扫码打开，点「用微信昵称一键入场」即可自动带入昵称  

未配置时，手机页仍可手动填写微信昵称参与。

---

## 奖项配置（人数 + 奖品名称均可改）

编辑 `data/config.json`（改完后点大屏「开始摇一摇」即可重新加载；也可重启服务）：

```json
{
  "firstPrizeCount": 1,
  "firstPrizeName": "一等奖 · 大奖礼盒",
  "secondPrizeCount": 3,
  "secondPrizeName": "二等奖 · 精美周边",
  "thirdPrizeCount": 10,
  "thirdPrizeName": "三等奖 · 纪念小礼"
}
```

| 字段 | 含义 |
|------|------|
| `firstPrizeCount` / `firstPrizeName` | 一等奖人数与奖品名称 |
| `secondPrizeCount` / `secondPrizeName` | 二等奖人数与奖品名称 |
| `thirdPrizeCount` / `thirdPrizeName` | 三等奖人数与奖品名称 |

排名规则：**摇动次数多者靠前**；次数相同则先达到该次数者靠前。  
揭晓倒计时阶段，大屏下半屏以柱状图展示前 10 名昵称与摇动次数。

想先看手机扫码后的界面，可打开 `/preview` 预览页（演示流程，不连真实房间）。

---

## 大屏背景与音乐

编辑 `data/screen.json`，将图片、音频放在 `public/assets/` 下，路径以 `/assets/` 开头。详见 `public/assets/README.md`。

```json
{
  "backgroundDefault": "/assets/bg/waiting.jpg",
  "backgroundReveal": "/assets/bg/reveal.jpg",
  "backgroundDone": "/assets/bg/celebrate.jpg",
  "musicDefault": "/assets/audio/waiting.mp3",
  "musicReveal": "/assets/audio/drumroll.mp3",
  "musicDone": "/assets/audio/celebrate.mp3",
  "countdownSeconds": 10
}
```

| 字段 | 含义 |
|------|------|
| `backgroundDefault` | 等待 / 摇一摇阶段背景图 |
| `backgroundReveal` | 倒计时揭晓阶段背景图 |
| `backgroundDone` | 三轮揭晓结束后的背景图 |
| `musicDefault` / `musicReveal` / `musicDone` | 各阶段背景音乐（需用户点击页面后才会播放） |
| `countdownSeconds` | 揭晓倒计时秒数（默认 10） |

留空则使用内置渐变背景、不播放音乐。修改后刷新大屏即可生效。

局域网根地址可保存在 `data/lan.json` 的 `baseUrl`（一般无需手动设置，服务会自动检测）。

开奖记录会写入 `data/results.json`。

---

## 二维码与网络说明（简要）

1. 服务监听本机 `0.0.0.0:8780`，并自动检测局域网 IP  
2. 大屏创建房间，得到 `roomId`  
3. 生成二维码内容：`http://局域网IP:8780/m?room=房间号`  
4. 手机扫码打开该页，经 WebSocket 进入同一房间，再进行摇一摇

二维码只负责「带房间号的入场链接」；实时互动走 `/ws`。

---

## 项目结构

```text
yaoyiyao/
├── start.bat              # 局域网启动（推荐）
├── start.ps1
├── server.js              # HTTP + WebSocket
├── package.json
├── data/
│   ├── config.json        # 奖项人数与名称
│   ├── screen.json        # 大屏背景、音乐、倒计时
│   ├── wechat.json        # 微信公众号授权（可选）
│   ├── lan.json           # 局域网 baseUrl（可选）
│   └── results.json       # 开奖记录
├── lib/
│   ├── db.js
│   ├── room.js
│   ├── wechat.js
│   └── ws.js
└── public/
    ├── assets/            # 背景图、音乐（见 assets/README.md）
    ├── screen/            # 大屏（倒计时 + Top10 柱状图揭晓）
    ├── mobile/            # 手机端
    ├── preview/           # 手机扫码界面预览
    └── vendor/qrcode.min.js
```

---

## 常见问题

**扫码打不开？**  
确认二维码是局域网 IP，不是 `127.0.0.1`；手机与电脑同一 WiFi。

**提示找不到 node？**  
使用 `.\start.bat`（会查找 Cursor 自带 node），不要在未装 Node 的终端里直接敲 `node server.js`。

**PowerShell 报无法识别命令？**  
写成 `.\start.bat`，不要写成 `start.bat` 或 `.start.bat`。

**想自动用微信昵称？**  
需配置 `data/wechat.json`，并准备 HTTPS 公网域名做网页授权回调；纯局域网 IP 无法完成微信 OAuth。未配置时可手动填写微信昵称。

**iPhone 摇不动？**  
HTTP 下系统可能限制动作感应，请用页面上的「模拟摇一摇」。

**防火墙拦截？**  
允许 Node 入站，或临时关闭防火墙再试。

---

## License

仅供内部活动使用。
