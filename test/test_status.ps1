# Live /status test: front end + protocol-accurate fake engine. No GPU, no model weights.
$ErrorActionPreference = "Continue"
$scratch = $PSScriptRoot
$fe      = "D:\arby-strata\build-hip-win\bin\arby-strata.exe"
$gguf    = "D:\Strata-data\models\swift-abliterated-iq3_xxs\IQ3_XXS\Swift-Qwen3.8-Flash-Next-GSQ-RCO-abliterated-IQ3_XXS-00001-of-00002.gguf"
$fake    = "$scratch\fake_engine.exe"
$log     = "$scratch\fe-test.log"
$con     = "$scratch\fe-console.txt"
$err     = "$scratch\fe-console-err.txt"
Remove-Item $log,$con,$err -ErrorAction SilentlyContinue

$env:ARBY_UI_FORCE = "live-nocon"
# -ArgumentList joins with spaces and does NOT quote: paths containing a space must be quoted here
$argLine = "--ui=live --log-file `"$log`" -m `"$gguf`" --engine `"$fake`" --host 127.0.0.1 --port 8099 -- --serve"
$p = Start-Process -FilePath $fe -ArgumentList $argLine `
        -PassThru -WindowStyle Hidden -RedirectStandardOutput $con -RedirectStandardError $err

try {
    $up = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        try { $c = New-Object Net.Sockets.TcpClient; $c.Connect("127.0.0.1", 8099); $c.Close(); $up = $true; break } catch {}
    }
    if (-not $up) { Write-Host "PORT NEVER OPENED"; if (Test-Path $log) { Get-Content $log -Tail 15 }; exit 1 }
    Write-Host "listening after $(($i+1)*0.5)s"

    Write-Host "`n=== /status (idle) ==="
    (Invoke-RestMethod -Uri "http://127.0.0.1:8099/status" -TimeoutSec 5) | ConvertTo-Json -Depth 6

    # vocab load from the real GGUF takes a few seconds; wait for the server to report ready
    $models = $null
    for ($j = 0; $j -lt 90; $j++) {
        try { $models = Invoke-RestMethod -Uri "http://127.0.0.1:8099/v1/models" -TimeoutSec 3; break } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $models) { Write-Host "NEVER BECAME READY"; exit 1 }
    Write-Host "`n=== /status (loaded) ==="
    (Invoke-RestMethod -Uri "http://127.0.0.1:8099/status" -TimeoutSec 5) | ConvertTo-Json -Depth 6

    $models = Invoke-RestMethod -Uri "http://127.0.0.1:8099/v1/models" -TimeoutSec 5
    $id = $models.data[0].id
    Write-Host "`nmodel id = $id"

    $body = @{ model = $id; messages = @(@{ role = "user"; content = "hello" }); max_tokens = 64; stream = $false } | ConvertTo-Json -Depth 5
    $job = Start-Job -ScriptBlock {
        param($u, $b)
        try { Invoke-RestMethod -Uri $u -Method Post -Body $b -ContentType "application/json" -TimeoutSec 40 | Out-Null } catch { }
    } -ArgumentList "http://127.0.0.1:8099/v1/chat/completions", $body

    Start-Sleep -Milliseconds 1400
    Write-Host "`n=== /status (mid-generation) ==="
    (Invoke-RestMethod -Uri "http://127.0.0.1:8099/status" -TimeoutSec 5) | ConvertTo-Json -Depth 6

    Wait-Job $job -Timeout 30 | Out-Null
    Remove-Job $job -Force
    Start-Sleep -Milliseconds 400
    Write-Host "`n=== /status (after the request) ==="
    (Invoke-RestMethod -Uri "http://127.0.0.1:8099/status" -TimeoutSec 5) | ConvertTo-Json -Depth 6
}
finally {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 400
    Write-Host "`n=== console bytes (expect 0: the live UI owns the console) ==="
    if (Test-Path $con) { "stdout: " + (Get-Item $con).Length + " bytes" }
    if (Test-Path $err) { "stderr: " + (Get-Item $err).Length + " bytes" }
}
