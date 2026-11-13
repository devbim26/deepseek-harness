@echo off
rem Туннель devbim.dev-bim.com -> dsh web (127.0.0.1:3080).
rem Отдельно от сервера: запускать, если сам сервер уже поднят
rem (dsh-web.cmd поднимает оба; этот файл - для ручного перезапуска туннеля).
rem Перед стартом гасит уже работающие коннекторы devbim: у одного имени туннеля
rem должен быть один активный коннектор (см. DEPLOY-DEMO-MACHINE.md, шаг 0.2),
rem лишние попадают в ротацию Cloudflare, и деградировавший из них рвёт сессии.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='cloudflared.exe'\" | Where-Object { $_.CommandLine -match 'config-devbim' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1
cd /d "%USERPROFILE%\.cloudflared"
cloudflared.exe tunnel --config config-devbim.yml run devbim
pause
