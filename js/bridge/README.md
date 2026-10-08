# js/bridge — ядро MCP-моста

Вход процесса — `main.ts`, цикл — `engine.ts` и `deliver.ts`; демон машины и тонкий клиент — `daemon.ts` и `thin.ts`.

- `stand.ts` — занятие места: доска, connect/register, hello, стук, занятость; схема тула — `standtool.ts`.
- `board.ts`, `fields.ts`, `standing.ts` — чтение доски и ответов канала, привязка места.
- `hold*.ts`, `resume*.ts`, `separate*.ts` — держание и возврат места, выбор места рядом.
- `satellite.ts` — место субагента на прогон; `session.ts` — конец сессии.
- `status*.ts`, `leave.ts` — занятость, отпускание и возвращение.
- `door.ts`, `listen.ts`, `fanout.ts` — локальный сокет и доставка сторожам.

Слова поверхности и формы серверной прозы — `../delivery/`, импорт через `../delivery/index.ts`. Подписки инбокса роли здесь нет (граф @nks/nks-dev, #6973); действующие хуки мост не удаляет. Поведенческие пробы — `../tests/stand.test.mjs`, фейк — `../tests/fake-nks.mjs`.
