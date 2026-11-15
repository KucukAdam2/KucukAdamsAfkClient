const accountsEl = document.getElementById('accounts');
const logs = document.getElementById('logs');
const statuses = new Map();
function log(text) {
  const p = document.createElement('p'); p.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  logs.prepend(p);
}
for (let i=1;i<=10;i++) {
  const row=document.createElement('div'); row.className='account';
  row.innerHTML=`<span class="number">${String(i).padStart(2,'0')}</span><input class="username" maxlength="16" placeholder="Hesap ${i} adı"><input class="password" type="password" placeholder="Giriş şifresi (isteğe bağlı)"><span class="status">Bekliyor</span><button class="start">Başlat</button><button class="stop secondary">Durdur</button>`;
  const input=row.querySelector('input'), status=row.querySelector('.status');
  row.querySelector('.start').addEventListener('click', async()=>{
    const name=input.value.trim(), host=document.getElementById('host').value.trim();
    if(!name || !host) return log('Önce hesap adını ve sunucu IP adresini gir.');
    if(!/^[A-Za-z0-9_]{3,16}$/.test(name)) log(`${name}: uyarı: kullanıcı adı 3-16 karakter olmalı, yalnızca harf, rakam ve _ içermeli.`);
    const result=await window.client.connect({name,host,port:document.getElementById('port').value,version:document.getElementById('version').value,password:row.querySelector('.password').value,authMode:document.getElementById('authMode').value});
    if(!result.ok) log(`${name}: ${result.error}`); else log(`${name}: bağlantı başlatıldı.`);
  });
  row.querySelector('.stop').addEventListener('click', async()=>{
    const name=input.value.trim(); if(name) await window.client.disconnect(name);
  });
  accountsEl.appendChild(row);
}
function rowFor(name) {
  return [...accountsEl.children].find(r=>r.querySelector('input').value.trim()===name);
}
window.client.onStatus(({name,status,detail})=>{
  const row=rowFor(name); if(row) row.querySelector('.status').textContent=status;
  log(`${name}: ${status}${detail ? ' — '+detail : ''}`);
});
let starting=false;
document.getElementById('all').onclick=async()=>{
  if(starting) return;
  starting=true;
  for(const row of accountsEl.children) {
    const name=row.querySelector('input').value.trim();
    if(name) { row.querySelector('.start').click(); await new Promise(r=>setTimeout(r,4000)); } // sunucu hızlı girişi engellemesin
  }
  starting=false;
};
document.getElementById('stopAll').onclick=()=>window.client.disconnectAll();
document.getElementById('clear').onclick=()=>logs.replaceChildren();
// --- Sohbete yazma ---
const chatTarget=document.getElementById('chatTarget'), chatText=document.getElementById('chatText');
function fillTargets(){
  const keep=chatTarget.value||'*';
  chatTarget.replaceChildren(new Option('Tüm hesaplar','*'));
  for(const row of accountsEl.children){
    const n=row.querySelector('input').value.trim();
    if(n) chatTarget.appendChild(new Option(n,n));
  }
  chatTarget.value=[...chatTarget.options].some(o=>o.value===keep)?keep:'*';
}
fillTargets();
chatTarget.addEventListener('mousedown',fillTargets);
chatTarget.addEventListener('focus',fillTargets);
async function sendChat(){
  const text=chatText.value;
  if(!text.trim()) return;
  const r=await window.client.chat({name:chatTarget.value,text});
  if(r.ok){ log(`Sohbete gönderildi (${r.sent} hesap): ${text}`); chatText.value=''; }
  else log(`Mesaj gönderilemedi: ${r.error}`);
}
document.getElementById('chatSend').onclick=sendChat;
chatText.addEventListener('keydown',e=>{ if(e.key==='Enter') sendChat(); });
