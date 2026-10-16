// Наблюдённая проза realm list (фикстура fake-nks, дела №777/№932).
export const REALM_LIST_HEADER = /^Доступные графы \((\d+)\) —[^\n]*$/m;
export const REALM_LIST_ROW = /^ {4}(@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+) {2}r\d+ {2}.* · .+$/;
export const REALM_LIST_GROUP = /^▸ @([A-Za-z0-9_.-]+)(?:\s.*)?$/;
export const REALM_LIST_ORG = /^▸ @([A-Za-z0-9_.-]+) \(организация\)$/;
