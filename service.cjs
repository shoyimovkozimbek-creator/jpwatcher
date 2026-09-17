'use strict';
require('./bootstrap.cjs');
const net=require('node:net');
const {config}=require('./config.cjs');const {Store}=require('./core.cjs');const {Agent}=require('./booking.cjs');
const {Notifier,Bot}=require('./telegram.cjs');const {Scheduler}=require('./scheduler.cjs');
async function acquireLock(port=4174){
  const server=net.createServer(socket=>socket.end());
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});return server;
}
async function main({dashboard=false}={}){
  let lock,store,agent,bot,scheduler,timer,notifier,httpServer,closing=false;
  async function close(code=0){
    if(closing)return;closing=true;clearInterval(timer);scheduler?.close();bot?.close();
    if(agent)await agent.stop();
    if(notifier&&!notifier.busy)await notifier.flush();
    while(notifier?.busy)await new Promise(r=>setTimeout(r,50));
    if(httpServer)await new Promise(r=>httpServer.close(r));
    if(lock)await new Promise(r=>lock.close(r));
    store?.close();process.exitCode=code;
  }
  try{
    const cfg=config();if(cfg.publicHost&&cfg.adminKey.length<32)throw new Error('ADMIN_API_KEY kamida 32 belgi bo‘lsin');lock=await acquireLock();store=new Store(cfg.dataDir);store.recover();
    agent=new Agent(store,{headless:cfg.headless,browserChannel:cfg.browserChannel,screenshots:cfg.screenshots});
    notifier=new Notifier(store,cfg);scheduler=new Scheduler(store,agent,cfg);bot=new Bot(store,agent,scheduler,cfg);
    if(!notifier.configured())throw new Error('Telegram token/owner_chat_id sozlanmagan');
    const identity=await notifier.api.call('getMe');
    const hook=await notifier.api.call('getWebhookInfo');if(hook.url)throw new Error('Webhook mavjud. Eski bot ulanishini avval tekshiring.');
    console.log(`Telegram agent: @${identity.username}. Kunlik jadval va nomzodlar: /status. Ctrl+C: to‘xtatish.`);
    if(dashboard||cfg.dashboardEnabled){httpServer=require('./server.cjs').createServer({store,agent,notifier,scheduler,config:cfg,port:cfg.port});await new Promise((r,j)=>{httpServer.once('error',j);httpServer.listen(cfg.port,cfg.panelHost,r);});console.log(`Admin API port: ${cfg.port}`);}
    store.notify(`boot:${Date.now()}`,'🤖 Telegram bron agenti ishga tushdi.\n/add — nomzod qo‘shish\n/status — kunlik jadval\n/help — barcha buyruqlar');
    process.once('SIGINT',()=>close());process.once('SIGTERM',()=>close());
    bot.run().catch(async()=>{store.notify(`bot-error:${Date.now()}`,'⚠️ Telegram boshqaruvi ishlamay qoldi. Token, webhook va eski watcher holatini tekshiring. Kunlik agent to‘xtatildi.');await close(78);});
    timer=setInterval(()=>{notifier.flush();scheduler.tick().catch(()=>store.event('Jadval tekshiruvida xato'));},2000);
    await scheduler.tick();await notifier.flush();
  }catch(e){console.error(e.code==='EADDRINUSE'?'Agent allaqachon ishlayapti (4174 port).':'Agent ishga tushmadi. Token, Telegram ulanishi va sozlamalarni tekshiring.');await close(78);}
}
if(require.main===module)main();
module.exports={main,acquireLock};
