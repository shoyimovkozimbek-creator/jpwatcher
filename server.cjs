'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {releaseTime}=require('./core.cjs');
const {scheduleSettings,validateSchedule}=require('./scheduler.cjs');
const {Notifier}=require('./telegram.cjs');
const BASE=__dirname;

function createServer({store,agent,notifier,scheduler,config={},port=4173}){
  if(config.publicHost&&(!config.adminKey||config.adminKey.length<32))throw new Error('Public API requires ADMIN_API_KEY (32+ characters)');
  const csrf=crypto.randomBytes(32).toString('hex');
  const server=http.createServer(async(req,res)=>{
    const hosts=[`127.0.0.1:${port}`,`localhost:${port}`,...(config.publicHost?[config.publicHost]:[])];
    const json=(status,obj)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));};
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(!hosts.includes(req.headers.host))return json(403,{error:'Host rad etildi'});
    const url=new URL(req.url,`http://${req.headers.host}`);
    if(url.pathname==='/healthz'&&req.method==='GET')return json(200,{ok:true});
    const origin=req.headers.origin;
    const allowedOrigin=origin===`http://${req.headers.host}`||origin===`https://${req.headers.host}`||Boolean(config.frontendOrigin&&origin===config.frontendOrigin);
    if(origin&&allowedOrigin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-CSRF-Token');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');}
    if(req.method==='OPTIONS'){if(!allowedOrigin)return json(403,{});res.writeHead(204);res.end();return;}
    if(config.adminKey&&(url.pathname.startsWith('/api/')||url.pathname.startsWith('/evidence/')||url.pathname.startsWith('/result/'))){
      const supplied=String(req.headers.authorization||'');const expected=`Bearer ${config.adminKey}`;
      if(!crypto.timingSafeEqual(crypto.createHash('sha256').update(supplied).digest(),crypto.createHash('sha256').update(expected).digest()))return json(401,{error:'Admin kaliti noto‘g‘ri yoki kiritilmagan'});
    }
    try{
      if(req.method==='GET'){
        if(url.pathname==='/api/state')return json(200,{csrf,candidates:store.publicList().map(c=>({...c,evidence:store.evidence(c.id)})),events:store.events(),agent:agent.status(),telegram:notifier.configured(),pendingNotifications:store.db.prepare('SELECT count(*) AS n FROM outbox WHERE sent=0').get().n,nextRelease:releaseTime(new Date(),scheduleSettings(store,config).release),schedule:scheduleSettings(store,config)});
        if(/^\/evidence\/\d+$/.test(url.pathname)){
          const item=store.evidenceFile(Number(url.pathname.split('/').pop()));
          if(!item)return json(404,{});
          const root=path.resolve(store.dir),file=path.resolve(root,item.file);
          if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return json(404,{error:'Skrinshot topilmadi'});
          res.writeHead(200,{'Content-Type':'image/png'});fs.createReadStream(file).pipe(res);return;
        }
        if(url.pathname.startsWith('/result/')){
          const id=url.pathname.slice(8);
          if(!/^[a-f0-9-]{36}$/.test(id))return json(404,{});
          store.get(id);const file=path.join(store.dir,`${id}.png`);
          if(!fs.existsSync(file))return json(404,{error:'Skrinshot hali yo‘q'});
          res.writeHead(200,{'Content-Type':'image/png'});fs.createReadStream(file).pipe(res);return;
        }
        const files={'/':'index.html','/app.js':'app.js','/connection.js':'connection.js','/style.css':'style.css'};
        if(!files[url.pathname])return json(404,{});
        const mime=url.pathname.endsWith('.js')?'text/javascript':url.pathname.endsWith('.css')?'text/css':'text/html';
        res.writeHead(200,{'Content-Type':`${mime}; charset=utf-8`});res.end(fs.readFileSync(path.join(BASE,'public',files[url.pathname])));return;
      }
      if(req.method!=='POST')return json(405,{});
      if(!allowedOrigin||req.headers['x-csrf-token']!==csrf)return json(403,{error:'So‘rov manbasi tasdiqlanmadi'});
      let data='';
      for await(const chunk of req){data+=chunk;if(data.length>65536)return json(413,{error:'So‘rov juda katta'});}
      const body=JSON.parse(data||'{}');
      if(['/api/edit','/api/archive','/api/candidate'].includes(url.pathname)){
        if(agent.running)throw new Error('Avval agentni to‘xtating');
        if(url.pathname==='/api/edit')store.update(body.id,body);
        else if(url.pathname==='/api/archive')store.archive(body.id);
        else {const c=store.get(body.id);return json(200,{id:c.id,family:c.family,given:c.given,phone:c.phone,email:c.email,passport:c.passport});}
        return json(200,{ok:true});
      }
      if(url.pathname==='/api/schedule'){
        const s=validateSchedule({...scheduleSettings(store,config),...body});store.saveSetting('schedule',s);return json(200,{ok:true});
      }
      if(url.pathname==='/api/notifications/retry'){notifier.nextTry=0;await notifier.flush();return json(200,{ok:true});}
      if(url.pathname==='/api/candidates'){
        if(agent.running)throw new Error('Nomzod qo‘shishdan oldin agentni to‘xtating');
        const id=store.add(body);return json(201,{id});
      }
      if(url.pathname==='/api/start'){
        if(!notifier.configured()&&body.mode==='live')throw new Error('Telegram owner_chat_id va tokenni private config faylida sozlang');
        return json(200,agent.start(body));
      }
      if(url.pathname==='/api/stop'){if(scheduler)scheduler.stopToday();else agent.stop().catch(()=>{});return json(200,{ok:true});}
      if(url.pathname==='/api/resolve'){
        if(agent.running)throw new Error('Natijani o‘zgartirishdan avval agentni to‘xtating');
        store.resolve(body.id,body.outcome);return json(200,{ok:true});
      }
      return json(404,{});
    }catch(e){return json(400,{error:e instanceof SyntaxError?'JSON noto‘g‘ri':e.message});}
  });
  return server;
}
module.exports={createServer,Notifier};
if(require.main===module)require('./service.cjs').main({dashboard:true});
