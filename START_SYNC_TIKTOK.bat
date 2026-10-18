@echo off
title TikTok Live Sync Dual Account (@greendmalik ^& @frhndytfrhn)
color 0C
echo ================================================================
echo    TIKTOK DUAL LIVE REAL-TIME SYNC BRIDGE (OTOMATIS)
echo    Akun: @greendmalik ^& @frhndytfrhn
echo ================================================================
echo.
echo Memeriksa file dependensi...

if not exist node_modules (
    echo Mengunduh modul TikTok Live Connector...
    call npm install
)

echo.
echo Menjalankan Sync Bridge Otomatis...
echo.
node sync_tiktok.js
pause
