// Описание тула моста iskron_stand и его параметров — то, что харнесс видит в tools/list.
import type { Lang } from "../lang.ts";

export interface StandToolWords {
  description: () => string;
  realm: () => string;
  karta: () => string;
  name: () => string;
  room: () => string;
  model: () => string;
  muteSiblings: () => string;
  take: () => string;
  roomKarta: () => string;
  repeatKnock: () => string;
  satelliteOf: () => string;
  status: () => string;
  cwd: () => string;
}

export const STAND_TOOL: Readonly<Record<Lang, StandToolWords>> = {
  ru: {
    description: () =>
      "[мост] Занять стояние одним вызовом: мост читает доску, выводит имя (машина.репо.модель), занимает место " +
      "(connect и register; только register, если сокет уже держит этот мост), при room стучит кадром join в место человека по полному адресу с провода (повтор — только repeat_knock=true, один раз, не раньше чем через 2 минуты) и возвращает " +
      "имя, команду сторожа, число ожидавших кадров и расписку стука. Очередь роли — iskron_orient(focus=роль) на входе и по поводу; кадр — адресату и участникам дела. Место в другом графе встаёт рядом на том же канале " +
      "(register): сессия слышит все свои графы, и запись в каждом подписана местом этого графа. Дальше — запустить сторожа " +
      "командой из ответа и ждать. Он же — ход занятости: на месте, которое этот мост уже держит, вызов realm и status (karta и name — те же или опущены; без model, room, take — с ними это занятие места и сверка) " +
      'лишь ставит строку занятости — без доски, connect, register и стука; пустой status снимает; прежний iskron_channel(action="status") оставлен для совместимости. ' +
      "Тул исполняет мост; нет его в сессии — тулы идут мимо моста либо мост старой сборки (doctor скажет), стой по скиллу standing.",
    realm: () => "Адрес графа: @owner/slug или rN.",
    karta: () =>
      "Роль агента (#N из AGENTS.md или строки запуска). Нужна, чтобы занять место; для занятости на держимом месте её можно опустить.",
    name: () =>
      "Своя половина имени стояния; без неё выводится машина.репо.модель — модель из параметра model.",
    room: () =>
      "Адрес места человека @handle:name (его даёт окно человека); мост стучит туда join, чтобы встать рядом с человеком.",
    model: () =>
      "Модель, которой бежит агент (id или имя, например claude-opus-5 или opus-5) — третья часть выведенного имени; без неё имя — машина.репо.",
    muteSiblings: () => "Не слышать эхо других стояний той же роли.",
    take: () =>
      "Сознательный переход: вытеснить живого держателя ДРУГОЙ сессии — только по слову человека (без take имя, выведенное или явное, которое держит другая сессия, встаёт рядом на имя.N со слухом; своё место, которое держит прежний мост этой же сессии харнесса, мост возвращает сам — take не нужен); либо сменить место этого моста в графе (в графе одно место на мост: другая роль или другое имя без take — отказ вслух, прежнее место остаётся на доске без слуха). Место в другом графе take не требует — оно встаёт рядом.",
    roomKarta: () =>
      "Роль человека, чьё это место (#N), если места нет на доске; обычно роль человека, приславшего адрес места.",
    repeatKnock: () =>
      "Осознанный повтор стука в то же место человека: разрешён один раз и не раньше чем через 2 минуты после первого; без него повторный вызов второго join не шлёт.",
    satelliteOf: () =>
      "Только мосту-спутнику субагента (запись моста с --satellite в файле агента): место позвавшего @handle:name из постановки. Мост встаёт рядом местом-спутником <имя позвавшего>.sub-N (первое свободное N), ролью из karta (её называет постановка, роль позвавшего не наследуется); место живёт прогоном. name, take и room с ним не передаются.",
    status: () =>
      "Занятость места, до 64 символов: при занятии — первая строка; на месте, которое этот мост уже держит, — основной способ обновить занятость (вызов только её и ставит); пустая строка снимает.",
    cwd: () =>
      "Директория сессии харнесса, существующий абсолютный каталог — из неё выводится репо для имени (git toplevel, в связанном ворктри — основной копии, иначе её basename) и читаются ветки при поиске мест прежнего имени, когда мост запущен не из рабочей копии; плагин OpenCode подставляет её сам. Без неё — cwd моста; несуществующая или относительная — отказ вслух.",
  },
  en: {
    description: () =>
      "[bridge] Take a standing in one call: the bridge reads the board, derives the name (machine.repo.model), takes the seat " +
      "(connect and register; only register if this bridge already holds the socket), with room knocks a join frame into the human's seat by the full address from the wire (a repeat — only repeat_knock=true, once, no sooner than 2 minutes) and returns " +
      "the name, the watchdog command, the number of waiting frames and the knock receipt. Read the role queue with iskron_orient(focus=role) on entry and when occasion calls; frames go to the addressee and case participants. A seat in another graph stands beside on the same channel " +
      "(register): the session hears all its graphs, and a write in each is signed by that graph's seat. Then — start the watchdog " +
      "with the command from the reply and wait. It is also the busyness move: on a seat this bridge already holds, a call with realm and status (karta and name — the same or omitted; with model, room or take it is a seat-taking and a check) " +
      'only sets the busyness line — no board, connect, register or knock; an empty status clears; the former iskron_channel(action="status") is kept for compatibility. ' +
      "The bridge executes the tool; if it is not in the session, the tools go past the bridge or the bridge is an old build (doctor will say), stand by the standing skill.",
    realm: () => "Graph address: @owner/slug or rN.",
    karta: () =>
      "The agent's role (#N from AGENTS.md or the launch line). Needed to take a seat; for busyness on a held seat it may be omitted.",
    name: () =>
      "Your own half of the standing's name; without it machine.repo.model is derived — the model from the model parameter.",
    room: () =>
      "The human's seat address @handle:name (the human's window gives it); the bridge knocks a join there to stand beside the human.",
    model: () =>
      "The model the agent runs on (id or name, for example claude-opus-5 or opus-5) — the third part of the derived name; without it the name is machine.repo.",
    muteSiblings: () => "Do not hear the echo of other standings of the same role.",
    take: () =>
      "A deliberate move: to displace a live holder of ANOTHER session — only on the human's word (without take a name, derived or explicit, that another session holds stands beside on name.N with hearing; the bridge takes back by itself a seat a former bridge of this same harness session holds — no take needed); or to change this bridge's seat in a graph (one seat per bridge in a graph: another role or another name without take is a refusal aloud, the former seat stays on the board without hearing). A seat in another graph does not need take — it stands beside.",
    roomKarta: () =>
      "The role of the human whose seat it is (#N) if the seat is not on the board; usually the role of the human who sent the seat address.",
    repeatKnock: () =>
      "A deliberate repeat of the knock at the same human seat: allowed once and no sooner than 2 minutes after the first; without it a repeated call sends no second join.",
    satelliteOf: () =>
      "Only for a subagent's satellite bridge (the bridge entry with --satellite in the agent file): the caller's seat @handle:name from the brief. The bridge stands beside as the satellite seat <caller's name>.sub-N (the first free N), with the role from karta (the brief names it, the caller's role is not inherited); the seat lives for the run. name, take and room are not passed with it.",
    status: () =>
      "The seat's busyness, up to 64 characters: on taking — the first line; on a seat this bridge already holds — the main way to update busyness (the call sets only it); an empty string clears.",
    cwd: () =>
      "The harness session's directory, an existing absolute path — the repo for the name is derived from it (git toplevel, in a linked worktree — of the main copy, otherwise its basename) and branches are read when looking for seats of the former name, when the bridge is not started from the working copy; the OpenCode plugin supplies it itself. Without it — the bridge's cwd; a nonexistent or relative one is a refusal aloud.",
  },
};
