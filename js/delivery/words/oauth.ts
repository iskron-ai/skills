// Слова входа OAuth: страница браузера на loopback-адресе (CALLBACK) и отказ входа
// по коду с другого устройства (DEVICE_CLIENT, #6619). Страница браузера пока
// говорит по-английски на обоих языках — как говорила до слоя.
import type { Lang } from "../lang.ts";

export interface CallbackWords {
  /** error приходит уже экранированным для HTML. */
  loginUnreachable: (error: string) => string;
  anotherTab: () => string;
  /** err приходит уже экранированным для HTML. */
  refused: (err: string) => string;
  stillRunning: () => string;
  /** failure приходит уже экранированным для HTML. */
  failed: (failure: string) => string;
  authenticated: () => string;
  abandoned: () => string;
  loginOver: () => string;
}

const CALLBACK_EN: CallbackWords = {
  loginUnreachable: (error) =>
    `<h3>iskron-bridge: the sign-in page could not be reached (${error}) — reload this page.</h3>`,
  anotherTab: () => "iskron-bridge: another tab is finishing this login — you can close this one.",
  refused: (err) => `iskron-bridge: authorization failed (${err})`,
  stillRunning: () =>
    "iskron-bridge: the code arrived and the exchange is still running — watch the agent.",
  failed: (failure) =>
    `iskron-bridge: authorization failed (${failure}) — nothing was stored; the agent has the details.`,
  authenticated: () => "iskron-bridge: authenticated — you can close this tab.",
  abandoned: () => "iskron-bridge: the login was abandoned — nothing was stored.",
  loginOver: () =>
    "iskron-bridge: this page belongs to a login that is over — open the link the agent gave you.",
};

export const CALLBACK: Readonly<Record<Lang, CallbackWords>> = { ru: CALLBACK_EN, en: CALLBACK_EN };

export interface DeviceClientWords {
  bareRefusal: (id: string, status: number | undefined) => string;
  /** Клиент, названный переменной BRIDGE_DEVICE_CLIENT, отвергнут. */
  namedRefused: (id: string, word: string) => string;
  unset: (id: string) => string;
}

export const DEVICE_CLIENT: Readonly<Record<Lang, DeviceClientWords>> = {
  ru: {
    bareRefusal: (id, status) =>
      `сервер авторизации отказал в коде входа клиенту ${id}: ${status} без объяснения — ход оператора сервера авторизации`,
    namedRefused: (id, word) =>
      `сервер авторизации отверг клиента входа по коду ${id}, заданного ISKRON_BRIDGE_DEVICE_CLIENT (${word}) — поправь переменную или клиента на сервере`,
    unset: (id) =>
      `вход по коду на этом сервере не настроен: нет клиента ${id} — ход оператора сервера авторизации`,
  },
  en: {
    bareRefusal: (id, status) =>
      `the sign-in server refused a sign-in code to the client ${id}: ${status} with no word why — a move for the operator of the sign-in server`,
    namedRefused: (id, word) =>
      `the sign-in server refused the client ${id} named by ISKRON_BRIDGE_DEVICE_CLIENT (${word}) — fix the variable or the client on the server`,
    unset: (id) =>
      `sign-in by code is not set up on this server: there is no client ${id} — a move for the operator of the sign-in server`,
  },
};
