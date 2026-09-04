#!/usr/bin/env node
// node watchdog.mjs <адрес-сокета>   — сторож канала, без зависимостей, Node 22+.
// Адрес — секрет, и командная строка его не прячет: ps печатает и аргумент, и
// присваивание перед командой. Клади адрес в файл 0600 и разворачивай внутри
// команды: bash -c 'ISKRON_CHANNEL_SOCKET=$(cat <файл>) exec node watchdog.mjs'
// — скрипт читает переменную, когда аргумента нет.
//
// Держит сокет канала делателя открытым и доставляет каждый кадр: печатает его
// на stdout, переоткрывается по закрытию, отличает мёртвый токен от катящейся
// выкатки и на мёртвом токене выходит ненулевым. В Claude Code гони его под
// Monitor с persistent: true — каждая напечатанная строка придёт событием в
// ход делателя. На харнесе без
// встроенного наблюдателя адаптируй по references/channel.md: выходи на первом
// кадре-сообщении вместо печати (фоновый вывод там читается только по запросу).
//
// И он же несёт слово делателя НАРУЖУ — строку занятости, см. вторую половину файла.
//
// Боевые заметки — в channel.md рядом с этим файлом: почему попытка считается
// от конструкции (никогда от onopen), почему пауза не растёт и почему три
// быстрых обрыва спрашивают /version, прежде чем винить токен.
import { readFileSync, writeSync } from 'node:fs';

const url = process.argv[2] || process.env.ISKRON_CHANNEL_SOCKET,
  // Обе схемы, как и у статусного адреса ниже: с одним `wss:` вопрос службе на
  // ws-адресе не уходил вовсе, и ветка «служба жива, а нас рвёт» не наступала.
  version = new URL(url).origin.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:') + '/api/version';
let fastDrops = 0, dead = false, retry = null;
const log = (s) => process.stdout.write(s + '\n');
// Последнее слово перед выходом: синхронно, иначе выход следом уносит саму строку.
// Полная неблокирующая труба бросает EAGAIN — тогда обычная печать и выход по её
// колбэку; сторожевой таймер на случай, если читатель не заберёт вовсе.
const loudExit = (s, code) => {
  try { writeSync(1, s + '\n'); process.exit(code); }
  catch {
    process.stdout.write(s + '\n', () => process.exit(code));
    setTimeout(() => process.exit(code), 1000).unref();
  }
};
const serviceUp = () => fetch(version, { signal: AbortSignal.timeout(5000) })
  .then((r) => (r.ok ? r.json() : null)).catch(() => null);

function open() {
  const startedAt = Date.now();           // от конструкции, НЕ в onopen — см. channel.md
  const ws = new WebSocket(url);
  let gone = false;                       // обрыв разбирается один раз, чем бы он ни пришёл
  ws.addEventListener('message', (e) => log(typeof e.data === 'string' ? e.data : '[двоичный кадр]'));
  // Обрыв на самом апгрейде даёт на части рантаймов ТОЛЬКО error: close не
  // приходит вовсе, и сторож, ждущий одного close, тихо умирает вместе с пустым
  // циклом событий (замерено на Node 22). Отсрочка оставляет close шанс назвать
  // свой код — коды мёртвого токена приходят именно им.
  ws.addEventListener('error', () => setTimeout(() => dropped(1006), 500));
  ws.addEventListener('close', (e) => dropped(e.code));

  async function dropped(code) {
    // Мёртвый токен громче любого предположения об обрыве. `error` даёт лишь
    // предположение (1006 по отсрочке), а настоящий код приходит `close`-ом и
    // может опоздать — прежняя ограда `gone` его глотала, и сторож молча
    // переоткрывался на мёртвом токене: ровно тот отказ, ради которого писан
    // громкий выход. Поэтому коды мёртвого токена проходят ограду всегда и
    // снимают уже назначенное переоткрытие.
    if ([4000, 4001, 4002].includes(code)) {
      if (dead) return;
      dead = true;
      if (retry) clearTimeout(retry);
      // Нулевой выход был бы неотличим от чистой остановки, а молчаливый — от
      // работающего сторожа: оба конца пути отсюда громкие.
      return loudExit(`ДЕЛАТЕЛЬ: закрытие ${code} — токен мёртв, зови connect (на 4001 — mint)`, 1);
    }
    if (gone) return;
    gone = true;
    fastDrops = Date.now() - startedAt < 5000 ? fastDrops + 1 : 0;
    if (fastDrops >= 3) {
      const up = await serviceUp();
      // Служба жива, а нас рвёт: переоткрывать нечего, и уйти молча нельзя —
      // делатель остался бы с виду слышимым.
      if (up) return loudExit(`ДЕЛАТЕЛЬ: обрывы, а служба отвечает (${up.version}) — спроси о токене`, 1);
      log('служба не отвечает — идёт раскатка, держу тот же токен');
      fastDrops = 1;                      // простой не должен перерасти в вопрос о токене
    }
    retry = setTimeout(open, code === 4003 ? 3000 : 2000);
  }
}
open();

// ── Вторая половина: слово делателя наружу ──────────────────────────────────
// Строку занятости удостоверяет слушающий секрет, а он здесь — у сторожа, не у
// рабочей сессии. Поэтому делатель пишет ТЕКСТ в файл, а публикует сторож; почему
// именно так и что значит каждый отказ — в channel.md, «Когда сокет держит сторож».
// Без переменной половина не включается, и старое поведение сохраняется дословно.
const sayFile = process.env.ISKRON_CHANNEL_SAY;
// Выданный рядом с сокетом адрес — первый; вывод из формы — фолбэк, потому что
// сторожу вручают сокет, а не ответ connect целиком, а форма адресов дрейфует.
const statusUrl = process.env.ISKRON_CHANNEL_STATUS
  || url.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:').replace('/channel/ws/', '/channel/status/');
let said = null, complained = null;

// Опрос, а не наблюдение за файлом: файла может ещё не быть, а наблюдатель за
// несуществующим путём бросает; пересоздание целиком опрос тоже переживает.
async function say() {
  let text;
  try { text = readFileSync(sayFile, 'utf8').trim(); } catch { return; } // ещё не написали — не о чем говорить
  if (text === said) return;              // публикуют смену занятия, а не такт
  const res = await fetch(statusUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }), signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (res?.ok) { said = text; complained = null; return; } // пустая строка — СЛОВО: ею занятость снимают
  if (complained !== text) {              // жалоба раз на текст, а не раз в секунду
    complained = text;
    log(`ДЕЛАТЕЛЬ: строку занятости не приняли (${res ? res.status : 'нет ответа'}) — см. channel.md`);
  }
  if (res && res.status >= 400 && res.status < 500) said = text; // отказ по самой строке: повтор той же ничего не изменит
}
if (sayFile) setInterval(say, 1000).unref(); // таймер не смеет держать процесс, чей сокет умер
