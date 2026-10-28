@echo off
cd /d "%~dp0"
echo Starting Local Academic Similarity Platform...
node src\similarity\cli.mjs start
pause
