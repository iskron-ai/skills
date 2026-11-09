// `orchestra <on|off|status|step|demands>`: the machine daemon's orchestration door
// daemon through its local door (graph @nks/nks-dev, nodes #7513, #7514, #8202). The daemon
// owns the flag and persists it next to the grant; without a daemon every op is refused with
// its cause. `on` needs the machine's consent — the daemon's own environment admits the
// orchestrator — and extends the named boundary with each `--realm`; `off` clears it;
// `status` reads what lies, cursors and last outcomes included; `step` reads both queues of
// every named graph from the daemon's cursor and moves the cursors only when all read;
// `step --dry-run` judges one tact and acts on nothing (bridge/orchestra-plan.ts).
import { parseArgs } from "../bridge/config.ts";
import { isOrchestraOp, orchestraAsk, type OrchestraOp } from "../bridge/orchestra-door.ts";
import { envName, ORCHESTRA, type OrchestraWords } from "../delivery/index.ts";
import { setLang, words } from "../shared/lang.ts";
import { defaultAuthDir } from "../shared/standings.ts";

const w = (): OrchestraWords => words(ORCHESTRA);

/** The flag's value, taken out of args. */
function take(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  if (i < 0) return undefined;
  return args.splice(i, 2)[1];
}

export async function runOrchestra(argv: string[]): Promise<void> {
  const args = [...argv];
  const lang = take(args, "--lang");
  setLang(lang);
  const realms: string[] = [];
  for (let i = 0; i < args.length; i++)
    if (args[i] === "--realm" && args[i + 1] !== undefined) {
      realms.push(args[i + 1]);
      args.splice(i, 2);
      i--;
    }
  const authDir =
    take(args, "--auth-dir") || process.env[envName("BRIDGE_AUTH_DIR")] || defaultAuthDir();
  const dry = args.indexOf("--dry-run");
  if (dry >= 0) args.splice(dry, 1);
  const named = args.find((a) => !a.startsWith("--"));
  const fail = (text: string): void => {
    process.stderr.write(`${text}\n`);
    process.exitCode = 1;
  };
  // `step --dry-run` is the door's own op: the same reading, judged and said, acting on nothing.
  if (!named || named === "plan" || !isOrchestraOp(named) || (dry >= 0 && named !== "step"))
    return fail(w().usage().trimEnd());
  const op: OrchestraOp = dry >= 0 ? "plan" : named;
  parseArgs(["--auth-dir", authDir, ...args.filter((a) => a !== named)]);
  const slow = op === "demands" || op === "plan";
  const answer = await orchestraAsk(authDir, op, realms, slow ? 120_000 : 5_000);
  if (answer.demands) {
    process.stdout.write(`${JSON.stringify(answer.demands)}\n`);
    if (!answer.ok) process.exitCode = 1;
    return;
  }
  if (!answer.ok) return fail(answer.said);
  process.stdout.write(`${answer.said}\n`);
}
