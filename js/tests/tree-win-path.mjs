import path from "node:path";

export default path.win32;
export const { isAbsolute, join, relative } = path.win32;
