'use strict';
let state=null;let refreshing=false;let scheduleDirty=false;
const $=s=>document.querySelector(s);
const labels={queued:'Navbatda',working:'To‘ldirilmoqda',submitting:'Yuborilmoqda',booked:'BRON BOR',waitlisted:'Kutish ro‘yxati',uncertain:'Natija noaniq',review:'Tekshirish tayyor',paused:'Qo‘lda tekshirish',failed:'Xato'};
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function error(message){$('#error').textContent=message;$('#error').hidden=!message;}
async function post(url,body){const res=await apiFetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify(body)});const result=await res.json();if(!res.ok)throw Error(result.error||'So‘rov bajarilmadi');return result;}
async function action(fn){try{error('');await fn();await refresh();}catch(e){error(e.message);}}
function render(){
  if(!scheduleDirty&&state.schedule){for(const [k,v] of Object.entries(state.schedule)){const f=$('#daily').elements.namedItem(k);if(f)f.value=String(v);}}
  $('#totals').replaceChildren(...[['queued','Navbatda'],['working','Jarayonda'],['booked','Bron bor'],['uncertain','Tekshirish kerak']].map(([key,title])=>node('div',`${title}: ${state.candidates.filter(c=>c.state===key).length}`,'badge')));
  $('#connection').textContent='Lokal ulanish bor';$('#status').textContent=state.agent.message;
  $('#telegram').textContent=state.telegram?`Telegram sozlangan · yuborilmagan xabarlar: ${state.pendingNotifications}`:'Telegram sozlanmagan';
  $('#start').disabled=state.agent.running||!state.candidates.some(c=>c.state==='queued');$('#stop').disabled=!state.agent.running;
  $('#count').textContent=state.candidates.length;
  const rows=$('#rows');rows.replaceChildren();
  for(const c of state.candidates){
    const tr=node('tr');const name=node('td',`${c.family} ${c.given}`);name.append(node('small',c.email));tr.append(name,node('td',c.passportMasked));
    const status=node('td',labels[c.state]||c.state,`state-${c.state}`);status.append(node('small',c.note));tr.append(status,node('td',c.slot?`${c.slot.date} ${c.slot.time}`:'—'));
    const result=node('td');
    if(c.evidence?.length){const details=node('details');details.append(node('summary','Jarayon skrinshotlari'));for(const ev of c.evidence){const a=node('a',`${({filled:'Ma’lumotlar kiritildi',review:'Reserve oldidan',booked:'Bron tasdiqlandi',uncertain:'Noaniq natija',error:'Xato',waitlisted:'Kutish ro‘yxati'})[ev.stage]||ev.stage} · ${new Date(ev.captured_at).toLocaleTimeString('uz-UZ',{timeZone:'Asia/Tashkent'})}`);a.href=`/evidence/${ev.id}`;a.target='_blank';a.rel='noopener';details.append(a,node('br'));}result.append(details);}
    if(!state.agent.running&&['queued','review','paused','archived'].includes(c.state)){const edit=node('button','Tahrirlash','secondary');edit.addEventListener('click',()=>action(async()=>{const data=await post('/api/candidate',{id:c.id});for(const [k,v] of Object.entries(data)){const field=$('#candidate').elements.namedItem(k);if(field)field.value=v;}$('#candidate').dataset.id=c.id;$('#candidate-title').textContent='Nomzodni tahrirlash';$('#cancel-edit').hidden=false;$('#candidate').scrollIntoView({behavior:'smooth'});}));result.append(edit);if(c.state!=='archived'){const remove=node('button','Navbatdan olish','secondary');remove.addEventListener('click',()=>action(()=>post('/api/archive',{id:c.id})));result.append(remove);}}
    if(['review','uncertain','booked','waitlisted','paused'].includes(c.state)){
      const a=node('a','Sahifa skrinshoti');a.href=`/result/${c.id}`;a.target='_blank';a.rel='noopener';result.append(a);
    }
    if(!state.agent.running&&['review','uncertain','paused','failed'].includes(c.state)){
      const select=node('select');for(const [value,label] of [['','Natijani belgilash…'],['booked','Bron bor — emaildan tekshirdim'],['waitlisted','Kutish ro‘yxatida'],['queued','Bron yo‘q — qayta navbat']]){const o=node('option',label);o.value=value;select.append(o);}
      select.addEventListener('change',()=>{if(select.value)action(()=>post('/api/resolve',{id:c.id,outcome:select.value}));});result.append(node('br'),select);
    }
    tr.append(result);rows.append(tr);
  }
  if(!state.candidates.length){const tr=node('tr');const td=node('td','Nomzodlar hali qo‘shilmagan. Yuqoridagi formadan boshlang.');td.colSpan=5;tr.append(td);rows.append(tr);}
  $('#events').replaceChildren(...state.events.map(e=>{const d=node('div',undefined,'event');d.append(node('time',new Date(e.at).toLocaleTimeString('uz-UZ',{timeZone:'Asia/Tashkent'})),node('span',e.message));return d;}));
}
async function refresh(){if(refreshing)return;refreshing=true;try{const r=await apiFetch('/api/state');if(!r.ok)throw Error('Ulanish xatosi');state=await r.json();render();}catch{$('#connection').textContent='Backend ulanmagan';}finally{refreshing=false;}}
function cancelEdit(){$('#candidate').reset();delete $('#candidate').dataset.id;$('#candidate-title').textContent='Nomzod qo‘shish';$('#cancel-edit').hidden=true;}
$('#cancel-edit').addEventListener('click',cancelEdit);
$('#candidate').addEventListener('submit',e=>{e.preventDefault();action(async()=>{const id=e.target.dataset.id;await post(id?'/api/edit':'/api/candidates',{...Object.fromEntries(new FormData(e.target)),...(id?{id}:{})});cancelEdit();});});
$('#daily').addEventListener('input',()=>{scheduleDirty=true;});
$('#daily').addEventListener('submit',e=>{e.preventDefault();action(async()=>{const s=Object.fromEntries(new FormData(e.target));s.enabled=s.enabled==='true';s.parallel=s.parallel==='all'?'all':Number(s.parallel);await post('/api/schedule',s);scheduleDirty=false;});});
$('#retry-notifications').addEventListener('click',()=>action(()=>post('/api/notifications/retry',{})));
$('#start').addEventListener('click',()=>action(()=>post('/api/start',{mode:$('#mode').value,parallel:$('#parallel').value==='all'?'all':Number($('#parallel').value),startAt:$('#schedule').value==='19'?state.nextRelease:null})));
$('#stop').addEventListener('click',()=>action(()=>post('/api/stop',{})));
refresh();setInterval(refresh,3000);
