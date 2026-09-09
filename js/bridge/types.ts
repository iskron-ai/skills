export interface Tokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number | null;
  refresh_not_before?: number | null;
  refresh_expires_at?: number | null;
}

export interface Client {
  client_id: string;
  redirect_uri?: string;
  /** when this dynamic registration was made (local clock) */
  registered_at?: number;
  /** when a grant was first issued to it — a used registration outlives the server's cleanup of unused ones */
  granted_at?: number;
}

export interface AsMetadata {
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  [k: string]: unknown;
}

export interface Meta {
  as: AsMetadata;
  resource: string;
  scope: string | null;
}

export interface Store {
  client?: Client | null;
  tokens?: Tokens | null;
  meta?: Meta | null;
  clock_skew_ms?: number;
  server_url?: string;
  updated_at?: string;
}

/** Память машины о гранте, которому отказали: с каких пор, чьими словами, спрашивали ли человека. */
export interface GrantState {
  refused_since?: number;
  refused_at?: number;
  reason?: string;
  snooze_until?: number;
  early_refused_until?: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- JSON-RPC-полезная нагрузка приходит без схемы */
export interface JsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface Config {
  serverUrl: string;
  timeoutMs: number;
  authDir: string;
  clientName: string;
  noBrowser: boolean;
  debug: boolean;
  scope: string | null;
  resource: string | null;
  staticClientId: string | null;
  /** Личный токен доступа (PAT): с ним мост не ходит в OAuth вовсе. */
  pat: string | null;
  /** Откуда взят PAT — имя переменной или путь файла; для человека в отказе и в doctor. */
  patSource: string | null;
}
