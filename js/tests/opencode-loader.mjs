// Резолвер для пробы плагина OpenCode: в сессии OpenCode `@opencode-ai/plugin`
// лежит рядом с каталогом плагинов, а здесь — в js/node_modules; проба грузит
// собранный файл из песочницы вне репозитория, где ни того ни другого нет.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export async function resolve(specifier, context, next) {
  if (specifier === "@opencode-ai/plugin") {
    return {
      url: pathToFileURL(
        join(HERE, "..", "node_modules", "@opencode-ai", "plugin", "dist", "index.js"),
      ).href,
      shortCircuit: true,
    };
  }
  return next(specifier, context);
}
