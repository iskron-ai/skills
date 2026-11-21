// A volume at 1% free for a probe's process (`NODE_OPTIONS=--require <this>`): statfsSync of
// node:fs answers so, the built outputs' named import included (syncBuiltinESMExports). The
// real disk is never filled. Used where no real volume below the floor can hold a checkout.
const fs = require("node:fs");
fs.statfsSync = () => ({
  type: 0,
  bsize: 4096,
  blocks: 1000,
  bfree: 10,
  bavail: 10,
  files: 0,
  ffree: 0,
});
require("node:module").syncBuiltinESMExports();
