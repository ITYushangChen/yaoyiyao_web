@echo off
chcp 65001 >nul
cd /d "%~dp0"

set PORT=%PORT%
if "%PORT%"=="" set PORT=8780

echo.
echo === 摇一摇 · 局域网模式 ===
echo.

set "NODE_EXE="
where node >nul 2>nul && for /f "delims=" %%i in ('where node') do (
  if not defined NODE_EXE set "NODE_EXE=%%i"
)

if not defined NODE_EXE if exist "%LOCALAPPDATA%\Programs\cursor\resources\app\resources\helpers\node.exe" (
  set "NODE_EXE=%LOCALAPPDATA%\Programs\cursor\resources\app\resources\helpers\node.exe"
)

if not defined NODE_EXE if exist "%ProgramFiles%\cursor\resources\app\resources\helpers\node.exe" (
  set "NODE_EXE=%ProgramFiles%\cursor\resources\app\resources\helpers\node.exe"
)

if not defined NODE_EXE (
  echo 未找到可用的 node.exe。
  echo 可使用 Cursor 自带 helpers\node.exe，或安装 Node.js 18+。
  echo.
  pause
  exit /b 1
)

echo 使用 Node: %NODE_EXE%
echo.
echo 启动后请看终端打印的「局域网」地址
echo   电脑大屏: http://127.0.0.1:%PORT%/screen
echo   手机扫码: 使用局域网 IP（同一 WiFi），不要用 127.0.0.1
echo.

"%NODE_EXE%" server.js
echo.
echo 服务已退出，退出码 %ERRORLEVEL%
pause
