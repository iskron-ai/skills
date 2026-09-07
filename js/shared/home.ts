import { homedir } from "node:os";
import { join } from "node:path";

/** Имя домашней копии моста — контракт с конфигами харнесов, и оно не меняется с именем файла в поставке. */
export const homeBridgePath = (): string => join(homedir(), ".iskron-bridge", "iskron-bridge.mjs");
