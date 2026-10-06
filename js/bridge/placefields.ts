// Чем стояние является — поля места, которые мост называет при каждом занятии и
// каждой регистрации (граф nks-dev: #5174): model — модель, которой бежит агент
// (без префикса поставщика), attrs — признак сборки {name, version, stamp},
// установленный набор скиллов той же тройкой, харнес и версия хоста (#6226).
// attrs на поверхности заменяются целиком, поэтому мост всегда шлёт
// полный свой набор: частичная запись стёрла бы его же признак сборки.
import { lang } from "../shared/lang.ts";
import { scoped } from "../shared/scope.ts";
import { VERSION } from "../shared/version.ts";
import { BUILD } from "./build.ts";
import { harnessName, harnessVersion } from "./client.ts";
import { CFG } from "./config.ts";
import { seatField } from "./fields.ts";
import { normKarta, normName } from "./names.ts";
import { skillsAttr } from "./skillset.ts";
import { log } from "./streams.ts";

// Поля места — сессии (shared/scope.ts): у демона машины места разных сессий свои.
const P = scoped(() => ({
  model: "",
  /** Расход сессии (usage.ts, #6271): последний снятый — едет в каждой регистрации. */
  usage: null as object | null,
  satelliteOf: "",
  satelliteOfId: "",
  localeWarned: false,
}));
// attrs, названные агентом сам, — по месту, для которого названы: едут в его
// повторных регистрациях и не переезжают на другое место.
const extras = scoped(() => new Map<string, Record<string, unknown>>());
type Place = { realm?: unknown; karta?: unknown; name?: unknown };
// Ключ — в той же нормализации, что у привязки (#931 и 931, имя без пробелов по краям).
const placeKey = (p: Place): string =>
  `${String(p.realm ?? "")}|${normKarta(p.karta)}|${normName(p.name)}`;

export function rememberUsage(u: object): void {
  P.usage = u;
}

/**
 * Место позвавшего у моста-спутника (satellite.ts): адрес едет в attrs каждого
 * занятия и регистрации (доска печатает место спутником), id места — полем
 * satellite_of тела connect, mint и register (#6064: платформа не отдаёт
 * спутнику почту и веер роли). Вне режима спутника поле не шлётся никогда.
 */
export function noteSatelliteOf(address: string, id: string | null): void {
  P.satelliteOf = address;
  P.satelliteOfId = CFG.satellite && id ? id : "";
}

/** Модель из iskron_stand — едет полем места и во всех повторных регистрациях. */
export function rememberModel(m: unknown): void {
  if (typeof m === "string" && m.trim()) P.model = m.trim().replace(/^[^/]*\//, "");
}

/** Поля места для connect и register: всегда полный набор — свои ключи агента и признак моста. */
export function placeFields(place: Place = {}): {
  model?: string;
  satellite_of?: string;
  locale?: "en";
  attrs: Record<string, unknown>;
} {
  const harness = harnessName();
  const extra = extras.get(placeKey(place)) ?? {};
  const { model, usage, satelliteOf, satelliteOfId } = P;
  return {
    ...(model ? { model } : {}),
    // Язык места (#6080): английский мост просит en; русский молчит — решает умолчание сервера.
    ...(lang() === "en" ? { locale: "en" as const } : {}),
    ...(CFG.satellite && satelliteOfId ? { satellite_of: satelliteOfId } : {}),
    attrs: {
      ...extra,
      build: { name: "iskron-bridge", version: VERSION, stamp: BUILD.split("+")[1] ?? "" },
      skills: skillsAttr(),
      ...(harness ? { harness, harness_version: harnessVersion() } : {}),
      ...(satelliteOf ? { satellite_of: satelliteOf } : {}),
      ...(usage ? { usage } : {}),
    },
  };
}

const PLACE_ACTIONS = new Set(["connect", "mint", "register"]);

/**
 * Эхо locale в ответе connect/register (api отвечает действующим языком места):
 * расходится с запрошенным — одна строка в лог на сессию; эха нет — старый api, молчим.
 * Поле locale structuredContent (fields.ts) сильнее строки в прозе.
 */
export function noteLocaleEcho(
  args: Record<string, unknown>,
  text: string,
  structured?: unknown,
): void {
  const asked = args.locale;
  if (typeof asked !== "string" || P.localeWarned) return;
  const action = String(args.action);
  // Поле — только у ответа места; прочие ходы, как и прежде, судятся одной прозой.
  const field = PLACE_ACTIONS.has(action) ? seatField(structured, action)?.locale : undefined;
  const echo = (
    field ?? /\blocale\b["']?\s*[:=]\s*["']?([a-z]{2})\b/i.exec(text)?.[1]
  )?.toLowerCase();
  if (!echo || echo === asked) return;
  P.localeWarned = true;
  log(`locale: asked ${asked}, the server answered ${echo} — its prose stays in ${echo}`);
}

/**
 * connect/mint/register, которые агент зовёт сам (стояние пятью вызовами), несут
 * те же поля: его model и attrs запоминаются, признак сборки дописывается поверх.
 */
export function withPlaceFields(args: Record<string, unknown>): Record<string, unknown> {
  if (!PLACE_ACTIONS.has(String(args.action))) return args;
  rememberModel(args.model);
  if (args.attrs && typeof args.attrs === "object" && !Array.isArray(args.attrs))
    extras.set(placeKey(args), { ...(args.attrs as Record<string, unknown>) });
  return { ...args, ...placeFields(args) };
}
