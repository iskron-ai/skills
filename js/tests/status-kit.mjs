import { spawn, spawnSync } from "node:child_process";

import { connectSeam, helloFrame } from "../shared/seam.ts";
import { seamSocketPath } from "../shared/seam-entrance.ts";
import { BUILT_BRIDGE } from "./built.mjs";

export const BRIDGE = process.env.ISKRON_BRIDGE_PATH || BUILT_BRIDGE;
export const NODE = process.env.ISKRON_NODE || process.execPath;
export const env = {
  ...process.env,
  ISKRON_BRIDGE_NO_UPDATE: "1",
  ISKRON_BRIDGE_TOKEN: "status-pat",
};
export const status = (dir, args = []) =>
  spawnSync(NODE, [BRIDGE, "status", "--auth-dir", dir, ...args], {
    env,
    encoding: "utf8",
    timeout: 7000,
    input: "",
  });
export const asyncStatus = (dir, args = []) =>
  new Promise((resolve, reject) => {
    const child = spawn(NODE, [BRIDGE, "status", "--auth-dir", dir, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("status timed out"));
    }, 7000);
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
export const rpc = (link, method, params, id) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no reply: ${method}`)), 5000);
    link.onFrame((f) => {
      if (f.t === "rpc" && f.msg.id === id) {
        clearTimeout(timer);
        resolve(f.msg);
      }
    });
    link.send({ t: "rpc", msg: { jsonrpc: "2.0", id, method, params } });
  });
export async function entrance(dir) {
  for (let i = 0; i < 100; i++) {
    try {
      return await connectSeam(
        seamSocketPath(dir),
        helloFrame({ build: "v7.9.0+test", path: BRIDGE, argv: [], probe: true }),
        200,
      );
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error("daemon did not rise");
}
