# Render one strata-top frame against a live front end + fake engine. No GPU, no weights served.
$ErrorActionPreference = "Continue"
$scratch = $PSScriptRoot
$fe      = "D:\arby-strata\build-hip-win\bin\arby-strata.exe"
$gguf    = "D:\Strata-data\models\swift-abliterated-iq3_xxs\IQ3_XXS\Swift-Qwen3.8-Flash-Next-GSQ-RCO-abliterated-IQ3_XXS-00001-of-00002.gguf"
$fake    = "$scratch\fake_engine.exe"
$log     = "$scratch\fe-tui.log"
$con     = "$scratch\fe-tui-con.txt"
$errf    = "$scratch\fe-tui-err.txt"
$top     = "C:\Hermes\Default Project\strata-top\strata-top.exe"
Remove-Item $log,$con,$errf -ErrorAction SilentlyContinue

$env:ARBY_UI_FORCE = "live-nocon"
# -ArgumentList joins with spaces and does NOT quote: paths containing a space must be quoted here
$argLine = "--ui=live --log-file `"$log`" -m `"$gguf`" --engine `"$fake`" --host 127.0.0.1 --port 8099 -- --serve --spec 4 --prefill auto:16384 --kv int8 --kv-resident 32768"
$p = Start-Process -FilePath $fe -ArgumentList $argLine `
        -PassThru -WindowStyle Hidden -RedirectStandardOutput $con -RedirectStandardError $errf

try {
    $models = $null
    for ($j = 0; $j -lt 90; $j++) {
        try { $models = Invoke-RestMethod -Uri "http://127.0.0.1:8099/v1/models" -TimeoutSec 3; break } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $models) { Write-Host "NEVER READY"; exit 1 }
    $id = $models.data[0].id

    # two completed requests first, so the history panel has bars
    foreach ($n in 1..2) {
        $body = @{ model = $id; messages = @(@{ role = "user"; content = "hello $n" }); max_tokens = 64; stream = $false } | ConvertTo-Json -Depth 5
        try { Invoke-RestMethod -Uri "http://127.0.0.1:8099/v1/chat/completions" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 40 | Out-Null } catch {}
    }

    # and one in flight while the TUI takes its snapshot
    $body = @{ model = $id; messages = @(@{ role = "user"; content = "in flight" }); max_tokens = 64; stream = $false } | ConvertTo-Json -Depth 5
    $job = Start-Job -ScriptBlock {
        param($u, $b)
        try { Invoke-RestMethod -Uri $u -Method Post -Body $b -ContentType "application/json" -TimeoutSec 40 | Out-Null } catch {}
    } -ArgumentList "http://127.0.0.1:8099/v1/chat/completions", $body

    Start-Sleep -Milliseconds 1200
    Write-Host "===== strata-top -once ====="
    & $top -url "http://127.0.0.1:8099/status" -once
    Write-Host "===== end frame ====="
    Wait-Job $job -Timeout 30 | Out-Null
    Remove-Job $job -Force
}
finally {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}
