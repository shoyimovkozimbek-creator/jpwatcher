const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../core.cjs'),{createServer}=require('../server.cjs');
test('remote API: bearer protects state and evidence; CORS and CSRF remain enforced',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jp-remote-')),store=new Store(dir),port=19674,key='a'.repeat(48),origin='https://frontend.example';
  const config={publicHost:'backend.example',adminKey:key,frontendOrigin:origin};const server=createServer({store,agent:{running:false,status:()=>({running:false})},notifier:{configured:()=>true},port,config});
  await new Promise(r=>server.listen(port,'127.0.0.1',r));t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));store.close();fs.rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`;
  assert.equal((await fetch(base+'/healthz')).status,200);
  for(const route of ['/api/state','/evidence/1','/result/anything'])assert.equal((await fetch(base+route)).status,401);
  assert.equal((await fetch(base+'/api/state',{headers:{Authorization:'Bearer '+String.fromCharCode(233).repeat(48)}})).status,401);
  const headers={Authorization:`Bearer ${key}`,Origin:origin};const res=await fetch(base+'/api/state',{headers});assert.equal(res.status,200);assert.equal(res.headers.get('access-control-allow-origin'),origin);const state=await res.json();
  assert.equal((await fetch(base+'/api/state',{method:'OPTIONS',headers:{Origin:origin}})).status,204);
  assert.equal((await fetch(base+'/api/state',{method:'OPTIONS',headers:{Origin:'https://evil.example'}})).status,403);
  const body=JSON.stringify({enabled:false,prepare:'17:55',release:'18:00',end:'20:00',parallel:'all'});
  assert.equal((await fetch(base+'/api/schedule',{method:'POST',headers,body})).status,403);
  assert.equal((await fetch(base+'/api/schedule',{method:'POST',headers:{...headers,'X-CSRF-Token':state.csrf},body})).status,200);
  assert.throws(()=>createServer({store,config:{publicHost:'backend.example'}}),/ADMIN_API_KEY/);
});
