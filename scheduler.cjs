'use strict';
const {tashkentParts}=require('./core.cjs');
function scheduleSettings(store,config={}){
  return store.setting('schedule',{enabled:config.scheduleEnabled!==false,prepare:config.prepareTime||'17:55',release:config.releaseTime||'18:00',end:config.endTime||'20:00',parallel:config.parallel||'all'});
}
function validateSchedule(s){
  if(typeof s.enabled!=='boolean'||(s.parallel!=='all'&&(!Number.isInteger(s.parallel)||s.parallel<1||s.parallel>20)))throw new Error('Jadval sozlamasi xato');
  for(const k of ['prepare','release','end'])if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s[k]))throw new Error('Vaqt HH:MM shaklida bo‘lsin');
  if(!(s.prepare<=s.release&&s.release<s.end))throw new Error('Tayyorlanish ≤ boshlanish < yakun vaqti bo‘lsin');return s;
}
class Scheduler{
  constructor(store,agent,config={}){this.store=store;this.agent=agent;this.config=config;this.closed=false;this.waiting=false;}
  async tick(now=new Date()){
    if(this.closed||this.waiting||this.agent.running)return;
    const s=validateSchedule(scheduleSettings(this.store,this.config));if(!s.enabled)return;
    const {date,time}=tashkentParts(now);if(time<s.prepare||time>=s.end)return;
    const key=`daily:${date}`;const previous=this.store.setting(key,null);
    if(previous?.finished||previous?.stopped)return;
    this.waiting=true;
    try{
      this.store.saveSetting(key,{started:now.toISOString(),finished:false,stopped:false});
      this.agent.start({mode:'live',parallel:s.parallel,startAt:`${date}T${s.release}:00+05:00`,endAt:`${date}T${s.end}:00+05:00`,allowMonitorOnly:true,runId:previous?.runId||`daily-${date}`,scheduled:true});
      this.store.saveSetting(key,{started:now.toISOString(),runId:this.agent.runId,finished:false,stopped:false});
      this.agent.done.finally(()=>{if(!this.closed)this.store.saveSetting(key,{...this.store.setting(key,{}),finished:true,ended:new Date().toISOString()});});
    }catch(e){this.store.notify(`schedule-error:${date}`,'⚠️ Kunlik agentni boshlashda xato. /status ni tekshiring.');this.store.saveSetting(key,{finished:true,error:true});}
    finally{this.waiting=false;}
  }
  stopToday(now=new Date()){const {date}=tashkentParts(now);this.store.saveSetting(`daily:${date}`,{stopped:true});this.agent.stop().catch(()=>{});}
  close(){this.closed=true;}
}
module.exports={Scheduler,scheduleSettings,validateSchedule};
