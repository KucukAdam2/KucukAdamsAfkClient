const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const mineflayer = require('mineflayer');

let win;
const sessions = new Map(); // hesap adı -> oturum

// Beklenmeyen bir ağ/protokol hatası uygulamayı çökertmesin
process.on('uncaughtException', err => console.error('Beklenmeyen hata:', err));
process.on('unhandledRejection', err => console.error('Beklenmeyen hata:', err));

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
  // Yasak / beyaz liste gibi durumlarda boşuna tekrar deneme
  if (/banned|yasaklan|not whitelisted|white-?list|beyaz liste/i.test(reason)) {
    s.wantRun = false;
    sessions.delete(name);
    sendStatus(name, 'Durduruldu', 'Yasaklı/beyaz listede değil, otomatik yeniden bağlanma kapatıldı');
    return;
  }
  s.retry += 1;
  let delay = Math.min(5000 * 2 ** (s.retry - 1), 60000); // 5, 10, 20, 40, 60, 60...
  if (/throttl|too fast|too quickly|çok hızlı/i.test(reason)) delay = Math.max(delay, 30000);
  sendStatus(name, 'Yeniden bağlanacak', `${Math.round(delay / 1000)} sn sonra — ${reason}`);
  clearTimeout(s.retryTimer);
  s.retryTimer = setTimeout(() => { if (s.wantRun && !s.bot) startBot(s); }, delay);
}

function startBot(s) {
  const { name, host, port, version, password, authMode } = s.params;
  let bot;
  try {
    bot = mineflayer.createBot({
      host, port, username: name,
      auth: 'offline', version: version === 'auto' ? false : version,
      hideErrors: true, checkTimeoutInterval: 60000
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
    sendStatus(name, 'AFK / Oyunda');
    // Sohbet dinlenmez. Yalnızca şifre girildiyse girişte tek bir /login (veya /register) gönderilir.
    if (password && authMode !== 'none') {
      setTimeout(() => {
        if (s.bot !== bot) return;
        try { bot.chat(authMode === 'register' ? `/register ${password} ${password}` : `/login ${password}`); } catch {}
      }, 3000);
    }
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
  clearTimeout(s.retryTimer);
  sessions.delete(name);
  if (s.bot) { try { s.bot.quit(msg); } catch {} }
  sendStatus(name, 'Durduruldu');
}

function createWindow() {
  win = new BrowserWindow({
    width: 980, height: 760, minWidth: 760, minHeight: 600,
    backgroundColor: '#090d0b',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });
  win.loadFile('index.html');
}
app.whenReady().then(createWindow);

ipcMain.handle('connect-bot', async (_event, data) => {
  const { name, port, version, password, authMode } = data;
  let host = String(data.host || '').trim().replace(/^\w+:\/\//, '').replace(/\/.*$/, '');
  let portNum = Number(port) || 25565;
  const m = host.match(/^(.+):(\d{1,5})$/); // "ip:port" yazıldıysa ayır
  if (m) { host = m[1]; if (!port || Number(port) === 25565) portNum = Number(m[2]); }
  if (!name || !host) return { ok: false, error: 'Hesap adı ve sunucu adresi gerekli.' };
  if (sessions.has(name)) return { ok: false, error: 'Bu hesap zaten çalışıyor.' };
  const s = {
    params: { name, host, port: portNum, version, password, authMode },
    bot: null, wantRun: true, retry: 0, spawned: false, lastReason: '', loginTimer: null, retryTimer: null
  };
  sessions.set(name, s);
  startBot(s);
  return { ok: true };
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
