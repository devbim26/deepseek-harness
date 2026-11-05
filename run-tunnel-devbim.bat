@echo off
rem Туннель devbim.dev-bim.com -> dsh web (127.0.0.1:3080).
rem Отдельно от сервера: запускать, если сам сервер уже поднят
rem (dsh-web.cmd поднимает оба; этот файл - для ручного перезапуска туннеля).
cd /d "%USERPROFILE%\.cloudflared"
cloudflared.exe tunnel --config config-devbim.yml run devbim
pause
