'use strict';
let apiBase=localStorage.getItem('jp-api-url')||'';
let apiKey=sessionStorage.getItem('jp-admin-key')||'';
const localHost=['127.0.0.1','localhost'].includes(location.hostname);
function apiFetch(route,options={}){
  if(!apiBase&&!localHost)return Promise.reject(Error('Avval Render backendini ulang'));
  return fetch(apiBase+route,{...options,headers:{...options.headers,...(apiKey?{Authorization:`Bearer ${apiKey}`}:{})}});
}
document.addEventListener('DOMContentLoaded',()=>{
  document.querySelector('#api-url').value=apiBase;
  document.querySelector('#api-key').value=apiKey;
  document.querySelector('#backend-connect').addEventListener('submit',async e=>{
    e.preventDefault();const raw=document.querySelector('#api-url').value.trim();
    try{if(raw){const url=new URL(raw);if(url.protocol!=='https:'&&!(localHost&&url.protocol==='http:'))throw Error();if(url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error();apiBase=url.origin;}else apiBase='';}
    catch{document.querySelector('#connection-error').textContent='Backendning https://nom.onrender.com ko‘rinishidagi manzilini kiriting.';return;}
    apiKey=document.querySelector('#api-key').value.trim();localStorage.setItem('jp-api-url',apiBase);sessionStorage.setItem('jp-admin-key',apiKey);
    try{const res=await apiFetch('/api/state');if(!res.ok)throw Error(`Ulanish xatosi (${res.status}). Kalit va FRONTEND_ORIGIN sozlamasini tekshiring.`);document.querySelector('#connection-error').textContent='Ulandi';await refresh();}catch(e){document.querySelector('#connection-error').textContent=e.message;}
  });
  document.querySelector('#backend-disconnect').addEventListener('click',()=>{sessionStorage.removeItem('jp-admin-key');location.reload();});
  document.addEventListener('click',async e=>{
    const link=e.target.closest('a');if(!link)return;const url=new URL(link.href);if(!/^\/(evidence|result)\//.test(url.pathname))return;
    e.preventDefault();const win=window.open('about:blank','_blank');if(win)win.opener=null;
    try{const res=await apiFetch(url.pathname);if(!res.ok)throw Error('Skrinshot ochilmadi');const blob=URL.createObjectURL(await res.blob());if(win)win.location=blob;setTimeout(()=>URL.revokeObjectURL(blob),60000);}catch(e){if(win)win.close();error(e.message);}
  });
});
