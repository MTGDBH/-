[CmdletBinding()]
param(
  [string]$Version = (Get-Date -Format 'yyyyMMdd-HHmmss'),
  [string]$PythonPath = 'python',
  [string]$OutputPath
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $OutputPath) {
  $OutputPath = Join-Path $ProjectRoot "private-artifacts\health-model-bundle-$Version.zip"
}

& $PythonPath (Join-Path $ProjectRoot 'ml\model_bundle.py') package `
  --source (Join-Path $ProjectRoot 'ml\models') `
  --output $OutputPath `
  --version $Version
if ($LASTEXITCODE -ne 0) { throw '模型包创建失败。' }

$Digest = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Host "模型包已创建：$OutputPath"
Write-Host "MODEL_BUNDLE_SHA256=$Digest"
Write-Host '请将模型包上传到私有 HTTPS 地址，并把签名 URL 与以上哈希填入 server\.env。'
