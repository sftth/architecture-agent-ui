@echo off
setlocal
rem architecture-agent-ui Windows service helper. Usage: service.cmd install|uninstall|start|stop|restart|status|logs [backend|frontend]
set "PS=powershell"
where pwsh >nul 2>nul && set "PS=pwsh"
%PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0service.ps1" %*
exit /b %ERRORLEVEL%
