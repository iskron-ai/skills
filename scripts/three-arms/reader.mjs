// Reuse the LAB ledger's forwarding and cancellation; no credentials or live CLI here.
import { createLedger } from "../stand-mcp-ledger.mjs";
import { readerCall } from "./protocol.mjs";

export function createReaderLedger({ realm, record, fetchImpl }) {
  if (typeof realm !== "string" || !realm.trim()) throw new Error("reader realm required");
  return createLedger({ record, fetchImpl, authorizeRequest(request) {
    // Initialization/tool discovery cannot read case contents. Calls use an exact tool/realm allowlist.
    if (["initialize", "notifications/initialized", "tools/list"].includes(request?.method)) return true;
    return readerCall(request, realm);
  } });
}
