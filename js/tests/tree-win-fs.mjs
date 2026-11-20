import * as fs from "node:fs";
import path from "node:path";

const root = () => globalThis.treeWinRoot;
export const toNative = (p) => {
  if (typeof p !== "string" || !/^C:\\win(?:\\|$)/i.test(p)) return p;
  return path.join(root(), ...p.slice(6).split("\\").filter(Boolean));
};
export const toWindows = (p) => {
  if (!p.startsWith(root())) return p;
  return `C:\\win${p.slice(root().length).split(path.sep).join("\\")}`;
};
export const existsSync = (p) => fs.existsSync(toNative(p));
export const mkdirSync = (p, opts) => fs.mkdirSync(toNative(p), opts);
export const lstatSync = (p) => fs.lstatSync(toNative(p));
export const realpathSync = { native: (p) => toWindows(fs.realpathSync.native(toNative(p))) };
export const readFileSync = (p, opts) => {
  const result = fs.readFileSync(toNative(p), opts);
  if (typeof result === "string" && p.endsWith("\\gitdir"))
    return (globalThis.treeWinGitdir ?? toWindows(result.trim())).replaceAll("\\", "/") + "\n";
  return result;
};
export const openSync = (p, ...args) => fs.openSync(toNative(p), ...args);
export const unlinkSync = (p) => fs.unlinkSync(toNative(p));
export const { closeSync, fstatSync } = fs;
