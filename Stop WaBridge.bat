@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "windows\manage.ps1" stop
pause
