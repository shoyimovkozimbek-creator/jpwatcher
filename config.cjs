'use strict';
const fs=require('node:fs');const path=require('node:path');
const BASE=__dirname;
function readJson(file,fallback={}){try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}catch(e){if(e.code==='ENOENT')return fallback;throw new Error(`Sozlama JSON xato: ${path.basename(file)}`);}}
function config(){
  const old=readJson(path.join(BASE,'watcher-config.private.json'));
  const app=readJson(path.join(BASE,'agent-config.json'));
  return {...app,telegram_bot_token:process.env.TELEGRAM_BOT_TOKEN||old.telegram_bot_token,owner_chat_id:process.env.OWNER_CHAT_ID||old.owner_chat_id,
    dataDir:process.env.AGENT_DATA_DIR||path.join(BASE,'data'),
    dashboardEnabled:process.env.AGENT_PANEL==='true'||app.dashboardEnabled===true,
    panelHost:process.env.AGENT_PANEL_HOST||'127.0.0.1',
    port:Number(process.env.PORT||4173),
    publicHost:process.env.RENDER_EXTERNAL_HOSTNAME||'',
    adminKey:process.env.ADMIN_API_KEY||'',
    frontendOrigin:process.env.FRONTEND_ORIGIN||'',
    headless:process.env.AGENT_HEADLESS?process.env.AGENT_HEADLESS==='true':app.headless!==false,
    browserChannel:process.env.BROWSER_CHANNEL||app.browserChannel||(process.platform==='win32'?'chrome':undefined)};
}
module.exports={config,BASE};
