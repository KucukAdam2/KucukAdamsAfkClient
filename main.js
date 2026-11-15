const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const mineflayer = require('mineflayer');

let win;
const bots = new Map();
let config = { host: '', port: 25565, version: '1.21.4' };

function sendStatus(name, status, detail = '') {
  if (win && !win.isDestroyed()) win.webContents.send('bot-status', { name, status, detail });
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
  const { name, host, port, version, password, authMode } = data;
  if (!name || !host) return { ok: false, error: 'Hesap adı ve sunucu adresi gerekli.' };
  if (bots.has(name)) return { ok: false, error: 'Bu hesap zaten çalışıyor.' };
  config = { host, port: Number(port) || 25565, version };
  try {
    const bot = mineflayer.createBot({
      host, port: config.port, username: name,
      auth: 'offline', version: version === 'auto' ? false : version,
      hideErrors: false
    });
    bots.set(name, bot);
    sendStatus(name, 'Bağlanıyor');
    bot.once('login', () => sendStatus(name, 'Giriş yapıldı'));
    bot.once('spawn', () => {
      sendStatus(name, 'AFK / Oyunda');
      if (password && authMode !== 'none') {
        setTimeout(() => {
          try { bot.chat(authMode === 'register' ? `/register ${password} ${password}` : `/login ${password}`); } catch {}
        }, 3000);
      }
    });
    // Sohbet dinlenmez. Yalnızca şifre girildiyse girişte tek bir /login (veya /register) gönderilir.
    bot.on('kicked', () => sendStatus(name, 'Atıldı'));
    bot.on('end', () => { bots.delete(name); sendStatus(name, 'Bağlantı kesildi'); });
    bot.on('error', err => sendStatus(name, 'Hata', String(err.message || err).slice(0, 140)));
    return { ok: true };
  } catch (err) {
    bots.delete(name);
    return { ok: false, error: String(err.message || err) };
  }
});
ipcMain.handle('disconnect-bot', async (_event, name) => {
  const bot = bots.get(name);
  if (bot) { bots.delete(name); bot.quit('Kullanıcı tarafından durduruldu'); }
  sendStatus(name, 'Durduruldu');
  return { ok: true };
});
ipcMain.handle('disconnect-all', async () => {
  for (const [name, bot] of bots) {
    bots.delete(name);
    try { bot.quit('Tüm hesaplar durduruldu'); } catch {}
    sendStatus(name, 'Durduruldu');
  }
  return { ok: true };
});
app.on('window-all-closed', () => {
  for (const bot of bots.values()) { try { bot.quit(); } catch {} }
  if (process.platform !== 'darwin') app.quit();
});