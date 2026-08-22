$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PidPath = Join-Path $ProjectRoot 'server\.local-server.pid'
if (-not (Test-Path -LiteralPath $PidPath)) {
  Write-Host '没有找到本机服务进程记录。'
  exit 0
}
$Record = Get-Content -LiteralPath $PidPath -Raw | ConvertFrom-Json
$ServerPid = [int]$Record.pid
$Process = Get-Process -Id $ServerPid -ErrorAction SilentlyContinue
if ($Process -and $Record.node_path -and [IO.Path]::GetFullPath($Process.Path) -eq [IO.Path]::GetFullPath([string]$Record.node_path)) {
  Stop-Process -Id $ServerPid
  Write-Host "已停止本机服务进程 $ServerPid。"
} elseif ($Process) {
  throw 'PID 对应的进程与本项目记录的 Node 路径不一致，未执行停止操作。'
}
Remove-Item -LiteralPath $PidPath -ErrorAction SilentlyContinue
