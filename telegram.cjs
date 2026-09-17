'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
const {scheduleSettings,validateSchedule}=require('./scheduler.cjs');
class TelegramError extends Error{constructor(code,retry=15){super(`Telegram API xatosi (${code})`);this.code=code;this.retry=retry;}}
class TelegramAPI{
  constructor(config,send=fetch){this.config=config;this.send=send;}
  configured(){return Boolean(this.config.telegram_bot_token&&/^\d+$/.test(String(this.config.owner_chat_id||'')));}
  async call(method,body={},signal){
    const response=await this.send(`https://api.telegram.org/bot${this.config.telegram_bot_token}/${method}`,{method:'POST',headers:body instanceof FormData?undefined:{'content-type':'application/json'},body:body instanceof FormData?body:JSON.stringify(body),signal:signal||AbortSignal.timeout(method==='getUpdates'?35000:20000)});
    const data=await response.json();if(!response.ok||!data.ok)throw new TelegramError(data.error_code||response.status,Math.max(5,Number(data.parameters?.retry_after||15)));return data.result;
  }
}
class Notifier{
  constructor(store,config,send=fetch){this.store=store;this.config=config;this.api=new TelegramAPI(config,send);this.busy=false;this.nextTry=0;}
  configured(){return this.api.configured();}
  async flush(){
    if(this.busy||!this.configured()||Date.now()<this.nextTry)return;this.busy=true;
    try{
      for(const item of this.store.pending()){
        const media=item.media?JSON.parse(item.media):null;
        let text=item.message;
        if(media){
          const root=path.resolve(this.store.dir),file=path.resolve(root,media.file);
          if(!file.startsWith(root+path.sep))throw new Error('Ilova manzili noto‘g‘ri');
          if(fs.existsSync(file)){
            const form=new FormData();form.append('chat_id',String(this.config.owner_chat_id));
            const stamp=new Date(media.capturedAt).toLocaleString('uz-UZ',{timeZone:'Asia/Tashkent'});
            form.append('caption',`${text}\nSkrinshot: ${stamp} (Toshkent)`.slice(0,1000));
            form.append('document',new Blob([fs.readFileSync(file)],{type:'image/png'}),`site-${path.basename(file)}`);
            await this.api.call('sendDocument',form);
          }else{await this.api.call('sendMessage',{chat_id:String(this.config.owner_chat_id),text:(text+'\n⚠️ Skrinshot fayli topilmadi.').slice(0,4000)});}
        }else await this.api.call('sendMessage',{chat_id:String(this.config.owner_chat_id),text:text.slice(0,4000),disable_web_page_preview:true});
        this.store.sent(item.id);
      }
    }catch(e){this.nextTry=Date.now()+(e.retry||15)*1000;/* Tokens and raw API errors never reach logs. */}
    finally{this.busy=false;}
  }
}
const HELP=`🇯🇵 Short stay bron agenti\n\n/panel — telefon uchun boshqaruv paneli\n/add — nomzod qo‘shish (bosqichma-bosqich)\n/list — nomzodlar va natijalar\n/status — barcha sessiyalar holati\n/edit KOD — nomzodni tahrirlash\n/remove KOD — navbatdan olish\n/schedule on — har kuni 18:55 tayyorlanish, 19:00–20:00 qidirish\n/schedule off — kunlik ishni o‘chirish\n/end 20:00 — qidiruv yakun vaqti\n/parallel all — barcha nomzodlar alohida sessiyada\n/run — hozir avtomatik bronni boshlash\n/test — Reserve bosmasdan sinash\n/stop — bugungi ishni to‘xtatish\n/booked KOD — emaildan bronni tasdiqladim\n/no_booking KOD — bron yo‘q, qayta navbat\n/waitlisted KOD — kutish ro‘yxatida\n/cancel — kiritishni bekor qilish`;
const fields=[['family','Familiyani lotin alifbosida yuboring (Family name).'],['given','Ismni lotin alifbosida yuboring (First name).'],['passport','To‘liq pasport raqamini yuboring: ikki harf va 7 raqam.'],['phone','Aloqa telefonini yuboring.'],['email','Tasdiq xati keladigan Gmail/email manzilini yuboring.']];
const stateLabels={queued:'Navbatda',working:'To‘ldirilmoqda',submitting:'Yuborilmoqda',booked:'BRON BOR',uncertain:'Emailni tekshiring',review:'Tekshirish tayyor',paused:'Qo‘lda tekshirish',waitlisted:'Kutish ro‘yxati',archived:'Navbatdan olingan'};
class Bot{
  constructor(store,agent,scheduler,config,{api,now=()=>Date.now()}={}){
    this.store=store;this.agent=agent;this.scheduler=scheduler;this.config=config;this.api=api||new TelegramAPI(config);this.now=now;this.closed=false;this.boot=Math.floor(now()/1000);
    this.offsetKey='telegram-offset:'+crypto.createHash('sha256').update(config.telegram_bot_token||'').digest('hex').slice(0,12);
  }
  reply(update,text){this.store.notify(`reply:${update}:${crypto.createHash('sha256').update(text).digest('hex').slice(0,12)}`,text);}
  settings(){return scheduleSettings(this.store,this.config);}
  async handle(update){
    const id=update.update_id;
    if(id<this.store.setting(this.offsetKey,0))return;
    // Commit delivery offset before an action: a restart cannot re-run /run or /no_booking.
    this.store.saveSetting(this.offsetKey,id+1);
    const msg=update.message;
    if(!msg||msg.chat?.type!=='private'||String(msg.chat.id)!==String(this.config.owner_chat_id)||String(msg.from?.id)!==String(this.config.owner_chat_id)||typeof msg.text!=='string')return;
    if(msg.date<this.boot-5)return;
    const text=msg.text.trim();const [verb,...args]=text.split(/\s+/);const cmd=verb.toLowerCase().split('@')[0];
    try{
      if(cmd==='/cancel'){this.store.saveSetting('wizard',null);this.reply(id,'Ma’lumot kiritish bekor qilindi.');return;}
      if(cmd==='/start'||cmd==='/help'){this.reply(id,HELP);return;}
      if(cmd==='/add'||cmd==='/edit'){
        if(this.agent.running)throw new Error('Avval /stop yuboring va to‘xtashini kuting.');
        const candidate=cmd==='/edit'?this.store.findCode(args[0]||''):null;
        if(candidate&&!['queued','paused','review','archived'].includes(candidate.state))throw new Error('Bu holatda tahrirlash mumkin emas.');
        this.store.saveSetting('wizard',{step:0,values:{},editId:candidate?.id||null});this.reply(id,fields[0][1]);return;
      }
      if(cmd==='/list'){
        const list=this.store.list();if(!list.length){this.reply(id,'Nomzod yo‘q. /add bilan qo‘shing.');return;}
        for(let n=0;n<list.length;n+=12)this.reply(id,list.slice(n,n+12).map(c=>`${c.id.slice(0,8)} · ${c.family} ${c.given}\n${stateLabels[c.state]||c.state}${c.slot?' · '+c.slot.date+' '+c.slot.time:''}`).join('\n\n'));return;
      }
      if(cmd==='/screens'){
        if(!args[0])throw new Error('Nomzod kodini /list dan oling. /screens KOD');
        const c=this.store.findCode(args[0]);const shots=this.store.evidence(c.id).slice(0,6).reverse();
        if(!shots.length){this.reply(id,'Bu nomzod uchun hali skrinshot yo‘q.');return;}
        for(const e of shots){const shot=this.store.evidenceFile(e.id);this.store.notify(`screens:${id}:${e.id}`,`📸 ${c.family} ${c.given}\nBosqich: ${e.stage}`,{file:shot.file,capturedAt:shot.captured_at,url:shot.url});}return;
      }
      if(cmd==='/panel'){
        const panel=this.config.frontendOrigin||'http://127.0.0.1:4173';
        if(/^https:\/\//.test(panel))await this.api.call('sendMessage',{chat_id:String(this.config.owner_chat_id),text:'📱 Admin panelni ochish uchun tugmani bosing.',reply_markup:{inline_keyboard:[[{text:'Admin panelni ochish',web_app:{url:panel}}]]}});
        else this.reply(id,`Admin panel shu kompyuterda: ${panel}`);
        return;
      }
      if(cmd==='/status'||cmd==='/schedule'&&!args.length){const s=this.settings(),a=this.agent.status();const sessions=(a.sessions||[]).slice(0,20).map((x,i)=>`${i+1}. ${x.name}: ${x.message}`).join('\n');this.reply(id,`${a.message}\nNomzodlar: ${this.store.list().length}\nKunlik jadval: ${s.enabled?'yoqilgan':'o‘chiq'}\n${s.prepare} tayyorlanish → ${s.release} qidirish → ${s.end} yakun\nToshkent vaqti; parallel: ${s.parallel}\nYuborilmagan xabarlar: ${this.store.pending().length}${sessions?'\n\nSessiyalar:\n'+sessions:''}`);return;}
      if(['/schedule','/end','/parallel'].includes(cmd)){
        const s=this.settings();
        if(cmd==='/schedule'){if(!['on','off'].includes(args[0]))throw new Error('/schedule on yoki /schedule off');s.enabled=args[0]==='on';}
        if(cmd==='/end')s.end=args[0];if(cmd==='/parallel')s.parallel=args[0]==='all'?'all':Number(args[0]);
        validateSchedule(s);this.store.saveSetting('schedule',s);this.reply(id,'Jadval saqlandi. /status orqali ko‘ring. O‘zgarish keyingi ishga tushishga ta’sir qiladi.');return;
      }
      if(cmd==='/run'||cmd==='/test'){
        this.agent.start({mode:cmd==='/test'?'review':'live',parallel:this.settings().parallel,allowMonitorOnly:true});
        this.reply(id,cmd==='/test'?'Tekshirish rejimi boshlandi. Reserve bosilmaydi.':'Avtomatik bron boshlandi. Qidiruv 30 daqiqagacha davom etadi.');return;
      }
      if(cmd==='/stop'){this.scheduler.stopToday(new Date(this.now()));this.reply(id,'Bugungi ish to‘xtatilmoqda. Ertangi kunlik jadval o‘zgarmadi.');return;}
      if(['/booked','/no_booking','/waitlisted','/remove'].includes(cmd)){
        if(this.agent.running)throw new Error('Avval /stop yuboring va to‘xtashini kuting.');
        if(!args[0])throw new Error('Nomzod kodini /list dan oling.');const c=this.store.findCode(args[0]);
        if(cmd==='/remove')this.store.archive(c.id);else this.store.resolve(c.id,cmd==='/booked'?'booked':cmd==='/waitlisted'?'waitlisted':'queued');
        this.reply(id,'Nomzod holati yangilandi.');return;
      }
      if(cmd.startsWith('/')){this.reply(id,'Buyruq topilmadi. /help');return;}
      const wizard=this.store.setting('wizard',null);if(!wizard){this.reply(id,'Nomzod qo‘shish: /add. Buyruqlar: /help');return;}
      if(this.agent.running)throw new Error('Agent ishlayotganida ma’lumot tahrirlanmaydi. /stop');
      wizard.values[fields[wizard.step][0]]=text;
      if(wizard.step<fields.length-1){wizard.step++;this.store.saveSetting('wizard',wizard);this.reply(id,fields[wizard.step][1]);return;}
      const code=wizard.editId||this.store.add(wizard.values);
      if(wizard.editId)this.store.update(wizard.editId,wizard.values);
      this.store.saveSetting('wizard',null);this.reply(id,`✅ Saqlandi: ${wizard.values.family} ${wizard.values.given}\nKod: ${code.slice(0,8)}\n/list — ro‘yxat. Kunlik jadvalda faqat navbatdagi nomzodlar olinadi.`);
    }catch(e){this.reply(id,`⚠️ ${e.message}\nMa’lumotlarni qayta kiritish: /add yoki /edit KOD.`);}
  }
  async run(){
    if(!this.api.configured())throw new Error('Telegram token/owner_chat_id sozlanmagan');
    const hook=await this.api.call('getWebhookInfo');if(hook.url)throw new Error('Botda webhook bor. Eski botni to‘xtatib yangi polling rejimini sozlang.');
    await this.api.call('setMyCommands',{commands:[{command:'add',description:'Nomzod qo‘shish'},{command:'list',description:'Nomzodlar'},{command:'status',description:'Agent holati'},{command:'run',description:'Hozir bron qidirish'},{command:'stop',description:'Bugungi ishni to‘xtatish'},{command:'help',description:'Barcha buyruqlar'}],scope:{type:'chat',chat_id:String(this.config.owner_chat_id)}});
    if(/^https:\/\//.test(this.config.frontendOrigin||''))await this.api.call('setChatMenuButton',{chat_id:String(this.config.owner_chat_id),menu_button:{type:'web_app',text:'Admin panel',web_app:{url:this.config.frontendOrigin}}});
    while(!this.closed){
      try{
        this.controller=new AbortController();
        const updates=await this.api.call('getUpdates',{offset:this.store.setting(this.offsetKey,0),timeout:25,allowed_updates:['message']},AbortSignal.any([this.controller.signal,AbortSignal.timeout(35000)]));
        for(const u of updates){if(this.closed)break;await this.handle(u);}
      }catch(e){
        if(this.closed)break;
        if(e.code===409){this.store.notify('polling-conflict','⚠️ Shu token bilan boshqa bot ham getUpdates ishlatyapti. Eski watcher xizmatini to‘xtating, keyin yangi botni qayta ishga tushiring.');this.closed=true;throw new Error('Telegram polling conflict');}
        const end=this.now()+Math.max(5,e.retry||5)*1000;while(!this.closed&&this.now()<end)await new Promise(r=>setTimeout(r,200));
      }
    }
  }
  close(){this.closed=true;this.controller?.abort();}
}
module.exports={TelegramAPI,TelegramError,Notifier,Bot,HELP};
