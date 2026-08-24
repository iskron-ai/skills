#!/usr/bin/env node
// node watchdog.mjs <адрес-сокета>   — сторож канала, без зависимостей, Node 22+.
//
// Держит сокет канала делателя открытым и доставляет каждый кадр: печатает его
// на stdout, переоткрывается по закрытию и отличает мёртвый токен от катящейся
// выкатки. В Claude Code гони его под Monitor с persistent: true — каждая
// напечатанная строка придёт событием в ход делателя. На харнесе без
// встроенного наблюдателя адаптируй по references/channel.md: выходи на первом
// кадре-сообщении вместо печати (фоновый вывод там читается только по запросу).
//
// Боевые заметки — в channel.md рядом с этим файлом: почему попытка считается
// от конструкции (никогда от onopen), почему пауза не растёт и почему три
// быстрых обрыва спрашивают /version, прежде чем винить токен.
const url = process.argv[2], version = new URL(url).origin.replace('wss:', 'https:') + '/api/version';
let fastDrops = 0;
const log = (s) => process.stdout.write(s + '\n');
const serviceUp = () => fetch(version, { signal: AbortSignal.timeout(5000) })
  .then((r) => (r.ok ? r.json() : null)).catch(() => null);

function open() {
  const startedAt = Date.now();           // от конструкции, НЕ в onopen — см. channel.md
  const ws = new WebSocket(url);
  ws.addEventListener('message', (e) => log(typeof e.data === 'string' ? e.data : '[двоичный кадр]'));
  ws.addEventListener('error', () => {}); // закрытие придёт следом в любом случае
  ws.addEventListener('close', async (e) => {
    if ([4000, 4001, 4002].includes(e.code)) {
      return log(`ДЕЛАТЕЛЬ: закрытие ${e.code} — токен мёртв, зови connect (на 4001 — mint)`); // и выход
    }
    fastDrops = Date.now() - startedAt < 5000 ? fastDrops + 1 : 0;
    if (fastDrops >= 3) {
      const up = await serviceUp();
      if (up) return log(`ДЕЛАТЕЛЬ: обрывы, а служба отвечает (${up.version}) — спроси о токене`);
      log('служба не отвечает — идёт раскатка, держу тот же токен');
      fastDrops = 1;                      // простой не должен перерасти в вопрос о токене
    }
    setTimeout(open, e.code === 4003 ? 3000 : 2000);
  });
}
open();
