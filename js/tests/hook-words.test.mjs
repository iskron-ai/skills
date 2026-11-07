import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { build } from "esbuild";

// Execute the source words in isolation: no shared dev build, sockets or private memory.
// prettier-ignore
const modules = ["prepare", "rites", "compaction", "turn", "launch", "rootseat", "plugin", "leads", "backlog", "stalebatch", "opencode", "opencode-keep", "watchdog", "onboardstart"];
const { outputFiles } = await build({
  stdin: {
    contents: modules.map((m) => `export * from './js/delivery/words/${m}.ts';`).join("\n"),
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  plugins: process.env.HOOK_WORDS_REV
    ? [
        {
          name: "baseline-words",
          setup(b) {
            b.onLoad({ filter: /\/delivery\/words\/.*\.ts$/ }, ({ path }) => ({
              contents: execFileSync(
                "git",
                ["show", `${process.env.HOOK_WORDS_REV}:${path.slice(process.cwd().length + 1)}`],
                { encoding: "utf8" },
              ),
              loader: "ts",
            }));
          },
        },
      ]
    : [],
});
const words = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`
);
// Each row is one operational contract and one representative measurement, not a prose snapshot.
// prettier-ignore
const cases = [
  ["PREPARE.start", [{ graph: "r5", holon: "1506", role: "931" }], 260, [/Старт/, /двери iskron/, /r5/, /#1506/, /#931/]],
  ["PREPARE.guard", ["r5"], 330, [/^BLOCKED:/, /целиком/, /AGENTS.md/, /r5/, /minding/, /ловушки/, /машины/]],
  ["RITES.push", ["Самопроверка этапа"], 150, [/не отгрузка/, /AGENTS.md/, /Самопроверка этапа/]],
  ["RITES.merge", ["1506", "Жизненный цикл сессии", "Мерж → граф"], 190, [/AGENTS.md/, /#1506/, /Жизненный цикл сессии/, /Мерж → граф/]],
  ["RITES.early", ["r5"], 150, [/r5/, /iskronify/, /Первый граф/, /не выдумывай/]],
  ["COMPACTION.keep", ["931", "agent", "r5"], 200, [/#931/, /agent/, /r5/, /мост/, /дел/, /номер/, /iskron/]],
  ["COMPACTION.back", ["931", "agent", "r5"], 260, [/#931/, /agent/, /r5/, /мост/, /iskron/, /recall/]],
  ["COMPACTION.bare", [], 200, [/iskron/, /recall/]],
  ["TURN.wake", [], 190, [/ask/, /iskron_case/, /iskron_channel/, /ход кончен/]],
  ["LAUNCH.notSeated", ["отказ", "3494", "iskron_case(realm, action=join)"], 280, [/спутник/, /запустивш/, /iskron_stand/, /3494/, /action=join/, /без графа/]],
  ["ROOT_SEAT.seated", ["agent", "931", "r5", "AGENTS.md"], 200, [/agent/, /931/, /r5/, /подписаны/, /предварительное/, /без take/]],
  ["ROOT_SEAT.ownSeated", ["agent", "931", "r5", "AGENTS.md"], 160, [/своим/, /agent/, /подписаны/, /take/]],
  ["ROOT_SEAT.realign", ["нет роли", "AGENTS.md"], 210, [/iskronify/, /не угадывай/, /сама/, /AGENTS.md/]],
  ["PLUGIN.dead", ["4000"], 160, [/4000/, /connect/, /register/]],
  ["PLUGIN.stoppedTurn", ["СТОП: работу кончи, место не занимай"], 160, [/СТОП/, /человек/, /iskron_stand/]],
  ["PLUGIN.evicted", ["4003"], 300, [/4003/, /имя.N/, /iskron_stand/, /take=true/, /человека/]],
  ["LEAD.cascade", ["agent"], 210, [/не кончен/, /дело/, /revoke/, /agent/]],
  ["LEAD.end", ["agent", "исход", "место снято. ", "ДИНАМИЧЕСКИЙ ИТОГ"], 220, [/КОНЧЕН/, /не ход/, /не приёмка/, /ДИНАМИЧЕСКИЙ ИТОГ/]],
  ["LEAD.turn", ["agent"], 190, [/не поручение/, /КОНЧЕН/, /revoke/, /agent/]],
  ["LEAD.notice", ["ses_child", "agent"], 290, [/ses_child/, /state="completed"/, /ХОДА/, /не поручения/, /КОНЧЕН/, /revoke/]],
  ["LEAD.ask", ["agent", "ДИНАМИЧЕСКОЕ РАЗРЕШЕНИЕ"], 230, [/только человек/, /окне/, /ДИНАМИЧЕСКОЕ РАЗРЕШЕНИЕ/]],
  ["BACKLOG.head", [12, 20, 5, 3], 120, [/12/, /20/, /5/, /7/, /3/, /отдельно/]],
  ["STALE.head", [12, 5, true], 190, [/12/, /5/, /7/, /адресованные/, /счётом/, /iskron_case/]],
  ["OPENCODE.commandHead", ["iskron"], 100, [/skill/, /iskron/, /человека/]],
  ["OPENCODE_KEEP.resumed", ["agent"], 300, [/agent/, /leave/, /iskron_stand/, /истории/]],
  ["OPENCODE_KEEP.elsewhere", ["agent"], 260, [/agent/, /iskron_stand/, /take не нужен/, /имя.N/]],
  ["OPENCODE_KEEP.notBack", ["agent", "отказ"], 170, [/agent/, /отказ/, /сторож/i, /iskron_stand/]],
  ["OPENCODE_KEEP.retryFailed", ["agent", "отказ"], 130, [/agent/, /отказ/, /iskron_stand/]],
  ["OPENCODE_KEEP.lostWord", ["12:34", "agent"], 210, [/12:34/, /agent/, /подожди/, /iskron_stand/, /не удался/]],
  ["WATCHDOG.noHeld", [], 110, [/iskron_stand/, /слушания/]],
  ["WATCHDOG.noThread", [], 120, [/CODEX_THREAD_ID/, /оболочки сессии Codex/]],
  ["WATCHDOG.noDoor", ["/door"], 250, [/ЧЕЛОВЕКА/, /CODEX_HOME/, /SETUP/, /watchdog-exit/, /\/door/]],
  ["ONBOARD_START.start", [], 120, [/предложи/, /onboarding/, /не задерживает/]],
];

for (const [name, args, limit, required] of cases) {
  const [module, key] = name.split(".");
  const text = words[module].ru[key](...args);
  process.stdout.write(`SIZE ${name} ${[...text].length} ${Buffer.byteLength(text)}\n`);
  test(`${name}: concise with its operational doors`, () => {
    for (const re of required) assert.match(text, re);
    assert.ok([...text].length <= limit, `${name}: ${[...text].length} > ${limit}`);
  });
}

test("guard sample matches the executable source word", () => {
  const sample = readFileSync("skills/iskronify/references/hooks.md", "utf8");
  assert.ok(sample.includes(words.PREPARE.ru.guard("<Граф>", "<Раздел персистентности>")));
});

test("stop is final; own and satellite places stay distinct", () => {
  assert.match(words.PLUGIN.ru.stoppedAny(), /остановлен.*работу кончи.*место не занимай/);
  assert.match(words.ROOT_SEAT.ru.cancelled(), /новая посадка запрещена/);
  assert.match(
    words.LEAD.ru.writeUnderParent("write", "parent"),
    /спутник.*iskron_stand.*satellite_of="parent"/s,
  );
  assert.match(words.LEAD.ru.finalRefusal("конец", "write"), /встать снова нельзя/);
  assert.match(words.WATCHDOG.ru.listening("agent"), /^слушаю стояние agent/);
  assert.match(words.PLUGIN.ru.evicted(4003), /take=true.*только словом человека/);
});

test("optional addresses and sections are not invented; counts keep their branches", () => {
  assert.doesNotMatch(words.PREPARE.ru.start({ graph: "r5" }), /#|undefined/);
  assert.doesNotMatch(words.PREPARE.ru.guard("r5", null), /Правила персистентности|undefined/);
  assert.doesNotMatch(words.RITES.ru.merge(), /#|«|undefined/);
  assert.match(words.COMPACTION.ru.back("", "agent", "r5"), /<роль>/);
  assert.match(words.LAUNCH.ru.entered("agent", "3494"), /agent.*3494.*первым словом.*бриф.*деле/);
  assert.match(words.PLUGIN.ru.dead(4002), /4002.*просто[юя].*iskron_stand/);
  assert.equal(words.BACKLOG.ru.head(1, 0, 1, 0), "Побудка: кадров 1.");
  assert.equal(words.STALE.ru.head(1, 1), "Лежалых кадров: 1.");
  assert.match(words.LEAD.ru.end("agent", "исход", "", ""), /дело/);
  const payload = "НЕ СОКРАЩАТЬ: пользователь/агент\n".repeat(100);
  assert.ok(words.LEAD.ru.end("agent", "исход", "", payload).endsWith(payload));
  assert.ok(words.LEAD.ru.ask("agent", payload).includes(payload));
});
