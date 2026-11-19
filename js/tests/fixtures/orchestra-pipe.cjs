// Model a Windows pipe: its name cannot be unlinked while the listener owns it.
const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");
const unlink = fs.unlinkSync;
fs.unlinkSync = function (path, ...args) {
  if (String(path).endsWith("orchestra.sock")) return;
  return unlink.call(this, path, ...args);
};
syncBuiltinESMExports();
