# Deterministic VM acceptance transport

These are development probes, not files included in the npm package. They use
OpenCode's HTTP API. Only channel response tests need a model; setup commands do not.

Before creating a paid VM, verify the executor on the target OpenCode binary:

```sh
node js/tests/opencode-shell-live.mjs /absolute/path/to/opencode
```

It asserts exact output markers, distinguishes inner exit 0 from exit 7, exercises
loopback HTTP 200/503, checks the operator CLI's base64 transport, rejects an input
marker as evidence of a reply, and asserts zero requests to the fixture model.
The shell API can return HTTP 200 and a completed tool even for a failed command.
Neither sign substitutes for the script's receipt and explicit success marker.

## Operator client

Set `EDGE_BASE` to the **actual** VM entry URL returned by the orchestrator. The
trailing `/vm/TENANT/INSTANCE/` prefix is retained for all API requests. The client
does not follow redirects or send credentials to a different origin.

The bearer is read in memory from `VERIFY_OPENCODE_BEARER`, or from
`VERIFY_OPENCODE_CONFIG` (default `~/.config/opencode/opencode.jsonc`, the
`mcp.dark-orchestrator.headers.Authorization` field). Never place it in commands
sent to a guest, scripts, URLs or printed output. `VERIFY_OPENCODE_NO_AUTH=1` is
for local fixtures and overrides both sources. TLS is checked by default; only
for the known self-signed verification edge set `VERIFY_OPENCODE_INSECURE_TLS=1`.

```sh
node js/tests/opencode-vm.mjs probe "$EDGE_BASE"
node js/tests/opencode-vm.mjs create "$EDGE_BASE" npm-verification-setup
node js/tests/opencode-vm.mjs shell "$EDGE_BASE" "$SETUP_SESSION" reviewed-installer.sh
```

`shell` sends a base64-encoded reviewed shell file to `POST /session/ID/shell`.
The remote wrapper distinguishes success and failure with a fresh marker. This
does not make a secret-printing script safe: review the file before sending it.
Use a deterministic installer that prints only safe structured receipts. Transport
failure after a mutation is **unknown**: run the separate read-only comparison,
never repeat PUT automatically. A configuration change may restart OpenCode and
cut the response even when the write succeeded.

## Channel acceptance

After actual plugin loading (not just configuration acknowledgement):

```sh
node js/tests/opencode-vm.mjs tools "$EDGE_BASE"
node js/tests/opencode-vm.mjs create "$EDGE_BASE" npm-verification-A
node js/tests/opencode-vm.mjs create "$EDGE_BASE" npm-verification-B
node js/tests/opencode-vm.mjs prompt "$EDGE_BASE" "$SESSION_A" reviewed-A-prompt.txt
node js/tests/opencode-vm.mjs prompt "$EDGE_BASE" "$SESSION_B" reviewed-B-prompt.txt
node js/tests/opencode-vm.mjs wait "$EDGE_BASE" "$SESSION_A" READY-A
node js/tests/opencode-vm.mjs wait "$EDGE_BASE" "$SESSION_B" READY-B
```

Choose a model from the guest's current catalog with `VERIFY_OPENCODE_MODEL`,
or leave it unset to use the server's configured model. Check explicit retry/error
state before extending a timeout; a rate-limited model is not a channel failure.

Each prompt tells its own agent to take and register a distinct standing, report
READY-A/B, then answer an incoming `NPM_WAKE_...` token with ACK and that entire
token **including the NPM_WAKE_ prefix**. A separate sender posts channel frames. The `wait` command only reads
messages/status: it does not send a prompt and cannot itself wake the model.

```sh
node js/tests/opencode-vm.mjs wait "$EDGE_BASE" "$SESSION_B" "$FRESH_MARKER"
node js/tests/opencode-vm.mjs assert-absent "$EDGE_BASE" "$SESSION_A" "$FRESH_MARKER"
```

Require a completed, error-free assistant response and idle state; merely seeing
the marker in an incoming user message is not evidence of an answer. Repeat for
both sessions and after idle, delete A, then verify B again. Delete only the
probe's sessions and standings, tear down its VM, and confirm terminal retirement.
An operator setup session means this procedure does not prove installation before
*any* OpenCode session; record bootstrap cloning separately too.
