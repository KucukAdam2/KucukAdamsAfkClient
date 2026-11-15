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
document.getElementById('all').onclick=async()=>{
  for(const row of accountsEl.children) {
    const name=row.querySelector('input').value.trim();
    if(name) row.querySelector('.start').click();
  }
};
document.getElementById('stopAll').onclick=()=>window.client.disconnectAll();
document.getElementById('clear').onclick=()=>logs.replaceChildren();