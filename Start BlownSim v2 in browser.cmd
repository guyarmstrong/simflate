@echo off
rem Double-click to open BlownSim in a browser tab (also shows the "Runs" tab
rem for simulations saved by the command-line solver).
title BlownSim v2 (browser)
cd /d "%~dp0"
set "PATH=%APPDATA%\nvm\v22.20.0;%USERPROFILE%\.cargo\bin;%PATH%"
echo Starting BlownSim in your browser... (leave this window open while you use it)
call npm run preview
if errorlevel 1 pause
