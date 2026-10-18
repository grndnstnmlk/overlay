/**
 * TikTok Live Stream Sync Bridge
 * MLBB Overlay Real-Time Sync
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
const readline = require('readline');

// Kompatibilitas Versi tiktok-live-connector (v1 & v2.x)
const tiktokConnectorModule = require('tiktok-live-connector');
const TikTokLiveConnection = tiktokConnectorModule.TikTokLiveConnection || tiktokConnectorModule.WebcastPushConnection || tiktokConnectorModule.default || tiktokConnectorModule;
const WebcastEvent = tiktokConnectorModule.WebcastEvent || {
  LIKE: 'like',
  ROOM_USER: 'roomUser',
  CHAT: 'chat',
  STREAM_END: 'streamEnd'
};

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
let activeConnection = null;
let reconnectTimer = null;

function startTikTokConnector(username) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const cleanUsername = username.replace(/^@/, '').trim();
  console.log(`\n[TikTok] 🔍 Memeriksa siaran langsung untuk @${cleanUsername}...`);

  try {
    if (activeConnection) {
      try { activeConnection.disconnect(); } catch (e) {}
      activeConnection = null;
    }

    const tiktokLive = new TikTokLiveConnection(cleanUsername, {
      processInitialData: true,
      enableExtendedGiftInfo: true
    });
    activeConnection = tiktokLive;

    // Cek apakah akun sedang live terlebih dahulu agar tidak error saat streamer belum klik go live
    tiktokLive.fetchIsLive()
      .then(isLive => {
        if (!isLive) {
          console.log(`[TikTok] ℹ️  Akun @${cleanUsername} saat ini SEDANG TIDAK LIVE (Offline).`);
          console.log(`[TikTok] ⏳ Bridge tetap siaga dan akan otomatis terhubung begitu Anda klik "Mulai Siaran Langsung" di TikTok Live Studio!`);
          console.log(`[TikTok] 🔄 Memeriksa ulang dalam 10 detik...\n`);
          reconnectTimer = setTimeout(() => startTikTokConnector(cleanUsername), 10000);
          return;
        }

        console.log(`[TikTok] 🟢 Siaran LANGSUNG AKTIF terdeteksi! Menghubungkan ke room...`);
        return tiktokLive.connect()
          .then(state => {
            console.log(`[TikTok] 🔥 TERHUBUNG KE LIVE STREAM @${cleanUsername}! (Room ID: ${state.roomId})`);
            console.log(`[TikTok] ✨ Siap menerima tap-tap like dari penonton secara real-time.\n`);
          });
      })
      .catch(err => {
        console.error(`[TikTok] ⚠️  Gagal memeriksa/terhubung ke @${cleanUsername}:`, err.message || err);
        console.log(`[TikTok] 🔄 Mencoba kembali dalam 10 detik...`);
        reconnectTimer = setTimeout(() => startTikTokConnector(cleanUsername), 10000);
      });

    // Event: Penonton memberi like / tap-tap layar
    tiktokLive.on(WebcastEvent.LIKE || 'like', (data) => {
      const likeCount = data.likeCount || data.count || 1;
      const totalLikeCount = data.totalLikeCount || data.total;
      const user = (data.user && (data.user.uniqueId || data.user.nickname)) || data.uniqueId || 'penonton';

      console.log(`[Like] ❤️ +${likeCount} like dari @${user}${totalLikeCount ? ' | Total Like: ' + totalLikeCount : ''}`);
      broadcast({
        type: 'like',
        likeCount: likeCount,
        totalLikeCount: totalLikeCount,
        user: user
      });
    });

    // Event: Update statistik penonton & like
    tiktokLive.on(WebcastEvent.ROOM_USER || 'roomUser', (data) => {
      if (data.viewerCount) {
        broadcast({
          type: 'stats',
          viewerCount: data.viewerCount
        });
      }
    });

    // Event: Siaran langsung berakhir
    tiktokLive.on(WebcastEvent.STREAM_END || 'streamEnd', () => {
      console.log(`[TikTok] 🛑 Siaran langsung telah berakhir.`);
      console.log(`[TikTok] ⏳ Bridge siaga menunggu siaran berikutnya...`);
      reconnectTimer = setTimeout(() => startTikTokConnector(cleanUsername), 15000);
    });

    tiktokLive.on('disconnected', () => {
      console.log(`[TikTok] ⚠️ Terputus dari TikTok Live. Mencoba menghubungkan kembali...`);
      reconnectTimer = setTimeout(() => startTikTokConnector(cleanUsername), 10000);
    });

    tiktokLive.on('error', (err) => {
      console.error(`[TikTok] ⚠️ Peringatan koneksi:`, err.message || err);
    });

  } catch (err) {
    console.error(`[TikTok] ❌ Inisialisasi koneksi gagal:`, err.message || err);
    reconnectTimer = setTimeout(() => startTikTokConnector(cleanUsername), 10000);
  }
}

// 4. Jalankan Server
server.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(`         ⚡ TIKTOK LIVE REAL-TIME SYNC BRIDGE (AKTIF) ⚡         `);
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

    rl.question('Masukkan Username TikTok Anda (contoh: @greendmalik): ', (answer) => {
      rl.close();
      const targetUser = answer.trim() || 'greendmalik';
      startTikTokConnector(targetUser);
    });
  }
});
