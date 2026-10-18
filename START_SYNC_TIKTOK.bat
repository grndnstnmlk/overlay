@echo off
title TikTok Live Sync Bridge - JAGÈSTORE
color 0C
echo ================================================================
echo       JAGÈSTORE TIKTOK LIVE REAL-TIME SYNC BRIDGE
echo ================================================================
echo.
echo Memeriksa file dependensi...

if not exist node_modules (
    echo Mengunduh modul TikTok Live Connector...
    call npm install
)

echo.
echo Menjalankan Sync Bridge...
echo.
node sync_tiktok.js
pause
