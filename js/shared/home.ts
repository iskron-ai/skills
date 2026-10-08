import { homedir } from "node:os";
import { join } from "node:path";

import { HOME_BRIDGE_FILE, HOME_DIR } from "../delivery/index.ts";

/** Имя домашней копии моста — контракт с конфигами харнесов, и оно не меняется с именем файла в поставке. */
export const homeBridgePath = (): string => join(homedir(), HOME_DIR, HOME_BRIDGE_FILE);
