@echo off
rem strata-top: live dashboard for a running arby-strata server.
rem
rem   strata-top.bat                attach to http://127.0.0.1:8080/status
rem   strata-top.bat 8090           attach to another port on this box
rem   strata-top.bat 100.85.142.85:8080   attach over the tailnet
rem
rem Read-only: it polls /status and never sends a request to the model. It cannot slow the server
rem down, and if it dies the server never notices.
setlocal
set "HERE=%~dp0"
set "TARGET=%~1"
if not defined TARGET set "TARGET=127.0.0.1:8080"
set "URL=http://%TARGET%/status"

if not exist "%HERE%strata-top.exe" (
  echo strata-top.exe is missing next to this launcher.
  pause
  exit /b 1
)

"%HERE%strata-top.exe" -url "%URL%"
set RC=%errorlevel%
if not "%RC%"=="0" (
  echo.
  echo strata-top exited with code %RC%
  echo If the server is not running, start it first: run-arby-strata.bat
  pause
)
exit /b %RC%
