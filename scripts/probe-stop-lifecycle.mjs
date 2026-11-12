// Case 4540: genuine TUI/serve, LOCAL scripted NKS/provider, isolated HOME. No model.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync} from 'node:fs';
import {join, dirname, resolve} from 'node:path';
import {startFakeNks} from '../js/tests/fake-nks.mjs';

process.umask(0o077);
const out = resolve(process.argv[2]);
const root = resolve(import.meta.dirname, '..');
const sourceBridge = resolve(process.env.ISKRON_BRIDGE_PATH || join(root,'dist/dev/skills/establish-mcp/scripts/iskron.mjs'));
const sourcePlugin = resolve(process.env.ISKRON_OPENCODE_PLUGIN || join(root,'dist/dev/skills/establish-mcp/scripts/opencode-plugin.js'));
const bridge=join(out,'iskron.mjs'),plugin=join(out,'opencode-plugin.js');
const bin = execFileSync('which',['opencode'],{encoding:'utf8'}).trim();
const orcaBin = execFileSync('which',['orca'],{encoding:'utf8'}).trim();
const orcaWorktree = process.env.PROBE_ORCA_WORKTREE || dirname(execFileSync('git',['rev-parse','--path-format=absolute','--git-common-dir'],{cwd:root,encoding:'utf8'}).trim());
mkdirSync(out,{recursive:true});
copyFileSync(sourceBridge,bridge);copyFileSync(sourcePlugin,plugin);
const save = (n,d) => writeFileSync(join(out,n),typeof d === 'string' ? d : JSON.stringify(d,null,2));
const sha = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const fake = await startFakeNks({pat:'local4540-not-a-real-token'});
await fake.control({richTools:true,structured:true});
const wires=[];
const provider=createServer(async(req,res)=>{
  let b='';for await(const c of req)b+=c;
  wires.push({at:Date.now(),body:JSON.parse(b)});save('provider-wire.json',wires);
  // The full-stop scene has an actually running turn, not merely the last idle outcome.
  // This is a held loopback HTTP response, never a model request outside the carrier.
  if(b.includes('LOCAL4532 axis3-orca reply OK'))return;
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const chunk=(delta,finish_reason=null)=>({id:'local4540',object:'chat.completion.chunk',created:1,model:'probe',choices:[{index:0,delta,finish_reason}]});
  res.end(`data: ${JSON.stringify(chunk({role:'assistant',content:'LOCAL OK'}))}\n\ndata: ${JSON.stringify(chunk({},'stop'))}\n\ndata: [DONE]\n\n`);
});
await new Promise(r=>provider.listen(0,'127.0.0.1',r));
const home=join(out,'h'),cwd=join(out,'p'),auth=join(out,'a'),config=join(home,'.config/opencode');
for(const p of [cwd,auth,join(config,'plugins'),join(home,'tmp')])mkdirSync(p,{recursive:true});
save('freeze.json',{bridge:{path:bridge,source:sourceBridge,sha256:sha(bridge)},plugin:{path:plugin,source:sourcePlugin,sha256:sha(plugin)},opencode:{path:bin,version:execFileSync(bin,['--version'],{encoding:'utf8'}).trim()},ceiling:'LOCAL scripted API/provider, genuine TUI/serve. No LAB/production/model. Not cold acceptance.'});
writeFileSync(join(cwd,'AGENTS.md'),'---\niskron:\n  graph: r5\n  holon: 1506\n  agent_role: 931\n  contract: 41\n---\n# LOCAL 4540\n');
copyFileSync(plugin,join(config,'plugins/iskron.js'));
if(process.env.PROBE_ARCHIVE_SURFACE==='1')copyFileSync(join(root,'scripts/probe-archive-plugin.mjs'),join(config,'plugins/archive-surface.js'));
writeFileSync(join(config,'opencode.json'),JSON.stringify({model:'scripted/probe',snapshots:false,update:'disable',policies:[{action:'provider.use',resource:'*',effect:'deny'},{action:'provider.use',resource:'scripted',effect:'allow'}],providers:{scripted:{name:'LOCAL script',env:['SCRIPTED_API_KEY'],package:'@opencode/ai/providers/openai-compatible',settings:{baseURL:`http://127.0.0.1:${provider.address().port}/v1`},models:{probe:{name:'Probe',limit:{context:200000,output:4096},capabilities:{tools:true}}}}}}));
const env={PATH:`${dirname(orcaBin)}:${dirname(bin)}:${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`,HOME:home,TMPDIR:join(home,'tmp'),LANG:'en_US.UTF-8',TERM:'xterm-256color',COLORTERM:'truecolor',XDG_CONFIG_HOME:join(home,'.config'),XDG_DATA_HOME:join(home,'.local/share'),XDG_STATE_HOME:join(home,'.local/state'),XDG_CACHE_HOME:join(home,'.cache'),OPENCODE_CONFIG_DIR:config,SCRIPTED_API_KEY:'local-not-a-key',ISKRON_BRIDGE_PATH:bridge,ISKRON_BRIDGE_AUTH_DIR:auth,ISKRON_BRIDGE_URL:fake.mcpUrl,ISKRON_BRIDGE_TOKEN:'local4540-not-a-real-token',ISKRON_BRIDGE_DAEMON:'0',ISKRON_BRIDGE_NO_UPDATE:'1',ISKRON_BRIDGE_NO_BROWSER:'1',ISKRON_ROOT_SEAT:'1'};
if(process.env.PROBE_ORCA_ADAPTER==='1'){
  const wrapper=join(out,'probe-orca-wrapper.mjs'),configFile=join(out,'orca-probe.json'),allowlist=join(out,'orca-owned.json'),ownBin=join(out,'bin');
  copyFileSync(join(root,'scripts/probe-orca-wrapper.mjs'),wrapper);
  mkdirSync(ownBin,{recursive:true,mode:0o700});
  writeFileSync(allowlist,'{}',{mode:0o600});
  writeFileSync(configFile,JSON.stringify({home:process.env.HOME,executable:orcaBin,allowlist,log:join(out,'orca-wrapper.ndjson'),tmpdir:join(home,'tmp')}),{mode:0o600});
  const q=x=>"'"+x.replaceAll("'","'\\''")+"'";
  writeFileSync(join(ownBin,'orca'),`#!/bin/sh\nexec ${q(process.execPath)} ${q(wrapper)} ${q(configFile)} "$@"\n`,{mode:0o700});
  env.PATH=ownBin+':'+env.PATH;
  save('orca-probe-adapter.json',{wrapper,sha256:sha(wrapper),argv:['--version','terminal show --terminal OWN --json','terminal close --terminal OWN --json','terminal wait --terminal OWN --for exit --timeout-ms 5000 --json'],originalHome:process.env.HOME,metadataCopied:false,nativeOrcaIsolation:false,ceiling:'HOME restored only for real Orca CLI IPC; exact own handle/runtime/incarnation allowlist. Not a production adapter.'});
}
const port=48000+Math.floor(Math.random()*5000),server=`http://127.0.0.1:${port}`;
const serve=spawn(bin,['serve','--hostname','127.0.0.1','--port',String(port),'--print-logs','--log-level','warn'],{cwd,env,stdio:['ignore','pipe','pipe']});
let stdout='';serve.stdout.on('data',d=>{stdout+=d;const m=stdout.match(/server password (\S+)/);if(m)env.OPENCODE_PASSWORD=m[1];save('serve-stdout.raw',stdout);});
serve.stderr.on('data',d=>writeFileSync(join(out,'serve.raw'),d,{flag:'a'}));
for(let i=0;i<120&&!env.OPENCODE_PASSWORD;i++)await sleep(250);
assert.ok(env.OPENCODE_PASSWORD,'own serve must announce password');
const basic=()=>({authorization:'Basic '+Buffer.from('opencode:'+env.OPENCODE_PASSWORD).toString('base64')});
async function api(method,path,body){
  const r=await fetch(server+path,{method,headers:{...basic(),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(!r.ok)throw new Error(`${method} ${path}: ${r.status}`);
  const text=await r.text(),d=text?JSON.parse(text):null;return d?.data??d;
}
assert.equal((await fetch(server+'/api/session/active')).status,401);
assert.equal((await fetch(server+'/api/session/active',{headers:basic()})).status,200);
const listener=execFileSync('lsof',['-nP','-t',`-iTCP@127.0.0.1:${port}`,'-sTCP:LISTEN'],{encoding:'utf8'}).trim();assert.equal(listener,String(serve.pid));
save('ownership.json',{driver:process.pid,serve:serve.pid,port,listener,cwd});
const stream=await fetch(server+'/api/event',{headers:basic()});
void(async()=>{for await(const d of stream.body)writeFileSync(join(out,'events.raw'),d,{flag:'a'});})().catch(()=>{});
const sessions=new Map();
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
function snapshot(){
  for(const s of sessions.values())if(s.orca&&!s.exit&&!alive(s.pty.pid))s.exit={code:null,signal:'observed_gone',at:Date.now()};
  const holds=[];try{for(const n of readdirSync(join(auth,'standings')).filter(n=>n.endsWith('.hold')))holds.push(JSON.parse(readFileSync(join(auth,'standings',n),'utf8')));}catch{}
  return {at:Date.now(),places:[...fake.state.places.values()],channels:[...fake.state.channels].map(([key,c])=>({key,places:[...c.places]})),holds,orders:[...fake.state.orders.list.values()],acks:fake.state.orders.acks,wires:wires.length,serveAlive:serve.exitCode===null,clients:[...sessions].map(([label,s])=>({label,id:s.id,pid:s.pty.pid,exit:s.exit??null})),connects:fake.state.placeArgs.filter(p=>p.action==='connect')};
}
async function create(label,bare=false,orca=false){
  const s=await api('POST','/api/session',{title:'LOCAL4540 '+label,location:{directory:cwd},model:{providerID:'scripted',id:'probe'}});
  save(label+'-argv.json',[bin,'--server',server,...(bare?[]:['--session',s.id])]);
  if(orca){
    assert.equal(bare,false);
    const quote=x=>{assert.ok(!x.includes('\0'));return "'"+x.replaceAll("'","'\\''")+"'";};
    const launcher=join(out,label+'-exec.sh'),marker=join(out,label+'-pid');
    const script=`echo $$ > ${quote(marker)}\ncd ${quote(cwd)} && exec /usr/bin/env -i ${Object.entries(env).map(([k,v])=>quote(k+'='+v)).join(' ')} ${[bin,'--server',server,'--session',s.id].map(quote).join(' ')}\n`;
    writeFileSync(launcher,script,{mode:0o600});
    const args=['terminal','create','--worktree','path:'+orcaWorktree,'--title','LOCAL4540 '+label,'--command','exec /bin/sh '+quote(launcher),'--json'];
    const raw=execFileSync('orca',args,{encoding:'utf8',timeout:30000});
    const answer=JSON.parse(raw),terminal=answer.result?.terminal;
    assert.equal(answer.ok,true);assert.ok(terminal?.handle&&terminal.incarnationId&&answer._meta?.runtimeId);
    for(let i=0;i<40;i++){try{readFileSync(marker);break;}catch{}await sleep(250);}
    const pid=Number(readFileSync(marker,'utf8').trim());
    const command=execFileSync('ps',['-p',String(pid),'-o','command='],{encoding:'utf8'});
    assert.ok(command.includes('--session '+s.id)&&command.includes(server),'exact own client argv');
    const item={id:s.id,pty:{pid},orca:{handle:terminal.handle,runtime:answer._meta.runtimeId,incarnation:terminal.incarnationId}};sessions.set(label,item);
    if(process.env.PROBE_ORCA_ADAPTER==='1'){
      const file=join(out,'orca-owned.json'),owned=JSON.parse(readFileSync(file,'utf8'));
      owned[item.orca.handle]={runtime:item.orca.runtime,incarnation:item.orca.incarnation,session:s.id,pid};
      writeFileSync(file,JSON.stringify(owned),{mode:0o600});
    }
    save(label+'-terminal.json',answer);
    await api('POST',`/api/session/${s.id}/prompt`,{text:'LOCAL4532 '+label+' reply OK',resume:true});
    for(let i=0;i<120;i++){if(snapshot().holds.some(h=>h.session===s.id)&&wires.some(w=>JSON.stringify(w).includes('LOCAL4532 '+label+' reply OK')))break;await sleep(250);}
    const snap=snapshot(),hold=snap.holds.find(h=>h.session===s.id);
    const place=snap.channels.flatMap(c=>c.places.map(([,p])=>p)).find(p=>p.name===hold?.name);
    assert.ok(place?.standing_id,'own session seat');
    const run={realm:hold.realm,room:'00000000-0000-4000-8000-000000004540',invite:1,karta:931,launcher:'LOCAL-carrier',harness:'opencode',model:'scripted/probe',repository:'LOCAL',worktree:cwd,terminal:item.orca.handle,runtime:item.orca.runtime,standing_id:place.standing_id,state:'raised',at:new Date().toISOString()};
    mkdirSync(join(auth,'run'),{recursive:true});
    writeFileSync(join(auth,'run/orchestra-runs.json'),JSON.stringify({runs:{'local-owned':run}}),{mode:0o600});
    save(label+'-bound.json',{session:s.id,pid,command,run,...item.orca,ceiling:'Own terminal-create plus scenario Run binding; not agent-launch or live spawned_for proof.'});
    save(label+'-before.json',snapshot());return {id:s.id,handle:item.orca.handle,runtime:item.orca.runtime};
  }
  const p=spawn('/usr/bin/python3',[join(root,'scripts/probe-stop-pty.py'),join(out,label+'-argv.json')],{cwd,env,stdio:['pipe','pipe','pipe']});
  const item={id:s.id,pty:p};sessions.set(label,item);
  p.stdout.on('data',d=>writeFileSync(join(out,label+'.stdout.raw'),d,{flag:'a'}));p.stderr.on('data',d=>writeFileSync(join(out,label+'.stderr.raw'),d,{flag:'a'}));
  p.on('exit',(code,signal)=>{item.exit={code,signal,at:Date.now()};});
  await sleep(2500);assert.equal(item.exit,undefined);
  await api('POST',`/api/session/${s.id}/prompt`,{text:'LOCAL4532 '+label+' reply OK',resume:true});
  for(let i=0;i<120;i++){if(snapshot().holds.some(h=>h.session===s.id))break;await sleep(250);}
  save(label+'-before.json',snapshot());return {id:s.id,snapshot:snapshot()};
}
const control=createServer(async(req,res)=>{
  try{
    let b='';for await(const c of req)b+=c;const a=b?JSON.parse(b):{};let r;
    if(req.url==='/status')r=snapshot();
    else if(req.url==='/create')r=await create(a.label,a.bare===true,a.orca===true);
    else if(req.url==='/fake'){await fake.control(a);r=snapshot();}
    else if(req.url==='/api')r=await api(a.method,a.path,a.body);
    else if(req.url==='/input'){sessions.get(a.label).pty.stdin.write(a.text);r={sent:true};}
    else if(req.url==='/capture'){const s=sessions.get(a.label);r={state:await api('GET',`/api/session/${s.id}`),history:await api('GET',`/api/session/${s.id}/context`),snapshot:snapshot()};save(a.name||a.label+'-after.json',r);}
    else throw new Error('unknown command');
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(r));
  }catch(e){res.writeHead(500);res.end(JSON.stringify({error:String(e)}));}
});
await new Promise(r=>control.listen(0,'127.0.0.1',r));
save('control.json',{url:`http://127.0.0.1:${control.address().port}`,server,driver:process.pid});
console.log(JSON.stringify({ready:true,out,url:`http://127.0.0.1:${control.address().port}`,serve:serve.pid}));
