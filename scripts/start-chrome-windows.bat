@echo off
echo Starting Chrome with DevTools Protocol for Windows...

REM Kill existing Chrome processes
taskkill /f /im chrome.exe 2>nul
timeout /t 2 /nobreak >nul

REM Start Chrome with DevTools Protocol
start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" ^
  --remote-debugging-port=9222 ^
  --no-sandbox ^
  --disable-setuid-sandbox ^
  --disable-dev-shm-usage ^
  --disable-gpu ^
  --user-agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" ^
  --window-size=1366,768

echo Chrome started with DevTools Protocol
echo DevTools available at: http://localhost:9222
pause
