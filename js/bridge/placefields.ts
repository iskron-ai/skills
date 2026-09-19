// Чем стояние является — поля места, которые мост называет при каждом занятии и
// каждой регистрации (граф nks-dev: #5174): model — модель, которой бежит агент
// (без префикса поставщика), attrs — признак сборки {name, version, stamp} и
// харнес. attrs на поверхности заменяются целиком, поэтому мост всегда шлёт
// полный свой набор: частичная запись стёрла бы его же признак сборки.
import { VERSION } from "../shared/version.ts";
import { BUILD } from "./build.ts";
import { harnessName } from "./client.ts";

let model = "";

/** Модель из iskron_stand — едет полем места и во всех повторных регистрациях. */
export function rememberModel(m: unknown): void {
  if (typeof m === "string" && m.trim()) model = m.trim().replace(/^[^/]*\//, "");
}

/** Поля места для connect и register: всегда полный набор моста. */
export function placeFields(): { model?: string; attrs: Record<string, unknown> } {
  const harness = harnessName();
  return {
    ...(model ? { model } : {}),
    attrs: {
      build: { name: "iskron-bridge", version: VERSION, stamp: BUILD.split("+")[1] ?? "" },
      ...(harness ? { harness } : {}),
    },
  };
}
