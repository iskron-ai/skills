// Disk fixtures and a deliberately constrained stand-in for the existing CLI.
import { createHash } from "node:crypto";
import { linkSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BRIDGE, NODE } from "./status-kit.mjs";

export const sha = "a".repeat(40);
export const names = ["entry", "establish-mcp", "iskron"];
export const hash = (s) => createHash("sha1").update(s).digest("hex");
export const blob = (s) =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(s)}\0${s}`)
    .digest("hex");
export const version = /(?:const|var|let) VERSION = "([^"]+)"/.exec(
  readFileSync(BRIDGE, "utf8"),
)[1];

export function prepareAutoSet(dir, mode) {
  const [major, minor, patch] = version.split(".").map(Number);
  const bridgeVersion = mode === "patch" ? `${major}.${minor}.${patch + 1}` : version;
  const bridge = mode === "patch" ? join(dir, "patch-marker.mjs") : BRIDGE;
  if (bridge !== BRIDGE)
    writeFileSync(
      bridge,
      readFileSync(BRIDGE, "utf8").replace(
        `VERSION = "${version}"`,
        `VERSION = "${bridgeVersion}"`,
      ),
    );
  const root = join(dir, ".agents", "skills");
  const stateHome = mode === "xdg" || mode === "missing-active-lock" ? join(dir, "state") : "";
  const lockPath =
    mode === "xdg"
      ? join(stateHome, "skills", ".skill-lock.json")
      : join(root, "..", ".skill-lock.json");
  const lock = { version: 3, skills: {} };
  for (const name of ["establish-mcp", "entry", "stranger"]) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, "SKILL.md"), "before");
    lock.skills[name] = {
      source:
        name === "stranger" || (name === "entry" && mode === "foreign")
          ? "someone/else"
          : "iskron-ai/skills",
      skillFolderHash: hash(`old-${name}`),
    };
  }
  mkdirSync(join(root, "establish-mcp", "scripts"));
  if (mode === "fork-url") lock.skills.entry.sourceUrl = "https://github.com/someone/else.git";
  if (mode === "new-name-collision") lock.skills.iskron = { source: "someone/else" };
  if (mode === "unowned") delete lock.skills.entry;
  if (mode === "retired") {
    mkdirSync(join(root, "retired"));
    writeFileSync(join(root, "retired", "SKILL.md"), "retired-own");
    lock.skills.retired = { source: "iskron-ai/skills", skillFolderHash: hash("retired") };
  }
  const installed =
    mode === "resume" || mode === "patch" || mode === "fresh-dangling"
      ? version
      : mode === "minor"
        ? minor > 0
          ? `${major}.${minor - 1}.999`
          : `${major - 1}.999.999`
        : "0.1.0";
  writeFileSync(
    join(root, "establish-mcp", "scripts", "iskron.mjs"),
    `const VERSION = "${installed}";`,
  );
  if (mode === "symlink") {
    const other = join(dir, "other");
    mkdirSync(other);
    writeFileSync(join(other, "sentinel"), "foreign");
    symlinkSync(other, join(root, "entry", "link"));
  }
  mkdirSync(join(lockPath, ".."), { recursive: true });
  writeFileSync(lockPath, mode === "malformed-lock" ? "{" : JSON.stringify(lock));
  if (mode === "hardlink")
    linkSync(join(root, "entry", "SKILL.md"), join(dir, "hardlink-sentinel"));
  if (mode === "lock-hardlink") linkSync(lockPath, join(dir, "hardlink-sentinel"));
  if (mode === "busy") {
    mkdirSync(join(root, "..", ".skill-catchup.lock"));
    writeFileSync(join(root, "..", ".skill-catchup.lock", "sentinel"), "another writer");
  }
  if (mode === "fresh-dangling")
    symlinkSync(join(dir, "missing-writer"), join(root, "..", ".skill-catchup.lock"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "npx"),
    `#!${NODE}
import {appendFileSync,existsSync,readFileSync,writeFileSync,mkdirSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
const args=process.argv.slice(2), dir=process.env.HOME, root=join(dir,'.agents','skills');
writeFileSync(join(dir,'token-present'),String(Boolean(process.env.ISKRON_BRIDGE_TOKEN)));
appendFileSync(join(dir,'calls'),JSON.stringify(args)+'\\n');
if(args.includes('--version')) { console.error('npm notice (not version stdout)'); console.log('1.7.6'); process.exit(0); }
if(${JSON.stringify(mode)}==='concurrent') {
 writeFileSync(join(dir,'updater-pid'),String(process.pid));
 await new Promise(resolve=>{const end=Date.now()+3000,t=setInterval(()=>{
   if(existsSync(join(dir,'release-writer'))||Date.now()>end){clearInterval(t);resolve();}
 },20);});
}
if(${JSON.stringify(mode)}==='exit1') process.exit(1);
if(${JSON.stringify(mode)}==='noop') process.exit(0);
if(${JSON.stringify(mode)}==='timeout'||${JSON.stringify(mode)}==='stop-during') {
 const {spawn}=await import('node:child_process');
 writeFileSync(join(dir,'updater-pid'),String(process.pid));
 process.on('SIGTERM',()=>{});
 spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setTimeout(()=>require('node:fs').writeFileSync("+JSON.stringify(join(dir,'escaped-child'))+",'escaped'),3000);setInterval(()=>{},1000)"],{stdio:'ignore'});
 setInterval(()=>{},1000);
 await new Promise(()=>{});
}
const lockPath=process.env.XDG_STATE_HOME?join(process.env.XDG_STATE_HOME,'skills','.skill-lock.json'):join(root,'..','.skill-lock.json'), lock=JSON.parse(readFileSync(lockPath));
for(const name of ${JSON.stringify(names)}) {
 mkdirSync(join(root,name),{recursive:true});
 if(!(${JSON.stringify(mode)}==='missing-skill' && name==='iskron') && !(${JSON.stringify(mode)}==='stale-file' && name==='entry')) writeFileSync(join(root,name,'SKILL.md'),'after:'+name);
 lock.skills[name]={source:'iskron-ai/skills',ref:${JSON.stringify(mode === "bad-ref" ? "b".repeat(40) : sha)},skillFolderHash:${JSON.stringify(Object.fromEntries(names.map((n) => [n, hash(n)])))}[name],skillPath:'skills/'+name+'/SKILL.md'};
}
writeFileSync(join(root,'establish-mcp','scripts','iskron.mjs'),'const VERSION = "${version}";');
if(${JSON.stringify(mode)}==='missing-bridge') unlinkSync(join(root,'establish-mcp','scripts','iskron.mjs'));
if(${JSON.stringify(mode)}==='bad-hash') lock.skills.entry.skillFolderHash='0'.repeat(40);
writeFileSync(lockPath,JSON.stringify(lock));
`,
    { mode: 0o755 },
  );
  return { root, stateHome, lockPath, bin, bridge, bridgeVersion };
}
