// Probe-only adapter authorized in case 4540[33]. No synthesized success and no launch verbs.
import {execFileSync} from 'node:child_process';
import {appendFileSync,readFileSync} from 'node:fs';
import {dirname} from 'node:path';
const [configFile,...args]=process.argv.slice(2);
const config=JSON.parse(readFileSync(configFile,'utf8'));
const reject=why=>{console.log(JSON.stringify({ok:false,error:{code:'probe_scope_refused',message:why}}));process.exit(2);};
const version=args.length===1&&args[0]==='--version';
const verb=args[1],handle=args[3];
const normal=['terminal',verb,'--terminal',handle,'--json'];
const waiting=['terminal','wait','--terminal',handle,'--for','exit','--timeout-ms','5000','--json'];
if(!version&&(!['show','close','wait'].includes(verb)||JSON.stringify(args)!==JSON.stringify(verb==='wait'?waiting:normal)))reject('argv');
const owned=version?null:JSON.parse(readFileSync(config.allowlist,'utf8'))[handle];
if(!version&&(!owned?.runtime||!owned?.incarnation))reject('target is not owned');
const env={HOME:config.home,PATH:dirname(config.executable)+':/opt/homebrew/bin:/usr/bin:/bin',LANG:'en_US.UTF-8',TMPDIR:config.tmpdir};
function run(argv){
  let out='',code=0;
  try{out=execFileSync(config.executable,argv,{encoding:'utf8',env,timeout:12000,stdio:['ignore','pipe','pipe']});}
  catch(e){out=String(e.stdout||'');code=typeof e.status==='number'?e.status:1;}
  appendFileSync(config.log,JSON.stringify({at:new Date().toISOString(),argv,code,stdout:out})+'\n',{mode:0o600});
  return {out,code};
}
if(version){const r=run(args);process.stdout.write(r.out);process.exit(r.code);}
const shown=run(['terminal','show','--terminal',handle,'--json']);
let proof;try{proof=JSON.parse(shown.out);}catch{reject('show is not JSON');}
if(shown.code!==0||proof.ok!==true||proof._meta?.runtimeId!==owned.runtime||proof.result?.terminal?.handle!==handle||proof.result.terminal.incarnationId!==owned.incarnation)reject('runtime/handle/incarnation changed');
const result=verb==='show'?shown:run(args);
process.stdout.write(result.out);process.exit(result.code);
