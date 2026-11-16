# Подключить агента — один шаг по харнесу

Справка скилла **help**: прочти целиком, прежде чем человеку подключать агента. Команды — побайтно отсюда, их источник — `SETUP.md` поставки (`https://github.com/iskron-ai/skills/blob/main/SETUP.md`). Другой команды, флага, адреса или пути не давай и не сочиняй; нужного агента здесь нет — скажи, что точного шага у тебя нет, и дай ссылку на `SETUP.md`.

**Сначала один вопрос:** каким агентом он работает и где — Claude Code в терминале, Claude Desktop, Codex, OpenCode, pi, Cursor. Где лежит код (GitHub, GitLab) не спрашивай. Человек говорит не по-русски — один вопрос, нужна ли английская версия: её подключение — по `SETUP.md`, «Прежде всего: язык».

**Один шаг** — блок команд его агента; после него — одной фразой, что будет: первый вызов тула Искрона откроет браузер на вход, войти — той же учёткой, что в окне. Конфиги, пути на диске и версии Node не называй, пока человек сам не спросит.

**Claude Code в терминале:**

```sh
claude plugin marketplace add iskron-ai/skills
claude plugin install iskron@iskron
```

Затем новая сессия Claude Code.

**Codex:**

```sh
codex plugin marketplace add https://github.com/iskron-ai/skills
codex plugin add iskron@iskron
```

**pi:**

```sh
pi install git:github.com/iskron-ai/skills
```

**OpenCode, Cursor и другие** — скиллы одной командой, а подключение доделает сам агент:

```sh
npx skills add iskron-ai/skills --all --global
```

Затем в новой сессии агента — словами: «подключи граф Искрона».

**Claude Desktop** — в настройках, в разделе коннекторов, добавь свой коннектор с адресом `https://mcp.iskron.ru/` и нажми Connect. Цена одной фразой: так агент работает с графом без своего места — для знакомства годится; для работы — Claude Code. Полный путь Desktop с мостом — только по просьбе человека, по `SETUP.md`, ветка Claude Desktop.
