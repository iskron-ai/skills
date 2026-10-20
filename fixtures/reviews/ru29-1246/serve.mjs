// Read roles through an isolated, real OpenCode server. No prompt/model endpoint is called.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
const out = join(process.cwd(), 'fixtures/reviews/ru29-1246');
const scratch = readFileSync(join(out, 'scratch-path.txt'), 'utf8').trim();
const home = join(scratch, 'home'), cwd = join(home, 'consumer');
const env = {PATH: process.env.PATH, HOME: home, TMPDIR: scratch,
  XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'),
  XDG_DATA_HOME: join(home, 'data'), XDG_STATE_HOME: join(home, 'state'),
  OPENCODE_CONFIG_DIR: join(home, 'config/opencode'), ISKRON_ROOT_SEAT: '0',
  ISKRON_BRIDGE_NO_UPDATE: '1', NO_COLOR: '1'};
const reserve = createServer();
await new Promise(r => reserve.listen(0, '127.0.0.1', r));
const port = reserve.address().port;
await new Promise(r => reserve.close(r));
const server = `http://127.0.0.1:${port}`;
const proc = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {cwd, env, stdio: ['ignore', 'pipe', 'pipe']});
let stdout = '', stderr = '';
proc.stdout.on('data', d => stdout += d);
proc.stderr.on('data', d => stderr += d);
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  for(let i=0; i<120 && !/server password (\S+)/.test(stdout) && proc.exitCode === null; i++) await sleep(250);
  const password = stdout.match(/server password (\S+)/)?.[1];
  assert.ok(password, stderr);
  const headers = {Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`};
  assert.equal((await fetch(`${server}/api/agent`)).status, 401);
  const query = `?location%5Bdirectory%5D=${encodeURIComponent(cwd)}`;
  async function get(name, path) {
    const r = await fetch(server + path, {headers});
    const text = await r.text();
    writeFileSync(join(out, `${name}.json`), text);
    assert.equal(r.status, 200, text);
    return JSON.parse(text);
  }
  await get('serve-location', '/api/location' + query);
  await get('serve-agents', '/api/agent' + query);
  await get('serve-config', '/api/config' + query);
  const api = await get('serve-openapi', '/openapi.json');
  console.log(Object.keys(api.paths).filter(p => /agent|plugin|session$/.test(p)).join('\n'));
  // Authenticated real CLI request to that very server, no managed/default server.
  const cli = execFileSync('opencode', ['api', '--server', server, 'get', '/api/agent' + query], {cwd, env: {...env, OPENCODE_PASSWORD: password}, encoding:'utf8'});
  writeFileSync(join(out, 'serve-cli-agents.json'), cli);
} finally {
  writeFileSync(join(out, 'serve.stderr'), stderr);
  writeFileSync(join(out, 'serve.stdout'), stdout.replace(/server password \S+/g, 'server password [redacted]'));
  if(proc.exitCode === null) {
    const stopped = new Promise(r => proc.once('exit', r));
    proc.kill('SIGTERM');
    await Promise.race([stopped, sleep(5000)]);
    if(proc.exitCode === null) proc.kill('SIGKILL');
  }
}
