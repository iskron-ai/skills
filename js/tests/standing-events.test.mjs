// Одно событие — один раз в ход, текстом или числом (standing.suite.mjs).
process.env.ISKRON_STANDING_PART = "events";
await import("./standing.suite.mjs");
