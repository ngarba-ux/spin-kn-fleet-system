@echo off
title SPIN-KN Fleet Server
echo Starting SPIN-KN Fleet...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1"
pause
