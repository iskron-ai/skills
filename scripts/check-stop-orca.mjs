// The separately accepted scoped criterion (#9256): own Run/handle exit, no archive prerequisite.
// check-4532.mjs and check-stop-scoped.mjs remain unchanged; their old RED is not renamed.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const out=process.argv[2],label='axis3-orca';
const base=JSON.parse(readFileSync(join(out,'control.json'))).url;
const binding=JSON.parse(readFileSync(join(out,label+'-bound.json')));
const call=async(path,body)=>{const r=await fetch(base+path,{method:'POST',body:JSON.stringify(body||{})});assert.equal(r.status,200);return r.json();};
const status=await call('/status');
const capture=await call('/capture',{label,name:'scoped-orca-final.raw.json'});
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
const observe=args=>{
  try{return JSON.parse(execFileSync('orca',args,{encoding:'utf8',timeout:5000}));}
  catch(e){try{return {...JSON.parse(e.stdout),observerExit:e.status};}catch{return {ok:false,observerExit:e.status,error:String(e)};}}
};
const shown=observe(['terminal','show','--terminal',binding.handle,'--json']);
const waited=observe(['terminal','wait','--terminal',binding.handle,'--for','exit','--timeout-ms','2000','--json']);
const t=shown.result?.terminal,w=waited.result?.wait;
const order=status.orders.find(o=>o.standing_id===binding.run.standing_id);
const acks=status.acks.filter(a=>a.id===order?.id);
const neighbour=Number(/OWN_TUI_PID=(\d+)/.exec(readFileSync(join(out,'neighbour.stderr.raw'),'utf8'))[1]);
const checks=[];const test=(name,ok,observed)=>checks.push({name,ok,observed});
let probeAdapter=null;try{probeAdapter=JSON.parse(readFileSync(join(out,'orca-probe-adapter.json')));}catch{}
test('same own Run/session and terminal binding',capture.state.id===binding.session&&binding.run.terminal===binding.handle&&binding.run.runtime===binding.runtime,binding);
test('own client process actually ended',!alive(binding.pid),{pid:binding.pid,alive:alive(binding.pid)});
test('same runtime/handle/incarnation after close',shown.ok&&shown._meta?.runtimeId===binding.runtime&&t?.handle===binding.handle&&t.incarnationId===binding.incarnation,{shown});
test('terminal exit observed, not CLI close exit0',waited.ok&&waited._meta?.runtimeId===binding.runtime&&w?.handle===binding.handle&&w.condition==='exit'&&w.satisfied===true&&w.status==='exited'&&t.connected===false&&t.writable===false,{waited});
test('history preserved and turn interrupted',capture.state.outcome==='interrupted'&&capture.history.some(m=>m.type==='user'&&m.text==='LOCAL4532 '+label+' reply OK'),{outcome:capture.state.outcome,messages:capture.history.length});
test('own place gone and no revived holding record',!status.holds.some(h=>h.session===binding.session),{holds:status.holds.map(h=>h.session)});
test('observed terminal ack names archive ceiling',acks.some((a,i)=>a.state==='stopped'&&a.reason_code==='client_exited_archive_unconfirmed'&&acks.slice(0,i).some(b=>b.state==='accepted')),{order,acks});
test('neighbour and shared serve survive',status.serveAlive&&alive(neighbour),{serveAlive:status.serveAlive,neighbour,alive:alive(neighbour)});
const result={at:new Date().toISOString(),verdict:checks.every(c=>c.ok)?'provisional':'contradicted',checks,archiveObserved:!!capture.state.time?.archived,probeAdapter,freeze:JSON.parse(readFileSync(join(out,'freeze.json'))),ceiling:'LOCAL own terminal-create with scenario Run binding, scripted provider/NKS. Not agent-launch/claim/join, not quit, not cold acceptance. No archive success or graceful exit claimed. If probeAdapter is present, HOME is restored only for the real CLI IPC: not native isolated Orca.'};
writeFileSync(join(out,'scoped-orca-evidence.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
process.exitCode=checks.every(c=>c.ok)?0:1;
