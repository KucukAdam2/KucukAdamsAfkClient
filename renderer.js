const $ = id => document.getElementById(id);
const accountsEl = $('accounts'), out = $('out');
const KEY = 'kucukadams-afk-settings-v1';
const MAX_LINES = 800;
const lines = [];

// ---- Logo ----
(() => {
  const map = { a: '#46d3c9', b: '#2fa59d', c: '#8ff0e8' };
  const p = 'acaabaabbbabbbbb';
  $('logo').innerHTML = '<svg viewBox="0 0 4 4" shape-rendering="crispEdges" aria-hidden="true">' +
    [...p].map((k, i) => `<rect x="${i % 4}" y="${(i / 4) | 0}" width="1" height="1" fill="${map[k]}"/>`).join('') + '</svg>';
})();

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

// ---- Hesap kimliği: isimden renk ve piksel avatar üret ----
function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function colorFor(name) { return name ? `hsl(${hash(name) % 360} 75% 70%)` : 'var(--faint)'; }
function avatarSVG(name) {
  if (!name) return '';
  let seed = hash(name) || 1; const h = hash(name) % 360;
  const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  let r = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
    const v = rnd();
    if (v < 0.5) continue;
    const c = v < 0.78 ? `hsl(${h} 70% 62%)` : `hsl(${(h + 40) % 360} 65% 46%)`;
    r += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/><rect x="${7 - x}" y="${y}" width="1" height="1" fill="${c}"/>`;
  }
  return `<svg viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
}
function updateAvatar(row) {
  const name = row.querySelector('.username').value.trim();
  const av = row.querySelector('.avatar');
  av.innerHTML = avatarSVG(name);
  av.classList.toggle('empty', !name);
}

// ---- Konsol ----
function rowFor(name) {
  const rows = [...accountsEl.children];
  return rows.find(r => r.dataset.active === name) || rows.find(r => r.querySelector('.username').value.trim() === name);
}
function makeLine(l) {
  const d = document.createElement('div'); d.className = 'line ' + l.kind;
  const t = document.createElement('span'); t.className = 'time'; t.textContent = l.time; d.appendChild(t);
  if (l.name) { const g = document.createElement('span'); g.className = 'tag'; g.style.color = l.color; g.textContent = l.name; d.appendChild(g); }
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
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) sys(`${name}: kullanıcı adı 3-16 karakter olmalı, yalnızca harf, rakam ve _ içermeli. Sunucu reddedebilir.`, 'err');
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
  row.innerHTML = `<div class="avatar empty"></div><div class="info"><input class="username" maxlength="16" placeholder="Hesap ${i} adı" spellcheck="false" autocomplete="off"><span class="status">Bekliyor</span></div><div class="btns"><button class="pwbtn ghost" type="button" title="Giriş şifresi">Şifre</button><button class="start primary" type="button">Başlat</button><button class="stop" type="button">Durdur</button></div><input class="pw password" type="password" placeholder="Giriş şifresi (isteğe bağlı)" autocomplete="off">`;
  const input = row.querySelector('.username');
  input.value = (saved.names && saved.names[i - 1]) || '';
  updateAvatar(row);
  input.addEventListener('input', () => updateAvatar(row));
  row.querySelector('.pwbtn').addEventListener('click', () => {
    row.classList.toggle('open');
    if (row.classList.contains('open')) row.querySelector('.password').focus();
  });
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
