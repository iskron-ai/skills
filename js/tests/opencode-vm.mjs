// Operator-side client for an isolated verification VM. No model decides commands.
// Token stays in memory; do not pass secret-bearing scripts to the shell action.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { homedir } from "node:os";
import { join } from "node:path";

import ts from "typescript";

const [action, input, id, arg] = process.argv.slice(2);
assert.ok(
  action && input,
  "Usage: opencode-vm.mjs probe|tools|create|shell|prompt|observe|delete URL [session/title] [file]",
);
const base = new URL(input.endsWith("/") ? input : `${input}/`);
assert.ok(
  ["http:", "https:"].includes(base.protocol) &&
    !base.username &&
    !base.password &&
    !base.search &&
    !base.hash,
);
let authorization;
if (process.env.VERIFY_OPENCODE_NO_AUTH === "1") {
  authorization = undefined;
} else if (process.env.VERIFY_OPENCODE_BEARER) {
  authorization = `Bearer ${process.env.VERIFY_OPENCODE_BEARER}`;
} else if (process.env.VERIFY_OPENCODE_NO_AUTH !== "1") {
  const path =
    process.env.VERIFY_OPENCODE_CONFIG || join(homedir(), ".config/opencode/opencode.jsonc");
  const parsed = ts.parseConfigFileTextToJson(path, readFileSync(path, "utf8"));
  assert.ok(!parsed.error, "cannot parse operator config");
  authorization = parsed.config.mcp?.["dark-orchestrator"]?.headers?.Authorization;
  assert.ok(/^Bearer\s+\S+$/.test(authorization ?? ""), "no configured tenant bearer");
}

function request(path, method = "GET", body) {
  const url = new URL(path, base);
  assert.equal(url.origin, base.origin, "never forward auth to a different origin");
  const bytes = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method,
        rejectUnauthorized: process.env.VERIFY_OPENCODE_INSECURE_TLS !== "1",
        headers: {
          "content-type": "application/json",
          ...(authorization ? { Authorization: authorization } : {}),
          ...(bytes ? { "content-length": Buffer.byteLength(bytes) } : {}),
        },
      },
      (res) => {
        let text = "";
        res.on("data", (chunk) => {
          text += chunk;
          if (text.length > 8 * 1024 * 1024) req.destroy(new Error("response exceeds probe limit"));
        });
        res.on("end", () => {
          if (res.statusCode < 200 || res.statusCode >= 300)
            return reject(new Error(`${method} ${path}: HTTP ${res.statusCode}; response omitted`));
          if (res.statusCode === 204 || !text) return resolve(null);
          try {
            resolve(JSON.parse(text));
          } catch {
            reject(new Error(`${method} ${path}: response is not JSON`));
          }
        });
        res.on("error", reject);
      },
    );
    const timer = setTimeout(
      () =>
        req.destroy(
          new Error(`${method} ${path}: outcome unknown after 90s; read back before retry`),
        ),
      90000,
    );
    req.on("close", () => clearTimeout(timer));
    req.on("error", (error) => reject(error));
    req.end(bytes);
  });
}
const print = (value) => process.stdout.write(JSON.stringify(value) + "\n");
const selectedModel = () => {
  const model = process.env.VERIFY_OPENCODE_MODEL;
  if (!model) return undefined;
  const slash = model.indexOf("/");
  assert.ok(slash > 0 && slash < model.length - 1);
  return { providerID: model.slice(0, slash), modelID: model.slice(slash + 1) };
};
const sessionPath = () => {
  assert.ok(/^ses_[a-zA-Z0-9]+$/.test(id ?? ""), "expected session ID");
  return `session/${id}`;
};
switch (action) {
  case "probe": {
    const health = await request("global/health");
    assert.equal(health.healthy, true);
    print({ healthy: health.healthy, version: health.version });
    break;
  }
  case "tools": {
    const tools = await request("experimental/tool/ids");
    assert.ok(Array.isArray(tools) && tools.every((t) => typeof t === "string"));
    const skills = await request("skill");
    print({
      iskronTools: tools.filter((t) => t.startsWith("iskron_")),
      skills: skills.map((s) => ({ name: s.name, location: s.location })),
    });
    break;
  }
  case "catalog": {
    const agents = await request("agent");
    const tools = await request("experimental/tool/ids");
    assert.ok(Array.isArray(agents) && agents.every((a) => typeof a.name === "string"));
    assert.ok(Array.isArray(tools) && tools.every((t) => typeof t === "string"));
    print({
      agents: agents.map((a) => ({
        name: a.name,
        model:
          typeof a.model === "string"
            ? a.model
            : a.model
              ? {
                  providerID: a.model.providerID,
                  modelID: a.model.modelID,
                }
              : null,
      })),
      tools,
    });
    break;
  }
  case "create": {
    assert.ok(id, "a specific verification title is required");
    const session = await request("session", "POST", { title: id });
    assert.ok(session.id && !session.parentID, "expected a new root session");
    print({ sessionID: session.id });
    break;
  }
  case "shell": {
    assert.ok(arg, "a reviewed shell script path is required");
    const encoded = readFileSync(arg).toString("base64");
    const marker = `EXEC_${randomUUID().replaceAll("-", "")}`;
    const command = `if bash -o pipefail -c 'printf %s ${encoded} | base64 -d | bash'; then printf '\\n${marker}=OK\\n'; else printf '\\n${marker}=FAIL\\n'; fi`;
    const result = await request(`${sessionPath()}/shell`, "POST", {
      agent: "build",
      model: selectedModel(),
      command,
    });
    const output = result.parts?.find((p) => p.type === "tool")?.state?.output ?? "";
    const markerOffset = output.lastIndexOf(marker);
    if (markerOffset >= 0) process.stdout.write(output.slice(0, markerOffset));
    if (!output.trim().endsWith(`${marker}=OK`))
      throw new Error(
        `Shell failed or result incomplete; inspect session ${id} before retrying a mutation`,
      );
    print({ shellCompleted: true, sessionID: id });
    break;
  }
  case "prompt": {
    assert.ok(arg, "a reviewed prompt path is required");
    await request(`${sessionPath()}/prompt_async`, "POST", {
      model: selectedModel(),
      parts: [{ type: "text", text: readFileSync(arg, "utf8") }],
    });
    print({ accepted: true, sessionID: id });
    break;
  }
  case "observe": {
    const messages = await request(`${sessionPath()}/message`);
    const statuses = await request("session/status");
    const retryText = String(statuses[id]?.message ?? "");
    print({
      sessionID: id,
      state: statuses[id]?.type ?? "idle",
      retryAttempt: statuses[id]?.attempt ?? null,
      retryClass: [
        ["rate-limit", /429|rate.?limit/i],
        ["upstream-5xx", /50[0-9]|internal server|overload|unavailable/i],
        ["context-size", /context|too many tokens|too long|maximum.*token/i],
        ["auth", /401|403|unauthorized|forbidden|authentication/i],
        ["model", /model.*(?:not found|unknown|unsupported)/i],
        ["network", /timeout|ECONN|ENOTFOUND|fetch failed/i],
      ]
        .filter(([, pattern]) => pattern.test(retryText))
        .map(([name]) => name),
      messages: messages.map((m) => ({
        id: m.info.id,
        role: m.info.role,
        completed: m.info.time?.completed ?? null,
        error: m.info.error?.name ?? null,
        finish: m.info.finish ?? null,
        model: m.info.modelID ?? m.info.model?.modelID ?? null,
        parts: m.parts.map((p) => ({
          type: p.type,
          textLength: typeof p.text === "string" ? p.text.length : null,
        })),
        tools: m.parts
          .filter((p) => p.type === "tool")
          .map((p) => ({ name: p.tool, state: p.state.status })),
        markers: m.parts
          .filter((p) => p.type === "text")
          .flatMap(
            (p) =>
              p.text.match(
                /READY-[AB]|ACK(?:[: _-]+[AB])?[: _-]+NPM_WAKE_[A-Za-z0-9_-]+|NPM_WAKE_[A-Za-z0-9_-]+/g,
              ) ?? [],
          ),
      })),
    });
    break;
  }
  case "wait":
  case "assert-absent": {
    assert.ok(
      /^(READY-[AB]|NPM_WAKE_[A-Za-z0-9_-]+)$/.test(arg ?? ""),
      "expected a verification marker",
    );
    const timeout = Number(process.env.VERIFY_OPENCODE_WAIT_MS || 180000);
    assert.ok(Number.isFinite(timeout) && timeout >= 1000 && timeout <= 300000);
    const deadline = Date.now() + timeout;
    for (;;) {
      const messages = await request(`${sessionPath()}/message`);
      const replies = messages.filter(
        (m) =>
          m.info.role === "assistant" &&
          m.parts.some((p) => p.type === "text" && p.text.includes(arg)),
      );
      if (action === "assert-absent") {
        assert.equal(replies.length, 0, "marker leaked to the other session");
        print({ absent: true, sessionID: id, marker: arg });
        break;
      }
      const statuses = await request("session/status");
      const answered = replies.find((m) => !m.info.error && m.info.time?.completed);
      if (answered && (!statuses[id] || statuses[id].type === "idle")) {
        print({
          answered: true,
          idle: true,
          sessionID: id,
          marker: arg,
          messageID: answered.info.id,
        });
        break;
      }
      assert.ok(
        Date.now() < deadline,
        "no completed assistant response and idle state before deadline",
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    break;
  }
  case "delete":
    await request(sessionPath(), "DELETE");
    print({ deleted: id });
    break;
  case "abort":
    await request(`${sessionPath()}/abort`, "POST");
    print({ aborted: id });
    break;
  case "last-answer": {
    const messages = await request(`${sessionPath()}/message`);
    const last = messages.filter((m) => m.info.role === "assistant").at(-1);
    const text =
      last?.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n") ?? "";
    assert.ok(
      text.length <= 200 &&
        !/https?:|wss?:|token|bearer|secret|password|sk-|[A-Za-z0-9+/=]{24,}/i.test(text),
      "answer requires protected inspection",
    );
    print({ sessionID: id, answer: text });
    break;
  }
  case "idle-age": {
    const messages = await request(`${sessionPath()}/message`);
    const statuses = await request("session/status");
    const last = messages.filter((m) => m.info.role === "assistant").at(-1);
    assert.ok(!statuses[id] || statuses[id].type === "idle", "session is not idle");
    assert.ok(last?.info.time?.completed && !last.info.error);
    const idleMs = Date.now() - last.info.time.completed;
    assert.ok(idleMs >= 60000, "need at least 60 seconds after last completion");
    print({ sessionID: id, idleMs, lastCompleted: last.info.time.completed });
    break;
  }
  default:
    throw new Error("unknown probe action");
}
