'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {chromium}=require('playwright');
const {Store}=require('../core.cjs');const {createServer}=require('../server.cjs');const {Scheduler}=require('../scheduler.cjs');

test('admin panel: add/edit/archive, all-candidate mode, schedule, evidence and notification controls work through the real UI',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jp-panel-'));const store=new Store(dir);
  const calls=[];const agent={running:false,status:()=>({message:'Lokal sinov — agent tayyor',running:false}),start:o=>{calls.push(o);return {running:false};},stop:async()=>{}};
  const notifier={configured:()=>true,flush:async()=>{calls.push('notify');},nextTry:123};const scheduler=new Scheduler(store,agent);
  const port=19574,server=createServer({store,agent,notifier,scheduler,port});await new Promise(r=>server.listen(port,'127.0.0.1',r));
  const browser=await chromium.launch({channel:process.platform==='win32'?'chrome':undefined,headless:true,chromiumSandbox:true});
  t.after(async()=>{scheduler.close();await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}`);await page.getByText('Lokal ulanish bor',{exact:true}).waitFor();
  const form=page.locator('#candidate');for(const [name,value] of Object.entries({family:'TESTOV',given:'TEST',passport:'TT7654321',phone:'+998901234567',email:'panel@example.invalid'}))await form.locator(`[name="${name}"]`).fill(value);
  await form.getByRole('button',{name:'Ro‘yxatga qo‘shish',exact:true}).click();await page.locator('#rows').getByText('panel@example.invalid',{exact:true}).waitFor();
  assert.equal(store.list().length,1);await page.getByRole('button',{name:'Tahrirlash',exact:true}).click();await page.getByRole('heading',{name:'Nomzodni tahrirlash'}).waitFor();await form.locator('[name="given"]').fill('TESTER');
  await form.getByRole('button',{name:'Ro‘yxatga qo‘shish',exact:true}).click();await page.locator('#rows tr').filter({hasText:'TESTOV TESTER'}).waitFor();assert.equal(store.list()[0].given,'TESTER');
  await page.locator('#daily [name="end"]').fill('20:30');await page.getByRole('button',{name:'Jadvalni saqlash'}).click();
  await page.waitForResponse(r=>r.url().endsWith('/api/state'));assert.equal(store.setting('schedule',{}).end,'20:30');
  await page.getByRole('button',{name:'Agentni boshlash',exact:true}).click();await page.waitForResponse(r=>r.url().endsWith('/api/state'));assert.equal(calls[0].parallel,'all');assert.equal(calls[0].mode,'review');
  await page.getByRole('button',{name:'Telegram xabarlarini qayta yuborish'}).click();await page.waitForResponse(r=>r.url().endsWith('/api/state'));assert.ok(calls.includes('notify'));
  const id=store.list()[0].id;const shot=path.join(dir,'panel-shot.png');await page.screenshot({path:shot});store.saveEvidence(id,'filled',{file:'panel-shot.png',capturedAt:new Date().toISOString(),url:'local-test'});
  await page.reload();await page.getByText('Jarayon skrinshotlari').waitFor();const evidence=store.evidence(id)[0];const image=await page.request.get(`http://127.0.0.1:${port}/evidence/${evidence.id}`);assert.equal(image.status(),200);assert.match(image.headers()['content-type'],/image\/png/);
  if(process.env.AGENT_TEST_ARTIFACT_DIR){fs.mkdirSync(process.env.AGENT_TEST_ARTIFACT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.AGENT_TEST_ARTIFACT_DIR,'admin-panel.png'),fullPage:true});}
  await page.getByRole('button',{name:'Navbatdan olish',exact:true}).click();await page.waitForResponse(r=>r.url().endsWith('/api/state'));assert.equal(store.get(id).state,'archived');assert.equal(errors.length,0,errors.join('\n'));
});

test('admin API: edits and evidence paths cannot bypass CSRF or expose raw passport in state',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jp-admin-api-')),store=new Store(dir),port=19575;
  const id=store.add({family:'TESTOV',given:'TEST',passport:'TT7654321',phone:'+998901234567',email:'panel@example.invalid'});
  const agent={running:false,status:()=>({running:false})},server=createServer({store,agent,notifier:{configured:()=>true},port});await new Promise(r=>server.listen(port,'127.0.0.1',r));
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`,state=await(await fetch(base+'/api/state')).json();assert.equal(state.candidates[0].passport,undefined);
  for(const route of ['/api/edit','/api/archive','/api/candidate','/api/schedule']){const r=await fetch(base+route,{method:'POST',headers:{Origin:'https://outside.invalid','X-CSRF-Token':state.csrf},body:JSON.stringify({id})});assert.equal(r.status,403);}
  store.saveEvidence(id,'filled',{file:'../outside.png',capturedAt:new Date().toISOString(),url:'local'});const e=store.evidence(id)[0];assert.equal((await fetch(base+`/evidence/${e.id}`)).status,404);
});
