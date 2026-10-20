import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const out = 'fixtures/reviews/ru29-1246';
const roles = ['reader', 'worker', 'verifier', 'reviewer', 'searcher', 'designer', 'weaver'];
const data = JSON.parse(readFileSync(`${out}/serve-cli-agents.json`, 'utf8')).data;
for (const role of roles) {
  const source = readFileSync(`.opencode/agents/${role}.md`, 'utf8');
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, '').trim();
  const pin = source.match(/^model: (.+)$/m)[1];
  const found = data.find(a => a.id === role);
  assert.ok(found, `${role} discovered`);
  assert.equal(found.system.trim(), body, `${role}: full body consumed by real CLI`);
  assert.equal(`${found.model.providerID}/${found.model.id}`, pin, `${role}: model pin`);
  assert.equal(found.mode, 'subagent');
  console.log(JSON.stringify({role, pin, systemBytes: Buffer.byteLength(found.system), bodyExact: true}));
}
