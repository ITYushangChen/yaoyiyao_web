# 局域网启动
# 用法: powershell -ExecutionPolicy Bypass -File .\start.ps1

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

function Find-NodeExe {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) { return $cmd.Source }
  $candidates = @(
    Join-Path $env:LOCALAPPDATA "Programs\cursor\resources\app\resources\helpers\node.exe"
    Join-Path ${env:ProgramFiles} "cursor\resources\app\resources\helpers\node.exe"
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

$NodeExe = Find-NodeExe
if (-not $NodeExe) {
  Write-Host "未找到 node.exe（可用 Cursor 自带 helpers\\node.exe）" -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "=== 摇一摇 · 局域网模式 ===" -ForegroundColor Yellow
Write-Host "使用 Node: $NodeExe"
Write-Host "电脑大屏: http://127.0.0.1:8780/screen"
Write-Host "手机需与电脑连接同一 WiFi"
Write-Host ""

& $NodeExe server.js
