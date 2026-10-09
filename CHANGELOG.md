# Changelog

## [7.8.0](https://github.com/iskron-ai/skills/compare/v7.7.0...v7.8.0) (2026-10-09)


### Features

* **bridge:** тулы, методы, логгеры, id и ключи сервера — из слоя поставки; шов и versionIn узнают продукт ([#391](https://github.com/iskron-ai/skills/issues/391)) ([e777734](https://github.com/iskron-ai/skills/commit/e7777340b1de645756a322ba0a750121a840a11c))
* **iskron:** ожидание карточкой — ack и исполнение, переспрос и агенту, строки на ключ карточки до ack нет ([#420](https://github.com/iskron-ai/skills/issues/420)) ([86dfea9](https://github.com/iskron-ai/skills/commit/86dfea9127f1a570c5552f723074117390e405f3))
* **opencode:** английская поверхность плагина OpenCode и pi; слова о детях — только о своих ([#402](https://github.com/iskron-ai/skills/issues/402)) ([7b00af8](https://github.com/iskron-ai/skills/commit/7b00af8be618b2221e551b8e6357826657ad6ea6))
* **skills:** make agent waits visible through ask cards ([#416](https://github.com/iskron-ai/skills/issues/416)) ([17cd1e3](https://github.com/iskron-ai/skills/commit/17cd1e32f213a4371f9fa2247e969385f63af479))
* **skills:** подхватывать своё имя после пробы держателю ([#415](https://github.com/iskron-ai/skills/issues/415)) ([fddc9b3](https://github.com/iskron-ai/skills/commit/fddc9b3a841206f987a27898b674e3c533e43627))


### Bug Fixes

* **bridge:** stop arming role inbox webhooks ([#417](https://github.com/iskron-ai/skills/issues/417)) ([7c2b0fc](https://github.com/iskron-ai/skills/commit/7c2b0fce9c6172b37e3884e601b0b334d5177169))
* **bridge:** своё имя — проба брату словом, чужое — словом человека; leave с чужим standing — отказ ([#419](https://github.com/iskron-ai/skills/issues/419)) ([b1f2691](https://github.com/iskron-ai/skills/commit/b1f26918f4b3b3a68ebad6f3c5442e60f8f41af6))
* **skills:** читать дела с досок ролей и мест ([#418](https://github.com/iskron-ai/skills/issues/418)) ([29b3f4a](https://github.com/iskron-ai/skills/commit/29b3f4ab87b0dd7e949c058febf6ed285ebaef50))

## [7.7.0](https://github.com/iskron-ai/skills/compare/v7.6.0...v7.7.0) (2026-10-08)


### Features

* **skills:** уборка каждым законченным куском — деревья, ветки, временные файлы, выход из дел; контракт 25 ([#410](https://github.com/iskron-ai/skills/issues/410)) ([fd138d7](https://github.com/iskron-ai/skills/commit/fd138d73844c9f94ecb0b9799a3b0e4af12fd279))


### Bug Fixes

* **bridge:** a login taken over from a killed bridge says its link and names the dead owner ([#405](https://github.com/iskron-ai/skills/issues/405)) ([f1fc629](https://github.com/iskron-ai/skills/commit/f1fc6297e99e2eb2519c337167f8802c51368c13))
* **bridge:** list_changed from the SSE of any answer reaches the harness once per change ([#6819](https://github.com/iskron-ai/skills/issues/6819)) ([#411](https://github.com/iskron-ai/skills/issues/411)) ([1f39191](https://github.com/iskron-ai/skills/commit/1f3919174d71e5211f5fbf69f52bc08d0b62b404))
* **bridge:** the plugin's resume takes back the seat its session's former bridge still holds, as iskron_stand does; overfull journals rotate to .1 ([#409](https://github.com/iskron-ai/skills/issues/409)) ([8aaa13e](https://github.com/iskron-ai/skills/commit/8aaa13ea5e9a8f4512ca6c597f9f48139afc8f42))
* **bridge:** возврат своего места не называет его чужим ([#413](https://github.com/iskron-ai/skills/issues/413)) ([7552169](https://github.com/iskron-ai/skills/commit/755216908fc708a63941d4890eac41635afa7e53))
* **iskronify:** видимый отказ не будит пуш и мерж; пуш только меток — по форме команды ([#404](https://github.com/iskron-ai/skills/issues/404)) ([4c94afa](https://github.com/iskron-ai/skills/commit/4c94afa944e3810bdc63c3d3c088a81ee95846f7))
* **iskronify:** готчи — строками в GOTCHAS.md, где его назначила «Раскладка», узел не обязателен (слово владельца) ([#408](https://github.com/iskron-ai/skills/issues/408)) ([9d516d1](https://github.com/iskron-ai/skills/commit/9d516d1fb2591bfd0fc4518a8cd9739363ce6c15))
* **iskronify:** маршрут отказа memory-guard — факты о коде и ловушки в граф, в AGENTS.md только конвенции, ритуалы и команды ([#407](https://github.com/iskron-ai/skills/issues/407)) ([bf4ad20](https://github.com/iskron-ai/skills/commit/bf4ad201d816d1cbcfb09ed03ca385b52724c2a4))
* **iskronify:** приветствие плагина OpenCode несёт то же, что SessionStart — вход в дело словом start и мост-спутник субагента ([#412](https://github.com/iskron-ai/skills/issues/412)) ([08ad385](https://github.com/iskron-ai/skills/commit/08ad385dd9c6e2bfc3143c75c83cfa94a3c75593))

## [7.6.0](https://github.com/iskron-ai/skills/compare/v7.5.0...v7.6.0) (2026-10-08)


### Features

* **assistant:** check abandoned work before calling its role ([#389](https://github.com/iskron-ai/skills/issues/389)) ([2c2294c](https://github.com/iskron-ai/skills/commit/2c2294c07ed74ad39155c65c2012e4905826ae4e))
* **iskronify:** memory-guard refuses with a route from slots, role files keep the repo tail; contract 24 ([#388](https://github.com/iskron-ai/skills/issues/388)) ([30176d5](https://github.com/iskron-ai/skills/commit/30176d5927a7ed08fdf06ee09ac48da5d3a7ba28))
* **skills:** вопрос человеку — карточкой ask, ответ — ack, адрес — стояние; строка дела — сводка ([#396](https://github.com/iskron-ai/skills/issues/396)) ([1319c39](https://github.com/iskron-ai/skills/commit/1319c39b653d1bc177dcef4bf046d5255c6ae51c))
* **skills:** связать моменты двери с ходами по графу ([#384](https://github.com/iskron-ai/skills/issues/384)) ([5c59710](https://github.com/iskron-ai/skills/commit/5c59710c2646affe0282014d5bc06d345051545b))


### Bug Fixes

* **bridge:** запись держания без сессии не делает своё место чужим ([#386](https://github.com/iskron-ai/skills/issues/386)) ([8d0a0e5](https://github.com/iskron-ai/skills/commit/8d0a0e577962a4a1d7cc40f9b31ae33a4eb77680))
* **iskronify:** готчи — узлом всегда, GOTCHAS.md лишь указатель на узлы (шаблон в ногу с Шагом 7) ([#394](https://github.com/iskron-ai/skills/issues/394)) ([96aa261](https://github.com/iskron-ai/skills/commit/96aa2619954d0929435295728a9f73f33bda751b))
* **iskronify:** холодное ревью в OpenCode — ручная изоляция отрешённым деревом ведущего, не «ревью не было» ([#399](https://github.com/iskron-ai/skills/issues/399)) ([e2c48fd](https://github.com/iskron-ai/skills/commit/e2c48fdad4f83507adb8b2d028d7907b94641596))
* **iskronify:** хук мержа в ногу с ритуалом (исключение работы по ссылке, модусы по свидетельству, «протки»); строка дела — сводка, не журнал на каждое действие ([#397](https://github.com/iskron-ai/skills/issues/397)) ([1d7bae1](https://github.com/iskron-ai/skills/commit/1d7bae163c3a902c6b878284b0a379062c1a39e5))
* **tests:** перевзвод после пачки лежалых и тред Codex ждут метки сторожа, а не печати и паузы ([#398](https://github.com/iskron-ai/skills/issues/398)) ([4d7590c](https://github.com/iskron-ai/skills/commit/4d7590c0aa21d2ce615a219a04f3846b56919210))

## [7.5.0](https://github.com/iskron-ai/skills/compare/v7.4.1...v7.5.0) (2026-10-08)


### Features

* **bridge:** поля по запросу, обрезка занятости, ключ события, свёртка строк ключа ([#374](https://github.com/iskron-ai/skills/issues/374)) ([d7a4216](https://github.com/iskron-ai/skills/commit/d7a42164b3a6af001b67dd0866e91dc1e3d715f7))
* **bridge:** роды вопроса в деле — ask, answer, ack и зов роли ([#379](https://github.com/iskron-ai/skills/issues/379)) ([0417fd5](https://github.com/iskron-ai/skills/commit/0417fd50a15d97fa677367835d4e1b0e13e61460))
* **evals:** пробы чтения графа — набор и протокол двух плеч ([#361](https://github.com/iskron-ai/skills/issues/361)) ([7bd3782](https://github.com/iskron-ai/skills/commit/7bd37821b24c3e84ce7b05f5592e6f523163ed15))
* **iskronify:** чужой код в контекст не берут — интеграция у стюарда или в графе; контракт 21 ([#358](https://github.com/iskron-ai/skills/issues/358)) ([5861a6f](https://github.com/iskron-ai/skills/commit/5861a6f4695756c496c64ce15c040d90f9540f72))
* **skills:** граф — место общей работы, дело — разговор; контракт 22 ([#362](https://github.com/iskron-ai/skills/issues/362)) ([e3b558f](https://github.com/iskron-ai/skills/commit/e3b558f2f3fc157b47e40f2795bb3ceb9ffec747))


### Bug Fixes

* **bridge:** doctor называет демон, команду записи, второй путь и отставание скиллов; место без имени не занимается ([#380](https://github.com/iskron-ai/skills/issues/380)) ([5e620da](https://github.com/iskron-ai/skills/commit/5e620daef0682e9e00ecd584b518d8ffeea3e466))
* **bridge:** своё место сессии мост возвращает сам; чужое — рядом со слухом, без подписи ([#363](https://github.com/iskron-ai/skills/issues/363)) ([1cde81b](https://github.com/iskron-ai/skills/commit/1cde81b4851e0943eac82b93483e29b9613a1ed2))
* **bridge:** такт внимания до последнего, пока ход занят ([#381](https://github.com/iskron-ai/skills/issues/381)) ([0aa761d](https://github.com/iskron-ai/skills/commit/0aa761dce8117d364deedbbc0ab1860932f32303))
* **bridge:** шум сторожа и заметки раскатки ([#372](https://github.com/iskron-ai/skills/issues/372)) ([b9a3412](https://github.com/iskron-ai/skills/commit/b9a3412b1b752d878cc2eb8856e83779bb07f1cf))
* **evals:** пробы чтения графа — по повторному ревью [#361](https://github.com/iskron-ai/skills/issues/361) ([#370](https://github.com/iskron-ai/skills/issues/370)) ([6ba53db](https://github.com/iskron-ai/skills/commit/6ba53db6f33393b30659c5ff8f8738ab5d0b26ff))
* **evals:** пробы чтения графа — по разбору первого прогона ([#378](https://github.com/iskron-ai/skills/issues/378)) ([c38e4f7](https://github.com/iskron-ai/skills/commit/c38e4f77daa66e6bef95f8b1ef84998b1ec61c37))
* **feedback:** адрес фидбэка — свой граф или @nks/feedback ([#371](https://github.com/iskron-ai/skills/issues/371)) ([327b336](https://github.com/iskron-ai/skills/commit/327b3366730c9b0f0030e7999266ca3a9a56292d))
* **iskronify:** «протки», не «проткай» ([#368](https://github.com/iskron-ai/skills/issues/368)) ([cc06b95](https://github.com/iskron-ai/skills/commit/cc06b95b4c5d258c8d0dabfb8ecd5c0188501927))
* **iskronify:** роли исполнения и ревью — на opus; контракт 23 ([#373](https://github.com/iskron-ai/skills/issues/373)) ([f737e48](https://github.com/iskron-ai/skills/commit/f737e487a4a5b3b8b1fbf6f95100bb7de3f6d0b8))
* **opencode:** плагин открывает чтение файлов скиллов поставки вне рабочей копии ([#376](https://github.com/iskron-ai/skills/issues/376)) ([00c2a8a](https://github.com/iskron-ai/skills/commit/00c2a8a3f86cd1eee1fdfb1637c60c5e0cd386fe))
* **setup,plugin:** http-записи нигде — только мост ([#369](https://github.com/iskron-ai/skills/issues/369)) ([f6456cf](https://github.com/iskron-ai/skills/commit/f6456cfb25894dfeb7e4c7a5a9ae8e46f7baa026))
* **skills,setup:** один путь к графу — мост ([#366](https://github.com/iskron-ai/skills/issues/366)) ([2a5458c](https://github.com/iskron-ai/skills/commit/2a5458c21c5f0218a2912f5dc58ee9bade5b5646))
* **skills:** foreign questions are not taken or held — filter by own mandate ([#357](https://github.com/iskron-ai/skills/issues/357)) ([60ec760](https://github.com/iskron-ai/skills/commit/60ec76071374ec152188bf4e4af1e1455635bf40))
* **skills:** второй и третий круги ревью [#362](https://github.com/iskron-ai/skills/issues/362) — в main ([#364](https://github.com/iskron-ai/skills/issues/364)) ([cfca7a0](https://github.com/iskron-ai/skills/commit/cfca7a07b876b4902a5f039b009e1859a88944fb))
* **standing:** одно pending в hello глухоты не доказывает — различает history и живое получение ([#365](https://github.com/iskron-ai/skills/issues/365)) ([322afa7](https://github.com/iskron-ai/skills/commit/322afa7ca1358843077e5941c0cda62263fb0870))
* **standing:** ребёнок без места корня — отказ ([#375](https://github.com/iskron-ai/skills/issues/375)) ([7f88727](https://github.com/iskron-ai/skills/commit/7f887271ca9b7c906d714d3b5c8ba9d5e5712499))
* **standing:** своё место без take=true; безымянного места мост не занимает ([#382](https://github.com/iskron-ai/skills/issues/382)) ([b2281c7](https://github.com/iskron-ai/skills/commit/b2281c7574b22e7c1f716c3405ec71c544e6ee28))
* **tests:** нестабильные пробы плагина OpenCode — причина, не ретрай ([#377](https://github.com/iskron-ai/skills/issues/377)) ([83ebebc](https://github.com/iskron-ai/skills/commit/83ebebcd20cecb3a5a55e420b926d272575f567c))

## [7.4.1](https://github.com/iskron-ai/skills/compare/v7.4.0...v7.4.1) (2026-10-07)


### Bug Fixes

* **bridge:** a daemon handover pauses satellites with live bridges instead of ending their runs ([#355](https://github.com/iskron-ai/skills/issues/355)) ([669a281](https://github.com/iskron-ai/skills/commit/669a2817f5bdb8067f27cb05ff58d311ff70fa02))
* **iskronify:** description ролей в образце delegation.md — в двойных кавычках ([#354](https://github.com/iskron-ai/skills/issues/354)) ([8c07d2c](https://github.com/iskron-ai/skills/commit/8c07d2c868aec1ad7934da04ddf489bfe158d72e))
* **iskronify:** memory-guard блокирует путь, не раскрывшийся за 8 переходов ссылок ([#353](https://github.com/iskron-ai/skills/issues/353)) ([a54f4d3](https://github.com/iskron-ai/skills/commit/a54f4d38191ab0321a973fa1c8845e983972851d))
* **iskronify:** образец ритуалов без id не глушит напоминания; свой мост роли — харнесс-нейтрально ([#350](https://github.com/iskron-ai/skills/issues/350)) ([e1508d9](https://github.com/iskron-ai/skills/commit/e1508d91583811fc4fc22ae49f5913bff51ba506))
* **opencode:** the permission word says only the human answers, in the child's session window ([#351](https://github.com/iskron-ai/skills/issues/351)) ([60f7e3e](https://github.com/iskron-ai/skills/commit/60f7e3ebdd6151e8810d0288571d6156c5e37e2c))

## [7.4.0](https://github.com/iskron-ai/skills/compare/v7.3.0...v7.4.0) (2026-10-06)


### Features

* **iskronify:** Шаг 4 — проверка плагинов ритуалов OpenCode check-rituals; контракт 20 ([#342](https://github.com/iskron-ai/skills/issues/342)) ([273962e](https://github.com/iskron-ai/skills/commit/273962e9ba60e7b6e8592422ea634a559893da0d))
* **opencode:** родитель слышит, что субагент ждёт разрешения или прерван ([#346](https://github.com/iskron-ai/skills/issues/346)) ([b176ef4](https://github.com/iskron-ai/skills/commit/b176ef4afbe1ad3f0b5ed664b4efe5a715c919f7))


### Bug Fixes

* **cli:** check-rituals --help и неверный путь без стектрейса ([#344](https://github.com/iskron-ai/skills/issues/344)) ([ece2444](https://github.com/iskron-ai/skills/commit/ece2444874bde8dc7eccf9e8c3060b38ac417790))
* **cli:** version без дефисов — подкоманда; check-rituals понимает -- ([#349](https://github.com/iskron-ai/skills/issues/349)) ([72a3bd0](https://github.com/iskron-ai/skills/commit/72a3bd0e59e5a45f4a0c97f0517a918f295e40f1))
* **opencode,bridge:** место ведёт экземпляр точного написания каталога, близнец будит выгруженного ([#341](https://github.com/iskron-ai/skills/issues/341)) ([41463a4](https://github.com/iskron-ai/skills/commit/41463a457a81ce74aaf42d9cf6ce6690f1d3d515))
* **skills:** establish-mcp — код входа до своего срока, мост без открытой ссылки уходит по SIGTERM ([#348](https://github.com/iskron-ai/skills/issues/348)) ([f5ae70c](https://github.com/iskron-ai/skills/commit/f5ae70c889ce28cf24f0c5338bb03ba0314b6654))

## [7.3.0](https://github.com/iskron-ai/skills/compare/v7.2.8...v7.3.0) (2026-10-06)


### Features

* **bridge:** поля structuredContent вместо прозы, где сервер их даёт ([#335](https://github.com/iskron-ai/skills/issues/335)) ([937c111](https://github.com/iskron-ai/skills/commit/937c111a0ccca21b5c19758e0889a151357e0737))


### Bug Fixes

* **bridge,skills:** место вернулось после долгой выгрузки — проверить дела ([#333](https://github.com/iskron-ai/skills/issues/333)) ([888db50](https://github.com/iskron-ai/skills/commit/888db505379988574359877cc6de5098fec3e771))
* **bridge:** код входа живёт свой срок целиком, ожидание входа выходит по SIGTERM ([#339](https://github.com/iskron-ai/skills/issues/339)) ([7ef493c](https://github.com/iskron-ai/skills/commit/7ef493c07c771f87790c50906686bb4126d2ba6a))
* **bridge:** неполные поля сервера (dropped, incomplete) — в прозу ([#336](https://github.com/iskron-ai/skills/issues/336)) ([3d53826](https://github.com/iskron-ai/skills/commit/3d53826672ca14d0d32a89340129c2d116692ce3))
* **ci,opencode:** замок выходов — коммиттер выпуска и база без before; проба marker-child без гонки ([#332](https://github.com/iskron-ai/skills/issues/332)) ([7756880](https://github.com/iskron-ai/skills/commit/77568804daa37112ea313f9232244b778984003c))
* **iskronify:** плагин ритуалов пишет только в сессии своего каталога — проба и ревизор ([#340](https://github.com/iskron-ai/skills/issues/340)) ([06da1c9](https://github.com/iskron-ai/skills/commit/06da1c91e4e4e16c1ae9d6251bf7e3861a037ac3))
* **iskronify:** ритуалы OpenCode — только сессии своего каталога ([#338](https://github.com/iskron-ai/skills/issues/338)) ([7643441](https://github.com/iskron-ai/skills/commit/7643441fb997542f5bc58ca5e24ace31c18129ed))
* **opencode:** ведущий кончен с «КОНЧЕН» — его вызовы отказ, пока мост кончает прогон ([#343](https://github.com/iskron-ai/skills/issues/343)) ([5add109](https://github.com/iskron-ai/skills/commit/5add10997363e64df5ec2c65e4dd9217452a9a1d))
* **opencode:** КОНЧЕН сразу, неудача снятия места — отдельным словом без пробуждения ([#337](https://github.com/iskron-ai/skills/issues/337)) ([1e58da3](https://github.com/iskron-ai/skills/commit/1e58da3429fcd3e1a1bd4340d8ab4b8ae2ee99df))
* **opencode:** место держит каталог загруженным — побудки доходят ночью ([#334](https://github.com/iskron-ai/skills/issues/334)) ([c88ff48](https://github.com/iskron-ai/skills/commit/c88ff4815d72719c7727a236645ef97b31a215c0))
* **skills:** бот не встал — область его привязки, не членство ([#331](https://github.com/iskron-ai/skills/issues/331)) ([381d0db](https://github.com/iskron-ai/skills/commit/381d0db6802981dc7f3a33a8459235af05eeaf92))
* **skills:** владелец достижим — привязка его роли к человеку проверяется ([#329](https://github.com/iskron-ai/skills/issues/329)) ([5427b23](https://github.com/iskron-ai/skills/commit/5427b2355d6fe379a5e49087abe7936fa78a6d62))

## [7.2.8](https://github.com/iskron-ai/skills/compare/v7.2.7...v7.2.8) (2026-10-03)


### Bug Fixes

* **bridge:** запись держания переживает уход сессии — срок от ухода сокета, уборка соседа её не стирает ([#326](https://github.com/iskron-ai/skills/issues/326)) ([bc0c7e2](https://github.com/iskron-ai/skills/commit/bc0c7e2f8af0c28132d6a1983752f4145e91134c))
* **opencode,bridge:** без потолка простоя, отмена кончает спутника, dev-сборка не трогает дом ([#325](https://github.com/iskron-ai/skills/issues/325)) ([a4d5160](https://github.com/iskron-ai/skills/commit/a4d5160423109d4a1a37a29757baa642a1c4dfc5))
* **opencode,bridge:** ведущий кончается словом на evicted, пауза спутника до срока держания, main несёт сборку выпуска ([#328](https://github.com/iskron-ai/skills/issues/328)) ([12b942c](https://github.com/iskron-ai/skills/commit/12b942c5bece8bd0990645784a0f7de2505768a0))

## [7.2.7](https://github.com/iskron-ai/skills/compare/v7.2.6...v7.2.7) (2026-10-03)


### Bug Fixes

* **bridge:** доска и хуки читаются на обоих языках сервера ([#323](https://github.com/iskron-ai/skills/issues/323)) ([b8bc206](https://github.com/iskron-ai/skills/commit/b8bc2065ad9588abbcfe27c5770e62c6442d62ca))
* **bridge:** заданный клиент входа по коду отвергнут — отказ, не подмена ([#320](https://github.com/iskron-ai/skills/issues/320)) ([ed29cd8](https://github.com/iskron-ai/skills/commit/ed29cd8aeba54b9004ba0f12899191b34bde348b))
* **bridge:** своё close канала — одно слово на двух языках; занятость при занятии места называет место ([#322](https://github.com/iskron-ai/skills/issues/322)) ([4e8a718](https://github.com/iskron-ai/skills/commit/4e8a718459757e0150a7ec03ae6f35a917ecd7e9))
* **bridge:** сторож после своего close или revoke выходит нулём словом моста ([#324](https://github.com/iskron-ai/skills/issues/324)) ([fae6006](https://github.com/iskron-ai/skills/commit/fae600667dd1fb8429ef98a5e9779fd48bde82b3))

## [7.2.6](https://github.com/iskron-ai/skills/compare/v7.2.5...v7.2.6) (2026-10-03)


### Bug Fixes

* **bridge:** мост говорит языком поверхности ([#311](https://github.com/iskron-ai/skills/issues/311)) ([8c40523](https://github.com/iskron-ai/skills/commit/8c40523b25e0f5919971597432fc5e33468db28e))
* **opencode:** род 主 без отката на шапку, чужой маркер по старту процесса ([#316](https://github.com/iskron-ai/skills/issues/316)) ([92570ef](https://github.com/iskron-ai/skills/commit/92570ef22a5ab5074cb71e3dbe5c896191b72150))

## [7.2.5](https://github.com/iskron-ai/skills/compare/v7.2.4...v7.2.5) (2026-10-03)


### Bug Fixes

* **opencode:** «?» — чтение только у тулов с action ([#317](https://github.com/iskron-ai/skills/issues/317)) ([7c1d0d3](https://github.com/iskron-ai/skills/commit/7c1d0d3048fb7e41f145f40132a5c55564995aed))

## [7.2.4](https://github.com/iskron-ai/skills/compare/v7.2.3...v7.2.4) (2026-10-03)


### Bug Fixes

* **opencode,bridge:** запуск под корнем без места, слово о потере слуха только своё, род роли через поиск ([#314](https://github.com/iskron-ai/skills/issues/314)) ([05d3140](https://github.com/iskron-ai/skills/commit/05d314027df363e6d303eab3ac9ea5cb82cb7273))

## [7.2.3](https://github.com/iskron-ai/skills/compare/v7.2.2...v7.2.3) (2026-10-03)


### Bug Fixes

* **opencode,bridge:** роль владельца, запись ребёнка только спутником, передача демона, перенос с детьми ([#312](https://github.com/iskron-ai/skills/issues/312)) ([53798a1](https://github.com/iskron-ai/skills/commit/53798a10acc2712738f650898930abb93f65838a))

## [7.2.2](https://github.com/iskron-ai/skills/compare/v7.2.1...v7.2.2) (2026-10-03)


### Bug Fixes

* **bridge:** ответ занятости называет место, а не ключ записи ([#300](https://github.com/iskron-ai/skills/issues/300)) ([86488bc](https://github.com/iskron-ai/skills/commit/86488bc6c5496f224a3862876787ab28a08d9512))
* **bridge:** повтор статуса на закрытом соединении, занятость рядом до hello ([#310](https://github.com/iskron-ai/skills/issues/310)) ([63b0269](https://github.com/iskron-ai/skills/commit/63b02697d1d1d1487929d44d39caa1dd1a91b0b2))
* **opencode,bridge:** перенос сессии, пауза ребёнка без ложного take, КОНЧЕН вставкой ([#308](https://github.com/iskron-ai/skills/issues/308)) ([56a141a](https://github.com/iskron-ai/skills/commit/56a141a37b72ef399dff23030166d710bb4613a9))

## [7.2.1](https://github.com/iskron-ai/skills/compare/v7.2.0...v7.2.1) (2026-10-02)


### Bug Fixes

* **opencode,bridge:** хвост ведущего субагента и возврат места по своей локации ([#306](https://github.com/iskron-ai/skills/issues/306)) ([6cd6dd7](https://github.com/iskron-ai/skills/commit/6cd6dd787ffc9b0a6c5ab7c7f9c61456c04b1609))

## [7.2.0](https://github.com/iskron-ai/skills/compare/v7.1.0...v7.2.0) (2026-10-02)


### Features

* **opencode:** ведущий субагент — конец по уходу, кадры свои, итог родителю ([#304](https://github.com/iskron-ai/skills/issues/304)) ([9dae7e2](https://github.com/iskron-ai/skills/commit/9dae7e2bee6259c4916141e21d2a19f179164827))

## [7.1.0](https://github.com/iskron-ai/skills/compare/v7.0.0...v7.1.0) (2026-10-02)


### Features

* **bridge:** вход с другого устройства — код и ссылка страницы входа (RFC 8628) ([#298](https://github.com/iskron-ai/skills/issues/298)) ([83e37de](https://github.com/iskron-ai/skills/commit/83e37de6b48589cf771760c9e26592ff051a0198))


### Bug Fixes

* **bridge:** демон без сессий не ждёт брошенный вход дольше предела ([#302](https://github.com/iskron-ai/skills/issues/302)) ([f617b19](https://github.com/iskron-ai/skills/commit/f617b193e706c65f891cac26183579154057e2bb))

## [7.0.0](https://github.com/iskron-ai/skills/compare/v6.25.0...v7.0.0) (2026-10-02)


### ⚠ BREAKING CHANGES

* **bridge:** демон машины по умолчанию; ISKRON_BRIDGE_DAEMON=0 — полный мост ([#299](https://github.com/iskron-ai/skills/issues/299))
* **bridge,iskronify:** форма записи моста-спутника в ролевых файлах сменилась; выровненным репо нужен перегон iskronify (контракт 18).
* **bridge,delegation:** своя запись моста-спутника у каждого ролевого файла, выбор .sub-N под заявкой машины; контракт iskronify 17 ([#267](https://github.com/iskron-ai/skills/issues/267))

### Features

* **bridge,iskronify:** doctor чинит субагентов сам; единая форма записи моста-спутника node -e; контракт iskronify 18 ([#273](https://github.com/iskron-ai/skills/issues/273)) ([c17cf03](https://github.com/iskron-ai/skills/commit/c17cf0340a46b140a33dc64e8e0a86bb3c10dce9))
* **bridge,iskronify:** флаг --tools у моста и схема iskron_channel без ходов над местом ([#282](https://github.com/iskron-ai/skills/issues/282)) ([94d088d](https://github.com/iskron-ai/skills/commit/94d088df0f03aba397358c67d8662a9df7d1d516))
* **bridge,opencode,pi:** расход места — поля токенов и модель, снимок до выхода, спутник своим местом ([#297](https://github.com/iskron-ai/skills/issues/297)) ([fcf6c8b](https://github.com/iskron-ai/skills/commit/fcf6c8b41cbe73dacf8c752fe5ecc13bc5ab02f9))
* **bridge,opencode,pi:** расход сессии и полнота контекста в attrs места ([#254](https://github.com/iskron-ai/skills/issues/254)) ([bee7f0a](https://github.com/iskron-ai/skills/commit/bee7f0a23922cd2740e486665145bf5d8536b42c))
* **bridge,opencode,pi:** стояние объявляет установленный набор скиллов и версию хоста ([#257](https://github.com/iskron-ai/skills/issues/257)) ([19df489](https://github.com/iskron-ai/skills/commit/19df48929b3e21b8e54ec2e1c755f053aa3e316b))
* **bridge:** демон машины по умолчанию; ISKRON_BRIDGE_DAEMON=0 — полный мост ([#299](https://github.com/iskron-ai/skills/issues/299)) ([ae9da3d](https://github.com/iskron-ai/skills/commit/ae9da3d68708cdd251ee2978e60ce7c660f5f293))
* **bridge:** демон машины, шаг 2 — сессии в своих областях, обновление только демоном, переотправка непринятого (за флагом) ([#280](https://github.com/iskron-ai/skills/issues/280)) ([b23e148](https://github.com/iskron-ai/skills/commit/b23e148db8b8eaa633fc9403657e7b7e6a399553))
* **bridge:** занятость ставит iskron_stand(status) на держимом месте — без доски, connect, register, хука и стука ([#279](https://github.com/iskron-ai/skills/issues/279)) ([2a7afaf](https://github.com/iskron-ai/skills/commit/2a7afaf6413959ca94c87f8dae9ce20606006d59))
* **bridge:** тонкий мост и шов к демону машины, шаг 1 — за флагом ISKRON_BRIDGE_DAEMON ([#272](https://github.com/iskron-ai/skills/issues/272)) ([2bc0cb1](https://github.com/iskron-ai/skills/commit/2bc0cb141012d74a59ab9d30b6ffc0255a9962b8))
* **delegation:** роли weaver и searcher — ткач догоняет граф после события работы, поиск отвечает, что граф знает; reader на sonnet ([#274](https://github.com/iskron-ai/skills/issues/274)) ([c10e531](https://github.com/iskron-ai/skills/commit/c10e5318907deb98a619be31d8c96210e5dad753))
* **delegation:** свой мост-спутник у каждого субагента; запуск на мосту позвавшего не допускается ([#261](https://github.com/iskron-ai/skills/issues/261)) ([8e387f7](https://github.com/iskron-ai/skills/commit/8e387f795444b58d1656545dfe51ad6929394204))
* **iskron,vahta,standing:** работа субагентами в любой сессии, вход по доле, занятое место, тело PR минимально ([#290](https://github.com/iskron-ai/skills/issues/290)) ([959557b](https://github.com/iskron-ai/skills/commit/959557b1cdd1e42231ac91b01046eb61450c169d))
* **iskronify:** контракт 19 — прогон без человека, кроме принципиального; обложка — фронтматтер ([#284](https://github.com/iskron-ai/skills/issues/284)) ([37c97f5](https://github.com/iskron-ai/skills/commit/37c97f519c6e6d9f6a2aa53852152df46002c90b))
* **iskronify:** роль designer ведёт прогон iskronify; умолчание раскладки по [#6412](https://github.com/iskron-ai/skills/issues/6412); AGENTS.md под шаблон (контракт 18) ([#275](https://github.com/iskron-ai/skills/issues/275)) ([5c20c92](https://github.com/iskron-ai/skills/commit/5c20c9264a3ab22bf23caa324f7819215227b397))
* **skills:** законы дела в двери iskron — группа в дочернем деле, вход сводкой, выход по исходу ([#285](https://github.com/iskron-ai/skills/issues/285)) ([019abb6](https://github.com/iskron-ai/skills/commit/019abb69101a1e39a33edd732fadee51e36d331a))
* **skills:** сжатие, волна 2 — standing, vahta, chief-of-staff ([#250](https://github.com/iskron-ai/skills/issues/250)) ([3bfedb7](https://github.com/iskron-ai/skills/commit/3bfedb70412c3d0c1b468bb7ebb59e24c6b6446f))
* **widgets:** скилл виджетов окна собирается из узлов договора; make widgets и check-widgets ([#255](https://github.com/iskron-ai/skills/issues/255)) ([c30e0eb](https://github.com/iskron-ai/skills/commit/c30e0eb2976d843142b260f8713ace957c86769b))


### Bug Fixes

* **architect,iskronify:** ткач ведёт ткачество, ведущий принимает перечитыванием узлов; смысл кода — в граф, навигация — README компонента ([#271](https://github.com/iskron-ai/skills/issues/271)) ([cd37f78](https://github.com/iskron-ai/skills/commit/cd37f78540d316d6f2ae8adfc908ef1faae533db))
* **assistant:** раздел «Карта», граница дел и место, которое держит среда ([#256](https://github.com/iskron-ai/skills/issues/256)) ([1ebd472](https://github.com/iskron-ai/skills/commit/1ebd472577d1cee36c69d8d313ce04622188bbf6))
* **bridge,delegation:** своя запись моста-спутника у каждого ролевого файла, выбор .sub-N под заявкой машины; контракт iskronify 17 ([#267](https://github.com/iskron-ai/skills/issues/267)) ([20409c4](https://github.com/iskron-ai/skills/commit/20409c41a13da4ec8b9709b93625e9c37721cdda))
* **bridge,opencode,pi,watchdog:** законы дела в доставке — в ход адресованное месту, прочее счётом; спутник выходит из дел концом прогона ([#287](https://github.com/iskron-ai/skills/issues/287)) ([6e28e5a](https://github.com/iskron-ai/skills/commit/6e28e5abc8b2e8feca693636865218bc425fdf8d))
* **bridge,opencode:** место-спутник живёт прогоном — конец прогона и уход словом отпускают его целиком ([#258](https://github.com/iskron-ai/skills/issues/258)) ([cb550fb](https://github.com/iskron-ai/skills/commit/cb550fb1a4199ed2139a35db5aeacf67c5a6bec7))
* **bridge,watchdog:** сторож переживает SIGTERM демона, когда место возвращается ([#291](https://github.com/iskron-ai/skills/issues/291)) ([9e21d15](https://github.com/iskron-ai/skills/commit/9e21d15f330dba98d96c8ab4d45aa078ec16fe98))
* **bridge:** update и фоновая сверка не глохнут на лимите GitHub API — тег со страницы релизов, память лимита, повтор к сбросу ([#268](https://github.com/iskron-ai/skills/issues/268)) ([45f8f4e](https://github.com/iskron-ai/skills/commit/45f8f4e2cdb9db8eec9f8ccea40fce2d92c9ead6))
* **bridge:** голова пачки кадров дела без подсказки про «старый тул без since» ([#260](https://github.com/iskron-ai/skills/issues/260)) ([71dbd22](https://github.com/iskron-ai/skills/commit/71dbd22915e692c07872cbc13212897e06bb5fc5))
* **bridge:** занятое место — не предлагать и вести вперёд, а не к человеку ([#294](https://github.com/iskron-ai/skills/issues/294)) ([84cd301](https://github.com/iskron-ai/skills/commit/84cd30124e2b1a5393c16260e65b66e86c111453))
* **bridge:** кадр, принятый сокетом уходящего демона, доходит после смены ([#289](https://github.com/iskron-ai/skills/issues/289)) ([1f3fa1f](https://github.com/iskron-ai/skills/commit/1f3fa1f5f56fc9eaacbe6c4066fa012825889f53))
* **bridge:** остатки ревью передачи места; спутник уходит с места при смене демона ([#296](https://github.com/iskron-ai/skills/issues/296)) ([e29537b](https://github.com/iskron-ai/skills/commit/e29537bd17ae02b8e5858389bb545dc925ecdaaf))
* **bridge:** слова человека в полёте и адресованное — по делу и нумерации записи ([#293](https://github.com/iskron-ai/skills/issues/293)) ([7a25064](https://github.com/iskron-ai/skills/commit/7a25064d385052334f3d3bc62e24159977b06d32))
* **bridge:** сокет при длинном --auth-dir; без гранта — не ходить на сервер, пока вход ждёт ([#252](https://github.com/iskron-ai/skills/issues/252)) ([275f9d4](https://github.com/iskron-ai/skills/commit/275f9d4c47da488462c578a798b3b667e9f2d1a9))
* **intake,iskron:** внешнее слово сверяется с графом и делами прежде передачи ([#264](https://github.com/iskron-ai/skills/issues/264)) ([ca6dd37](https://github.com/iskron-ai/skills/commit/ca6dd37edbaf985ba5ccb9c2413808a1d9d61cb8))
* **iskron,weaving,architect:** работа не закрыта, пока граф её не догнал; тема — свой ключ; сводка — состояние ([#266](https://github.com/iskron-ai/skills/issues/266)) ([2f46543](https://github.com/iskron-ai/skills/commit/2f465434ab3f9dec0068654b34d4477eb2ac13fa))
* **iskronify:** пуш одних меток выпуска не будит ревью ветки ([#295](https://github.com/iskron-ai/skills/issues/295)) ([0bf485d](https://github.com/iskron-ai/skills/commit/0bf485d6761de6e41c5c6fc78ada11c5ffb5d951))
* **iskronify:** фильтр тихого пуша по состоянию git; роль reviewer о чистом брифе ([#281](https://github.com/iskron-ai/skills/issues/281)) ([6a278f5](https://github.com/iskron-ai/skills/commit/6a278f5cc5b5e63f1b91e71dce5d21070153c41d))
* **iskronify:** человек без места — зов его роли в дело выравнивания; к роли выше — только если она есть ([#259](https://github.com/iskron-ai/skills/issues/259)) ([154c0dd](https://github.com/iskron-ai/skills/commit/154c0dd3c08901eb3ea6f7c40482d3a8fc97f868))
* **iskron:** слово не твоё — сперва реши, чьё: не по предмету — автору, делать нечего — спроси ведущего и выйди ([#277](https://github.com/iskron-ai/skills/issues/277)) ([1e6de1a](https://github.com/iskron-ai/skills/commit/1e6de1a703b59457ca120ef89d74ec76fabead29))
* **iskron:** читатель дела сразу говорит автору, что слово не по предмету ([#276](https://github.com/iskron-ai/skills/issues/276)) ([b0cbbaa](https://github.com/iskron-ai/skills/commit/b0cbbaa362734b440455f03a2b313748cde591ae))
* **setup:** плоское обновление поставки — повторный add --all, не update ([#283](https://github.com/iskron-ai/skills/issues/283)) ([5ba26d7](https://github.com/iskron-ai/skills/commit/5ba26d788c5143d4b8f77f7179d3c8c42b1937eb))
* **skills:** architect делит дело волны по предметам ([#292](https://github.com/iskron-ai/skills/issues/292)) ([19e774e](https://github.com/iskron-ai/skills/commit/19e774e4c54d8595661f072d2ef2a695b52793f8))
* **skills:** санкция на тег — на строке стюарда, доля в деле — у автора ([#288](https://github.com/iskron-ai/skills/issues/288)) ([69e60ed](https://github.com/iskron-ai/skills/commit/69e60ed52316a31425729015a7eb0f2f9c2e90f8))
* **skills:** читать граф как структуру, а не поиск ([#253](https://github.com/iskron-ai/skills/issues/253)) ([a74f2ad](https://github.com/iskron-ai/skills/commit/a74f2ad1f156c7a16ecc2342f1d5c9d32c536313))
* **standing,chief-of-staff:** talk с about — дело пары о предмете ([#269](https://github.com/iskron-ai/skills/issues/269)) ([327fa62](https://github.com/iskron-ai/skills/commit/327fa623b3b24650893aa12132146749e60aee40))
* **vahta:** свои строки и долги — по событиям и в три момента; строка работы открыта, пока граф не догнал ([#265](https://github.com/iskron-ai/skills/issues/265)) ([33b62cc](https://github.com/iskron-ai/skills/commit/33b62ccc6b9216fbd2fc26aeb36acabbc98170f0))

## [6.25.0](https://github.com/iskron-ai/skills/compare/v6.24.0...v6.25.0) (2026-09-28)


### Features

* **assistant:** скилл ассистента — сводка дел и единая точка управления ([#248](https://github.com/iskron-ai/skills/issues/248)) ([2314757](https://github.com/iskron-ai/skills/commit/231475770b2dcc8b5c71f65db8e90f6bfbea4298))
* **establish-mcp:** сжатие — doctor, вход, use, update, Codex ([#247](https://github.com/iskron-ai/skills/issues/247)) ([78b3f56](https://github.com/iskron-ai/skills/commit/78b3f5612d64e6116b65b1670f14bd32d85199f8))
* **skills:** сжатие, волна 1 — iskron, entry, writing, architect, AGENTS.md и REALITY.md, контракт 16 ([#246](https://github.com/iskron-ai/skills/issues/246)) ([f3ec271](https://github.com/iskron-ai/skills/commit/f3ec271add9c88d4c96c341334346bad91bf87e6))

## [6.24.0](https://github.com/iskron-ai/skills/compare/v6.23.0...v6.24.0) (2026-09-28)


### Features

* **iskronify:** согласование слотов — делом на контуре репо, контракт 15 ([#242](https://github.com/iskron-ai/skills/issues/242)) ([7d79dc0](https://github.com/iskron-ai/skills/commit/7d79dc069eeaa501e32d0787cfc04a21ce5f81de))
* **skills:** открытые дела — в обзоре контура и в at ([#236](https://github.com/iskron-ai/skills/issues/236)) ([a1eb8f1](https://github.com/iskron-ai/skills/commit/a1eb8f17964b406bf970fcdbd4ee1df7b63d709b))
* **skills:** работа через дела — поручение в деле, строки по вещам, контракт AGENTS.md 14 ([#240](https://github.com/iskron-ai/skills/issues/240)) ([7ec1ad7](https://github.com/iskron-ai/skills/commit/7ec1ad700ff6e1cdd44f8f5c59f7aed75c381084))


### Bug Fixes

* **bridge:** место возвращается без хода агента, совет на 4001 — connect, initialize без старой сессии ([#241](https://github.com/iskron-ai/skills/issues/241)) ([57eeff2](https://github.com/iskron-ai/skills/commit/57eeff2e77325af61ce1af6bd71a29df4b10ab97))
* **iskronify:** зазор хука мержа назван — мерж на форже и ворктри ([#239](https://github.com/iskron-ai/skills/issues/239)) ([dee43a9](https://github.com/iskron-ai/skills/commit/dee43a9d281efb7469b2dd3e600c4251a292177d))
* **iskronify:** подтяжка ствола в хуке мержа — якорь команды и «;» ([#244](https://github.com/iskron-ai/skills/issues/244)) ([526c98b](https://github.com/iskron-ai/skills/commit/526c98b79ba741a1987f48ad6deeb21f075890eb))
* **iskronify:** фильтры хуков пуша и мержа будят по исходу ([#243](https://github.com/iskron-ai/skills/issues/243)) ([4ac0b4a](https://github.com/iskron-ai/skills/commit/4ac0b4a23e4057a7dd5ce7a40549bb266d31cc1a))
* **skills:** журнал дела — место SHA и провенанса; файл сессии — запасной путь ([#245](https://github.com/iskron-ai/skills/issues/245)) ([1ad3e34](https://github.com/iskron-ai/skills/commit/1ad3e34e767ff59cac49fbb5b01f394cf6a44865))

## [6.23.0](https://github.com/iskron-ai/skills/compare/v6.22.0...v6.23.0) (2026-09-26)


### Features

* дело «№N» в room и подсказке моста; слово вышедшему адресату — целиком ([#235](https://github.com/iskron-ai/skills/issues/235)) ([a5b8475](https://github.com/iskron-ai/skills/commit/a5b8475fb4eaea58a622d8c90e7809ff65d7e745))


### Bug Fixes

* **vahta:** своё «было» в деле закрывается строкой ok, как только исход наблюдён ([#233](https://github.com/iskron-ai/skills/issues/233)) ([42ccbe2](https://github.com/iskron-ai/skills/commit/42ccbe283d07fb8c23e9626a33f23c77fb950ee5))

## [6.22.0](https://github.com/iskron-ai/skills/compare/v6.21.0...v6.22.0) (2026-09-26)


### Features

* **skills:** слово — в дело своего предмета, ответ — в дело, откуда пришло ([#226](https://github.com/iskron-ai/skills/issues/226)) ([f6007fb](https://github.com/iskron-ai/skills/commit/f6007fb3527535b8210eb08c5b1f6c6aea75d546))


### Bug Fixes

* **bridge:** прозрачное переоткрытие обновляет кэш initialize ([#230](https://github.com/iskron-ai/skills/issues/230)) ([d7376fc](https://github.com/iskron-ai/skills/commit/d7376fc5e95eb24cbf8e74aab50dc994ca08e23e))
* **establish-mcp:** не звать, когда транспорт уже есть — ответил хоть один iskron_*; описание короче 900 байт ([#228](https://github.com/iskron-ai/skills/issues/228)) ([6dba2ac](https://github.com/iskron-ai/skills/commit/6dba2ac286c2e7c9a09f644e08b86c786254c792))
* **establish-mcp:** описание короче 900 байт — триггеры целы ([#232](https://github.com/iskron-ai/skills/issues/232)) ([02ad66f](https://github.com/iskron-ai/skills/commit/02ad66f03f7f89203325a8e3f50967cd42d6fd78))
* **standing:** кому и на что — полями to и in_reply_to, не обращением в тексте ([#231](https://github.com/iskron-ai/skills/issues/231)) ([b5dff74](https://github.com/iskron-ai/skills/commit/b5dff744fc8bb781b1936c70b48b2cbe7f0475e9))
* **vahta:** семя при делах — без журнала и истории дел, живые дела строкой ([#229](https://github.com/iskron-ai/skills/issues/229)) ([d55509e](https://github.com/iskron-ai/skills/commit/d55509e9aae87531b7da4cbe2ea22f5fb5241866))

## [6.21.0](https://github.com/iskron-ai/skills/compare/v6.20.0...v6.21.0) (2026-09-26)


### Features

* **bridge:** короткий кадр дела; адресное слово не мне — одной строкой без побудки ([#224](https://github.com/iskron-ai/skills/issues/224)) ([94e72eb](https://github.com/iskron-ai/skills/commit/94e72eb4cbb407c6f3e8422fe8aa652dd5f8f6d3))

## [6.20.0](https://github.com/iskron-ai/skills/compare/v6.19.0...v6.20.0) (2026-09-26)


### Features

* **bridge:** субагент своим местом в роли запускающего; OpenCode — дочерняя сессия спутником; строка запуска с делом ([#221](https://github.com/iskron-ai/skills/issues/221)) ([146578a](https://github.com/iskron-ai/skills/commit/146578a9e6c437fa26d22ef87f6ccbbbb926e8ab))
* запуск в дело строкой запуска — pi и OpenCode входят сами; мост по-английски на *.ai; строка гроссбуха по канону ([#223](https://github.com/iskron-ai/skills/issues/223)) ([fdccf6d](https://github.com/iskron-ai/skills/commit/fdccf6d1aab30548acaa7c9975ef51e5a49ad312))


### Bug Fixes

* **skills:** «комната» в смысле общей работы — «дело»; человеку — «место», «вопрос», «сообщение» ([#218](https://github.com/iskron-ai/skills/issues/218)) ([defedfa](https://github.com/iskron-ai/skills/commit/defedfa9e18d1f01585cfbdf126b61101035d4c7))
* окно человека — «место человека», не «комната» ([#220](https://github.com/iskron-ai/skills/issues/220)) ([443fc4b](https://github.com/iskron-ai/skills/commit/443fc4b4a7aee657a0377c7bb75e36e6318a3472))
* ярлык дела — «№N», не «#N» (слова моста и речь навыков) ([#222](https://github.com/iskron-ai/skills/issues/222)) ([54fda1e](https://github.com/iskron-ai/skills/commit/54fda1ec0a5e8652a6508f71ab28b3d863b7f667))

## [6.19.0](https://github.com/iskron-ai/skills/compare/v6.18.0...v6.19.0) (2026-09-25)


### Features

* **skills:** готовое, что ждёт человека или чужого слова, — своя строка partial по ключу вещи; ведущий несёт её человеку ([#214](https://github.com/iskron-ai/skills/issues/214)) ([dd07f91](https://github.com/iskron-ai/skills/commit/dd07f91a18d44812ca1671b817817723482006f5))


### Bug Fixes

* **bridge:** reasoning узла — телом записи, op узла — ещё удалён и восстановлен ([#216](https://github.com/iskron-ai/skills/issues/216)) ([8d174e2](https://github.com/iskron-ai/skills/commit/8d174e27e5ae047c012d0d6cf990e415343a9d37))
* **bridge:** уход и вход называют место из полей строки, узел в деле — op и reasoning ([#213](https://github.com/iskron-ai/skills/issues/213)) ([cbe92ff](https://github.com/iskron-ai/skills/commit/cbe92ffd94814c84220f9d94bb1ed854b7b0d94e))
* **opencode:** кадры дела — одним промптом очереди, прямое слово — вставкой отдельно ([#217](https://github.com/iskron-ai/skills/issues/217)) ([d9583e2](https://github.com/iskron-ai/skills/commit/d9583e285fc4e9512c88fa03ac18e5672f604650))

## [6.18.0](https://github.com/iskron-ai/skills/compare/v6.17.0...v6.18.0) (2026-09-25)


### Features

* **bridge:** своё место субагента — мост-спутник из файла агента, место на прогон ([#202](https://github.com/iskron-ai/skills/issues/202)) ([72f72a5](https://github.com/iskron-ai/skills/commit/72f72a51cb721c6aa843da474e0c126b0c1a3e2c))
* **skills:** агенты не пересказывают — строка, слово и узел не дублируют друг друга; слово человека в деле разносит ведущий ([#211](https://github.com/iskron-ai/skills/issues/211)) ([dfe74b4](https://github.com/iskron-ai/skills/commit/dfe74b4edc8ff865564ac30ae1506bbdb42acd7e))
* **skills:** слово агента — только в дело; вердикт гроссбуха «slop» ([#208](https://github.com/iskron-ai/skills/issues/208)) ([5cb857f](https://github.com/iskron-ai/skills/commit/5cb857f97921d157d9f3bc6bedeaf8b5007a703a))
* **skills:** спрос и взятие в деле — строки «нужно:» и «беру:», ведущий разводит, запуск по «да» ([#204](https://github.com/iskron-ai/skills/issues/204)) ([08d7b15](https://github.com/iskron-ai/skills/commit/08d7b15dd89a267aaed6b83b9d334136a6251ec6))


### Bug Fixes

* **bridge:** место по каталогу — только стоявшей сессии; уход словом держится ([#206](https://github.com/iskron-ai/skills/issues/206)) ([369b0fe](https://github.com/iskron-ai/skills/commit/369b0fe6399c774c9bb2f5299cd587a626aa4aea))
* **bridge:** прямое слово не теряется в пачке — отдельным событием, пачка дела коротко ([#212](https://github.com/iskron-ai/skills/issues/212)) ([a68054f](https://github.com/iskron-ai/skills/commit/a68054f6dcf13740f196b14ea17836d9d343b4fa))
* **bridge:** род body и слово в полёте — две фазы слова не будят пустым и не падают в неизвестные ([#209](https://github.com/iskron-ai/skills/issues/209)) ([6e25d87](https://github.com/iskron-ai/skills/commit/6e25d87bb1d9938f962d478538f7d95f1c96cb44))
* **iskronify:** спутник субагента не проецируется, пока платформа не отделит его от почты роли ([#210](https://github.com/iskron-ai/skills/issues/210)) ([b534081](https://github.com/iskron-ai/skills/commit/b53408177817d37e7ceac84bbe1efee7d14f91d6))
* **iskronify:** хук после мержа — по исходу, не по форме команды; справка не будит ([#205](https://github.com/iskron-ai/skills/issues/205)) ([e774928](https://github.com/iskron-ai/skills/commit/e774928a75eebbf5201031821dff6bc3d456a2d5))
* **skills:** замысел дела — зачин, без формы; ведение и донесение — слово, не будущая запись ([#207](https://github.com/iskron-ai/skills/issues/207)) ([537fc76](https://github.com/iskron-ai/skills/commit/537fc766b18705bbdeae0329f8669168ee954c52))

## [6.17.0](https://github.com/iskron-ai/skills/compare/v6.16.2...v6.17.0) (2026-09-24)


### Features

* **skills:** дело ступени 6 — замысел первым словом, ведение уговором, донесение из дочернего, субагент в деле, гроссбух строками дела ([#198](https://github.com/iskron-ai/skills/issues/198)) ([281ed96](https://github.com/iskron-ai/skills/commit/281ed96dab0c8d99ddeb31f9c6a9d0ab98887344))


### Bug Fixes

* **bridge:** род auto в словаре дела — записи платформы о дочерних делах словами, пачкой ([#200](https://github.com/iskron-ai/skills/issues/200)) ([0b3cad6](https://github.com/iskron-ai/skills/commit/0b3cad65ff8bc4e65026fa99692341062a8003f9))

## [6.16.2](https://github.com/iskron-ai/skills/compare/v6.16.1...v6.16.2) (2026-09-24)


### Bug Fixes

* **bridge:** приглашение моей роли в дело прерывает, как приглашение моему месту ([#196](https://github.com/iskron-ai/skills/issues/196)) ([a00d833](https://github.com/iskron-ai/skills/commit/a00d833d7d51fe2c4b1b5225de2aaa172013b87a))

## [6.16.1](https://github.com/iskron-ai/skills/compare/v6.16.0...v6.16.1) (2026-09-24)


### Bug Fixes

* **bridge:** уже отданный кадр не отдаётся снова после переподключения ([#193](https://github.com/iskron-ai/skills/issues/193)) ([eeb9c1f](https://github.com/iskron-ai/skills/commit/eeb9c1fdbab2cf21bed9fff0defafe3581fb4434))
* **test:** лимит времени набора проб 300 с — standing.test с пробами повторной доставки не укладывался в 120 с на CI с покрытием ([#195](https://github.com/iskron-ai/skills/issues/195)) ([11d127b](https://github.com/iskron-ai/skills/commit/11d127b5a6ceb0d3ecef30eb043d80637e02e6c6))

## [6.16.0](https://github.com/iskron-ai/skills/compare/v6.15.1...v6.16.0) (2026-09-24)


### Features

* **skills:** дело — тул iskron_case, разговор talk; дела по единицам под родительским ([#191](https://github.com/iskron-ai/skills/issues/191)) ([37f78ae](https://github.com/iskron-ai/skills/commit/37f78ae4f7e20002b594094e8ee73e97582644b0))

## [6.15.1](https://github.com/iskron-ai/skills/compare/v6.15.0...v6.15.1) (2026-09-24)


### Bug Fixes

* **bridge:** имя стояния в связанном ворктри — репо основной копии, не каталог задачи ([#189](https://github.com/iskron-ai/skills/issues/189)) ([410087f](https://github.com/iskron-ai/skills/commit/410087fe413b27439ad9f87fcb628fc610bf2bfb))

## [6.15.0](https://github.com/iskron-ai/skills/compare/v6.14.0...v6.15.0) (2026-09-24)


### Features

* **skills:** штабные практики в силе — пересказ, стык с пробой, сдача смены, краткость доклада, узкие права ведущего ([#186](https://github.com/iskron-ai/skills/issues/186)) ([2040fde](https://github.com/iskron-ai/skills/commit/2040fde9247c2899b50bd049979af3833fa7a37d))

## [6.14.0](https://github.com/iskron-ai/skills/compare/v6.13.1...v6.14.0) (2026-09-24)


### Features

* **skills:** дело на поверхности агента — ходы журнала, закрытие и возражение, ведущий по проекции ([#184](https://github.com/iskron-ai/skills/issues/184)) ([fd97758](https://github.com/iskron-ai/skills/commit/fd97758b14a7ac6ae9ab6b24f4ddb322ecd29ce5))

## [6.13.1](https://github.com/iskron-ai/skills/compare/v6.13.0...v6.13.1) (2026-09-24)


### Bug Fixes

* **bridge:** may_object на бою — объекты мест, «ты можешь возразить» сверяется по их id ([#181](https://github.com/iskron-ai/skills/issues/181)) ([03209d1](https://github.com/iskron-ai/skills/commit/03209d188364c727d3cf646666b553dc9ee95e14))
* **bridge:** подсказка возражения называет настоящий ход iskron_room(action="object"); без свидетельств — без «?» ([#183](https://github.com/iskron-ai/skills/issues/183)) ([91f0815](https://github.com/iskron-ai/skills/commit/91f0815e9850eea41cd9657c1fd9590fae063c32))

## [6.13.0](https://github.com/iskron-ai/skills/compare/v6.12.0...v6.13.0) (2026-09-24)


### Features

* **bridge:** словарь родов комнаты — слово и стопка технического кадра, закрытие прерывает ([#178](https://github.com/iskron-ai/skills/issues/178)) ([8829207](https://github.com/iskron-ai/skills/commit/882920723c74f621ba60566c4de0da48e89eac1a))


### Bug Fixes

* **bridge:** приглашение в комнату называет приглашённого по имени, не голым id из ключа ([#180](https://github.com/iskron-ai/skills/issues/180)) ([11f97f0](https://github.com/iskron-ai/skills/commit/11f97f00ddd839835bc35fa6e8b4180fc2ded54c))

## [6.12.0](https://github.com/iskron-ai/skills/compare/v6.11.0...v6.12.0) (2026-09-23)


### Features

* **architect:** скилл всякого ведущего комнаты; провенанс — в reasoning, posed_by — короткий адрес ([#176](https://github.com/iskron-ai/skills/issues/176)) ([6f54582](https://github.com/iskron-ai/skills/commit/6f54582ba1b3d98d88e23cbec8efd3cbfcd5457b))
* **bridge:** место на каждый граф на одном канале — одна сессия держит стояния в нескольких графах ([#177](https://github.com/iskron-ai/skills/issues/177)) ([415715d](https://github.com/iskron-ai/skills/commit/415715d56604dd25e4f0602cde2a3885290cb363))


### Bug Fixes

* **bridge:** одно событие графа доходит до делателя один раз ([#174](https://github.com/iskron-ai/skills/issues/174)) ([4d6e849](https://github.com/iskron-ai/skills/commit/4d6e849979f800122d305828306ed6143632bb73))

## [6.11.0](https://github.com/iskron-ai/skills/compare/v6.10.2...v6.11.0) (2026-09-21)


### Features

* **iskronify:** контракт 13 — слот обложки «Раскладка»: README папок и GOTCHAS.md владельца прогон не вливает и не перетирает ([#171](https://github.com/iskron-ai/skills/issues/171)) ([f61b58a](https://github.com/iskron-ai/skills/commit/f61b58a99ab7614cdf8ca96fa6f6e00aad7ddc99))
* **vahta,writing:** вахта по сигналу и с субагентами организует; провенанса в теле узла не бывает ([#173](https://github.com/iskron-ai/skills/issues/173)) ([f74af71](https://github.com/iskron-ai/skills/commit/f74af71a17d6baf994aadad86e248e0cb52f20b0))

## [6.10.2](https://github.com/iskron-ai/skills/compare/v6.10.1...v6.10.2) (2026-09-20)


### Bug Fixes

* **bridge:** статусный адрес держится экземпляром моста, не держателем сокета ([#169](https://github.com/iskron-ai/skills/issues/169)) ([2877a23](https://github.com/iskron-ai/skills/commit/2877a2313eba772e0dfcf58a22389cf8925eb9ac))
* **doctor,establish-mcp:** запись mcp рядом с плагином OpenCode названа ([#165](https://github.com/iskron-ai/skills/issues/165)) ([e89c16e](https://github.com/iskron-ai/skills/commit/e89c16e56f31a1e91d2e3f4a46bc91d99ebe6800))
* **opencode:** имя тула соседней записи — через точку, наблюдено на 2.0.9 ([#168](https://github.com/iskron-ai/skills/issues/168)) ([72a2feb](https://github.com/iskron-ai/skills/commit/72a2feb1b93c3735c4ff20cab778199ac63ebb86))

## [6.10.1](https://github.com/iskron-ai/skills/compare/v6.10.0...v6.10.1) (2026-09-19)


### Bug Fixes

* **iskronify:** контракт 12 — канон графа кладётся ссылочным блоком, не прозой скелета ([#163](https://github.com/iskron-ai/skills/issues/163)) ([adb908c](https://github.com/iskron-ai/skills/commit/adb908c34db89694b4aa2e57e5ded136903c1764))
* **iskronify:** новая роль в той же сессии — телом в брифе; Reality — живость наблюдена на 0.78.0 ([#161](https://github.com/iskron-ai/skills/issues/161)) ([7df2edc](https://github.com/iskron-ai/skills/commit/7df2edcf433856d8a2a5424b890967eda9e3eeb1))

## [6.10.0](https://github.com/iskron-ai/skills/compare/v6.9.1...v6.10.0) (2026-09-19)


### Features

* окно «слушает» под честную живость; iskronify контракт 11 — поведение только из worktree, хуки по цене; minding глубже и приватен ([#159](https://github.com/iskron-ai/skills/issues/159)) ([8001dac](https://github.com/iskron-ai/skills/commit/8001dac871fde5d2ac806233a9e6974e6c48f813))

## [6.9.1](https://github.com/iskron-ai/skills/compare/v6.9.0...v6.9.1) (2026-09-19)


### Bug Fixes

* **bridge,opencode,pi:** list_changed в OpenCode и pi, своё место, поля места, пустая доска ([#158](https://github.com/iskron-ai/skills/issues/158)) ([a6e5aa6](https://github.com/iskron-ai/skills/commit/a6e5aa6a4996a89f2024b625177e2af7d6942285))
* **bridge,standing:** живого держателя выведенного имени не вытесняют — отдельное место имя.N ([#157](https://github.com/iskron-ai/skills/issues/157)) ([331d465](https://github.com/iskron-ai/skills/commit/331d465621d7cdd3a64e8c323bf69d2ba529d98e))
* **bridge:** таймер живости сокета, распознавание ответов поверхности, list_changed после выкатки ([#155](https://github.com/iskron-ai/skills/issues/155))да  ([29d145f](https://github.com/iskron-ai/skills/commit/29d145f5cca955fc22c4564cd88f542584b84e6f))

## [6.9.0](https://github.com/iskron-ai/skills/compare/v6.8.0...v6.9.0) (2026-09-19)


### Features

* **inquiry,writing,assembly,vahta,minding:** слово «парковка» снято — клетку называет воля ([#137](https://github.com/iskron-ai/skills/issues/137)) ([a05bb3d](https://github.com/iskron-ai/skills/commit/a05bb3d63973c01da859045bec92f81a24e47369))
* **inquiry,writing:** стрелка ответа ведёт и на феномен по данности ([#136](https://github.com/iskron-ai/skills/issues/136)) ([8a36b9e](https://github.com/iskron-ai/skills/commit/8a36b9eb09750822e52fb5073a97b2339a6d266e))
* **opencode:** плагин на API OpenCode 2 — стояние одно на мост, кадр в идущий ход вставкой ([#135](https://github.com/iskron-ai/skills/issues/135)) ([69148fa](https://github.com/iskron-ai/skills/commit/69148fa6bcb7b287496d9db63aa9d8059bbf02e7))
* **triputi:** скиллы приведены к решённой матрице трипути ([#132](https://github.com/iskron-ai/skills/issues/132)) ([91f50d1](https://github.com/iskron-ai/skills/commit/91f50d10cd830bf13af11f634fe5440c13e0f18f))
* **writing,assembly,design:** веер различают ступенями — грубая связь на зонте прежде тонких ([#142](https://github.com/iskron-ai/skills/issues/142)) ([67b3648](https://github.com/iskron-ai/skills/commit/67b364863075525630645784b4764703eaa6a80d))
* **writing,inquiry,assembly,vahta,integrity,methodology-work:** состояние узла — словом клетки, не зонтом ([#148](https://github.com/iskron-ai/skills/issues/148)) ([e058a51](https://github.com/iskron-ai/skills/commit/e058a51d79f8ab343831f9002afec9304c873b72))
* **writing,vahta,weaving,assembly:** имя — приглашение; тишина — мандат сборки ([#134](https://github.com/iskron-ai/skills/issues/134)) ([6ff119f](https://github.com/iskron-ai/skills/commit/6ff119ff6d144fbdaa40a5760e60dbc386882a62))


### Bug Fixes

* **bridge,opencode,standing:** место, возвращённое мостом самим, объявляется в сессию с именем и соседями по каталогу ([#150](https://github.com/iskron-ai/skills/issues/150)) ([7a4f7d6](https://github.com/iskron-ai/skills/commit/7a4f7d6a0ae9e2993674d572b63433c4621d718c))
* **bridge,opencode:** кадр комнаты 0.71.0 — конверт целиком, платформа без автора, defer очередью, длина по сериализованному телу ([#145](https://github.com/iskron-ai/skills/issues/145)) ([de1d314](https://github.com/iskron-ai/skills/commit/de1d314db91450f0fb5ed8e010cd928cc8466416))
* **bridge:** отказ занятости называет живой мост-держатель и путь передачи целиком ([#154](https://github.com/iskron-ai/skills/issues/154)) ([a316063](https://github.com/iskron-ai/skills/commit/a31606311d8a54de49a7c3de2b7f49a8b3ea28a3))
* **design,inquiry,weaving,methodology-work:** отвергнутые атрибуты не упоминаются и как запрет ([#138](https://github.com/iskron-ai/skills/issues/138)) ([763903a](https://github.com/iskron-ai/skills/commit/763903a5d3cb5a164d490f46df3dc75a9828aef1))
* **entry:** состояние вопрошания — словом клетки «зовёт», не «открыто» ([#151](https://github.com/iskron-ai/skills/issues/151)) ([0c21867](https://github.com/iskron-ai/skills/commit/0c218678c58be4ff3a7db1fd6f47ee18a7706837))
* **inquiry,vahta:** состояние anga читается из ответа линзы, а не пересказывается словом resolved ([#149](https://github.com/iskron-ai/skills/issues/149)) ([0cc9ee1](https://github.com/iskron-ai/skills/commit/0cc9ee1214e94dd43930a0ed9d5bb962ef825e56))
* **inquiry,writing:** принятый риск жив как запись — закрывает только отпускание, принятие не закрытие ([#143](https://github.com/iskron-ai/skills/issues/143)) ([eb82dcf](https://github.com/iskron-ai/skills/commit/eb82dcf04d15dcfea32316fb8c04a84bb82392c3))
* **iskron,vahta:** число зовущих и зовущие риски — словом клетки, не «открытым» ([#152](https://github.com/iskron-ai/skills/issues/152)) ([c4bbfd0](https://github.com/iskron-ai/skills/commit/c4bbfd06526402c50acafd8c5a1e92da1a7c687d))
* **iskronify:** шаблон не учит судить инбокс по возрасту — будит перемена у якоря, не дата ([#147](https://github.com/iskron-ai/skills/issues/147)) ([b3f4eb0](https://github.com/iskron-ai/skills/commit/b3f4eb0a11f33710db2060dc32aab5e77fe69f92))
* **standing,entry,vahta,weaving:** вместо копий чужого — источник, знак и ход, который работает ([#139](https://github.com/iskron-ai/skills/issues/139)) ([03ef7aa](https://github.com/iskron-ai/skills/commit/03ef7aa732558c990dc7062ae536fb63e7985eae))
* **standing,iskron:** граница вставки кадра, почта роли в отлучке, прибор в строке гроссбуха ([#153](https://github.com/iskron-ai/skills/issues/153)) ([5968b6b](https://github.com/iskron-ai/skills/commit/5968b6b2d53e36ea10336decfe751ac01d38ae99))
* **writing,iskronify:** adhikarin стюардит сам либо действует под старшей ролью — предупреждение только без стюарда по всей цепи специализации ([#144](https://github.com/iskron-ai/skills/issues/144)) ([2f87a12](https://github.com/iskron-ai/skills/commit/2f87a12d68bfc990dad6a5a1389cdd3dbe2aeb32))

## [6.8.0](https://github.com/iskron-ai/skills/compare/v6.7.0...v6.8.0) (2026-09-17)


### Features

* **architect:** скилл архитектора — штаб при владельце ([#130](https://github.com/iskron-ai/skills/issues/130)) ([1d4783f](https://github.com/iskron-ai/skills/commit/1d4783f1c48fbb1fd7a6b80bb669a33c4fb323c3))
* **writing:** пере-вывод скилла из канона — ядро в пять решений, случаи в references ([#128](https://github.com/iskron-ai/skills/issues/128)) ([2055968](https://github.com/iskron-ai/skills/commit/2055968cac2ab4b27b4e7cee66bca5ec6e8f0b6e))

## [6.7.0](https://github.com/iskron-ai/skills/compare/v6.6.4...v6.7.0) (2026-09-16)


### Features

* **bridge,standing,establish-mcp,pi:** уход с места, английский адрес mcp.iskron.ai, pi ждёт вход ([#125](https://github.com/iskron-ai/skills/issues/125)) ([5a5d00e](https://github.com/iskron-ai/skills/commit/5a5d00efe298d804d3deaa02703b8fc38950596e))
* **bridge,standing:** мост возвращает место с диска после перезапуска, блок слушателя — своего харнеса ([#126](https://github.com/iskron-ai/skills/issues/126)) ([ca1e5b5](https://github.com/iskron-ai/skills/commit/ca1e5b52badc68197cddde9cdcbad2d715263977))


### Bug Fixes

* **bridge,standing,vahta,iskronify:** имя стояния — адрес; revoke и хук роли; плагин ритуалов OpenCode 2 ([#127](https://github.com/iskron-ai/skills/issues/127)) ([3bdb6f4](https://github.com/iskron-ai/skills/commit/3bdb6f43b321896bc9310b7be1f34e658f586c04))
* **bridge,standing:** мост ведёт стояние агента — адреса скрыты, 4000 не смерть, занятость от стояния, кадр под Monitor текстом, stale не будит ([#123](https://github.com/iskron-ai/skills/issues/123)) ([1578612](https://github.com/iskron-ai/skills/commit/157861209f01b27ba746825ba6e86feb0555fe19))

## [6.6.4](https://github.com/iskron-ai/skills/compare/v6.6.3...v6.6.4) (2026-09-11)


### Bug Fixes

* **bridge,establish-mcp:** вход без «подожди N минут» — одна вкладка на вход, рабочая до конца ([#121](https://github.com/iskron-ai/skills/issues/121)) ([d427ce3](https://github.com/iskron-ai/skills/commit/d427ce363a0619018eb3ee5ff3403dfd7cfecc8f))
* **bridge,establish-mcp:** мёртвый грант не роняет рукопожатие — вход доходит до человека первым вызовом ([#119](https://github.com/iskron-ai/skills/issues/119)) ([da51668](https://github.com/iskron-ai/skills/commit/da51668f3351f807137fe31de30cde3df7dd8340))

## [6.6.3](https://github.com/iskron-ai/skills/compare/v6.6.2...v6.6.3) (2026-09-10)


### Bug Fixes

* **iskron,entry,standing,vahta,writing,minding:** первая запись новичка; гроссбух — строгий формат; mind каждому ([#116](https://github.com/iskron-ai/skills/issues/116)) ([a1c80f1](https://github.com/iskron-ai/skills/commit/a1c80f1f4c89b6fc60b9b2318a1b1d71a1ce6647))
* **iskron,iskronify,vahta:** одно правило на штамп ниже контракта ([#114](https://github.com/iskron-ai/skills/issues/114)) ([3a7b414](https://github.com/iskron-ai/skills/commit/3a7b414983f69429de6d9f6c8ccb5b0840bdcfca))
* **opencode,bridge,standing,iskron,entry,iskronify:** первый вход в OpenCode ждёт человека; мост держит сеть; правки ревью двери ([#117](https://github.com/iskron-ai/skills/issues/117)) ([8dce75a](https://github.com/iskron-ai/skills/commit/8dce75a1fd0fab22508b3415954ff0492d366c38))

## [6.6.2](https://github.com/iskron-ai/skills/compare/v6.6.1...v6.6.2) (2026-09-09)


### Bug Fixes

* **standing:** грамматику имени стояния держит держатель ([#112](https://github.com/iskron-ai/skills/issues/112)) ([225d5c7](https://github.com/iskron-ai/skills/commit/225d5c740c5a996fcdc1f78fdd672bceaf6d2bfd))

## [6.6.1](https://github.com/iskron-ai/skills/compare/v6.6.0...v6.6.1) (2026-09-09)


### Bug Fixes

* **bridge:** сторож выхода не будит на отданном кадре, doctor видит плагинные записи, имя стояния — машина.репо.модель ([#110](https://github.com/iskron-ai/skills/issues/110)) ([3dbbe8f](https://github.com/iskron-ai/skills/commit/3dbbe8f49d7b2f917a74efb8c19578483502e461))

## [6.6.0](https://github.com/iskron-ai/skills/compare/v6.5.0...v6.6.0) (2026-09-09)


### Features

* **iskronify:** два такта, обложка AGENTS.md, collaborate влит в standing ([#106](https://github.com/iskron-ai/skills/issues/106)) ([c61f3a3](https://github.com/iskron-ai/skills/commit/c61f3a37a72dcf83e521f14761ba5f23b623ee2e))
* **writing:** различитель волевой оси на феноменах и деяниях — «держится намерением или устройством?» ([#108](https://github.com/iskron-ai/skills/issues/108)) ([0f0b005](https://github.com/iskron-ai/skills/commit/0f0b005fcc4369d66d7dd36532681a98f5386277))


### Bug Fixes

* **bridge:** вход через браузер — Windows-опенер, регистрация DCR, 404 от token-эндпоинта ([#109](https://github.com/iskron-ai/skills/issues/109)) ([9d1d2c6](https://github.com/iskron-ai/skills/commit/9d1d2c69ddb420fbad8b82903847a0cd7d90c110))
* **bridge:** глаголы обновления Codex в строке отставания и SETUP.md ([#104](https://github.com/iskron-ai/skills/issues/104)) ([ff0893d](https://github.com/iskron-ai/skills/commit/ff0893d2d40a5d0a1ebf96793b96bd64f4b465cd))
* **iskron:** различение алиаса хоста в старте, бриф ревьюера без переключения чекаута, контракт 9 ([#107](https://github.com/iskron-ai/skills/issues/107)) ([959af0b](https://github.com/iskron-ai/skills/commit/959af0b3960968f384ce52b807f19b882d481825))

## [6.5.0](https://github.com/iskron-ai/skills/compare/v6.4.0...v6.5.0) (2026-09-08)


### Features

* **bridge,skills:** старт агента одним скиллом — iskron_stand, самообновление моста, раздел «Старт» в двери ([#102](https://github.com/iskron-ai/skills/issues/102)) ([cd26b46](https://github.com/iskron-ai/skills/commit/cd26b46f0e69911ebe1b7e700cedb1e82326b494))

## [6.4.0](https://github.com/iskron-ai/skills/compare/v6.3.0...v6.4.0) (2026-09-08)


### Features

* **vahta:** гроссбух в семени превращения, разделённая ответственность за граф, вахта без повода предлагает ([#99](https://github.com/iskron-ai/skills/issues/99)) ([323ca4e](https://github.com/iskron-ai/skills/commit/323ca4eaf7e218117a8d68ada859f603e858b4c1))

## [6.3.0](https://github.com/iskron-ai/skills/compare/v6.2.3...v6.3.0) (2026-09-08)


### Features

* **skills:** вход в комнату по строке, инвентарь клиента в reconcile; fix(bridge): рукопожатие за конвейерного клиента ([#97](https://github.com/iskron-ai/skills/issues/97)) ([cd290e5](https://github.com/iskron-ai/skills/commit/cd290e5edbf48333861b16a9405184dafe85b820))

## [6.2.3](https://github.com/iskron-ai/skills/compare/v6.2.2...v6.2.3) (2026-09-08)


### Bug Fixes

* **standing:** устаревшие сторожа нативного транспорта возвращены в поставку — обновление не роняет живых вахт ([#95](https://github.com/iskron-ai/skills/issues/95)) ([60f6ee0](https://github.com/iskron-ai/skills/commit/60f6ee087cbf14fc17bb8ea3574cade5374a35e2))

## [6.2.2](https://github.com/iskron-ai/skills/compare/v6.2.1...v6.2.2) (2026-09-07)


### Bug Fixes

* **plugin:** запись моста Claude Code — ровно токен ${CLAUDE_PLUGIN_ROOT}, форма с умолчанием не раскрывается ([#93](https://github.com/iskron-ai/skills/issues/93)) ([364b3d8](https://github.com/iskron-ai/skills/commit/364b3d8f932858f94ea83595d386929f315c06bd))

## [6.2.1](https://github.com/iskron-ai/skills/compare/v6.2.0...v6.2.1) (2026-09-07)


### Bug Fixes

* **opencode:** мост на каждую сессию; занятость — вызовом к своему стоянию ([#91](https://github.com/iskron-ai/skills/issues/91)) ([f810f09](https://github.com/iskron-ai/skills/commit/f810f09bba99768f42aa8b32d1faef5b14edab39))

## [6.2.0](https://github.com/iskron-ai/skills/compare/v6.1.2...v6.2.0) (2026-09-07)


### Features

* **js:** отгружаемый JS на полном релиз-цикле — единый исходник, один файл iskron.mjs с doctor, гейт lint→types→check-js→пробы ([#88](https://github.com/iskron-ai/skills/issues/88)) ([d19d6e8](https://github.com/iskron-ai/skills/commit/d19d6e8b5bf4ae5f938a637df7aa058df381928a))

## [6.1.2](https://github.com/iskron-ai/skills/compare/v6.1.1...v6.1.2) (2026-09-07)


### Bug Fixes

* **agents:** правило красной пробы — по классу, а не по списку имён ([#85](https://github.com/iskron-ai/skills/issues/85)) ([ba04a4d](https://github.com/iskron-ai/skills/commit/ba04a4d70e29c5500bc68ee428efa8653b75dcfa))

## [6.1.1](https://github.com/iskron-ai/skills/compare/v6.1.0...v6.1.1) (2026-09-06)


### Bug Fixes

* **bridge:** мёртвый грант признаётся фоном, стук ограничен, свёртка ждёт ротацию; чистка корпуса под первого читателя ([#83](https://github.com/iskron-ai/skills/issues/83)) ([a4da925](https://github.com/iskron-ai/skills/commit/a4da92540c49611cfd600b80134feb956b162776))

## [6.1.0](https://github.com/iskron-ai/skills/compare/v6.0.0...v6.1.0) (2026-09-05)


### Features

* **pi:** мост обновляется сам; сведён набор скиллов, честный гейт, Codex через cli, мёртвый refresh ([#80](https://github.com/iskron-ai/skills/issues/80)) ([d9a5afa](https://github.com/iskron-ai/skills/commit/d9a5afaaf5c39c09452b064195c8a357cae86e7f))

## [6.0.0](https://github.com/iskron-ai/skills/compare/v5.0.0...v6.0.0) (2026-09-04)


### ⚠ BREAKING CHANGES

* **feedback:** фидбэк идёт в граф работы, адресно; докс после мержа входа ([#76](https://github.com/iskron-ai/skills/issues/76))

### Features

* **establish-mcp:** мост первым, нативный OAuth вторым; js-bundle: граница, сторожа, проба, reconcile ([#78](https://github.com/iskron-ai/skills/issues/78)) ([5325337](https://github.com/iskron-ai/skills/commit/5325337436b39dfa47a8283cfa2b42ccf52ea754))
* дверь человека, поставка в pi и Codex, починенные сторожа ([#79](https://github.com/iskron-ai/skills/issues/79)) ([e13aa3c](https://github.com/iskron-ai/skills/commit/e13aa3c301208f1dc06d329aec9f60f93c938405))


### Bug Fixes

* **feedback:** фидбэк идёт в граф работы, адресно; докс после мержа входа ([#76](https://github.com/iskron-ai/skills/issues/76)) ([6c6969c](https://github.com/iskron-ai/skills/commit/6c6969c5cbc6d3c226ba3c2d08ae85e5859d0b01))

## [5.0.0](https://github.com/iskron-ai/skills/compare/v4.2.0...v5.0.0) (2026-09-02)


### ⚠ BREAKING CHANGES

* **entry:** скилл likbez упразднён, его содержание — первая часть entry.

### Features

* **entry:** вход в граф — грамотность влита и читается всегда; мост держит привязку стояния; снятие стояния по слову человека ([#74](https://github.com/iskron-ai/skills/issues/74)) ([c096669](https://github.com/iskron-ai/skills/commit/c09666969b99bfdc3f8b5440e1793cf7a8c2541d))

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
