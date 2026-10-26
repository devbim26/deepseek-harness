# Diagnostic launcher: run dsh web detached from any parent console, with
# stdout/stderr captured to %TEMP%\dsh-web.{out,err}.log for post-mortem.
# ASCII-only content; the repo root is derived from this script location.
$root = $PSScriptRoot
$out = Join-Path $env:TEMP 'dsh-web.out.log'
$err = Join-Path $env:TEMP 'dsh-web.err.log'
# Start-Process joins ArgumentList with spaces and never quotes, so any element
# containing a space (this checkout's path does) must carry its own quotes.
$overlay = '"' + (Join-Path $root 'packages\bundle\web-app\devbim.patch.yml') + '"'
Start-Process -FilePath (Join-Path $root '.tools\node\node.exe') `
  -ArgumentList @('--import', 'tsx/esm', 'apps\cli\src\bin.ts', 'web', '--patch', $overlay) `
  -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput $out -RedirectStandardError $err
Write-Host "detached dsh web started; logs: $out / $err"
