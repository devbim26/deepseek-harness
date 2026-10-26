@echo off
rem Smart launcher for dsh web (devBIM brand). Replaces the old start/restart pair.
rem All logic lines are ASCII (cmd parses the file in the OEM codepage until chcp
rem takes effect); Cyrillic appears only in echo text after the chcp 65001 line.
rem This file must stay UTF-8 without BOM, with CRLF line endings.
setlocal EnableExtensions
chcp 65001 >nul
title dsh web (devBIM)

set "PORT=3080"
set "ROOT=%~dp0"
set "NODEDIR=%ROOT%.tools\node"

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

echo Сервер уже запущен: порт %PORT%, PID %SERVER_PID%.
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
echo Если браузер показывает страницу 401, запустите этот файл с аргументом restart:
echo тогда в консоли появится свежая ссылка с токеном.
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
if "%SERVER_PID%"=="" (
    echo Останавливать нечего: сервер не запущен.
    goto :eof
)
echo Останавливаю dsh web - PID %SERVER_PID% ...
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
    echo Сервер уже запущен - порт %PORT%, PID %SERVER_PID%.
    start "" "http://127.0.0.1:%PORT%/"
    echo Открыл браузер: http://127.0.0.1:%PORT%/
    echo Если видите страницу 401, запустите этот файл с аргументом restart.
    goto :eof
)
if not exist "%NODEDIR%\node.exe" (
    echo ОШИБКА: не найден портативный Node: "%NODEDIR%\node.exe"
    goto :eof
)
cd /d "%ROOT%"
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
    goto :eof
)
echo Использую Node:
node --version
echo.
echo Запускаю dsh web - бренд devBIM.
echo Браузер откроется сам; адрес с токеном появится ниже.
echo Остановить сервер: Ctrl+C в этом окне, или dsh-web.cmd stop
echo.
call %PNPM% dsh web --patch "%ROOT%packages\bundle\web-app\devbim.patch.yml"
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
echo dsh web - бренд devBIM - Web UI DeepSeek Harness
echo.
echo Использование: dsh-web.cmd [команда]
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
