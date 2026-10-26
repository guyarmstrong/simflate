@echo off
rem Double-click to open Simflate in its own app window.
rem The first start takes a few minutes (it builds the app); later starts are quick.
title Simflate (development)
cd /d "%~dp0"
set "PATH=%APPDATA%\nvm\v22.20.0;%USERPROFILE%\.cargo\bin;%PATH%"
echo Starting Simflate... (leave this window open while you use the app)
call npm run app
if errorlevel 1 pause
