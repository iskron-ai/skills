import { buildOf } from "../shared/version.ts";

// Сборка, которую несёт ЭТОТ файл: в однофайловом выходе import.meta.url — сам
// выход, и хеш называет байты, которые реально бежали.
export const BUILD = buildOf(import.meta.url);
