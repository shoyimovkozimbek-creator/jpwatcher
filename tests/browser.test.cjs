'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const http=require('node:http');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {Store,FIELDS}=require('../core.cjs');const {Agent}=require('../booking.cjs');
const sample={family:'TESTOV',given:'TEST',phone:'+998901234567',email:'test@example.invalid',passport:'AA1234567'};
const {chromium}=require('playwright');
async function fixture(t,mode){
  let submissions=0,openAttempts=0;let received='';
  const server=http.createServer(async(req,res)=>{
    const send=(html,status=200)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end(`<html><body>${html}</body></html>`);};
    if(req.url==='/reservations/option'){
      openAttempts++;
      if(mode==='transient'&&openAttempts===1)return send('<h1>Internal Server Error</h1>',503);
      res.writeHead(302,{Location:'/reservations/form'});res.end();return;
    }
    if(req.url==='/reservations/form')return send(`<form action="/reservations/user/guest" method="post">${[6,16,17].map(n=>`<input style="display:none" type="checkbox" id="c${n}" name="reservations[addition_values][19][]" value="${n}"><label for="c${n}">${n}</label>`).join('')}<button>Next</button></form>`);
    if(req.url==='/reservations/user/guest')return send(`<form action="/reservations/confirm" method="post">${Object.values(FIELDS).map(id=>`<input id="${id}" name="${id}" required>`).join('')}<input id="user-guest-users-addition-values-26-0"><input id="user-guest-users-addition-values-27-0"><button>Next</button></form>`);
    if(req.url==='/reservations/confirm'){
      for await(const chunk of req)received+=chunk;
      return send(`<h2>Reservation Details</h2><p>VISA Application for short stay (Applicant) ${Object.values(sample).join(' ')} 2026/09/23 10:00</p><form method="post" action="/reservations/complete"><button>Reserve/Ro'yxatdan o'tish</button></form>`);
    }
    if(req.url==='/reservations/complete'){
      submissions++;
      if(mode==='post-error')return send('<h2>Internal Server Error</h2>',500);
      return send('<h2>予約完了</h2><p>Reservation completed.</p>');
    }
    return send('Not found',404);
  });
  let browser,store,dir;
  t.after(async()=>{if(browser)await browser.close();await new Promise(r=>server.close(r));if(store)store.close();if(dir)fs.rmSync(dir,{recursive:true,force:true});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  dir=fs.mkdtempSync(path.join(os.tmpdir(),'jp-browser-test-'));store=new Store(dir);
  browser=await chromium.launch({channel:process.platform==='win32'?'chrome':undefined,headless:true,chromiumSandbox:true});
  const agent=new Agent(store,{origin});agent.browser=browser;agent.options={mode:mode==='review'?'review':'live'};agent.gate.interval=1;
  // Keep fixture tests quick; production retains a real 3–5 second wait.
  agent.pause=async()=>{};
  const id=store.add(sample);await agent.book(store.get(id),{url:`${origin}/reservations/option`,date:'2026-09-23',time:'10:00'});
  return {store,id,submissions,openAttempts,received};
}
test('browser: full local flow fills exact values and submits once',{skip:!chromium},async t=>{const f=await fixture(t,'normal');assert.equal(f.store.get(f.id).state,'booked');assert.equal(f.submissions,1);assert.equal(f.openAttempts,1);const data=new URLSearchParams(f.received);assert.equal(data.get(FIELDS.passport),sample.passport);assert.equal(data.get(FIELDS.emailConfirm),sample.email);});
test('browser: pre-submit 503 retries and then succeeds',{skip:!chromium},async t=>{const f=await fixture(t,'transient');assert.equal(f.store.get(f.id).state,'booked');assert.equal(f.openAttempts,2);assert.equal(f.submissions,1);});
test('browser: post-submit 500 becomes uncertain without a second POST',{skip:!chromium},async t=>{const f=await fixture(t,'post-error');assert.equal(f.store.get(f.id).state,'uncertain');assert.equal(f.submissions,1);f.store.recover();assert.equal(f.store.get(f.id).state,'uncertain');});
test('browser: review mode never presses Reserve',{skip:!chromium},async t=>{const f=await fixture(t,'review');assert.equal(f.store.get(f.id).state,'review');assert.equal(f.submissions,0);});
