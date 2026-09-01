# Changelog

## [4.2.0](https://github.com/iskron-ai/skills/compare/v4.1.0...v4.2.0) (2026-09-01)


### Features

* **skills:** скилл standing, компактный collaborate, честный холд-офф моста ([#70](https://github.com/iskron-ai/skills/issues/70)) ([63d170a](https://github.com/iskron-ai/skills/commit/63d170a970534d7b10ce5a9bb2adcf149b093adc))


### Bug Fixes

* **skills:** шаг 2 standing под-пунктами, умолчание предела зонда в collaborate ([#73](https://github.com/iskron-ai/skills/issues/73)) ([fcab90d](https://github.com/iskron-ai/skills/commit/fcab90d7393fd936ae61c14fcf87c78201638ad2))
* **standing:** связка connect → register — занять место и привязать сессию, два вызова ([#72](https://github.com/iskron-ai/skills/issues/72)) ([280d9ed](https://github.com/iskron-ai/skills/commit/280d9ed64ad1536817f8a932055676f8065cf8dc))

## [4.1.0](https://github.com/iskron-ai/skills/compare/v4.0.0...v4.1.0) (2026-09-01)


### Features

* **iskronify:** поле интеграции из графа, контракт 6, гейт имён скиллов ([#66](https://github.com/iskron-ai/skills/issues/66)) ([2bcd5be](https://github.com/iskron-ai/skills/commit/2bcd5beab14321cee65dcc53190cb6a02340ead6))


### Bug Fixes

* **agents:** карта превращений читается, а не помнится ([#68](https://github.com/iskron-ai/skills/issues/68)) ([4a4fd14](https://github.com/iskron-ai/skills/commit/4a4fd147bf24e503761400eea07d3884a92420d9))
* **collaborate:** постановка запускает побудку, но не равна доставке ([#69](https://github.com/iskron-ai/skills/issues/69)) ([249028c](https://github.com/iskron-ai/skills/commit/249028ce64df56a1c3e0fcc5203c91573ff73b9c))

## [4.0.0](https://github.com/iskron-ai/skills/compare/v3.7.0...v4.0.0) (2026-08-31)


### ⚠ BREAKING CHANGES

* **chief-of-staff:** скилл foreman удалён; ведение бригады теперь несёт chief-of-staff.

### Features

* **chief-of-staff:** ярус между человеком и агентами; foreman упразднён ([#65](https://github.com/iskron-ai/skills/issues/65)) ([e9c88d2](https://github.com/iskron-ai/skills/commit/e9c88d28bcf28613622c3d2f954b6c1bc44fbb2a))
* **collaborate:** сторож несёт строку занятости делателя наружу ([#64](https://github.com/iskron-ai/skills/issues/64)) ([988983d](https://github.com/iskron-ai/skills/commit/988983d1fb312328b5bb7ff1102b328805f06e77))


### Bug Fixes

* **build:** упаковка детерминированна поперёк машин, и гейт поднят с деревьев на байты ([#62](https://github.com/iskron-ai/skills/issues/62)) ([8d4a864](https://github.com/iskron-ai/skills/commit/8d4a8643f56e25adf24a3f9d73ea39915ffb5ec4))

## [3.7.0](https://github.com/iskron-ai/skills/compare/v3.6.0...v3.7.0) (2026-08-30)


### Features

* **iskronify:** внешние поверхности (пратьякша прежде шабды), контракт в описание (2→5), поверхности из графа, холодное ревью PR ([#56](https://github.com/iskron-ai/skills/issues/56)) ([a331d4a](https://github.com/iskron-ai/skills/commit/a331d4a467a55e636a1a145276063029787626f8))
* **skills:** ликбез, карта положений, эскалация iskronify и вердикт исхода у моста ([#61](https://github.com/iskron-ai/skills/issues/61)) ([6b313f3](https://github.com/iskron-ai/skills/commit/6b313f3b5c0859a4737991998b252136f394e81d))
* **skills:** холодный старт в collaborate и починка осиротевшего моста ([#58](https://github.com/iskron-ai/skills/issues/58)) ([48a11ac](https://github.com/iskron-ai/skills/commit/48a11ac2e370f9aa59fed1633184844ec54eb659))


### Bug Fixes

* **bridge:** второй клик человека не оставляет первую вкладку висеть ([#59](https://github.com/iskron-ai/skills/issues/59)) ([c70810e](https://github.com/iskron-ai/skills/commit/c70810e0e42d9dd4b17217c2d31a72a9fc0d146d))
* канонический идентификатор ресурса (гейт) + мост перерегистрирует стояние на смену сессии ([#60](https://github.com/iskron-ai/skills/issues/60)) ([2f8f9bf](https://github.com/iskron-ai/skills/commit/2f8f9bf70a6553e58e9b644787a4783901e2b9ed))

## [3.6.0](https://github.com/iskron-ai/skills/compare/v3.5.0...v3.6.0) (2026-08-28)


### Features

* **skills:** четвёртое слово сентинелов — realm-owner, и слова на arrow-link ([#54](https://github.com/iskron-ai/skills/issues/54)) ([c600eec](https://github.com/iskron-ai/skills/commit/c600eec9a96a85a9346e885c1fdaa1a1c05a95aa))

## [3.5.0](https://github.com/iskron-ai/skills/compare/v3.4.5...v3.5.0) (2026-08-28)


### Features

* **iskronify:** протокол входа в работу, крия против задачи, референсы из кода, reconcile-такт ([#49](https://github.com/iskron-ai/skills/issues/49)) ([bfba933](https://github.com/iskron-ai/skills/commit/bfba93347a26ee9ec4cfd72fb48018ce495f4ca3))
* **reconcile:** скилл двусторонней сверки кода и графа ([#48](https://github.com/iskron-ai/skills/issues/48)) ([a747411](https://github.com/iskron-ai/skills/commit/a74741158113f2740a17a3f904c0947ebc43e367))
* **skills:** слова сентинелов канала — steward/agent/me на posed_to, mine на standing, инвентарь в отказах ([#53](https://github.com/iskron-ai/skills/issues/53)) ([49c75aa](https://github.com/iskron-ai/skills/commit/49c75aa11679e841addd859d01aa0ab685daf214))


### Bug Fixes

* **collaborate:** авто-перепривязка сессии — обычный путь поверхности, ручной register — первая привязка и фолбэк ([#52](https://github.com/iskron-ai/skills/issues/52)) ([1e8ddba](https://github.com/iskron-ai/skills/commit/1e8ddba5ac6ea571b6d4dd293f5d80703a77abfe))
* **writing:** противопарковочная развилка given_as — до записи, не из предупреждения после ([#50](https://github.com/iskron-ai/skills/issues/50)) ([ae56441](https://github.com/iskron-ai/skills/commit/ae56441db45ea14a700c28e0671c4a42aa80da89))

## [3.4.5](https://github.com/iskron-ai/skills/compare/v3.4.4...v3.4.5) (2026-08-27)


### Bug Fixes

* **skills:** пачка полевых фидбэков — адресация человека, глухота слушателя, секрет сокета, inline-стрелки, брифинг из графа ([#46](https://github.com/iskron-ai/skills/issues/46)) ([e992b2e](https://github.com/iskron-ai/skills/commit/e992b2e4737a2aefa3f324162d58d3215386d996))

## [3.4.4](https://github.com/iskron-ai/skills/compare/v3.4.3...v3.4.4) (2026-08-27)


### Bug Fixes

* **bridge:** одна занятая дырка callback-порта не делает логин невозможным ([#43](https://github.com/iskron-ai/skills/issues/43)) ([b178e39](https://github.com/iskron-ai/skills/commit/b178e39413c56d42e17a6d011901820962755719))

## [3.4.3](https://github.com/iskron-ai/skills/compare/v3.4.2...v3.4.3) (2026-08-27)


### Bug Fixes

* **bridge:** сборка в каждой ошибке, часы сервера вместо машинных, три класса простоя закрыты ([#41](https://github.com/iskron-ai/skills/issues/41)) ([5547da8](https://github.com/iskron-ai/skills/commit/5547da8c2059ae0ea0a487a57be386f1ea2b04d0))

## [3.4.2](https://github.com/iskron-ai/skills/compare/v3.4.1...v3.4.2) (2026-08-26)


### Bug Fixes

* **plugin:** архив несёт граф-сервер; установка — всем харнессам и на уровень пользователя ([#39](https://github.com/iskron-ai/skills/issues/39)) ([9502535](https://github.com/iskron-ai/skills/commit/95025350825de7c805f0a07634080d17368730ba))

## [3.4.1](https://github.com/iskron-ai/skills/compare/v3.4.0...v3.4.1) (2026-08-26)


### Bug Fixes

* **bridge:** час токена паузит спекулятивное обновление, но не стоит стеной перед нужным ([#37](https://github.com/iskron-ai/skills/issues/37)) ([c63faac](https://github.com/iskron-ai/skills/commit/c63faacaa54a60dfd035b30a674e924d27c2d656))

## [3.4.0](https://github.com/iskron-ai/skills/compare/v3.3.2...v3.4.0) (2026-08-26)


### Features

* **collaborate:** сторож выхода-на-кадре отгружён, вход вернулся в тело, гейт стережёт обещанные файлы ([#35](https://github.com/iskron-ai/skills/issues/35)) ([46c21b1](https://github.com/iskron-ai/skills/commit/46c21b145b14520fe524d8cd2e3f75b6657c9259))

## [3.3.2](https://github.com/iskron-ai/skills/compare/v3.3.1...v3.3.2) (2026-08-25)


### Bug Fixes

* **bridge:** часы гранта берутся из самих токенов, логин тратится последним ([#32](https://github.com/iskron-ai/skills/issues/32)) ([421a087](https://github.com/iskron-ai/skills/commit/421a087e320424382d86b25fa35a22eeaabfd92f))

## [3.3.1](https://github.com/iskron-ai/skills/compare/v3.3.0...v3.3.1) (2026-08-25)


### Bug Fixes

* **bridge:** одно истечение — одно обновление гранта на машину ([#30](https://github.com/iskron-ai/skills/issues/30)) ([e7d26d3](https://github.com/iskron-ai/skills/commit/e7d26d3e554c0dfbfed499aa84aac4889b319cf8))

## [3.3.0](https://github.com/iskron-ai/skills/compare/v3.2.0...v3.3.0) (2026-08-24)


### Features

* мост держит флоу портом; поведенческие тесты, сверка поверхности, iskronify ([#27](https://github.com/iskron-ai/skills/issues/27)) ([ff6f4ac](https://github.com/iskron-ai/skills/commit/ff6f4acb6c0841388578a56fab90d62f1715acff))

## [3.2.0](https://github.com/iskron-ai/skills/compare/v3.1.1...v3.2.0) (2026-08-24)


### Features

* бригада, фидбэк и мост MCP; постановка будит стояние; архив плагина к релизу ([#24](https://github.com/iskron-ai/skills/issues/24)) ([2065cf4](https://github.com/iskron-ai/skills/commit/2065cf45521ab20e646cbafe1609d14302f06993))


### Bug Fixes

* **repo-boost:** не заводить HANDOVER.md — дома состояния ветки названы явно ([#25](https://github.com/iskron-ai/skills/issues/25)) ([b15b28a](https://github.com/iskron-ai/skills/commit/b15b28a0a68dd3130d68edeb35f80c0154089431))

## [3.1.1](https://github.com/iskron-ai/skills/compare/v3.1.0...v3.1.1) (2026-08-17)


### Bug Fixes

* **mcp:** no trailing slash ([#21](https://github.com/iskron-ai/skills/issues/21)) ([485beb1](https://github.com/iskron-ai/skills/commit/485beb1bf222a1d058f2a9383d95338ec629977e))

## [3.1.0](https://github.com/iskron-ai/skills/compare/v3.0.1...v3.1.0) (2026-08-14)


### Features

* **entry,collaborate,writing,design,repo-boost:** редакция скилла, две половины держания, sense на ребре, ворота фабрики, док-слот ([#19](https://github.com/iskron-ai/skills/issues/19)) ([4dd41d6](https://github.com/iskron-ai/skills/commit/4dd41d60cb5904766520c99733206d01a7b552db))

## [3.0.1](https://github.com/iskron-ai/skills/compare/v3.0.0...v3.0.1) (2026-08-09)


### Bug Fixes

* **collaborate,vahta:** держание сокета закрывается на hello и строке listening, а не на connect ([#16](https://github.com/iskron-ai/skills/issues/16)) ([ab5cfb7](https://github.com/iskron-ai/skills/commit/ab5cfb7ecd774e18a4a3e7f0d82a2404bce4c32d))

## [3.0.0](https://github.com/iskron-ai/skills/compare/v2.1.0...v3.0.0) (2026-08-08)


### ⚠ BREAKING CHANGES

* контракт шаблона поднят до 2 — конфиг без запрета меню неверен, репо со штампом 1 и ниже получают полную дугу.

### Features

* интеграция начинается с графа; начало не объявляется — совершается; вопрос — текстом ([#14](https://github.com/iskron-ai/skills/issues/14)) ([4a6def1](https://github.com/iskron-ai/skills/commit/4a6def1445b0ccbd821ef5621f44a3b509b06b3d))

## [2.1.0](https://github.com/iskron-ai/skills/compare/v2.0.0...v2.1.0) (2026-08-08)


### Features

* **vahta,collaborate:** сторож сокета — связь держится сама, делатель будится только на мёртвом токене ([#11](https://github.com/iskron-ai/skills/issues/11)) ([0f249d2](https://github.com/iskron-ai/skills/commit/0f249d2508c535bff5509325c340695860eb2b0c))


### Bug Fixes

* **collaborate,vahta:** факты сокета по коду службы — коды, вдох на 4003, поведение вместо кода, пинг из hello ([#13](https://github.com/iskron-ai/skills/issues/13)) ([d187948](https://github.com/iskron-ai/skills/commit/d187948675c67f72ee83959e09558a3f59d6a33a))

## [2.0.0](https://github.com/iskron-ai/skills/compare/v1.2.0...v2.0.0) (2026-08-08)


### ⚠ BREAKING CHANGES

* скилл on-duty заменён скиллом vahta.

### Features

* **skills:** «реалм» → «граф» в русской прозе ([#8](https://github.com/iskron-ai/skills/issues/8)) ([6f29892](https://github.com/iskron-ai/skills/commit/6f2989283a4d86ae257d0a6f11b871b96aedc50e))
* вахта, сотрудничество, repo-boost — цикл до интеграции и канал делателей ([#10](https://github.com/iskron-ai/skills/issues/10)) ([4925d62](https://github.com/iskron-ai/skills/commit/4925d625182fa7c8638bf9c94ffb0e6a37bc7f43))


### Bug Fixes

* **repo-boost:** последний хвост карта→роль в шаблоне ([583b060](https://github.com/iskron-ai/skills/commit/583b06027c6565f529c593f83f1e25292582d882))

## [1.2.0](https://github.com/iskron-ai/skills/compare/v1.1.0...v1.2.0) (2026-07-28)


### Features

* **repo-boost:** русская деривация четырёх references ([#5](https://github.com/iskron-ai/skills/issues/5)) ([fee1ab8](https://github.com/iskron-ai/skills/commit/fee1ab8edb77dc863cf916a3de2d62af86cfe7ff))

## [1.1.0](https://github.com/iskron-ai/skills/compare/v1.0.0...v1.1.0) (2026-07-28)


### Features

* release-please + русский SETUP.md с актуальными адресами ([#1](https://github.com/iskron-ai/skills/issues/1)) ([7ee6b30](https://github.com/iskron-ai/skills/commit/7ee6b30d56e99788a593302f74c610e86a31c26f))
* repo-boost (ex-align) + промежуточная дисциплина сверки реальности ([#4](https://github.com/iskron-ai/skills/issues/4)) ([ce0aad4](https://github.com/iskron-ai/skills/commit/ce0aad497245370186a501ec6e77aa63579ce893))
* **skills:** ритуал переноса — все скиллы пере-выведены из канона methodology по-русски ([#3](https://github.com/iskron-ai/skills/issues/3)) ([57a880e](https://github.com/iskron-ai/skills/commit/57a880ee3da265a2d6f417bcf6e5b8b0bed80799))
