'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {ORIGIN,CATEGORY,FIELDS,months,tashkentParts,slotFromHref,classifyResult,verifyReview} = require('./core.cjs');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
class Stop extends Error {}
class Temporary extends Error {}
class Structure extends Error {}
class SoldOut extends Error {}

// Shared gate: one new site operation per interval, never 20 independent retry storms.
class Gate {
  constructor(interval=150){this.interval=interval;this.tail=Promise.resolve();this.until=0;}
  async take(check=()=>{}) {
    const task=this.tail.then(async()=>{check(); while(Date.now()<this.until){check();await sleep(Math.min(200,this.until-Date.now()));}check();this.until=Date.now()+this.interval;});
    this.tail=task.catch(()=>{});return task;
  }
  backoff(ms){this.until=Math.max(this.until,Date.now()+ms);}
}
function retryAfter(value,now=Date.now()){
  if(!value) return 60000;
  if(/^\d+$/.test(value)) return Math.max(1000,Number(value)*1000);
  const parsed=Date.parse(value);return Number.isFinite(parsed)?Math.max(1000,parsed-now):60000;
}

class Agent {
  constructor(store,{launch,origin=ORIGIN,slotParser=slotFromHref,headless=true,browserChannel=process.platform==='win32'?'chrome':undefined,clock=()=>Date.now(),screenshots=true}={}) {
    this.store=store;this.launch=launch;this.origin=origin;this.slotParser=slotParser;
    this.running=false;this.stopping=false;this.browser=null;this.gate=new Gate();this.tasks=new Map();
    this.info={phase:'idle',message:'Tayyor',startedAt:null};this.lastCalendarError=0;this.sessions=new Map();
    this.headless=headless;this.browserChannel=browserChannel;this.clock=clock;this.captureScreenshots=screenshots;this.runId=null;this.endAt=Infinity;this.seenSlots=new Set();this.evidence={};this.slotUse=new Map();this.warmPool=new Map();
  }
  status(){return {...this.info,running:this.running,active:this.tasks.size,sessions:[...this.sessions.values()].sort((a,b)=>a.index-b.index)};}
  session(id,patch={}){
    if(!id)return;
    const current=this.sessions.get(id)||{id,index:this.sessions.size+1,name:'Kuzatuv sessiyasi',phase:'starting',message:'Tayyorlanmoqda',attempts:0,updatedAt:new Date().toISOString()};
    this.sessions.set(id,{...current,...patch,updatedAt:new Date().toISOString()});
  }
  check(){if(this.stopping||this.clock()>=this.endAt)throw new Stop(this.stopping?'To‘xtatildi':'Qidiruv vaqti tugadi');}
  async pause(ms){const end=Date.now()+ms;while(Date.now()<end){this.check();await sleep(Math.min(200,end-Date.now()));}}
  start(options){
    if(this.running)throw new Error('Agent allaqachon ishlayapti');
    if(!options.allowMonitorOnly&&!this.store.list().some(c=>c.state==='queued'))throw new Error('Navbatda nomzod yo‘q');
    const all=options.parallel==='all'||options.parallel===undefined;
    const parallel=all?Math.max(1,this.store.list().filter(c=>c.state==='queued').length):Number(options.parallel);
    if(!Number.isInteger(parallel)||parallel<1||(!all&&parallel>20))throw new Error('Parallel nomzodlar: all yoki 1–20');
    if(!['review','live'].includes(options.mode))throw new Error('Rejimni tanlang');
    const startAt=options.startAt?new Date(options.startAt):new Date();
    if(!Number.isFinite(+startAt))throw new Error('Boshlanish vaqti xato');
    const endAt=options.endAt?+new Date(options.endAt):+startAt+30*60000;
    if(!Number.isFinite(endAt)||endAt<=this.clock()||endAt<=+startAt)throw new Error('Qidiruv yakun vaqti xato');
    this.options={parallel,mode:options.mode,startAt:+startAt,allowMonitorOnly:!!options.allowMonitorOnly};this.endAt=endAt;
    this.runId=options.runId||`manual-${crypto.randomUUID()}`;
    this.stats=this.store.setting(`run:${this.runId}`,{checks:0,errors:0,found:0,months:[],started:new Date().toISOString()});
    this.seenSlots=new Set();this.evidence={};
    this.stopping=false;this.running=true;this.gate=new Gate(50);this.slotUse=new Map();this.warmPool=new Map();this.sessions=new Map();
    this.info={phase:'starting',message:'Brauzer ochilmoqda',startedAt:new Date().toISOString()};
    this.done=this.run().catch(e=>{if(!(e instanceof Stop)){this.info.message='Agent to‘xtadi: brauzer yoki sayt tuzilishini tekshiring';this.store.event(this.info.message);this.store.notify(`launch:${this.runId}`,`⚠️ ${this.info.message}. Joy yo‘q deb xulosa qilinmadi.`);}}).finally(()=>{this.running=false;this.info.phase='idle';});
    return this.status();
  }
  async stop(){this.stopping=true;this.info.message='To‘xtatilmoqda';if(this.done)await this.done;}
  async resource(operation,cleanup=()=>{},timeout=15000){
    let timer,expired=false;
    const work=Promise.resolve().then(operation).then(value=>{if(expired){Promise.resolve(cleanup(value)).catch(()=>{});throw new Stop('Resurs kech ochildi');}return value;});
    const deadline=new Promise((_,reject)=>{const start=Date.now();timer=setInterval(()=>{try{this.check();if(this.browser?.isConnected&&!this.browser.isConnected())throw new Temporary('Brauzer uzildi');if(Date.now()-start>=timeout)throw new Temporary('Brauzer ochilishi muddati tugadi');}catch(e){expired=true;reject(e);}},100);});
    try{return await Promise.race([work,deadline]);}finally{clearInterval(timer);}
  }
  async makePage(context) {
    const page=await this.resource(()=>context.newPage(),p=>p.close());page.setDefaultTimeout(12000);page.setDefaultNavigationTimeout(45000);
    page._health={status:200,retryAfter:null};page._gate=new Gate(250);
    page.on('response',r=>{
      if(r.url().startsWith(this.origin) && (r.request().isNavigationRequest()||r.url().includes('/ajax/reservations/'))){
        page._health={status:r.status(),retryAfter:r.headers()['retry-after']};
        if(r.status()===429)this.gate.backoff(retryAfter(r.headers()['retry-after']));
        if(r.status()===403)this.gate.backoff(60000);
      }
    });
    return page;
  }
  async health(page){
    this.check();
    const {status}=page._health;
    if(status===403)throw new Structure('Sayt kirishni chekladi (403). Qo‘lda tekshiring.');
    if(status===429||status>=500)throw new Temporary('Sayt vaqtincha javob bermayapti');
    const body=await page.locator('body').innerText({timeout:5000});
    if(/captcha|verify you are human|access denied/i.test(body))throw new Structure('Sayt qo‘lda tekshirishni talab qildi');
    if(/administrator.{0,50}(?:contact|bog)|contact.{0,40}administrator|administratoringiz|свяжитесь.{0,50}администратор|管理者.{0,30}(?:連絡|お問い合わせ)|internal (?:server )?error|service unavailable|bad gateway|gateway time.?out|システムエラー/i.test(body))throw new Temporary('Vaqtinchalik sayt xatosi');
    if(/予約.*(?:満員|定員に達)|no longer available|slot.*(?:full|taken)|qabul tugadi.*(?:qayta|tanlang)/i.test(body))throw new SoldOut('Joy band bo‘ldi');
    return body;
  }
  async goto(page,url){
    const u=new URL(url,this.origin);
    if(u.origin!==this.origin||!u.pathname.startsWith('/reservations/'))throw new Structure('Kutilmagan sayt manzili');
    await this.navigation(page,()=>page.goto(u.href,{waitUntil:'load',timeout:45000}));
  }
  async next(page){
    await this.navigation(page,async()=>{await page.getByRole('button',{name:'Next',exact:true}).click();await page.waitForLoadState('load',{timeout:45000});});
  }
  async navigation(page,action){
    let first=true,attempt=0;
    while(true){
      this.check();await this.gate.take(()=>this.check());await page._gate.take(()=>this.check());page._health={status:200};
      try{
        if(first)await action();else await page.reload({waitUntil:'load',timeout:45000});
        await this.health(page);return;
      }catch(e){
        if(!(e instanceof Temporary)&&e.name!=='TimeoutError'&&!/net::/.test(e.message))throw e;
        this.check();if(page.isClosed()||this.browser?.isConnected&&!this.browser.isConnected())throw new Structure('Brauzer yopildi; qayta ishga tushiring');
        attempt++;this.session(page._candidateId,{phase:'retrying',message:`Sayt xatosi — shu sahifa F5 qilinmoqda (${attempt})`,attempts:attempt,url:page.url()});
        if(attempt===1||attempt%10===0)this.store.event(`F5: vaqtinchalik xato, ${attempt}-urinish. Sahifa: ${new URL(page.url()).pathname}`,page._candidateId||null);
        // The preceding navigation finished or timed out before a single reload starts.
        // Reload preserves this session, URL and pre-Reserve POST form values.
        first=false;
      }
    }
  }
  async expected(page,locator){
    try{await locator.waitFor({state:'visible',timeout:30000});}
    catch {await this.health(page);throw new Structure('Kutilgan maydon topilmadi; sayt yoki forma o‘zgargan');}
  }
  async calendar(page,month){
    await this.goto(page,`${this.origin}/reservations/calendar?category=12&date=${month}`);
    await this.expected(page,page.locator('a[href="#event-select"]'));
    if((await page.locator('a[href="#event-select"]').innerText()).trim()!==CATEGORY)throw new Structure('Kalendar Short stay (Applicant) emas');
    await this.expected(page,page.locator('.sc_cal_date').first());
    const days=await page.locator('td').evaluateAll(cells=>cells.filter(td=>td.querySelector('img[src*="icon_circle"]')&&td.querySelector('a')).map(td=>(td.querySelector('.sc_cal_date')?.textContent||'').trim()).filter(d=>/^\d{1,2}$/.test(d)));
    if(this.stats){
      this.stats.checks++;if(!this.stats.months.includes(month))this.stats.months.push(month);
      this.store.saveSetting(`run:${this.runId}`,this.stats);
      const previous=this.evidence[month];
      if(!previous||this.clock()-previous.at>60000){const shot=await this.capture(page,`calendar-${month}`);if(shot)this.evidence[month]={...shot,at:this.clock(),valid:true,month};}
    }
    const slots=[];
    for(const day of days){
      this.check();
      const date=`${month.slice(0,7)}-${day.padStart(2,'0')}`;
      if(date<tashkentParts().date)continue;
      // Day links are selected from the current rendered calendar, never fabricated option URLs.
      const cell=page.locator('td').filter({has:page.locator('.sc_cal_date').filter({hasText:new RegExp(`^${day}$`)})}).filter({has:page.locator('img[src*="icon_circle"]')});
      if(await cell.count()!==1)throw new Structure('Kalendar kuni bir ma’noli topilmadi');
      await this.gate.take(()=>this.check());await page._gate.take(()=>this.check());page._health={status:200};
      try{await Promise.all([page.waitForResponse(r=>r.url().includes('/ajax/reservations/calendar'),{timeout:45000}),cell.locator('a').first().click()]);}
      catch{await this.health(page);throw new Temporary('Kun jadvali yuklanmadi');}
      await this.health(page);
      // AJAX rendering follows the response; wait for day layout, including empty sold-out days.
      try{await page.locator('.sc_cal_date').first().waitFor({state:'hidden',timeout:10000});}catch{throw new Temporary('Kun jadvali yangilanmadi');}
      const links=await page.locator('a[href*="/reservations/option"]').evaluateAll(nodes=>nodes.filter(a=>a.querySelector('img[src*="icon_circle"]')).map(a=>a.href));
      for(const href of links){const slot=this.slotParser(href);if(slot && slot.date===date)slots.push(slot);}
      if(slots.length)return slots;
      // Restore month only if another day remains to inspect.
      if(day!==days[days.length-1])await this.goto(page,`${this.origin}/reservations/calendar?category=12&date=${month}`);
    }
    return slots;
  }
  async checklist(page){
    const groups=page.locator('input[type="checkbox"][name="reservations[addition_values][19][]"]');
    if(await groups.count()!==3)throw new Structure('Uchta tasdiqlash katagi topilmadi');
    for(const box of await groups.all()){
      if(await box.isChecked())continue;
      const id=await box.getAttribute('id');
      if(await box.isVisible())await box.check();
      else await page.locator(`label[for="${id}"]`).click();
      if(!await box.isChecked())throw new Structure('Tasdiqlash katagi belgilanmadi');
    }
    // The COE-specific selector is not assumed to exist on Short stay.
    for(const select of await page.locator('select').all()){
      if(!await select.isVisible()||!await select.isEnabled())continue;
      const options=await select.locator('option').evaluateAll(nodes=>nodes.filter(o=>!o.disabled&&o.value&&/\d\s*[：:]\s*\d/.test(o.textContent.normalize('NFKC'))).map(o=>o.value));
      if(!options.length)throw new Structure('Noma’lum tanlov maydoni; qo‘lda tekshiring');
      await select.selectOption(options[Math.floor(Math.random()*options.length)]);
    }
    await this.next(page);
  }
  async fill(page,candidate,slot){
    await this.expected(page,page.locator(`#${FIELDS.family}`));
    for(const [key,id] of Object.entries(FIELDS)){
      const value=key==='emailConfirm'?candidate.email:candidate[key];
      const field=page.locator(`#${id}`);await field.fill(value);
      if(await field.inputValue()!==value)throw new Structure('Maydonga qiymat to‘liq yozilmadi');
    }
    for(const field of await page.locator('input[id^="user-guest-users-addition-values-26-"], input[id^="user-guest-users-addition-values-27-"]').all())await field.fill('');
    await this.candidateEvidence(page,candidate,'filled',slot,'📝 MA’LUMOTLAR KIRITILDI');
    await this.next(page);
  }
  async candidateEvidence(page,candidate,stage,slot,title){
    if(!this.captureScreenshots)return null;
    const shot=await this.capture(page,candidate.id);
    this.store.saveEvidence(candidate.id,stage,shot);
    const key=`evidence:${this.runId||'manual'}:${candidate.id}:${stage}`;
    this.store.notify(key,`${title}\n${candidate.family} ${candidate.given}${slot?'\n'+slot.date+' '+slot.time:''}\n${stage==='filled'||stage==='review'?'Hali bron emas. Reserve bosilmagan.':''}${shot?'':'\n⚠️ Skrinshotni saqlab bo‘lmadi.'}`,shot);
    return shot;
  }
  async capture(page,id){
    if(!this.captureScreenshots)return null;
    try {
      const dir=path.join(this.store.dir,'evidence');fs.mkdirSync(dir,{recursive:true});
      const name=`${crypto.randomUUID()}.png`,file=path.join(dir,name);
      await page.screenshot({path:file,fullPage:true,timeout:8000});
      if(/^[a-f0-9-]{36}$/.test(id))fs.copyFileSync(file,path.join(this.store.dir,`${id}.png`));
      return {file:`evidence/${name}`,capturedAt:new Date().toISOString(),url:page.url()};
    }catch{return null;}
  }
  saveResult(candidate,state,note,slot,shot){
    this.store.saveEvidence(candidate.id,state,shot);
    const title=state==='booked'?'✅ BRON BOR':state==='waitlisted'?'⏳ KUTISH RO‘YXATI':'⚠️ NATIJANI TEKSHIRING';
    const message=`${title}\n${candidate.family} ${candidate.given}\n${slot.date} ${slot.time}\n${note}\nGmailni tekshiring.${this.captureScreenshots&&!shot?'\nSkrinshotni saqlab bo‘lmadi.':''}`;
    this.store.finish(candidate.id,state,note,slot,{key:`result:${this.runId||'test'}:${candidate.id}:${state}`,message,media:shot});
  }
  async submit(page,candidate,slot){
    const reserve=page.getByRole('button',{name:/^Reserve\//});
    await this.expected(page,reserve);
    try{verifyReview(await page.locator('body').innerText(),candidate,slot);}catch(e){throw new Structure(e.message);}
    await this.candidateEvidence(page,candidate,'review',slot,'🔎 BRON OLDIDAN TEKSHIRUV');
    if(this.options.mode==='review'){
      this.store.transition(candidate.id,'review','Tekshiruv tayyor. Reserve bosilmadi.',slot);return;
    }
    await this.gate.take(()=>this.check());
    // Persist before touching the button. Restart, timeout and notification failure cannot resubmit.
    this.store.transition(candidate.id,'submitting','Bron yuborilmoqda',slot);
    let state='uncertain',shot=null,note='Reserve bosilganda javob noaniq. Emailni tekshiring.';
    try{
      await reserve.click({timeout:45000});
      await page.waitForLoadState('domcontentloaded',{timeout:45000});
      try{await reserve.waitFor({state:'hidden',timeout:15000});}catch{}
      const text=await page.locator('body').innerText({timeout:8000});
      const heading=(await page.locator('h1,h2,h3,.alert-success,.message.success').allTextContents()).join(' ');
      state=classifyResult({url:page.url(),text,heading,hasReserve:await reserve.isVisible()});
      note=state==='booked'?'Shu insonga joy olindi. Sayt muvaffaqiyatni tasdiqladi.':state==='waitlisted'?'Kutish ro‘yxatiga olindi; bu tasdiqlangan bron emas.':'Yuborish natijasi noaniq; takror yuborilmaydi.';
    }catch{/* Final POST is never retried, even if capture or network fails. */}
    shot=await this.capture(page,candidate.id);
    this.saveResult(candidate,state,note,slot,shot);
  }
  async book(candidate,slot){
    let context,page;
    try{
      this.check();
      if(!this.store.claim(candidate.id,slot))return;
      this.session(candidate.id,{phase:'opening',message:`${slot.date} ${slot.time} — bron sahifasi ochilmoqda`});
      const warm=this.warmPool.get(candidate.id);this.warmPool.delete(candidate.id);
      if(warm){({context,page}=warm);}else{context=await this.resource(()=>this.browser.newContext({locale:'en-US'}),c=>c.close());page=await this.makePage(context);}
      page._candidateId=candidate.id;
      while(true){
        this.check();
        try{
          // Replay only pre-submit steps via GET. Never reload a final POST.
          await this.goto(page,slot.url);
          if(!page.url().includes('/reservations/form'))throw new SoldOut('Forma ochilmadi; boshqa bo‘sh joy qidiriladi');
          await this.expected(page,page.getByRole('button',{name:'Next',exact:true}));
          this.session(candidate.id,{phase:'form',message:'Roziliklar va vaqt tanlanmoqda',url:page.url()});
          await this.checklist(page);await this.fill(page,candidate,slot);await this.submit(page,candidate,slot);return;
        }catch(e){
          if(e instanceof Temporary){this.store.transition(candidate.id,'working','Vaqtinchalik xato; 3–5 soniyadan so‘ng qayta urinadi',slot);await this.pause(3000+Math.random()*2000);continue;}
          throw e;
        }
      }
    }catch(e){
      if(this.store.get(candidate.id).state==='working'){
        const state=e instanceof Stop?'queued':e instanceof SoldOut?'queued':'paused';
        const note=e instanceof Structure?e.message:e instanceof SoldOut?e.message:e instanceof Stop?'To‘xtatildi; keyin davom ettiriladi':'Kutilmagan forma holati; skrinshotni tekshiring';
        const shot=page?await this.capture(page,candidate.id):null;this.store.saveEvidence(candidate.id,'error',shot);this.store.transition(candidate.id,state,note,slot);
        if(state==='paused')this.store.notify(`paused:${candidate.id}:${Date.now()}`,`⚠️ QO‘LDA TEKSHIRISH\n${candidate.family} ${candidate.given}\n${note}`,shot);
      }
    }finally{
      const final=this.store.get(candidate.id);this.session(candidate.id,{phase:final.state,message:final.note||final.state});
      if(context)await context.close().catch(()=>{});
    }
  }
  async watchCandidate(candidate,index){
    let context,page,handedOff=false,monthIndex=0;
    this.session(candidate.id,{index,name:`${candidate.family} ${candidate.given}`,phase:'starting',message:'Alohida brauzer sessiyasi ochilmoqda'});
    try{
      context=await this.resource(()=>this.browser.newContext({locale:'en-US'}),c=>c.close());page=await this.makePage(context);page._candidateId=candidate.id;
      this.session(candidate.id,{phase:'warming',message:'Kalendar oldindan ochilmoqda'});
      while(this.clock()<this.options.startAt){
        try{await this.goto(page,`${this.origin}/reservations/calendar?category=12&date=${months()[0]}`);this.session(candidate.id,{phase:'ready',message:'Kalendar ochiq — boshlanish vaqtini kutmoqda',url:page.url()});break;}
        catch(e){if(e instanceof Stop)throw e;if(e instanceof Structure)throw e;await this.pause(400+Math.random()*500);}
      }
      while(this.clock()<this.options.startAt)await this.pause(Math.min(250,this.options.startAt-this.clock()));
      while(true){
        this.check();
        if(this.store.get(candidate.id).state!=='queued')return;
        const month=months()[monthIndex++%2];
        this.session(candidate.id,{phase:'watching',message:`${month.slice(0,7)} kalendari tekshirilmoqda`,url:page.url()});
        try{
          const slots=await this.calendar(page,month);
          this.session(candidate.id,{phase:'watching',message:slots.length?`${slots.length} ta ochiq vaqt topildi`:'Ochiq joy yo‘q — kuzatuv davom etmoqda',url:page.url(),lastCheck:new Date().toISOString()});
          for(const slot of slots){
            if(this.seenSlots.has(slot.url))continue;this.seenSlots.add(slot.url);this.stats.found++;
            const shot=await this.capture(page,'available');this.store.notify(`opened:${this.runId}:${slot.date}:${slot.time}`,`🟢 SHORT STAY JOY OCHILDI\n${slot.date} ${slot.time}\nAlohida sessiyalar bron qilishni boshladi.`,shot);
          }
          this.store.saveSetting(`run:${this.runId}`,this.stats);
          if(slots.length){
            const slot=slots[Math.floor(Math.random()*slots.length)];
            this.warmPool.set(candidate.id,{context,page});handedOff=true;
            await this.book(candidate,slot);
            if(this.store.get(candidate.id).state==='queued'){context=null;page=null;return this.watchCandidate(candidate,index);}
            return;
          }
          await this.pause(350+Math.random()*450);
        }catch(e){
          if(e instanceof Stop)throw e;
          this.stats.errors++;this.store.saveSetting(`run:${this.runId}`,this.stats);
          this.session(candidate.id,{phase:'retrying',message:'Sayt javob bermadi — shu sessiyada F5 davom etmoqda',url:page.url()});
          if(e instanceof Structure){this.store.event(e.message,candidate.id);this.store.notify(`structure:${this.runId}:${candidate.id}`,`⚠️ ${candidate.family} ${candidate.given}: ${e.message}`);return;}
          await this.pause(500+Math.random()*700);
        }
      }
    }finally{if(!handedOff&&context)await context.close().catch(()=>{});}
  }
  async watchOnly(){
    let context,page,monthIndex=0;const id='monitor';this.session(id,{index:1,name:'Kuzatuv',phase:'starting',message:'Kalendar sessiyasi ochilmoqda'});
    try{
      context=await this.resource(()=>this.browser.newContext({locale:'en-US'}),c=>c.close());page=await this.makePage(context);page._candidateId=id;
      while(this.clock()<this.options.startAt){try{await this.goto(page,`${this.origin}/reservations/calendar?category=12`);break;}catch(e){if(e instanceof Stop)throw e;await this.pause(500);}}
      while(this.clock()<this.options.startAt)await this.pause(Math.min(250,this.options.startAt-this.clock()));
      while(true){this.check();const slots=await this.calendar(page,months()[monthIndex++%2]);this.session(id,{phase:'watching',message:slots.length?`${slots.length} ta joy topildi`:'Ochiq joy yo‘q',lastCheck:new Date().toISOString(),url:page.url()});if(slots.length){const shot=await this.capture(page,'available');for(const slot of slots){if(this.seenSlots.has(slot.url))continue;this.seenSlots.add(slot.url);this.stats.found++;this.store.notify(`opened:${this.runId}:${slot.date}:${slot.time}`,`🟢 SHORT STAY JOY OCHILDI\n${slot.date} ${slot.time}\nNavbatda nomzod yo‘q.`,shot);}}await this.pause(500+Math.random()*500);}
    }finally{if(context)await context.close().catch(()=>{});}
  }
  async run(){
    let reason='completed';
    try{
      const chromium=this.launch?null:require('playwright').chromium;
      this.browser=await this.resource(()=>this.launch?this.launch():chromium.launch({channel:this.browserChannel,headless:this.headless,chromiumSandbox:true,timeout:15000}),b=>b.close());
      const queued=this.store.list().filter(c=>c.state==='queued').slice(0,this.options.parallel);
      this.info.phase='warming';this.info.message=`${queued.length||1} ta alohida sessiya kalendarga kirmoqda`;
      this.store.notify(`prepared:${this.runId}`,`🟢 Agent tayyorlanmoqda. ${queued.length||1} ta alohida Short stay sessiyasi. Qidiruv ${new Date(this.options.startAt).toLocaleTimeString('uz-UZ',{timeZone:'Asia/Tashkent'})} da boshlanadi.`);
      const work=queued.length?queued.map((candidate,index)=>this.watchCandidate(candidate,index+1)):this.options.allowMonitorOnly?[this.watchOnly()]:[];
      work.forEach((task,index)=>this.tasks.set(queued[index]?.id||'monitor',task));
      this.info.phase='watching';this.info.message='Har nomzod o‘z sessiyasida kalendarni kuzatmoqda';
      await Promise.allSettled(work);this.tasks.clear();
      this.info.message='Navbatdagi ishlar tugadi; natijalarni tekshiring';
    }catch(e){reason=e instanceof Stop?(this.clock()>=this.endAt?'deadline':'stopped'):'error';if(!(e instanceof Stop))throw e;}
    finally{
      this.stopping=true;
      await Promise.allSettled([...this.tasks.values()]);
      await this.report(reason);
      if(this.browser)await this.browser.close().catch(()=>{});
      this.browser=null;this.warmPool.clear();
    }
  }
  async report(reason){
    const s=this.stats||{checks:0,errors:0,found:0,months:[]};
    const now=new Date().toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'});
    const full=s.months.length>=2&&s.errors===0;
    let message=s.found?`📋 QIDIRUV YAKUNI\nJoy ochilishi qayd etildi: ${s.found}. Har bir nomzodning natijasi alohida yuborildi.`:full?'📭 JOY TOPILMADI\nTekshiruvlarda Short stay uchun bo‘sh joy ko‘rinmadi. Bu butun vaqt davomida joy ochilmaganini kafolatlamaydi.':'⚠️ JOY HOLATINI TO‘LIQ TEKSHIRIB BO‘LMADI\nSayt xatosi yoki yetarli tekshiruv bo‘lmagani sabab joy yo‘q deb xulosa qilinmadi.';
    message+=`\n${now} (Toshkent)\nTekshiruv: ${s.checks}; xato: ${s.errors}.\n${reason==='stopped'?'Foydalanuvchi to‘xtatdi.':reason==='deadline'?'Qidiruv vaqti tugadi.':reason==='error'?'Texnik tekshiruv kerak.':'Qidiruv tugadi.'}`;
    const shots=Object.values(this.evidence).filter(Boolean);
    if(!shots.length)this.store.notify(`report:${this.runId}`,message+(this.captureScreenshots?'\nSayt skrinshotini olish imkoni bo‘lmadi.':''));
    for(let i=0;i<shots.length;i++)this.store.notify(`report:${this.runId}:${i}`,message+`\nIlova: ${shots[i].month||'xato sahifasi'}.`,shots[i]);
  }
}
module.exports={Agent,Gate,Temporary,Structure,Stop,retryAfter};
