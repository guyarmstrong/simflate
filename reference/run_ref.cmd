@echo off
rem BlownSim reference solver: run OpenCourant on <dir>\model.k, then turn
rem every animation frame into VTK. Usage: run_ref.cmd <dir> [nopause]
setlocal
set OC=C:\Users\guyke\OpenCourant\OpenCourant
set RAD_CFG_PATH=%OC%\hm_cfg_files
set RAD_H3D_PATH=%OC%\extlib\h3d\lib\win64
set KMP_STACKSIZE=400m
set OMP_NUM_THREADS=4
set PATH=%OC%\extlib\hm_reader\win64;%OC%\extlib\intelOneAPI_runtime\win64;%OC%\extlib\h3d\lib\win64;%PATH%
cd /d "%~1"
del /q model_0000.out model_0001.out model_0001.rad modelA* *.vtk 2>nul
echo Running starter...
"%OC%\exec\starter_win64.exe" -i model.k -np 1 > starter.log 2>&1
echo starter exit code %ERRORLEVEL%
if not exist model_0001.rad goto done
echo Running engine...
"%OC%\exec\engine_win64.exe" -i model_0001.rad -nt 4 > engine.log 2>&1
echo engine finished
for %%f in (modelA???) do "%OC%\exec\anim_to_vtk_win64.exe" %%f > %%f.vtk
echo frames converted
:done
echo Done.
if "%~2"=="" pause
