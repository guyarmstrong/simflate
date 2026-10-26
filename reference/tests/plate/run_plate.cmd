@echo off
rem BlownSim - OpenCourant proof of life. Double-click to run.
rem Runs the starter (reads plate.k) then the engine, logs to starter.log / engine.log.
setlocal
set OC=C:\Users\guyke\OpenCourant\OpenCourant
set RAD_CFG_PATH=%OC%\hm_cfg_files
set RAD_H3D_PATH=%OC%\extlib\h3d\lib\win64
set KMP_STACKSIZE=400m
set OMP_NUM_THREADS=4
set PATH=%OC%\extlib\hm_reader\win64;%OC%\extlib\intelOneAPI_runtime\win64;%OC%\extlib\h3d\lib\win64;%PATH%
cd /d "%~dp0"
echo Running starter...
"%OC%\exec\starter_win64.exe" -i plate.k -np 1 > starter.log 2>&1
echo starter exit code %ERRORLEVEL%
for %%f in (*_0001.rad) do (
  echo Running engine on %%f ...
  "%OC%\exec\engine_win64.exe" -i %%f -nt 4 > engine.log 2>&1
  echo engine exit code %ERRORLEVEL%
)
echo Done. Tell Claude it has finished.
if "%~1"=="" pause
