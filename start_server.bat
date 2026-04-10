@echo off
cd /d "%~dp0"
echo ================================================
echo   Veritas AI - Plagiarism Checker Backend
echo ================================================
echo.
echo Starting Flask server on http://localhost:5000
echo Keep this window open while using the website.
echo.
python server.py
pause
