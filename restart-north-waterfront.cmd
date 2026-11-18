@echo off
rem One-click launch/restart of the client site north-waterfront.dev-bim.com:
rem stops the old dsh web (port 3081) and its tunnel connector (a no-op when
rem already down, so it doubles as a plain launcher), boots a fresh server,
rem and reuses the running tunnel window. The launcher also resets the
rem node.exe integrity label before every boot, so a replaced Node heals
rem itself. Just double-click.
call "%~dp0dsh-web-north-waterfront.cmd" restart
