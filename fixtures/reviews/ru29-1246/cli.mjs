// Real CLI ingestion in the disposable HOME made by independent.mjs.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const out = join(process.cwd(), 'fixtures/reviews/ru29-1246');
const scratch = readFileSync(join(out, 'scratch-path.txt'), 'utf8').trim();
const home = join(scratch, 'home');
const cwd = join(home, 'consumer');
assert.equal(spawnSync('git', ['init', '-q', cwd]).status, 0);
writeFileSync(join(cwd, 'opencode.json'), JSON.stringify({
  update: 'disable', snapshots: false,
  policies: [{action: 'provider.use', resource: '*', effect: 'deny'}],
  providers: { anthropic: {
    name: 'Offline model catalogue only',
    package: '@opencode/ai/providers/openai-compatible',
    settings: {baseURL: 'http://127.0.0.1:1/v1'},
    models: Object.fromEntries(['claude-opus-5-5', 'glm-5.3'].map(name => [name, {name, limit: {context: 200000, output: 4096}, capabilities: {tools: true}}])),
  }},
}, null, 2));
const env = {PATH: process.env.PATH, HOME: home, TMPDIR: scratch,
  XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'),
  XDG_DATA_HOME: join(home, 'data'), XDG_STATE_HOME: join(home, 'state'),
  OPENCODE_CONFIG_DIR: join(home, 'config/opencode'), ISKRON_ROOT_SEAT: '0',
  ISKRON_BRIDGE_NO_UPDATE: '1', NO_COLOR: '1'};
for (const [name, args] of [
  ['cli-private-config', ['service', 'set', 'disabled', 'true']],
  ['cli-catalogue-config-sources', ['debug', 'config']],
  ['cli-catalogue-agents', ['debug', 'agents']],
]) {
  const r = spawnSync('opencode', args, {cwd, env, encoding: 'utf8', timeout: 90000, maxBuffer: 20e6});
  writeFileSync(join(out, `${name}.stdout`), r.stdout || '');
  writeFileSync(join(out, `${name}.stderr`), r.stderr || '');
  writeFileSync(join(out, `${name}.status.json`), JSON.stringify({args, cwd, status: r.status, signal: r.signal, error: r.error?.message}));
  assert.equal(r.status, 0, r.stderr);
}
