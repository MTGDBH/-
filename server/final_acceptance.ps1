$node = $env:NODE22
if (-not $node) { $node = 'node' }
& $node (Join-Path $PSScriptRoot 'final_acceptance.mjs')
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
