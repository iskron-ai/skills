// Слова шага хука инбокса роли в ответе iskron_stand (граф @nks/nks-dev, узлы
// #5838, #6080): аргументы — готовые строки (обрезанный ответ тула, граф канала).
import type { Lang } from "../lang.ts";

export interface HookWords {
  /** Отдельное место имя.N — хук роли ему не взводится. */
  sub: () => string;
  wakesMe: () => string;
  unrecognized: (text: string) => string;
  otherHolder: () => string;
  /** Часть слов места другого графа: адрес — у канала, открытого в графе channelRealm. */
  noAddress: (channelRealm: string) => string;
  noSchema: (noAddress: string) => string;
  noChannelParam: (noAddress: string) => string;
  channelFailed: (text: string) => string;
  channelArmed: (text: string) => string;
  noIncoming: () => string;
  failed: (text: string) => string;
  armed: (text: string) => string;
}

const RU = "Хук инбокса роли";
const EN = "Role inbox hook";

export const HOOK: Readonly<Record<Lang, HookWords>> = {
  ru: {
    sub: () =>
      `${RU}: отдельному месту не взводится — почту роли слушает основное место, дела доставляют своё сами.`,
    wakesMe: () => `${RU}: стоит и будит это стояние.`,
    unrecognized: (text) => `${RU}: список хуков не распознан — не трогаю (${text}).`,
    otherHolder: () => `${RU}: не взвожу — слух у другого держателя.`,
    noAddress: (channelRealm) =>
      `у места этого графа своего входящего адреса нет (адрес — у канала, открытого в графе ${channelRealm})`,
    noSchema: (noAddress) =>
      `${RU}: не взведён — ${noAddress}, а схему тула iskron_admin прочесть не удалось (tools/list не ответил или iskron_admin в нём не нашёлся) — объявлен ли параметр channel, не известно; хук на канал (channel=self) не взвожу вслепую — повтори iskron_stand этого графа.`,
    noChannelParam: (noAddress) =>
      `${RU}: не взведён — ${noAddress}, а тул iskron_admin(action="add_webhook") в этой поверхности параметра channel не объявляет; хук на канал (channel=self) взвести нечем — почта роли этого графа сокетом не приходит.`,
    channelFailed: (text) => `${RU}: на канал (channel=self) не взвёлся — ${text}`,
    channelArmed: (text) =>
      `${RU}: взведён на канал (channel=self) — почта роли этого графа идёт в тот же сокет месту этого графа (${text}).`,
    noIncoming: () => `${RU}: не взведён — входящий адрес стояния не прочитался.`,
    failed: (text) => `${RU}: не взвёлся — ${text}`,
    armed: (text) => `${RU}: взведён на входящий адрес места (${text}).`,
  },
  en: {
    sub: () =>
      `${EN}: not armed for a separate seat — the main seat listens to the role's mail, cases deliver their own.`,
    wakesMe: () => `${EN}: in place and wakes this standing.`,
    unrecognized: (text) => `${EN}: the hook list is not recognized — left alone (${text}).`,
    otherHolder: () => `${EN}: not armed — another holder has the hearing.`,
    noAddress: (channelRealm) =>
      `this graph's seat has no incoming address of its own (the address is the channel's, opened in graph ${channelRealm})`,
    noSchema: (noAddress) =>
      `${EN}: not armed — ${noAddress}, and the iskron_admin schema could not be read (tools/list did not answer or has no iskron_admin) — whether it declares channel is unknown; no blind hook on the channel (channel=self) — repeat iskron_stand for this graph.`,
    noChannelParam: (noAddress) =>
      `${EN}: not armed — ${noAddress}, and iskron_admin(action="add_webhook") on this surface declares no channel parameter; nothing to arm a channel hook (channel=self) with — this graph's role mail does not come over the socket.`,
    channelFailed: (text) => `${EN}: not armed on the channel (channel=self) — ${text}`,
    channelArmed: (text) =>
      `${EN}: armed on the channel (channel=self) — this graph's role mail goes into the same socket to this graph's seat (${text}).`,
    noIncoming: () => `${EN}: not armed — the standing's incoming address did not read.`,
    failed: (text) => `${EN}: not armed — ${text}`,
    armed: (text) => `${EN}: armed on the seat's incoming address (${text}).`,
  },
};
