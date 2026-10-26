@echo off
rem Double-click to re-run the standard test shapes (circle, square, L-shape,
rem surfboard, with and without plates). Results appear in the browser's Runs tab.
title BlownSim test shapes
cd /d "%~dp0"
set "PATH=%APPDATA%\nvm\v22.20.0;%USERPROFILE%\.cargo\bin;%PATH%"
call npm run suite
echo.
echo Done. Open "Start BlownSim in browser" and click the Runs tab to watch them.
pause
