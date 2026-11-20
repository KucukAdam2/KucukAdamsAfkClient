const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const mineflayer = require('mineflayer');

// Bağlanamazsa (oyuna giremeden hata/zaman aşımı/atılma) yeniden deneme bekleme süresi
const FAIL_RETRY_MS = 5 * 60 * 1000; // 5 dakika

let win;
const sessions = new Map(); // hesap adı -> oturum

// Beklenmeyen bir ağ/protokol hatası uygulamayı çökertmesin
process.on('uncaughtException', err => console.error('Beklenmeyen hata:', err));
process.on('unhandledRejection', err => console.error('Beklenmeyen hata:', err));

function pushChat(name, text) {
  if (win && !win.isDestroyed()) win.webContents.send('bot-chat', { name, text: String(text).slice(0, 500) });
}
function sendStatus(name, status, detail = '') {
  if (win && !win.isDestroyed()) win.webContents.send('bot-status', { name, status, detail });
}

// Sunucunun gönderdiği atılma sebebini (JSON/NBT olabilir) düz yazıya çevir
function textOf(c) {
  if (c == null) return '';
  if (typeof c === 'string') {
    try { const j = JSON.parse(c); if (j && typeof j === 'object') return textOf(j); } catch {}
    return c;
  }
  if (Array.isArray(c)) return c.map(textOf).join('');
  if (typeof c === 'object') {
    let t = '';
    if (c.text != null) t += textOf(c.text);
    if (c.translate) t += c.translate;
    if (c.value !== undefined) t += textOf(c.value);
    if (c.extra) t += textOf(c.extra);
    return t || JSON.stringify(c);
  }
  return String(c);
}
function cleanReason(r) { return textOf(r).replace(/§./g, '').replace(/\s+/g, ' ').trim().slice(0, 140); }

function errText(err) {
  const code = err && err.code;
  const map = {
    ECONNREFUSED: 'Sunucu bağlantıyı reddetti (adres/port yanlış ya da sunucu kapalı)',
    ENOTFOUND: 'Sunucu adresi bulunamadı (IP/alan adını kontrol et)',
    ETIMEDOUT: 'Bağlantı zaman aşımına uğradı',
    ECONNRESET: 'Bağlantı sunucu tarafından kesildi',
    EHOSTUNREACH: 'Sunucuya ulaşılamıyor'
  };
  return map[code] || String((err && err.message) || err).slice(0, 140);
}

function scheduleReconnect(s) {
  if (!s.wantRun) return;
  const name = s.params.name;
  const reason = s.lastReason || 'bağlantı kesildi';
  if (!s.params.autoReconnect) {
    s.wantRun = false;
    sessions.delete(name);
    sendStatus(name, 'Bağlantı kesildi', reason);
    return;
  }
  // Yasak / beyaz liste gibi durumlarda boşuna tekrar deneme
  if (/banned|yasaklan|not whitelisted|white-?list|beyaz liste/i.test(reason)) {
    s.wantRun = false;
    sessions.delete(name);
    sendStatus(name, 'Durduruldu', 'Yasaklı/beyaz listede değil, otomatik yeniden bağlanma kapatıldı');
    return;
  }
  s.retry += 1;
  // Oyuna girdikten sonra kopmuşsa hızlı dene; hiç bağlanamıyorsa 5 dk bekle
  let delay = s.spawned ? Math.min(5000 * 2 ** (s.retry - 1), 60000) : FAIL_RETRY_MS;
  const wait = delay >= 60000 ? `${Math.round(delay / 60000)} dk` : `${Math.round(delay / 1000)} sn`;
  sendStatus(name, 'Yeniden bağlanacak', `${wait} sonra — ${reason}`);
  clearTimeout(s.retryTimer);
  s.retryTimer = setTimeout(() => { if (s.wantRun && !s.bot) startBot(s); }, delay);
}

function startBot(s) {
  s.spawned = false;
  const { name, host, port, version, password, authMode } = s.params;
  let bot;
  try {
    bot = mineflayer.createBot({
      host, port, username: name,
      auth: 'offline', version: version === 'auto' ? false : version,
      hideErrors: false
    });
  } catch (err) {
    s.lastReason = errText(err);
    sendStatus(name, 'Hata', s.lastReason);
    scheduleReconnect(s);
    return;
  }
  s.bot = bot;
  s.spawned = false;
  let ended = false;
  sendStatus(name, s.retry ? `Yeniden bağlanıyor (${s.retry}. deneme)` : 'Bağlanıyor');

  clearTimeout(s.hintTimer);
  s.hintTimer = setTimeout(() => {
    if (!s.spawned && s.bot === bot) sendStatus(name, 'Bağlanıyor', 'sunucudan yanıt bekleniyor...');
  }, 12000);

  // 30 sn içinde oyuna girilemezse bağlantıyı iptal edip yeniden dene
  clearTimeout(s.loginTimer);
  s.loginTimer = setTimeout(() => {
    if (!s.spawned && s.bot === bot) {
      s.lastReason = 'Giriş zaman aşımı (30 sn)';
      sendStatus(name, 'Hata', s.lastReason);
      try { bot.end('timeout'); } catch {}
      setTimeout(() => handleEnd(), 2000);
    }
  }, 30000);

  function handleEnd() {
    if (ended) return;
    ended = true;
    clearTimeout(s.loginTimer);
    clearTimeout(s.hintTimer);
    if (s.bot !== bot) return;
    s.bot = null;
    if (s.wantRun) {
      if (!s.lastReason) sendStatus(name, 'Bağlantı kesildi');
      scheduleReconnect(s);
    }
  }

  bot.once('login', () => sendStatus(name, 'Giriş yapıldı'));
  bot.once('spawn', () => {
    s.spawned = true; s.retry = 0; s.lastReason = '';
    clearTimeout(s.loginTimer);
    clearTimeout(s.hintTimer);
    sendStatus(name, 'AFK / Oyunda');
    // Şifre girildiyse girişte tek bir /login (veya /register) gönderilir.
    if (password && authMode !== 'none') {
      setTimeout(() => {
        if (s.bot !== bot) return;
        try { bot.chat(authMode === 'register' ? `/register ${password} ${password}` : `/login ${password}`); } catch {}
      }, 3000);
    }
  });
  // Sunucudan gelen sohbet/sistem mesajlarını konsola ilet
  bot.on('messagestr', (message, position) => {
    if (position === 'game_info') return;
    const text = String(message).replace(/§./g, '').trim();
    if (text) pushChat(name, text);
  });
  bot.on('kicked', reason => {
    s.lastReason = cleanReason(reason) || 'sebep belirtilmedi';
    sendStatus(name, 'Atıldı', s.lastReason);
  });
  bot.on('error', err => {
    s.lastReason = errText(err);
    sendStatus(name, 'Hata', s.lastReason);
    // 'end' olayı gelmezse takılı kalmasın
    setTimeout(() => {
      if (!ended && s.bot === bot && !s.spawned) { try { bot.end(); } catch {} handleEnd(); }
    }, 3000);
  });
  bot.once('end', handleEnd);
}

function stopSession(name, msg) {
  const s = sessions.get(name);
  if (!s) return;
  s.wantRun = false;
  clearTimeout(s.loginTimer);
  clearTimeout(s.hintTimer);
  clearTimeout(s.retryTimer);
  sessions.delete(name);
  if (s.bot) { try { s.bot.quit(msg); } catch {} }
  sendStatus(name, 'Durduruldu');
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320, height: 800, minWidth: 1100, minHeight: 680,
    backgroundColor: '#090d0b',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile('index.html');
}
app.whenReady().then(createWindow);

ipcMain.handle('connect-bot', async (_event, data) => {
  const { name, port, version, password, authMode, autoReconnect } = data;
  let host = String(data.host || '').trim().replace(/^\w+:\/\//, '').replace(/\/.*$/, '');
  let portNum = Number(port) || 25565;
  const m = host.match(/^(.+):(\d{1,5})$/); // "ip:port" yazıldıysa ayır
  if (m) { host = m[1]; if (!port || Number(port) === 25565) portNum = Number(m[2]); }
  if (!name || !host) return { ok: false, error: 'Hesap adı ve sunucu adresi gerekli.' };
  if (sessions.has(name)) return { ok: false, error: 'Bu hesap zaten çalışıyor.' };
  const s = {
    params: { name, host, port: portNum, version, password, authMode, autoReconnect: autoReconnect !== false },
    bot: null, wantRun: true, retry: 0, spawned: false, lastReason: '', loginTimer: null, retryTimer: null
  };
  sessions.set(name, s);
  startBot(s);
  return { ok: true };
});
ipcMain.handle('send-chat', async (_event, data) => {
  const name = data && data.name;
  const text = String((data && data.text) || '').slice(0, 250);
  if (!text.trim()) return { ok: false, error: 'Mesaj boş.' };
  const targets = name === '*' ? [...sessions.values()] : [sessions.get(name)];
  let sent = 0;
  for (const s of targets) {
    if (!s || !s.bot || !s.spawned) continue;
    try { s.bot.chat(text); sent++; } catch {}
    if (targets.length > 1) await new Promise(r => setTimeout(r, 1200)); // spam engeline takılmasın
  }
  return sent ? { ok: true, sent } : { ok: false, error: 'Oyunda olan hesap yok (önce hesabı başlat ve oyuna girmesini bekle).' };
});
ipcMain.handle('disconnect-bot', async (_event, name) => {
  if (sessions.has(name)) stopSession(name, 'Kullanıcı tarafından durduruldu');
  else sendStatus(name, 'Durduruldu');
  return { ok: true };
});
ipcMain.handle('disconnect-all', async () => {
  for (const name of [...sessions.keys()]) stopSession(name, 'Tüm hesaplar durduruldu');
  return { ok: true };
});
app.on('window-all-closed', () => {
  for (const name of [...sessions.keys()]) stopSession(name);
  if (process.platform !== 'darwin') app.quit();
});
