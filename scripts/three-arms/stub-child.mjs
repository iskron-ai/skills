// Only an IPC-driven, loopback, synthetic provider. No model route, credentials or config reads.
const port = Number(process.argv[2]);
if (!process.send || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("IPC and loopback port required");
let sequence = 0;
process.on("message", async (message) => {
  if (message !== "permit") return;
  const response = await fetch(`http://127.0.0.1:${port}/synthetic`, { method: "POST", body: "stub" });
  if (!response.ok) process.exit(2);
  process.send({ sequence: ++sequence, inputUpper: 6, outputUpper: 2, basis: "synthetic-byte-contract" });
});
process.send({ sequence, inputUpper: 6, outputUpper: 2, basis: "synthetic-byte-contract" });
