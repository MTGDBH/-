$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3001'
$s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$login = Invoke-WebRequest "$base/api/auth/login" -Method Post -ContentType 'application/json' -Body '{"identifier":"张奶奶","password":"123456"}' -WebSession $s
if ($login.StatusCode -ne 200) { throw 'login failed' }
$trend = (Invoke-WebRequest "$base/api/chat" -Method Post -ContentType 'application/json' -Body '{"message":"最近血压怎么样？"}' -WebSession $s).Content | ConvertFrom-Json
if ($trend.source -ne 'openai' -or $trend.confidence.type -ne 'data') { throw 'trend agent acceptance failed' }
$risk = (Invoke-WebRequest "$base/api/prediction/disease/diabetes" -WebSession $s).Content | ConvertFrom-Json
if (-not $risk.success -or $risk.risk_probability -lt 0 -or $risk.risk_probability -gt 1) { throw 'disease risk acceptance failed' }
$curve = (Invoke-WebRequest "$base/api/prediction/bp?days=90&future=30" -WebSession $s).Content | ConvertFrom-Json
if (-not $curve.actual -or -not $curve.fitted -or $curve.predicted.Count -eq 0 -or -not $curve.predicted[0].recorded_at -or $curve.predicted[0].lower -gt $curve.predicted[0].upper) { throw 'curve acceptance failed' }
$behaviorCurve = (Invoke-WebRequest "$base/api/prediction/steps?days=90&future=30" -WebSession $s).Content | ConvertFrom-Json
if ($behaviorCurve.predicted.Count -ne 0 -or -not $behaviorCurve.analysis.forecastReason) { throw 'behavior forecast gate failed' }
$graph = (Invoke-WebRequest "$base/api/knowledge/graph/query?q=血压连续偏高怎么办&disease=hypertension" -WebSession $s).Content | ConvertFrom-Json
if (-not $graph.results -or -not $graph.results[0].citation) { throw 'GraphRAG acceptance failed' }
$behavior = (Invoke-WebRequest "$base/api/chat" -Method Post -ContentType 'application/json' -Body '{"message":"我最近走得少吗？"}' -WebSession $s).Content | ConvertFrom-Json
if (-not $behavior.content -or $behavior.confidence.type -ne 'data') { throw 'behavior acceptance failed' }
$history = (Invoke-WebRequest "$base/api/chat/history" -WebSession $s).Content | ConvertFrom-Json
if ($history.Count -lt 2) { throw 'history acceptance failed' }
Write-Output "FINAL ACCEPTANCE PASS: login, DeepSeek trend, disease risk, GraphRAG, behavior, history"
