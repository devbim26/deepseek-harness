@echo off
rem One-click restart of the devBIM web front: kills the old dsh web on port 3080,
rem boots a fresh one (server plus front in one process), and the browser opens
rem itself with the auth-token URL. Works as a plain start when nothing runs.
rem Logic lines are ASCII (cmd parses this file in the OEM codepage until the
rem chcp below takes effect); Cyrillic appears only in echo text after chcp 65001.
rem Keep this file UTF-8 without BOM, with CRLF line endings.
setlocal EnableExtensions
chcp 65001 >nul
title dsh web - restart (devBIM)

set "PORT=3080"
set "ROOT=%~dp0"
set "NODEDIR=%ROOT%.tools\node"

echo [1/2] Останавливаю старый dsh web (если запущен)...
call :find_server
if not "%SERVER_PID%"=="" (
    echo   Останавливаю PID %SERVER_PID% на порту %PORT% ...
    taskkill /PID %SERVER_PID% /T /F >nul 2>&1
) else (
    echo   Сервер не запущен - будет чистый запуск.
)
set /a TRIES=0
:waitfree
netstat -ano | findstr /c:":%PORT% " | findstr /c:"LISTENING" >nul 2>&1
if errorlevel 1 goto :portfree
set /a TRIES+=1
if %TRIES% lss 10 (
    timeout /t 1 /nobreak >nul 2>&1
    goto :waitfree
)
echo ВНИМАНИЕ: порт %PORT% всё ещё занят другим процессом - продолжаю, но сервер может не подняться.

:portfree
echo.
echo [2/2] Запускаю dsh web - сервер и фронт, бренд devBIM.
if not exist "%NODEDIR%\node.exe" (
    echo ОШИБКА: не найден портативный Node: "%NODEDIR%\node.exe"
    goto :fail
)
cd /d "%ROOT%"
rem DEVBIM_WEB_PASSWORD (public login page) lives in .env, never here.
set "ENV_FILE=%ROOT%.env"
if exist "%ENV_FILE%" (
    for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%ENV_FILE%") do set "%%A=%%B"
)
set "PATH=%NODEDIR%;%PATH%"
rem pnpm from AppData\Roaming\npm is not on the double-clicked console PATH
rem (the persistent user PATH lacks that folder), so fall back to the corepack
rem shim shipped with the portable Node; it honours packageManager pnpm@11.7.0.
set "PNPM="
where pnpm >nul 2>&1
if not errorlevel 1 set "PNPM=pnpm"
if not defined PNPM if exist "%NODEDIR%\corepack.cmd" set PNPM="%NODEDIR%\corepack.cmd" pnpm
if not defined PNPM (
    echo ОШИБКА: pnpm не найден в PATH, и нет "%NODEDIR%\corepack.cmd".
    goto :fail
)
echo Использую Node:
node --version
echo.
echo Браузер откроется сам; адрес с токеном появится ниже.
echo Остановить сервер: Ctrl+C в этом окне, или dsh-web.cmd stop
echo.
rem Public tunnel window: skip when a devbim tunnel connector already runs.
powershell -NoProfile -Command "if (Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | Where-Object { $_.CommandLine -match 'config-devbim' }) { exit 1 } else { exit 0 }" >nul 2>&1
if errorlevel 1 (
    echo Туннель devbim.dev-bim.com уже запущен - окно не дублирую.
    goto :tunnel_up
)
if exist "%USERPROFILE%\.cloudflared\config-devbim.yml" (
    start "Tunnel devbim" cmd /k "cd /d "%USERPROFILE%\.cloudflared" && cloudflared.exe tunnel --config config-devbim.yml run devbim"
    echo Публичный адрес: https://devbim.dev-bim.com/ - вход по паролю из .env
) else (
    echo Пропускаю туннель: нет %USERPROFILE%\.cloudflared\config-devbim.yml
)
:tunnel_up
call %PNPM% dsh web --patch "%ROOT%packages\bundle\web-app\devbim.patch.yml"
set "EXITCODE=%errorlevel%"
echo.
if "%EXITCODE%"=="4294967295" (
    echo dsh web был завершён принудительно - скорее всего, restart из другого окна.
    echo Ничего не сломано: просто запустите этот файл снова.
) else (
    echo dsh web завершился с кодом %EXITCODE%.
)
goto :end

:find_server
set "SERVER_PID="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /c:":%PORT% " ^| findstr /c:"LISTENING"') do (
    if not defined SERVER_PID set "SERVER_PID=%%a"
)
goto :eof

:fail
echo.
pause
exit /b 1

:end
echo.
pause
exit /b 0
