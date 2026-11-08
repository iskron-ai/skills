// Правила по образцу nks-mcp: recommended + typescript-eslint + сортировка
// импортов + запрет неиспользуемого + prettier последним, чтобы форматирование
// не спорило с линтом. `any` и `!` — предупреждения, не ошибки: JSON-RPC-
// полезная нагрузка и ответы сервера приходят без схемы, и там `any`
// сознателен; CI падает только на ошибках.
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import unusedImports from "eslint-plugin-unused-imports";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Деревья гейта границы ядра — нарочно нарушающие куски, не модули.
    ignores: ["node_modules", "tests/fixtures/core-gate/**"],
  },
  {
    files: ["**/*.{ts,mjs}"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
    plugins: {
      "simple-import-sort": simpleImportSort,
      "unused-imports": unusedImports,
    },
    rules: {
      "no-unused-vars": "off",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        { vars: "all", varsIgnorePattern: "^_", args: "after-used", argsIgnorePattern: "^_" },
      ],
      "simple-import-sort/imports": "error",
      "simple-import-sort/exports": "error",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // Файл длиннее 500 строк читается хуже, чем два по 250: правило владельца,
      // и держится оно здесь, а не памятью — считаются все строки, без скидок.
      "max-lines": ["error", { max: 500, skipBlankLines: false, skipComments: false }],
    },
  },
  {
    files: ["**/*.ts"],
    extends: [...tseslint.configs.recommended],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
    },
  },
  {
    // Запрос моста называет отправителя (#9972): fetch и WebSocket — только через
    // shared/http.ts, в том числе через globalThis.
    files: ["{bridge,shared,cli,opencode,extension,watchdog}/**/*.ts"],
    ignores: ["shared/http.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "namedFetch из shared/http.ts несёт user-agent поставки." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='WebSocket']",
          message: "namedSocket из shared/http.ts несёт user-agent поставки.",
        },
        {
          selector:
            "MemberExpression[object.name=/^(globalThis|global)$/][property.name=/^(fetch|WebSocket)$/]",
          message: "namedFetch и namedSocket из shared/http.ts несут user-agent поставки.",
        },
      ],
    },
  },
  {
    // Пробы: один файл на набор, и набор моста один — 47 сцен против одного
    // фейка. Правило 500 строк писано про отгружаемый код, который читает
    // потребитель; здесь оно снято сознательно, а не забыто.
    files: ["tests/**/*.mjs"],
    rules: { "max-lines": "off" },
  },
  {
    // Рендер роадмапа бежит в браузере человека, не в Node.
    files: ["roadmap/**/*.ts"],
    languageOptions: { globals: { ...globals.browser } },
  },
  prettier,
);
