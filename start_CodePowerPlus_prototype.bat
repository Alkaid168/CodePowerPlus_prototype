@echo off
setlocal
cd /d "%~dp0"
if not exist "CodePowerPlus\Scripts\python.exe" (
  echo Virtual environment not found.
  pause
  exit /b 1
)
echo Starting CodePowerPlus at http://127.0.0.1:8000/
"CodePowerPlus\Scripts\python.exe" -m uvicorn app.main:app --reload
pause
