@echo off
rem Запуск DeepSeek Harness (dsh) Web UI из исходников.
rem Использует портативный Node 24 из .tools\node (системный Node 22.17 слишком стар:
rem в нём нет import.meta.main, из-за чего CLI dsh молча завершается).
setlocal
set "ROOT=%~dp0"
set "PATH=%ROOT%.tools\node;%PATH%"
cd /d "%ROOT%"
rem pnpm may be absent from a double-clicked console PATH (AppData\Roaming\npm
rem is not on the persistent user PATH), so fall back to portable-Node corepack.
set "PNPM="
where pnpm >nul 2>&1
if not errorlevel 1 set "PNPM=pnpm"
if not defined PNPM if exist "%ROOT%.tools\node\corepack.cmd" set PNPM="%ROOT%.tools\node\corepack.cmd" pnpm
if not defined PNPM (
    echo ОШИБКА: pnpm не найден в PATH, и нет "%ROOT%.tools\node\corepack.cmd".
    pause
    exit /b 1
)
echo Node: & node --version
echo Запускаю dsh web (бренд devBIM)... Браузер откроется сам (адрес с токеном).
call %PNPM% dsh web --patch "%ROOT%packages\bundle\web-app\devbim.patch.yml"
pause
