# 幸运多一点（局域网 / 公网兼容）

大屏主持 + 手机扫码「幸运多一点」点按冲榜系统。

- **一套代码两种模式**：本机局域网，或 Railway 公网
- **玩法**：累计点击次数排序；进行中 Top 20，结束揭晓前五
- **规模**：约 200 人同场

---

## 本地局域网启动（Mac）

在项目目录执行：

```bash
chmod +x start-lan.sh   # 只需第一次
./start-lan.sh
```

或：

```bash
npm run start:lan
```

然后打开：http://127.0.0.1:8780/screen  
手机连同一 WiFi，扫大屏二维码。

> 不要设置 `PUBLIC_URL` / `BASE_URL`，否则会走公网地址。

Windows 可用：`.\start.bat`

---

## 部署到 Railway

本项目是**长连接 Node 服务**（HTTP + WebSocket），适合 Railway 这类常驻进程，不适合 Vercel Serverless。

### 1. 准备仓库

把代码推到 GitHub（例如 `ITYushangChen/yaoyiyao_web`），确保包含：

- `package.json`（`npm start` → `node server.js`）
- `railway.toml`（已配置启动命令与健康检查）

### 2. 在 Railway 创建服务

1. 打开 [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**
2. 选中本仓库，Root Directory 保持仓库根目录
3. 部署完成后，进入服务 → **Settings → Networking → Generate Domain**，得到类似：  
   `https://xxx.up.railway.app`

### 3. 环境变量（重要）

在服务 **Variables** 里设置（二选一即可）：

| 变量 | 示例 | 说明 |
|------|------|------|
| `PUBLIC_URL` | `https://xxx.up.railway.app` | **推荐**，二维码与大屏用的公网根地址 |
| （可不填） | — | 若未设 `PUBLIC_URL`，会自动用 Railway 注入的 `RAILWAY_PUBLIC_DOMAIN` |

`PORT` 不用手动设，Railway 会注入。

设置后 **Redeploy** 一次。

### 4. 使用

1. 电脑浏览器打开：`https://你的域名/screen`
2. 手机扫大屏二维码（无需同一 WiFi）
3. 正常主持：开始 → 倒计时 → 开奖

### 注意

- 房间会定期写入 `data/rooms-snapshot.json`；进程重启可恢复未结束场次
- Railway 默认磁盘不持久，建议挂 Volume 到 `/app/data`
- `data/results.json` 为开奖记录；需要长期留存同样挂 Volume
- **保持单实例**：不要开多个 replica（内存房间会分裂）
- 活动现场若 WiFi 不稳，公网往往比局域网更稳

### 双模式兼容约定（以后改代码请遵守）

1. **不要写死域名**：公网用 `PUBLIC_URL` / `RAILWAY_PUBLIC_DOMAIN`，局域网用自动检测的内网 IP  
2. **大屏在 `https` 公网页时，二维码必须用当前 `location.origin`**  
3. **WebSocket 用相对当前页面的 host**（`ws` / `wss` 自动切换）  
4. **本地调试局域网**：用 `./start-lan.sh` 或 `npm run start:lan`，勿带公网环境变量  

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
幸运多一点服务已启动（局域网模式）
  本机大屏: http://127.0.0.1:8780/screen
  局域网:   http://10.88.161.250:8780/screen
  手机页:   http://10.88.161.250:8780/m
  二维码将使用: http://10.88.161.250:8780
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
4. 填写昵称入场  
5. 主持人操作：**开始幸运多一点** → 嘉宾猛点冲分（**点得越多排名越高**）→ 倒计时结束揭晓前五（进行中实时 Top 20）  
6. 倒计时结束后同时显示全部获奖名单；可点 **再来一轮**

---

## 奖项配置（人数 + 奖品名称均可改）

编辑 `data/config.json`（改完后点大屏「开始幸运多一点」即可重新加载；也可重启服务）：

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

排名规则：**点击次数多者靠前**；次数相同则先达到该次数者靠前。  
进行中大屏实时展示 Top 20；结束后揭晓前五名。

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
| `backgroundDefault` | 等待 / 冲榜阶段背景图 |
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
4. 手机扫码打开该页，经 WebSocket 进入同一房间，再进行幸运多一点

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
│   ├── lan.json           # 局域网 baseUrl（可选）
│   └── results.json       # 开奖记录
├── lib/
│   ├── db.js
│   ├── room.js
│   └── ws.js
└── public/
    ├── assets/            # 背景图、音乐（见 assets/README.md）
    ├── screen/            # 大屏（倒计时 + Top 20 / 前五揭晓）
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

**iPhone 点不动 / 无感应？**  
HTTP 下系统可能限制动作感应，请用页面上的「点这里 +1」。

**防火墙拦截？**  
允许 Node 入站，或临时关闭防火墙再试。

---

## License

仅供内部活动使用。
