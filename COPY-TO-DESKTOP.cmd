@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (echo Copy failed. & pause & exit /b 1)
echo Files copied to C:\Users\User\Desktop\COUNTER V2
pause
