#!/usr/bin/env node
// Настоящий демон (bridge/daemon.ts), задержанный перед стартом — шов для проб
// (js/tests/daemon.test.mjs): поднятый тонким мостом демон встаёт на
// ISKRON_TEST_DAEMON_DELAY_MS позже, отчего миг рукопожатия переподхвата
// предсказуем — без этого тайминг подъёма процесса решал бы, что видит проба.
import { daemonMain } from "../bridge/daemon.ts";

const delay = Number(process.env.ISKRON_TEST_DAEMON_DELAY_MS) || 0;
if (delay) await new Promise((r) => setTimeout(r, delay));
const argv = process.argv.slice(2);
await daemonMain(argv[0] === "daemon" ? argv.slice(1) : argv);
