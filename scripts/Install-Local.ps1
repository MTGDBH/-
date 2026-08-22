[CmdletBinding()]
param(
  [string]$PythonPath = 'python',
  [switch]$SkipNodeInstall,
  [switch]$SkipModelDownload
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ServerRoot = Join-Path $ProjectRoot 'server'
$VenvPython = Join-Path $ProjectRoot '.venv\Scripts\python.exe'
$PythonMarker = Join-Path $ProjectRoot '.venv\.runtime-requirements.sha256'
$EnvPath = Join-Path $ServerRoot '.env'
$EnvExample = Join-Path $ServerRoot '.env.example'

function Get-DotEnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path -LiteralPath $Path)) { return '' }
  foreach ($Line in Get-Content -LiteralPath $Path) {
    $Trimmed = $Line.Trim()
    if (-not $Trimmed -or $Trimmed.StartsWith('#')) { continue }
    $Parts = $Trimmed.Split('=', 2)
    if ($Parts.Count -eq 2 -and $Parts[0].Trim() -eq $Name) {
      return $Parts[1].Trim().Trim('"').Trim("'")
    }
  }
  return ''
}

Write-Host '=== 检查 Python 3.14 x64 ==='
if (-not (Test-Path -LiteralPath $VenvPython)) {
  $Version = & $PythonPath -c 'import struct,sys; print(f"{sys.version_info.major}.{sys.version_info.minor}|{struct.calcsize(''P'')*8}")'
  if ($LASTEXITCODE -ne 0 -or $Version.Trim() -ne '3.14|64') {
    throw '需要 Python 3.14 x64。可用 -PythonPath 指定 python.exe。'
  }
  & $PythonPath -m venv (Join-Path $ProjectRoot '.venv')
  if ($LASTEXITCODE -ne 0) { throw '创建 Python 虚拟环境失败。' }
}

$RequirementsPath = Join-Path $ProjectRoot 'ml\requirements-runtime.txt'
$RequirementsHash = (Get-FileHash -LiteralPath $RequirementsPath -Algorithm SHA256).Hash.ToLowerInvariant()
$InstalledHash = if (Test-Path -LiteralPath $PythonMarker) { (Get-Content -LiteralPath $PythonMarker -Raw).Trim() } else { '' }
if ($InstalledHash -ne $RequirementsHash) {
  Write-Host '=== 安装 Python 推理依赖 ==='
  & $VenvPython -m pip install --disable-pip-version-check --upgrade pip
  if ($LASTEXITCODE -ne 0) { throw '升级 pip 失败。' }
  & $VenvPython -m pip install --disable-pip-version-check -r $RequirementsPath
  if ($LASTEXITCODE -ne 0) { throw '安装 Python 推理依赖失败。' }
  Set-Content -LiteralPath $PythonMarker -Value $RequirementsHash -Encoding ascii
} else {
  Write-Host 'Python 推理依赖已是目标版本，跳过安装。'
}
& $VenvPython -c 'import joblib,lightgbm,numpy,pandas,sklearn,xgboost'
if ($LASTEXITCODE -ne 0) { throw 'Python 推理环境自检失败；请删除 .venv 后重新安装。' }

if (-not $SkipNodeInstall) {
  $LockPath = Join-Path $ServerRoot 'package-lock.json'
  $NodeMarker = Join-Path $ServerRoot 'node_modules\.package-lock.sha256'
  $LockHash = (Get-FileHash -LiteralPath $LockPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $InstalledLockHash = if (Test-Path -LiteralPath $NodeMarker) { (Get-Content -LiteralPath $NodeMarker -Raw).Trim() } else { '' }
  if ($InstalledLockHash -ne $LockHash) {
    Write-Host '=== 安装 Node 22 依赖 ==='
    $NodePath = (& npx --yes node@22.16.0 -p "process.execPath").Trim()
    $NpmCommand = (Get-Command npm.cmd -ErrorAction Stop).Source
    $NpmCli = Join-Path (Split-Path -Parent $NpmCommand) 'node_modules\npm\bin\npm-cli.js'
    if (-not (Test-Path -LiteralPath $NodePath) -or -not (Test-Path -LiteralPath $NpmCli)) {
      throw '无法定位 Node 22.16.0 或 npm-cli.js。'
    }
    Push-Location $ServerRoot
    try {
      & $NodePath $NpmCli ci
      if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败。' }
      Set-Content -LiteralPath $NodeMarker -Value $LockHash -Encoding ascii
    } finally { Pop-Location }
  } else {
    Write-Host 'Node 依赖已与锁文件一致，跳过安装。'
  }
}

if (-not (Test-Path -LiteralPath $EnvPath)) {
  Copy-Item -LiteralPath $EnvExample -Destination $EnvPath
  Write-Host '已从 .env.example 生成 server\.env。'
}

if (-not $SkipModelDownload) {
  $StatusJson = & $VenvPython (Join-Path $ProjectRoot 'ml\model_bundle.py') validate --models-dir (Join-Path $ProjectRoot 'ml\models')
  $Status = $StatusJson | ConvertFrom-Json
  if ($Status.status -ne 'ready') {
    $BundleUrl = Get-DotEnvValue $EnvPath 'MODEL_BUNDLE_URL'
    $BundleSha = Get-DotEnvValue $EnvPath 'MODEL_BUNDLE_SHA256'
    if ($BundleUrl -and $BundleSha) {
      Write-Host '=== 下载并校验私有模型包 ==='
      $env:HEALTH_MODEL_BUNDLE_URL = $BundleUrl
      try {
        & $VenvPython (Join-Path $ProjectRoot 'ml\model_bundle.py') install --url-env HEALTH_MODEL_BUNDLE_URL --sha256 $BundleSha --models-dir (Join-Path $ProjectRoot 'ml\models')
        if ($LASTEXITCODE -ne 0) { Write-Warning '模型包安装失败；主系统将以降级模式启动。' }
      } finally {
        Remove-Item Env:HEALTH_MODEL_BUNDLE_URL -ErrorAction SilentlyContinue
      }
    } else {
      Write-Warning '未配置私有模型地址；主系统和 Curve V2 可用，人群模型将显示“未安装”。'
    }
  } else {
    Write-Host "模型包已校验：$($Status.bundle_version)"
  }
}

Write-Host '数据库将在首次启动时自动建表；已有数据库不会被安装脚本改写。'
Write-Host '本机安装完成。运行 scripts\Start-Local.ps1 启动项目。'
