@echo off
rem Smart launcher for the client site dsh web (north-waterfront.dev-bim.com).
rem Mirrors dsh-web.cmd with a separate port (3081), a separate DSH_HOME
rem (isolated sessions, credentials, and settings), its own env file, and the
rem client-restricted overlay. All logic lines are ASCII (cmd parses the file
rem in the OEM codepage until chcp takes effect); Cyrillic appears only in
rem echo text after the chcp 65001 line.
rem This file must stay UTF-8 without BOM, with CRLF line endings.
setlocal EnableExtensions
chcp 65001 >nul
title dsh web north-waterfront

set "PORT=3081"
set "ROOT=%~dp0"
set "NODEDIR=%ROOT%.tools\node"
set "DSHHOME=%USERPROFILE%\.dsh-north-waterfront"
set "WORKSPACE=%USERPROFILE%\north-waterfront"

if /i "%~1"=="help" goto :usage
if /i "%~1"=="/?" goto :usage
if /i "%~1"=="-h" goto :usage
if /i "%~1"=="start" ( call :do_start & goto :end )
if /i "%~1"=="stop" ( call :do_stop & goto :end )
if /i "%~1"=="restart" ( call :do_restart & goto :end )
if /i "%~1"=="status" ( call :do_status & goto :end )
if not "%~1"=="" goto :usage

rem No argument: start when idle, ask when running.
call :find_server
if "%SERVER_PID%"=="" (
    call :do_start
    goto :end
)

echo Клиентский сервер уже запущен: порт %PORT%, PID %SERVER_PID%.
echo.
echo   [1] Открыть в браузере  (по умолчанию, Enter)
echo   [2] Перезапустить
echo   [3] Ничего не делать
echo.
choice /c 123 /n /t 15 /d 1 /m "Ваш выбор: "
if errorlevel 3 goto :end
if errorlevel 2 ( call :do_restart & goto :end )
start "" "http://127.0.0.1:%PORT%/"
echo.
echo Открыл http://127.0.0.1:%PORT%/ в браузере.
goto :end

rem ------------------------------------------------------------ subroutines

:find_server
set "SERVER_PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /c:":%PORT% " ^| findstr /c:"LISTENING"') do (
    if not defined SERVER_PID set "SERVER_PID=%%a"
)
goto :eof

:do_status
call :find_server
if "%SERVER_PID%"=="" (
    echo Статус: НЕ запущен - порт %PORT% свободен.
) else (
    echo Статус: запущен, порт %PORT%, PID %SERVER_PID%.
)
goto :eof

:do_stop
call :find_server
rem Stop the client tunnel connector alongside the server.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | Where-Object { $_.CommandLine -match 'config-north-waterfront' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
if "%SERVER_PID%"=="" (
    echo Останавливать нечего: сервер не запущен.
    goto :eof
)
echo Останавливаю клиентский dsh web - PID %SERVER_PID% ...
taskkill /PID %SERVER_PID% /T /F >nul 2>&1
set /a TRIES=0
:waitfree
netstat -ano | findstr /c:":%PORT% " | findstr /c:"LISTENING" >nul 2>&1
if errorlevel 1 (
    echo Остановлено.
    goto :eof
)
set /a TRIES+=1
if %TRIES% lss 10 (
    timeout /t 1 /nobreak >nul 2>&1
    goto :waitfree
)
echo ВНИМАНИЕ: порт %PORT% всё ещё занят - его держит какой-то другой процесс.
goto :eof

:do_start
call :find_server
if not "%SERVER_PID%"=="" (
    echo Клиентский сервер уже запущен - порт %PORT%, PID %SERVER_PID%.
    start "" "http://127.0.0.1:%PORT%/"
    echo Открыл браузер: http://127.0.0.1:%PORT%/
    goto :eof
)
if not exist "%NODEDIR%\node.exe" (
    echo ОШИБКА: не найден портативный Node: "%NODEDIR%\node.exe"
    goto :eof
)
cd /d "%ROOT%"
rem Isolated client state: sessions, credentials, and settings for this site
rem live under DSH_HOME, never mixed with the internal deployment.
set "DSH_HOME=%DSHHOME%"
if not exist "%DSHHOME%" mkdir "%DSHHOME%"
if not exist "%WORKSPACE%" mkdir "%WORKSPACE%"
rem Client secrets (DEVBIM_WEB_PASSWORD, OPENROUTER_API_KEY, DRAWING5_*)
rem live in .env.north-waterfront, never here.
set "ENV_FILE=%ROOT%.env.north-waterfront"
if exist "%ENV_FILE%" (
    for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%ENV_FILE%") do set "%%A=%%B"
)
set "PATH=%NODEDIR%;%PATH%"
set "PNPM="
where pnpm >nul 2>&1
if not errorlevel 1 set "PNPM=pnpm"
if not defined PNPM if exist "%NODEDIR%\corepack.cmd" set PNPM="%NODEDIR%\corepack.cmd" pnpm
if not defined PNPM (
    echo ОШИБКА: pnpm не найден в PATH, и нет "%NODEDIR%\corepack.cmd".
    goto :eof
)
echo Использую Node:
node --version
echo.
echo Запускаю клиентский сайт north-waterfront (порт %PORT%, DSH_HOME=%DSHHOME%).
echo Остановить сервер: Ctrl+C в этом окне, или dsh-web-north-waterfront.cmd stop
echo.
rem Public tunnel window: skip when the client tunnel connector already runs.
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | Where-Object { $_.CommandLine -match 'config-north-waterfront' }) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 (
    echo Туннель north-waterfront.dev-bim.com уже запущен - окно не дублирую.
    goto :tunnel_up
)
if exist "%USERPROFILE%\.cloudflared\config-north-waterfront.yml" (
    start "Tunnel north-waterfront" cmd /k "cd /d "%USERPROFILE%\.cloudflared" && cloudflared.exe tunnel --config config-north-waterfront.yml run north-waterfront"
    echo Публичный адрес: https://north-waterfront.dev-bim.com/ - вход по паролю из .env.north-waterfront
) else (
    echo Пропускаю туннель: нет %USERPROFILE%\.cloudflared\config-north-waterfront.yml
)
:tunnel_up
call %PNPM% dsh web --patch "%ROOT%packages\bundle\web-app\client-north-waterfront.patch.yml" --port %PORT%
set "EXITCODE=%errorlevel%"
echo.
if "%EXITCODE%"=="4294967295" (
    echo dsh web был завершён принудительно - скорее всего, restart из другого окна.
    echo Ничего не сломано: просто запустите снова.
) else (
    echo dsh web завершился с кодом %EXITCODE%.
)
goto :eof

:do_restart
call :do_stop
call :do_start
goto :eof

:usage
echo Клиентский сайт north-waterfront.dev-bim.com - Web UI DeepSeek Harness
echo.
echo Использование: dsh-web-north-waterfront.cmd [команда]
echo.
echo   без аргумента   запустить; если уже запущен - спросит, что делать
echo   start           запустить; если уже запущен - открыть браузер
echo   restart         остановить и запустить заново
echo   stop            остановить
echo   status          показать состояние

:end
echo.
pause
exit /b 0
