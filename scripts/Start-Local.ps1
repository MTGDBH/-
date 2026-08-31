[CmdletBinding()]
param([switch]$SkipSetup)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ServerRoot = Join-Path $ProjectRoot 'server'
$VenvPython = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
$PidPath = Join-Path $ServerRoot '.local-server.pid'

if (-not $SkipSetup) {
  & (Join-Path $PSScriptRoot 'Install-Local.ps1')
}
if (-not (Test-Path -LiteralPath $VenvPython)) { throw 'Python 虚拟环境不存在，请先运行 Install-Local.ps1。' }

try {
  $Existing = Invoke-RestMethod -Uri 'http://localhost:3001/api/health' -TimeoutSec 2
  if ($Existing.ok) {
    Start-Process 'http://localhost:3001/mobile'
    Write-Host '服务已在运行，已打开新版移动端。'
    exit 0
  }
} catch { }

$NodePath = (& npx --yes node@22.16.0 -p "process.execPath").Trim()
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $NodePath)) { throw '无法取得 Node 22.16.0。' }
$env:HTN_PYTHON = $VenvPython
$Process = Start-Process -FilePath $NodePath -ArgumentList 'src/index.js' -WorkingDirectory $ServerRoot `
  -WindowStyle Hidden -PassThru `
  -RedirectStandardOutput (Join-Path $ServerRoot 'server-runtime.out.log') `
  -RedirectStandardError (Join-Path $ServerRoot 'server-runtime.err.log')
@{ pid = $Process.Id; node_path = $NodePath } | ConvertTo-Json -Compress | Set-Content -LiteralPath $PidPath -Encoding utf8

$Ready = $false
for ($Attempt = 0; $Attempt -lt 30; $Attempt++) {
  Start-Sleep -Milliseconds 500
  if ($Process.HasExited) { break }
  try {
    $Health = Invoke-RestMethod -Uri 'http://localhost:3001/api/health' -TimeoutSec 2
    if ($Health.ok) { $Ready = $true; break }
  } catch { }
}
if (-not $Ready) {
  if (-not $Process.HasExited) { Stop-Process -Id $Process.Id }
  throw '服务启动失败，请查看 server\server-runtime.err.log。'
}

Start-Process 'http://localhost:3001/mobile'
Write-Host "项目已启动：http://localhost:3001/mobile"
Write-Host "人群模型状态：$($Health.populationModels)"
Write-Host "进程号：$($Process.Id)；运行 scripts\Stop-Local.ps1 可停止。"
