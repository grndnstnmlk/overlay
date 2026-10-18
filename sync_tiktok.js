/**
 * TikTok Live Stream Dual-Account Sync Bridge
 * MLBB Overlay Real-Time Sync (Otomatis: @greendmalik & @frhndytfrhn)
 * 
 * Fitur:
 * - Memantau 2 akun sekaligus secara otomatis tanpa perlu input manual
 * - Menggabungkan akumulasi tap-tap like dari kedua livestream ke 1 overlay
 * - Auto-reconnect dan standby otomatis jika salah satu atau kedua akun belum live
 * - Menyajikan overlay secara lokal pada http://localhost:8080/
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

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
const DEFAULT_ACCOUNTS = ['greendmalik', 'frhndytfrhn'];

// 1. Web Server Statis untuk menyajikan file overlay tanpa lag
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
  console.log(`[Overlay] ✅ Browser overlay tersambung! (Total: ${connectedClients.size} layar aktif)`);

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

// 3. Manajemen Koneksi Multi-Akun TikTok
const accountStates = {};

function initAccount(username) {
  const cleanUsername = username.replace(/^@/, '').trim();
  accountStates[cleanUsername] = {
    username: cleanUsername,
    conn: null,
    isLive: false,
    likeTotal: 0,
    reconnectTimer: null
  };
}

function getCombinedTotalLikes() {
  let sum = 0;
  for (const user in accountStates) {
    sum += (accountStates[user].likeTotal || 0);
  }
  return sum;
}

function monitorAccount(cleanUsername) {
  const state = accountStates[cleanUsername];
  if (!state) return;

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  try {
    if (state.conn) {
      try { state.conn.disconnect(); } catch (e) {}
      state.conn = null;
    }

    const tiktokLive = new TikTokLiveConnection(cleanUsername, {
      processInitialData: true,
      enableExtendedGiftInfo: true
    });
    state.conn = tiktokLive;

    // Cek apakah akun sedang live sebelum connect
    tiktokLive.fetchIsLive()
      .then(isLive => {
        if (!isLive) {
          state.isLive = false;
          console.log(`[TikTok: @${cleanUsername}] ℹ️  Sedang Offline (Belum Live). Standby cek ulang tiap 12s...`);
          state.reconnectTimer = setTimeout(() => monitorAccount(cleanUsername), 12000);
          return;
        }

        console.log(`[TikTok: @${cleanUsername}] 🟢 SIARAN LIVE AKTIF TERDETEKSI! Menghubungkan...`);
        return tiktokLive.connect()
          .then(connState => {
            state.isLive = true;
            console.log(`[TikTok: @${cleanUsername}] 🔥 TERHUBUNG KE LIVE STREAM! (Room ID: ${connState.roomId})`);
            console.log(`[TikTok: @${cleanUsername}] ✨ Siap menyinkronkan like penonton ke overlay.\n`);
          });
      })
      .catch(err => {
        state.isLive = false;
        console.log(`[TikTok: @${cleanUsername}] ⚠️  Pengecekan live: ${err.message || err}. Cek ulang dalam 12s...`);
        state.reconnectTimer = setTimeout(() => monitorAccount(cleanUsername), 12000);
      });

    // Event: Penonton memberi like / tap-tap layar
    tiktokLive.on(WebcastEvent.LIKE || 'like', (data) => {
      const incCount = data.likeCount || data.count || 1;
      if (data.totalLikeCount || data.total) {
        state.likeTotal = data.totalLikeCount || data.total;
      } else {
        state.likeTotal = (state.likeTotal || 0) + incCount;
      }

      const combinedTotal = getCombinedTotalLikes();
      const viewerName = (data.user && (data.user.uniqueId || data.user.nickname)) || data.uniqueId || 'penonton';

      console.log(`[Like: @${cleanUsername}] ❤️ +${incCount} like dari @${viewerName} | Akun: ${state.likeTotal} | Gabungan: ${combinedTotal}`);
      broadcast({
        type: 'like',
        likeCount: incCount,
        totalLikeCount: combinedTotal,
        user: viewerName,
        streamHost: cleanUsername
      });
    });

    // Event: Update statistik room
    tiktokLive.on(WebcastEvent.ROOM_USER || 'roomUser', (data) => {
      if (data.viewerCount) {
        broadcast({
          type: 'stats',
          viewerCount: data.viewerCount,
          streamHost: cleanUsername
        });
      }
    });

    // Event: Live berakhir
    tiktokLive.on(WebcastEvent.STREAM_END || 'streamEnd', () => {
      state.isLive = false;
      console.log(`[TikTok: @${cleanUsername}] 🛑 Siaran langsung telah berakhir. Standby siaran berikutnya...`);
      state.reconnectTimer = setTimeout(() => monitorAccount(cleanUsername), 15000);
    });

    tiktokLive.on('disconnected', () => {
      state.isLive = false;
      console.log(`[TikTok: @${cleanUsername}] ⚠️ Koneksi terputus. Menghubungkan ulang dalam 10s...`);
      state.reconnectTimer = setTimeout(() => monitorAccount(cleanUsername), 10000);
    });

    tiktokLive.on('error', (err) => {
      console.error(`[TikTok: @${cleanUsername}] ⚠️ Peringatan:`, err.message || err);
    });

  } catch (err) {
    console.error(`[TikTok: @${cleanUsername}] ❌ Inisialisasi error:`, err.message || err);
    state.reconnectTimer = setTimeout(() => monitorAccount(cleanUsername), 12000);
  }
}

// 4. Jalankan Server & Auto-Start Akun
server.listen(PORT, () => {
  const accountsToSync = process.argv.slice(2).length > 0
    ? process.argv.slice(2).map(u => u.replace(/^@/, '').trim())
    : DEFAULT_ACCOUNTS;

  console.log(`================================================================`);
  console.log(`    ⚡ TIKTOK DUAL LIVE REAL-TIME SYNC BRIDGE (OTOMATIS) ⚡     `);
  console.log(`================================================================`);
  console.log(`Akun Terpantau         : ${accountsToSync.map(a => '@' + a).join(' & ')}`);
  console.log(`Status Operasional     : Otomatis memantau kedua livestream`);
  console.log(`Local Web Server       : http://localhost:${PORT}/`);
  console.log(`Link Overlay Vertikal  : http://localhost:${PORT}/index.html`);
  console.log(`Link Overlay Horizontal: http://localhost:${PORT}/overlay.html`);
  console.log(`================================================================\n`);

  accountsToSync.forEach(username => {
    initAccount(username);
    monitorAccount(username);
  });
});
