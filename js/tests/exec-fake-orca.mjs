// Lower-layer fixture, not evidence of actual Orca runtime behaviour.
export const fakeOrca = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const cp = require('node:child_process');
const root = process.env.EXEC_TEST_ROOT;
const control = JSON.parse(fs.readFileSync(root + '/control.json'));
const args = process.argv.slice(2);
fs.appendFileSync(root + '/orca-calls.jsonl', JSON.stringify(args) + '\n');
const meta = { runtimeId: control.runtime ?? 'runtime' };
const terminal = () => ({ handle: 'term_own', incarnationId: control.incarnation ?? 'incarnation', worktreePath: root + '/checkout', executionHostId: 'local', hostPlatform: process.platform, connected: !fs.existsSync(root + '/exited'), writable: !fs.existsSync(root + '/exited') });
let result;
if (args[0] === '--version') { console.log('1.4.242'); process.exit(0); }
if (args[0] === 'agent-context') {
  const required = { status: ['json'], 'host name': ['json'], 'terminal create': ['worktree','command','json'], 'terminal show': ['terminal','json'], 'terminal wait': ['terminal','for','timeout-ms','json'], 'agent launch': ['agent','worktree','model','prompt','json'] };
  console.log(JSON.stringify({commands: Object.entries(required).map(([command, flags]) => ({command, flags}))})); process.exit(0);
}
if (args[0] === 'status') result = { target: { kind: control.target ?? 'local' }, runtime: { state: 'ready', reachable: true, connectionState: 'connected', runtimeId: meta.runtimeId, appVersion: '1.4.242' } };
else if (args[0] === 'host') { result = { machineName: 'A custom name, NOT hostname', platform: process.platform }; if (control.hostMismatch) meta.runtimeId = 'other'; }
else if (args[0] === 'project' && args[1] === 'list') result = { projects: [{ id: 'p', gitRemoteIdentity: { canonicalKey: 'example.test/org/repo' } }] };
else if (args[0] === 'project' && args[1] === 'setups') result = { setups: [{ projectId: 'p', path: root + '/checkout', setupState: 'ready', hostId: 'local' }] };
else if (args[0] === 'terminal' && args[1] === 'create') {
  if (!control.createUnknown) {
    const p = cp.spawnSync('/bin/sh', ['-c', args[args.indexOf('--command') + 1]], { env: { ...process.env, SYNTHETIC_CONTEXT: 'runtime-only' }, encoding: 'utf8', timeout: 20000 });
    fs.writeFileSync(root + '/helper-result.json', JSON.stringify({ status: p.status, stderr: p.stderr }));
  }
  if (control.createUnknown) process.exit(1);
  result = { terminal: terminal() };
} else if (args[0] === 'terminal' && args[1] === 'show') {
  if (control.showError) process.exit(1);
  result = { terminal: terminal() };
} else if (args[0] === 'terminal' && args[1] === 'wait') {
  if (control.waitError) process.exit(1);
  result = { wait: { handle: 'term_own', condition: 'exit', satisfied: fs.existsSync(root + '/exited'), status: fs.existsSync(root + '/exited') ? 'exited' : 'running' } };
} else { process.stderr.write('unexpected fake command'); process.exit(1); }
console.log(JSON.stringify({ ok: true, result, _meta: meta }));
`;

export const fakeOpenCode = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const root = process.env.EXEC_TEST_ROOT;
const args = process.argv.slice(2);
if (process.env.SYNTHETIC_CONTEXT !== 'runtime-only') { process.stderr.write('missing runtime context'); process.exit(1); }
if (args[0] !== 'api') {
  fs.writeFileSync(root + '/tui.json', JSON.stringify(args));
  fs.writeFileSync(root + '/exited', 'owned fake exited');
} else {
  const server = args[args.indexOf('--server') + 1];
  const i = args.indexOf('--server') + 2;
  const body = args.includes('--data') ? args[args.indexOf('--data') + 1] : undefined;
  fetch(server + args[i + 1], { method: args[i], headers: { 'content-type': 'application/json' }, body }).then(async r => {
    if (!r.ok) process.exitCode = 1;
    process.stdout.write(await r.text());
  }).catch(() => { process.exitCode = 1; });
}
`;
