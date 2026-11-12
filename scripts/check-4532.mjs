// Independent external falsifiers. Read own HTTP carrier and owned PIDs, no model or mutation.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
process.umask(0o077);
const axis=process.argv[2],out=process.argv[3];
assert.ok(['3','4','5'].includes(axis));
const base=JSON.parse(readFileSync(join(out,'control.json'))).url;
const call=async(path,body)=>{
  const r=await fetch(base+path,body?{method:'POST',body:JSON.stringify(body)}:{});
  assert.equal(r.status,200);return await r.json();
};
const status=await call('/status');
const freeze=JSON.parse(readFileSync(join(out,'freeze.json')));
const label=axis==='4'?'axis4-explicit':axis==='5'?'axis5-quit':'axis3-stop';
const capture=await call('/capture',{label,name:`axis${axis}-final.raw.json`});
const client=status.clients.find(c=>c.label===label);
const ownPid=(label)=>Number(/OWN_TUI_PID=(\d+)/.exec(readFileSync(join(out,label+'.stderr.raw'),'utf8'))[1]);
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const neighbour=ownPid('neighbour');
const pid=ownPid(label);
const checks=[];
const test=(name,ok,observed)=>checks.push({name,ok,observed});
test('own shared serve and neighbour survived',status.serveAlive&&alive(neighbour),{serveAlive:status.serveAlive,neighbour,alive:alive(neighbour)});
test('original history retained',capture.history.some(m=>m.type==='user'&&m.text===`LOCAL4532 ${label} reply OK`),{messages:capture.history.length});
if(axis==='4'){
  test('seat removal left original TUI alive/passive',alive(pid)&&client.exit===null,{pid,alive:alive(pid),exit:client.exit});
  test('stopped hold did not return across reload',!status.holds.some(h=>h.session===client.id),{session:client.id});
}
if(axis==='5'){
  test('actual quit exited zero',client.exit?.code===0&&!alive(pid),{pid,alive:alive(pid),exit:client.exit});
  test('quit released its holding record and listener',!status.holds.some(h=>h.session===client.id),{session:client.id,held:status.holds.some(h=>h.session===client.id)});
  test('late frame did not enter quit session',!capture.history.some(m=>m.type==='user'&&m.text?.includes('LOCAL4532 late frame after quit')),{matching:capture.history.filter(m=>m.type==='user'&&m.text?.includes('LOCAL4532 late frame after quit')).map(m=>m.text)});
}
let bare;
if(axis==='3'){
  test('explicit --session client actually exited',!alive(pid)&&client.exit?.code===143,{pid,alive:alive(pid),exit:client.exit});
  const barePid=ownPid('axis3-bare');
  const tty=readFileSync(join(out,'axis3-bare.stdout.raw'),'utf8');
  const sid=/state=clear:id=(ses_[A-Za-z0-9]+)/.exec(tty)?.[1];
  assert.ok(sid,'bare-TUI must itself announce its session, no cwd inference');
  const state=await call('/api',{method:'GET',path:`/api/session/${sid}`});
  const history=await call('/api',{method:'GET',path:`/api/session/${sid}/context`});
  const bareClient=status.clients.find(c=>c.label==='axis3-bare');
  bare={id:sid,pid:barePid,alive:alive(barePid),state,history,exit:bareClient.exit};
  writeFileSync(join(out,'axis3-bare-final.raw.json'),JSON.stringify(bare,null,2));
  test('bare-TUI history retained',history.some(m=>m.type==='user'&&m.text==='LOCAL4532 BARE_FROM_TUI reply OK'),{messages:history.length});
  test('full stop actually ended bare-TUI',!alive(barePid)&&bareClient.exit!==null,{pid:barePid,alive:alive(barePid),exit:bareClient.exit,announcedSession:sid});
  test('stop orders got terminal ack',status.acks.filter(a=>a.state==='stopped').length>=2,status.acks);
}
const pids=[pid,neighbour,...(bare?[bare.pid]:[])];
const processes=execFileSync('ps',['-p',pids.join(','),'-o','pid,ppid,uid,command'],{encoding:'utf8'});
const result={axis,at:new Date().toISOString(),verdict:checks.every(x=>x.ok)?'provisional':'contradicted',freeze,checks,processes,ceiling:'Genuine OpenCode TUI/serve and exact release bridge/plugin. LOCAL substituted NKS/provider only; no production/LAB, model or fix claim. Cold acceptance belongs to parent.'};
writeFileSync(join(out,`axis${axis}-evidence.json`),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
process.exitCode=checks.every(x=>x.ok)?0:1;
