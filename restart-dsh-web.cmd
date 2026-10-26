@echo off
rem Restart DeepSeek Harness (dsh) Web UI: stop the old instance, start fresh.
rem Works as a plain start too (if nothing is running, kill finds nothing).
rem Uses portable Node 24 from .tools\node (system Node 22.17 lacks import.meta.main,
rem which makes the dsh CLI exit silently with code 0).
rem NOTE: run only ONE copy at a time - a second copy kills the first server,
rem and the first window then shows exit code 4294967295 ("killed", see below).
setlocal
set "ROOT=%~dp0"
set "PATH=%ROOT%.tools\node;%PATH%"
cd /d "%ROOT%"

echo [1/2] Stopping old dsh web (if running)...
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'bin\.ts' } | ForEach-Object { Write-Host ('  killing node PID ' + $_.ProcessId); Stop-Process -Id $_.ProcessId -Force }"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /c:":3080" ^| findstr /c:"LISTENING"') do taskkill /PID %%a /F >nul 2>&1

rem wait until port 3080 is free (max 10 s)
set /a tries=0
:waitfree
netstat -ano | findstr /c:":3080" | findstr /c:"LISTENING" >nul 2>&1
if %errorlevel%==0 (
    set /a tries+=1
    if %tries% lss 10 (
        timeout /t 1 /nobreak >nul
        goto waitfree
    )
    echo   WARNING: port 3080 is still busy, starting anyway.
)

rem pnpm may be absent from a double-clicked console PATH (AppData\Roaming\npm
rem is not on the persistent user PATH), so fall back to portable-Node corepack.
set "PNPM="
where pnpm >nul 2>&1
if not errorlevel 1 set "PNPM=pnpm"
if not defined PNPM if exist "%ROOT%.tools\node\corepack.cmd" set PNPM="%ROOT%.tools\node\corepack.cmd" pnpm
if not defined PNPM (
    echo ERROR: pnpm not found in PATH and no corepack in "%ROOT%.tools\node".
    pause
    exit /b 1
)

echo [2/2] Starting dsh web (devBIM branding)... The browser will open with the auth-token URL.
node --version
call %PNPM% dsh web --patch "%ROOT%packages\bundle\web-app\devbim.patch.yml"
set "EXITCODE=%errorlevel%"

echo.
if "%EXITCODE%"=="4294967295" (
    echo dsh web was KILLED externally - most likely by a second restart-dsh-web
    echo window or by the task manager. Nothing is broken; start it again.
) else (
    echo dsh web exited with code %EXITCODE%.
)
echo Press any key to close this window...
pause >nul
