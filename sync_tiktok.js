/**
 * TikTok Live Stream Sync Bridge
 * JAGÈSTORE MLBB Overlay
 * 
 * Menghubungkan TikTok LIVE langsung ke overlay secara real-time:
 * - Menyinkronkan jumlah Like asli saat penonton tap-tap layar
 * - Memunculkan partikel hati (floating hearts) secara real-time
 * - Menyajikan overlay secara lokal pada http://localhost:8080/
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { WebcastPushConnection } = require('tiktok-live-connector');
const readline = require('readline');

const PORT = 8080;

// 1. Web Server Statis untuk menyajikan file overlay tanpa lag / tanpa mixed content
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain'
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

  const filePath = path.join(__dirname, decodeURIComponent(reqPath));

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('File tidak ditemukan');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Access-Control-Allow-Origin': '*'
    });

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  });
});

// 2. WebSocket Server untuk memancarkan event ke overlay
const wss = new WebSocketServer({ server });
const connectedClients = new Set();

wss.on('connection', (ws) => {
  connectedClients.add(ws);
  console.log(`[Overlay] ✅ Browser overlay tersambung! (Total: ${connectedClients.size} layar)`);

  ws.on('close', () => {
    connectedClients.delete(ws);
  });
});

function broadcast(data) {
  const payload = JSON.stringify(data);
  for (const client of connectedClients) {
    if (client.readyState === 1) { // OPEN
      client.send(payload);
    }
  }
}

// 3. Sambungkan ke TikTok Live Stream
function startTikTokConnector(username) {
  const cleanUsername = username.replace(/^@/, '').trim();
  console.log(`\n[TikTok] 🔍 Mencari siaran langsung untuk @${cleanUsername}...`);

  const tiktokLive = new WebcastPushConnection(cleanUsername, {
    processInitialData: true,
    enableExtendedGiftInfo: true,
    requestPollingIntervalMs: 1000
  });

  tiktokLive.connect()
    .then(state => {
      console.log(`[TikTok] 🔥 TERHUBUNG KE LIVE STREAM @${cleanUsername}! (Room ID: ${state.roomId})`);
      console.log(`[TikTok] ✨ Siap menerima tap-tap like dari penonton secara real-time.\n`);
    })
    .catch(err => {
      console.error(`[TikTok] ❌ Gagal terhubung ke @${cleanUsername}:`, err.message || err);
      console.log(`[TikTok] 👉 Pastikan akun @${cleanUsername} SEDANG LIVE saat script ini dijalankan.`);
      console.log(`[TikTok] 🔄 Mencoba menyambung kembali dalam 10 detik...`);
      setTimeout(() => startTikTokConnector(cleanUsername), 10000);
    });

  // Event: Penonton memberi like / tap-tap layar
  tiktokLive.on('like', (data) => {
    console.log(`[Like] ❤️ +${data.likeCount} like dari ${data.uniqueId} | Total: ${data.totalLikeCount}`);
    broadcast({
      type: 'like',
      likeCount: data.likeCount,
      totalLikeCount: data.totalLikeCount,
      user: data.uniqueId
    });
  });

  // Event: Update statistik penonton & like
  tiktokLive.on('roomUser', (data) => {
    if (data.viewerCount) {
      broadcast({
        type: 'stats',
        viewerCount: data.viewerCount
      });
    }
  });

  // Event: Siaran langsung berakhir
  tiktokLive.on('streamEnd', () => {
    console.log(`[TikTok] 🛑 Siaran langsung telah berakhir.`);
  });

  tiktokLive.on('disconnected', () => {
    console.log(`[TikTok] ⚠️ Terputus dari TikTok Live. Mencoba menghubungkan kembali...`);
  });

  tiktokLive.on('error', (err) => {
    console.error(`[TikTok] Error:`, err.message || err);
  });
}

// 4. Jalankan Server
server.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`       ⚡ JAGÈSTORE TIKTOK LIVE REAL-TIME SYNC BRIDGE ⚡        `);
  console.log(`================================================================`);
  console.log(`Local Web Server berjalan pada: http://localhost:${PORT}/`);
  console.log(`Link Overlay Vertikal : http://localhost:${PORT}/index.html`);
  console.log(`Link Overlay Horizontal: http://localhost:${PORT}/overlay.html`);
  console.log(`================================================================`);

  // Cek argumen CLI: node sync_tiktok.js [username]
  const argUser = process.argv[2];
  if (argUser) {
    startTikTokConnector(argUser);
  } else {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.question('Masukkan Username TikTok Anda (contoh: @malikalone): ', (answer) => {
      rl.close();
      const targetUser = answer.trim() || 'malikalone';
      startTikTokConnector(targetUser);
    });
  }
});
