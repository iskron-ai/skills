// Independent review observations; no model requests, no global configuration writes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = process.cwd();
const out = join(root, 'fixtures/reviews/ru29-1246');
const scratch = existsSync(join(out, 'scratch-path.txt')) ? readFileSync(join(out, 'scratch-path.txt'), 'utf8').trim() : mkdtempSync(join(tmpdir(), 'ru29-1246-'));
writeFileSync(join(out, 'scratch-path.txt'), `${scratch}\n`);
const records = [];
function run(name, cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 20e6, timeout: 120000, ...options });
  writeFileSync(join(out, `${name}.stdout`), result.stdout || '');
  writeFileSync(join(out, `${name}.stderr`), result.stderr || '');
  records.push({ name, cmd, args, cwd: options.cwd || root, status: result.status, signal: result.signal, error: result.error?.message });
  writeFileSync(join(out, 'commands.json'), JSON.stringify(records, null, 2));
  return result;
}
assert.equal(run('head', 'git', ['rev-parse', 'HEAD']).status, 0);
assert.equal(run('base-is-ancestor', 'git', ['merge-base', '--is-ancestor', '42da4024', 'HEAD']).status, 0);
assert.equal(run('post-content-delta', 'git', ['diff', '--name-status', '0035d579', 'HEAD']).status, 0);
assert.equal(run('node-version', process.execPath, ['--version']).status, 0);
const roles = ['reader', 'worker', 'verifier', 'reviewer', 'searcher', 'designer', 'weaver'];
const refs = [1, 2].map(n => readFileSync(`skills/iskronify/references/delegation-${n}.md`, 'utf8')).join('\n');
const body = text => text.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
for (const role of roles) {
  const cc = readFileSync(`.claude/agents/${role}.md`, 'utf8');
  const oc = readFileSync(`.opencode/agents/${role}.md`, 'utf8');
  const template = [...refs.matchAll(/```markdown\n([\s\S]*?)\n```/g)].map(m => m[1]).find(t => t.includes(`name: ${role}\n`));
  assert.ok(template, role);
  assert.equal(body(cc), body(template), `${role}: Claude vs source`);
  assert.equal(body(oc), body(template), `${role}: OpenCode vs source`);
  console.log(`SOURCE/CLAUDE/OPENCODE body identical: ${role}`);
}
const old = join(scratch, 'base');
mkdirSync(old, {recursive: true});
const archived = spawnSync('git', ['archive', '42da4024', 'skills/minding', 'skills/onboarding', 'skills/iskronify/references/hooks.md', '.claude/settings.json'], {cwd: root, maxBuffer: 10e6});
assert.equal(archived.status, 0);
assert.equal(spawnSync('tar', ['-x', '-C', old], {input: archived.stdout}).status, 0);
for (const [name, envName, file] of [
  ['negative-memory', 'MEMORY_GUARD_ROOT', 'memory-paths.test.mjs'],
  ['negative-personal', 'MINDING_ENTRY_ROOT', 'personal-entry.test.mjs'],
]) {
  const result = run(name, process.execPath, ['--test', '--test-reporter=tap', `js/tests/${file}`], {env: {...process.env, [envName]: old}});
  assert.equal(result.status, 1, `${name}: old source must be rejected`);
  assert.match(result.stdout, /not ok/);
}
// No parent-directory project config is inherited: the consumer is under a fresh temp HOME.
const home = join(scratch, 'home');
const consumer = join(home, 'consumer');
mkdirSync(join(consumer, '.opencode/agents'), {recursive: true});
mkdirSync(join(home, 'config'), {recursive: true});
for (const role of roles) cpSync(join(root, `.opencode/agents/${role}.md`), join(consumer, `.opencode/agents/${role}.md`));
const env = {PATH: process.env.PATH, HOME: home, TMPDIR: scratch,
  XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'),
  XDG_DATA_HOME: join(home, 'data'), XDG_STATE_HOME: join(home, 'state'),
  OPENCODE_CONFIG_DIR: join(home, 'config/opencode'), ISKRON_ROOT_SEAT: '0',
  ISKRON_BRIDGE_NO_UPDATE: '1', NO_COLOR: '1'};
const version = run('cli-version', 'opencode', ['--version'], {cwd: consumer, env});
assert.equal(version.status, 0);
// cli.mjs prepares an offline catalogue; serve.mjs uses an explicit, owned server
// and location. verify-records.mjs asserts the recorded CLI response, not its exit code alone.
console.log(`Fixture prepared; scratch retained at ${scratch}`);
