# js/shared — общие границы и протоколы

- `seam.ts`, `seam-host.ts`, `seam-entrance.ts` — локальный шов тонкого моста и демона: кадры, рукопожатие, вход, сессии.
- `snapshot.ts` — типы снимка машины и белый список полей для `status`; сборка по областям — `../bridge/snapshot.ts`, подкоманда — `../cli/status.ts`.
- `scope.ts` — область сессии; `standings.ts` — пути записей и дверей мест.

Слова поверхности — в `../delivery/`, импорт через `../delivery/index.ts`. Пробы шва — `../tests/seam.test.mjs`, снимка — `../tests/status*.test.mjs`.
