// Заголовок и группы тестовой прозы realm list (fake-nks). Строки — разбор моста shared/realm-list.ts.
export const REALM_LIST_HEADER = /^Доступные графы \((\d+)\) —[^\n]*$/m;
export const REALM_LIST_GROUP = /^▸ @([A-Za-z0-9_.-]+)(?:\s.*)?$/;
