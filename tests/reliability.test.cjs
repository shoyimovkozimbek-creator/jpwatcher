'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const {Store,FIELDS,CATEGORY,ORIGIN,slotFromHref}=require('../core.cjs');
const {Agent,Stop}=require('../booking.cjs');
const {Notifier}=require('../telegram.cjs');
const {scheduleSettings}=require('../scheduler.cjs');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const candidate=n=>({family:'TESTOV',given:'TEST',phone:'+998901234567',email:`test${n}@example.invalid`,passport:`TT${String(n).padStart(7,'0')}`});

async function site(t,{fail={},delay=0,finalError=false,failStatus=503}={}){
  const sessions=new Map(),requests=[],submissions=[],received=[],active=new Set();let peak=0,overlap=0,sequence=0;
  const server=http.createServer(async(req,res)=>{
    const u=new URL(req.url,'http://localhost');if(u.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
    let sid=/sid=([a-f0-9-]+)/.exec(req.headers.cookie||'')?.[1];
    if(!sid){sid=crypto.randomUUID();res.setHeader('set-cookie',`sid=${sid}; Path=/; HttpOnly`);}
    let session=sessions.get(sid);if(!session){session={attempts:{},inflight:0,candidate:null};sessions.set(sid,session);}
    let body='';for await(const chunk of req)body+=chunk;
    const key=u.pathname,entry={sid,path:key,method:req.method,body,start:Date.now(),end:null};requests.push(entry);
    session.inflight++;overlap=Math.max(overlap,session.inflight);active.add(sid);peak=Math.max(peak,active.size);
    let ended=false;const done=()=>{if(ended)return;ended=true;entry.end=Date.now();session.inflight--;active.delete(sid);};res.once('finish',done);res.once('close',done);
    const send=(html,status=200)=>{res.writeHead(status,{'content-type':'text/html; charset=utf-8'});res.end(`<!doctype html><html><body><div style="font:18px Arial;padding:30px">LOCAL AUTOMATED TEST — NOT AN EMBASSY BOOKING<br>${html}</div></body></html>`);};
    session.attempts[key]=(session.attempts[key]||0)+1;
    if(delay)await wait(delay);
    if(session.attempts[key]<=(fail[key]||0)){if(failStatus===429)res.setHeader('retry-after','1');return send('<h1>Administratoringiz bilan boglaning</h1><p>Internal Server Error</p>',failStatus);}
    if(key==='/reservations/calendar')return send(`<a href="#event-select">${CATEGORY}</a><table><tr><td><a href="#" id="day"><span class="sc_cal_date">23</span><img src="/icon_circle.svg"></a></td></tr></table><script>document.getElementById('day').onclick=async e=>{e.preventDefault();document.querySelector('table').outerHTML=await(await fetch('/ajax/reservations/calendar')).text();};</script>`);
    if(key==='/ajax/reservations/calendar'){res.writeHead(200,{'content-type':'text/html'});res.end(`<table>${['10:00','10:30','11:00'].map(time=>`<tr><td><a href="/reservations/option?event_id=20&event_plan_id=19&date=2026%2F09%2F23&time_from=${encodeURIComponent(time)}"><img src="/icon_circle.svg">${time}</a></td></tr>`).join('')}</table>`);return;}
    if(key==='/icon_circle.svg'){res.writeHead(200,{'content-type':'image/svg+xml'});res.end('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6" fill="green"/></svg>');return;}
    if(key==='/reservations/option'){
      session.time=u.searchParams.get('time_from')||'10:00';res.writeHead(302,{location:'/reservations/form'});res.end();return;
    }
    if(key==='/reservations/form')return send(`<form method="post" action="/reservations/user/guest">${[6,16,17].map(n=>`<input type="checkbox" style="display:none" name="reservations[addition_values][19][]" id="check-${n}"><label for="check-${n}">${n}</label>`).join('')}<button>Next</button></form>`);
    if(key==='/reservations/user/guest')return send(`<h2>Applicant Information</h2><form method="post" action="/reservations/conf">${Object.entries(FIELDS).map(([k,id])=>`<label>${k}<input id="${id}" name="${id}" required></label><br>`).join('')}<button>Next</button></form>`);
    if(key==='/reservations/conf'){
      const data=new URLSearchParams(body);session.candidate=Object.fromEntries(Object.entries(FIELDS).map(([k,id])=>[k,data.get(id)]));received.push({sid,data:session.candidate});
      return send(`<h2>Reservation Details</h2><p>${CATEGORY}</p><p>${Object.values(session.candidate).join(' ')}</p><p>2026/09/23 ${session.time}</p><form method="post" action="/reservations/finish"><button>Reserve/Ro'yxatdan o'tish</button></form>`);
    }
    if(key==='/reservations/finish'){
      submissions.push({sid,...session.candidate,time:session.time});
      if(finalError)return send('<h2>Internal Server Error</h2>',500);
      return send(`<h2>予約完了 Reservation Complete</h2><h3>Reservation Number</h3><p>TEST-${++sequence}</p>`);
    }
    send('Not found',404);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jp-reliability-'));const store=new Store(dir);
  const browser=await chromium.launch({channel:process.platform==='win32'?'chrome':undefined,headless:true,chromiumSandbox:true,timeout:15000});
  const parser=href=>{const local=new URL(href);const s=slotFromHref(ORIGIN+local.pathname+local.search,'2026-09-16');return s?{...s,url:href}:null;};
  const agent=new Agent(store,{origin,launch:async()=>browser,slotParser:parser});agent.browser=browser;agent.options={mode:'live'};agent.gate.interval=1;
  t.after(async()=>{agent.stopping=true;await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {store,browser,agent,dir,requests,submissions,received,sessions,origin,peak:()=>peak,overlap:()=>overlap};
}

test('F5: repeated errors at option, form, applicant POST and review POST recover in the same session',async t=>{
  const f=await site(t,{fail:{'/reservations/option':2,'/reservations/form':2,'/reservations/user/guest':2,'/reservations/conf':2},delay:40});
  const id=f.store.add(candidate(1));await f.agent.book(f.store.get(id),{url:f.origin+'/reservations/option',date:'2026-09-23',time:'10:00'});
  assert.equal(f.store.get(id).state,'booked');assert.equal(f.submissions.length,1);
  for(const key of ['/reservations/option','/reservations/form','/reservations/user/guest','/reservations/conf'])assert.equal(f.requests.filter(r=>r.path===key).length,3,key);
  const posts=f.requests.filter(r=>r.path==='/reservations/conf');assert.equal(new Set(posts.map(r=>r.body)).size,1);assert.ok(posts.every(r=>r.method==='POST'));
  assert.equal(new Set(f.requests.filter(r=>r.path.startsWith('/reservations/')).map(r=>r.sid)).size,1);
  assert.equal(f.overlap(),1,'each session waits for its previous response');
});

test('screenshots: filled values, review and completion create three real PNGs and flush to owner as documents',async t=>{
  const f=await site(t);const id=f.store.add(candidate(2));await f.agent.book(f.store.get(id),{url:f.origin+'/reservations/option',date:'2026-09-23',time:'10:00'});
  assert.deepEqual(f.store.evidence(id).map(e=>e.stage),['booked','review','filled']);
  const files=f.store.evidence(id).map(e=>f.store.evidenceFile(e.id));assert.equal(new Set(files.map(e=>e.file)).size,3);
  for(const shot of files){const png=fs.readFileSync(path.join(f.dir,shot.file));assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.ok(png.length>1000);}
  if(process.env.AGENT_TEST_ARTIFACT_DIR){const out=process.env.AGENT_TEST_ARTIFACT_DIR;fs.mkdirSync(out,{recursive:true});for(const shot of files)fs.copyFileSync(path.join(f.dir,shot.file),path.join(out,`local-test-${shot.stage}.png`));}
  const sent=[];const notifier=new Notifier(f.store,{telegram_bot_token:'fake',owner_chat_id:'100'},async(url,opts)=>{sent.push({url,form:opts.body});return {ok:true,json:async()=>({ok:true,result:{}})};});
  await notifier.flush();assert.equal(sent.length,3);assert.ok(sent.every(s=>s.url.endsWith('/sendDocument')&&s.form.get('chat_id')==='100'));
  assert.ok(sent[0].form.get('caption').includes('Hali bron emas'));assert.ok(sent[2].form.get('caption').includes('BRON BOR'));assert.equal(f.store.pending().length,0);
});

test('Reserve: server error after final POST stays uncertain and is never refreshed or submitted twice',async t=>{
  const f=await site(t,{finalError:true});const id=f.store.add(candidate(3));await f.agent.book(f.store.get(id),{url:f.origin+'/reservations/option',date:'2026-09-23',time:'10:00'});
  assert.equal(f.store.get(id).state,'uncertain');assert.equal(f.submissions.length,1);assert.equal(f.requests.filter(r=>r.path==='/reservations/finish').length,1);
  await f.agent.book(f.store.get(id),{url:f.origin+'/reservations/option',date:'2026-09-23',time:'10:00'});assert.equal(f.submissions.length,1);
});

test('parallel: the real calendar and worker loop books 20 candidates using 20 isolated sessions and all three times',{timeout:90000},async t=>{
  const f=await site(t,{delay:250});for(let n=10;n<30;n++)f.store.add(candidate(n));
  const start=Date.now();f.agent.start({mode:'live',parallel:'all',endAt:new Date(Date.now()+75000).toISOString()});await f.agent.done;
  assert.equal(f.agent.options.parallel,20);assert.equal(f.submissions.length,20);assert.equal(new Set(f.submissions.map(s=>s.sid)).size,20);assert.equal(new Set(f.submissions.map(s=>s.passport)).size,20);
  assert.equal(new Set(f.submissions.map(s=>s.time)).size,3);assert.ok(f.peak()>1);assert.ok(f.store.list().every(c=>c.state==='booked'));
  assert.ok(f.store.list().every(c=>f.store.evidence(c.id).length===3));
  console.log(`LOCAL 20-CANDIDATE RESULT: ${Date.now()-start} ms, ${f.submissions.length} unique submissions, peak simultaneous requests ${f.peak()}`);
});

test('session count follows queued candidates: one candidate opens one session',async t=>{
  const f=await site(t);f.store.add(candidate(35));f.agent.start({mode:'live',parallel:'all',endAt:new Date(Date.now()+30000).toISOString()});await f.agent.done;
  assert.equal(f.agent.options.parallel,1);assert.equal(f.agent.status().sessions.length,1);assert.equal(f.submissions.length,1);
});

test('claim: competing workers cannot begin the same candidate twice',async t=>{
  const f=await site(t);const id=f.store.add(candidate(40)),c=f.store.get(id),slot={url:f.origin+'/reservations/option',date:'2026-09-23',time:'10:00'};
  await Promise.all([f.agent.book(c,slot),f.agent.book(c,slot)]);assert.equal(f.submissions.length,1);
});

test('calendar F5: repeated 503 errors recover and real AJAX day links are parsed',async t=>{
  const f=await site(t,{fail:{'/reservations/calendar':2}});const context=await f.browser.newContext(),page=await f.agent.makePage(context);
  const slots=await f.agent.calendar(page,'2026-09-01');assert.equal(slots.length,3);assert.equal(f.requests.filter(r=>r.path==='/reservations/calendar').length,3);assert.equal(f.submissions.length,0);
});

test('429: F5 waits for server Retry-After before requesting again',async t=>{
  const f=await site(t,{fail:{'/reservations/option':1},failStatus:429});const id=f.store.add(candidate(42));
  await f.agent.book(f.store.get(id),{url:f.origin+'/reservations/option',date:'2026-09-23',time:'10:00'});
  const reqs=f.requests.filter(r=>r.path==='/reservations/option');assert.equal(reqs.length,2);assert.ok(reqs[1].start-reqs[0].end>=950);assert.equal(f.store.get(id).state,'booked');
});

test('stop: F5 recovery ends without a reservation and releases the candidate',async t=>{
  const f=await site(t,{fail:{'/reservations/option':1000},delay:50});const id=f.store.add(candidate(41));
  const timer=setTimeout(()=>{f.agent.stopping=true;},350);await f.agent.book(f.store.get(id),{url:f.origin+'/reservations/option',date:'2026-09-23',time:'10:00'});clearTimeout(timer);
  assert.equal(f.store.get(id).state,'queued');assert.equal(f.submissions.length,0);
});

test('resource startup: a hung page acquisition is bounded',async()=>{
  const a=new Agent({});await assert.rejects(a.resource(()=>new Promise(()=>{}),()=>{},20),/muddati tugadi/);
});

test('default schedule watches 19:00–20:00 and uses every candidate',()=>{
  const s=scheduleSettings({setting:(key,fallback)=>fallback});assert.deepEqual(s,{enabled:true,prepare:'18:55',release:'19:00',end:'20:00',parallel:'all'});
});
