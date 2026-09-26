@echo off
rem Запуск DeepSeek Harness (dsh) Web UI из исходников.
rem Использует портативный Node 24 из .tools\node (системный Node 22.17 слишком стар:
rem в нём нет import.meta.main, из-за чего CLI dsh молча завершается).
setlocal
set "ROOT=%~dp0"
set "PATH=%ROOT%.tools\node;%PATH%"
cd /d "%ROOT%"
echo Node: & node --version
echo Запускаю dsh web (бренд devBIM)... Браузер откроется сам (адрес с токеном).
call pnpm dsh web --patch "%ROOT%packages\bundle\web-app\devbim.patch.yml"
pause
