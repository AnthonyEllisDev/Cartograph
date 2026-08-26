@echo off
REM Cartograph launcher for Windows.
REM Finds a usable Python, starts the program, and keeps this window open if
REM something goes wrong so you can read why.
setlocal
cd /d "%~dp0"

set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"

if not defined PY goto nopython

REM The Microsoft Store stub called "python" answers `where` but runs nothing,
REM so prove the interpreter actually works before handing it the program.
%PY% -c "import sys; sys.exit(0 if sys.version_info >= (3, 8) else 1)" >nul 2>nul
if errorlevel 1 goto nopython

%PY% app.py %*
if errorlevel 1 pause
goto :eof

:nopython
echo.
echo   Cartograph needs Python 3.8 or newer, and could not find it.
echo.
echo   Install it from https://www.python.org/downloads/ and tick
echo   "Add Python to PATH" during setup, then run this file again.
echo.
pause
