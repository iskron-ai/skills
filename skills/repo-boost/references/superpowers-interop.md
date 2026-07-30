# Interop с superpowers — канонический шаблон

Канонический шаблон подсекции `### Workflow-suite interop (superpowers)`, которую Шаг 7 repo-boost проецирует в `AGENTS.md` целевого репо (в конец `## Жизненный цикл сессии`), когда superpowers обнаружен и пользователь согласился на Шаге 1. Деплоируемая секция — огороженный блок ниже; чек-лист перепроверки после него остаётся здесь и не деплоится никогда.

Цитаты из superpowers остаются английскими дословно: они сверяются с установленной поставкой, и переведённая цитата перестала бы грепаться.

## Текст деплоируемой секции

```markdown
### Workflow-suite interop (superpowers)
Superpowers сам ратифицирует этот контракт: "user instructions always take
precedence", с "User's explicit instructions (CLAUDE.md, GEMINI.md,
AGENTS.md, direct requests)" в высшем приоритете (using-superpowers,
Instruction Priority); "(User preferences for spec location override this
default)" (brainstorming). AGENTS.md — это инструкции пользователя: всё ниже
живёт внутри собственных правил superpowers, не исключением из них.
- **Гоняй brainstorming для творческой работы** — его сократическая
  элиситация желанна. Спека, которую он пишет (например, под
  `docs/superpowers/specs/`), — черновой вид; запись дизайна — граф.
- **Сохранение решений в граф — работа памяти, не имплементация** —
  brainstorming-овский HARD-GATE ("Do NOT … take any implementation action")
  до неё не дотягивается, по собственной формулировке. Дизайн не готов, пока
  его решения, риски и жизненный цикл не в графе.
- **Пост-brainstorming передача в силе**: сначала впусти спеку в граф, в той
  же сессии (инструкции пользователя идут первыми по клаузе приоритета), затем
  передай в writing-plans ровно так, как велит brainstorming.
- **Плоскость исполнения уступлена**: планирование, TDD, отладка, верификация,
  ревью и их родня — что бы ни поставлял установленный набор — ведут
  исполнение. Решения, рождённые посреди имплементации, всё равно ложатся
  узлами графа до конца сессии — никогда не откладываются до будущего пуша.

*(interop: <mode> — verified against superpowers@<version> — re-check on
suite upgrade)*
```

Штампуй деплоированную строку реально установленной версией (`superpowers@<version>`) и режимом, выбранным на Шаге 1 (`full` / `prose-only`) — штамп и есть запись согласованного режима; держи её простой строкой: шаг финализации вычищает HTML-комментарии.

## Чек-лист перепроверки (только мейнтейнерам — при апгрейде superpowers)

Грепни установленный кэш плагина на:
1. путь спек `docs/superpowers/specs/`, всё ещё несущий "(User preferences for spec location override this default)";
2. цитируемые скиллы всё ещё зовутся `using-superpowers`, `brainstorming`;
3. формулировки гейтов не изменились: HARD-GATE "take any implementation action" и передача "writing-plans is the next step";
4. клаузы приоритета не изменились: "user instructions always take precedence" и пункт "User's explicit instructions (CLAUDE.md, GEMINI.md, AGENTS.md, direct requests)" (using-superpowers, Instruction Priority) — они же цитируются в `skills/entry/SKILL.md` (секция коэкзистенции); обновляй оба места.
