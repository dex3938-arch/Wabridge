@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "windows\setup.ps1"
pause
