const $ = id => document.getElementById(id);
const accountsEl = $('accounts'), out = $('out');
const KEY = 'kucukadams-afk-settings-v1';
const COLORS = ['#6ee7a0', '#7cc4ff', '#ffd479', '#ff9ecb', '#c4a1ff', '#ff9f7a', '#7ee8e0', '#d6e66a', '#f0a0ff', '#9fb4ff'];
const MAX_LINES = 800;
const lines = [];

// ---- Kayıtlı ayarlar (IP, port, sürüm, isimler) ----
let saved = {};
try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch {}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      host: $('host').value, port: $('port').value, version: $('version').value,
      authMode: $('authMode').value, autoRe: $('autoRe').checked,
      names: [...accountsEl.children].map(r => r.querySelector('.username').value)
    }));
  } catch {}
}

// ---- Konsol ----
function rowFor(name) {
  const rows = [...accountsEl.children];
  return rows.find(r => r.dataset.active === name) || rows.find(r => r.querySelector('.username').value.trim() === name);
}
function colorFor(name) {
  const row = name ? rowFor(name) : null;
  return row ? COLORS[[...accountsEl.children].indexOf(row) % COLORS.length] : '#6c8c77';
}
function makeLine(l) {
  const d = document.createElement('div'); d.className = 'line ' + l.kind;
  const t = document.createElement('span'); t.className = 'time'; t.textContent = l.time; d.appendChild(t);
  if (l.name) { const g = document.createElement('span'); g.className = 'tag'; g.style.color = l.color; g.textContent = `[${l.name}]`; d.appendChild(g); }
  const m = document.createElement('span'); m.className = 'msg'; m.textContent = l.text; d.appendChild(m);
  return d;
}
function visible(l) { const v = $('view').value; return v === '*' || !l.name || l.name === v; }
function addLine(kind, name, text) {
  const l = { kind, name, text, time: new Date().toLocaleTimeString('tr-TR'), color: colorFor(name) };
  lines.push(l); if (lines.length > MAX_LINES) lines.shift();
  if (!visible(l)) return;
  const atBottom = out.scrollTop + out.clientHeight >= out.scrollHeight - 40;
  out.appendChild(makeLine(l));
  while (out.childElementCount > MAX_LINES) out.removeChild(out.firstChild);
  if (atBottom) out.scrollTop = out.scrollHeight;
}
function renderAll() { out.replaceChildren(...lines.filter(visible).map(makeLine)); out.scrollTop = out.scrollHeight; }
const sys = (text, kind = 'sys') => addLine(kind, '', text);

// ---- Hesap satırları ----
function stateOf(status) {
  if (/Oyunda/.test(status)) return 'run';
  if (/Hata|Atıldı|Yeniden bağlanacak/.test(status)) return 'err';
  if (/Bağlanıyor|Giriş yapıldı|Yeniden bağlanıyor/.test(status)) return 'wait';
  return 'off';
}
function setStatus(row, status, detail) {
  const el = row.querySelector('.status');
  el.textContent = status + (detail ? ' — ' + detail : '');
  el.title = el.textContent;
  row.dataset.state = stateOf(status);
}

async function startRow(row) {
  const name = row.querySelector('.username').value.trim(), host = $('host').value.trim();
  if (!name || !host) return sys('Önce hesap adını ve sunucu IP adresini gir.', 'err');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) sys(`${name}: uyarı: kullanıcı adı 3-16 karakter olmalı, yalnızca harf, rakam ve _ içermeli.`, 'err');
  row.dataset.active = name;
  const r = await window.client.connect({
    name, host, port: $('port').value, version: $('version').value,
    password: row.querySelector('.password').value, authMode: $('authMode').value, autoReconnect: $('autoRe').checked
  });
  if (!r.ok) {
    sys(`${name}: ${r.error}`, 'err');
    if (!/^Bu hesap/.test(r.error)) delete row.dataset.active;
  } else sys(`${name}: bağlantı başlatıldı.`);
}

for (let i = 1; i <= 10; i++) {
  const row = document.createElement('div'); row.className = 'account'; row.dataset.state = 'off';
  row.innerHTML = `<span class="num">${String(i).padStart(2, '0')}</span><input class="username" maxlength="16" placeholder="Hesap ${i} adı" spellcheck="false" autocomplete="off"><input class="password" type="password" placeholder="Giriş şifresi" autocomplete="off"><button class="start" title="Başlat">▶</button><button class="stop" title="Durdur">■</button><span class="status">Bekliyor</span>`;
  const input = row.querySelector('.username');
  input.value = (saved.names && saved.names[i - 1]) || '';
  row.querySelector('.start').addEventListener('click', () => startRow(row));
  row.querySelector('.stop').addEventListener('click', async () => {
    const name = row.dataset.active || input.value.trim();
    if (name) await window.client.disconnect(name);
    delete row.dataset.active;
  });
  // İsim değişince: çalışan hesabı durdur, yeni isimle yeniden başlat
  input.addEventListener('change', async () => {
    const old = row.dataset.active, nw = input.value.trim();
    if (old && old !== nw) {
      await window.client.disconnect(old);
      delete row.dataset.active;
      sys(`${old} → ${nw || '(boş)'}: isim değişti, eski hesap durduruldu.`);
      if (nw && $('host').value.trim()) { sys(`${nw}: yeni isimle yeniden başlatılıyor...`); setTimeout(() => startRow(row), 1500); }
    }
    fillSelects();
  });
  accountsEl.appendChild(row);
}

// ---- Kayıtlı ayarları geri yükle ----
if (saved.host) $('host').value = saved.host;
if (saved.port) $('port').value = saved.port;
if (saved.version && [...$('version').options].some(o => o.value === saved.version)) $('version').value = saved.version;
if (saved.authMode) $('authMode').value = saved.authMode;
if (saved.autoRe === false) $('autoRe').checked = false;
// Her değişiklikte kaydet
['input', 'change'].forEach(ev => document.addEventListener(ev, save));

// ---- Hesap seçiciler ----
function fillSel(sel, first) {
  const keep = sel.value || '*';
  sel.replaceChildren(new Option(first, '*'));
  const seen = new Set();
  for (const row of accountsEl.children) {
    const n = row.querySelector('.username').value.trim();
    if (n && !seen.has(n)) { seen.add(n); sel.appendChild(new Option(n, n)); }
  }
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : '*';
}
function fillSelects() { fillSel($('chatTarget'), 'Tüm hesaplar'); fillSel($('view'), 'Tüm sohbet'); }
fillSelects();
['chatTarget', 'view'].forEach(id => { $(id).addEventListener('mousedown', fillSelects); $(id).addEventListener('focus', fillSelects); });
$('view').addEventListener('change', renderAll);

// ---- Olaylar ----
window.client.onStatus(({ name, status, detail }) => {
  const row = rowFor(name);
  if (row) { setStatus(row, status, detail); if (status === 'Durduruldu') delete row.dataset.active; }
  addLine(/Hata|Atıldı/.test(status) ? 'err' : 'sys', name, status + (detail ? ' — ' + detail : ''));
});
window.client.onChat(({ name, text }) => addLine('chat', name, text));

// ---- Düğmeler ----
let starting = false;
$('all').onclick = async () => {
  if (starting) return;
  starting = true;
  try {
    for (const row of accountsEl.children) {
      const n = row.querySelector('.username').value.trim();
      if (n && !row.dataset.active) { startRow(row); await new Promise(r => setTimeout(r, 4000)); } // sunucu hızlı girişi engellemesin
    }
  } finally { starting = false; }
};
$('stopAll').onclick = async () => {
  await window.client.disconnectAll();
  for (const row of accountsEl.children) delete row.dataset.active;
};
$('clear').onclick = () => { lines.length = 0; out.replaceChildren(); };

// ---- Sohbete yaz ----
async function sendChat() {
  const text = $('chatText').value;
  if (!text.trim()) return;
  const target = $('chatTarget').value;
  const r = await window.client.chat({ name: target, text });
  if (r.ok) { addLine('me', target === '*' ? '' : target, `> ${text}`); $('chatText').value = ''; }
  else sys(`Mesaj gönderilemedi: ${r.error}`, 'err');
}
$('chatSend').onclick = sendChat;
$('chatText').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

sys('Hazır. Sunucu bilgilerini ve hesap adlarını gir; ayarlar otomatik kaydedilir.');
