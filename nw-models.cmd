@echo off
rem Set the north-waterfront model allowlist (NW_MODELS) in
rem .env.north-waterfront and optionally restart the client site.
rem The launcher reads the same value at start; the first id becomes the
rem new-session default. Model ids come from the OpenRouter catalog bundled
rem with pi-ai. This file must stay UTF-8 without BOM, with CRLF line endings.
setlocal EnableExtensions
chcp 65001 >nul
title NW model allowlist

set "ROOT=%~dp0"
set "ENV_FILE=%ROOT%.env.north-waterfront"
set "LAUNCHER=%ROOT%dsh-web-north-waterfront.cmd"

if /i "%~1"=="help" goto :usage
if /i "%~1"=="/?" goto :usage
if /i "%~1"=="-h" goto :usage
if /i "%~1"=="show" goto :show
if /i "%~1"=="reset" goto :reset
if not "%~1"=="" goto :set_arg
goto :prompt

:prompt
call :show_current
echo.
echo Введите список моделей OpenRouter через запятую.
echo Первая модель станет дефолтом для новых сессий.
echo Пример: deepseek/deepseek-v4.1-flash,deepseek/deepseek-v4-pro
echo.
set "LIST="
set /p "LIST=Список: "
if not defined LIST goto :cancelled
goto :apply

:set_arg
set "LIST=%~1"
if not "%~2"=="" echo ПРЕДУПРЕЖДЕНИЕ: лишние аргументы игнорируются - передайте список одной строкой в кавычках.
goto :apply

:apply
set "NW_MODE=set"
set "NW_MODELS_NEW=%LIST%"
goto :write

:reset
set "NW_MODE=remove"
set "NW_MODELS_NEW="
goto :write

:write
set "NW_ENV_FILE=%ENV_FILE%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:NW_ENV_FILE; $mode=$env:NW_MODE; if(-not (Test-Path -LiteralPath $p)){ Write-Host 'Не найден .env.north-waterfront - сначала настройте сайт.'; exit 1 }; $ids=@(); if($mode -eq 'set'){ $ids=@($env:NW_MODELS_NEW.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }); if($ids.Count -eq 0){ Write-Host 'Пустой список - ничего не записано.'; exit 1 } }; $lines=[IO.File]::ReadAllLines($p, [Text.Encoding]::UTF8); $out=New-Object System.Collections.Generic.List[string]; $done=$false; $changed=$false; foreach($line in $lines){ if($line -match '^\s*NW_MODELS\s*='){ if(-not $done -and $mode -eq 'set'){ $out.Add('NW_MODELS=' + ($ids -join ',')); $done=$true }; $changed=$true } else { $out.Add($line) } }; if($mode -eq 'set' -and -not $done){ $out.Add('NW_MODELS=' + ($ids -join ',')) }; if($mode -eq 'remove' -and -not $changed){ Write-Host 'NW_MODELS не задан - действует список по умолчанию из оверлея.'; exit 0 }; try { $utf8=New-Object System.Text.UTF8Encoding($false); [IO.File]::WriteAllText($p, (($out -join [Environment]::NewLine) + [Environment]::NewLine), $utf8) } catch { Write-Host ('Ошибка записи: ' + $_.Exception.Message); exit 1 }; if($mode -eq 'set'){ Write-Host ('Записано: NW_MODELS=' + ($ids -join ',')) } else { Write-Host 'NW_MODELS удалён - действует список по умолчанию из оверлея.' }"
if errorlevel 1 goto :cancelled

set "NW_ENV_FILE="
set "NW_MODE="
set "NW_MODELS_NEW="
echo.
call :show_current
echo.
choice /c YN /n /t 30 /d N /m "Перезапустить NW сейчас? [y/N] "
if errorlevel 2 goto :done
if not exist "%LAUNCHER%" (
    echo ОШИБКА: не найден "%LAUNCHER%".
    goto :done
)
start "NW restart" "%LAUNCHER%" restart
echo Перезапуск запущен в отдельном окне.
goto :done

:show
call :show_current
goto :done

:show_current
set "FOUND="
if exist "%ENV_FILE%" (
    for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
        if /i "%%A"=="NW_MODELS" (
            set "FOUND=1"
            if "%%B"=="" (
                echo NW_MODELS= [пусто - действует список по умолчанию]
            ) else (
                echo NW_MODELS=%%B
            )
        )
    )
)
if not defined FOUND echo NW_MODELS не задан - действует список по умолчанию из оверлея.
goto :eof

:cancelled
echo.
echo Отменено.
goto :end

:usage
echo Настройка списка моделей NW (NW_MODELS в .env.north-waterfront).
echo.
echo   nw-models.cmd                    спросить список и записать
echo   nw-models.cmd "id1,id2,..."      записать список
echo   nw-models.cmd show               показать текущий список
echo   nw-models.cmd reset              удалить NW_MODELS (вернуть оверлейный дефолт)
echo.
echo Первая модель списка - дефолт новых сессий. Id берутся из каталога
echo OpenRouter, встроенного в pi-ai; модель вне каталога даст диагностику.
echo После записи скрипт предложит перезапустить NW.
goto :end

:done
echo.

:end
pause
exit /b 0
