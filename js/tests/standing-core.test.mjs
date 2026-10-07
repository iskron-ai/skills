// Стояние, которое держит мост: connect, сокет, сторожа, веер, кольцо (standing.suite.mjs).
process.env.ISKRON_STANDING_PART = "core";
await import("./standing.suite.mjs");
