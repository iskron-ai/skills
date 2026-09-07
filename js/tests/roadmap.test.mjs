// Probe for the roadmap renderer (js/roadmap/render.ts — graph nks-dev: #4060).
// Until this file the shipped html template had no cover at all: its script was
// 487 lines of browser JS that only a human opening the page could judge. The
// renderer is now pure functions (data → html), so the part that decides what
// the human sees is judged here, in Node, on a fixture; only the DOM mounting
// (js/roadmap/main.ts) still waits for a browser.
//
// The source is imported directly — Node strips the types (22.18+ needs no
// flag); the build inlines the same code into the template, and check-js
// holds the two together.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createRenderer, esc } from "../roadmap/render.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(
  HERE,
  "..",
  "..",
  "skills",
  "product-roadmap",
  "references",
  "roadmap-template.html",
);

const fixture = () => ({
  repo: "acme/thing",
  repoUrl: "https://github.com/acme/thing",
  version: "v1.2.3",
  generated: "2026-09-07",
  tagline: 'A <b>tag</b> & "quotes"',
  nextMoves: ["Merge #12 first", "Then look at ISKRON#4220"],
  product: {
    summary: "It does things.",
    subsystems: [
      {
        name: "Core",
        primitive: "src/core.ts",
        capabilities: [{ name: "Runs", primitive: "run()" }],
      },
    ],
    entities: [{ name: "Thing", primitive: "db things" }],
  },
  estafeta: {
    name: "Thing lifecycle",
    steps: [{ label: "Make" }, { label: "Ship", primitive: "ci" }],
  },
  directions: [
    {
      id: "D1",
      name: "Things get faster",
      status: "committed",
      extends: "Core",
      telos: "Things are fast.",
      karta: "Maintainer",
      drivers: [
        {
          ref: 12,
          kind: "pr",
          title: "Speed <up>",
          author: "alice",
          assoc: "OWNER",
          weight: "high",
          state: "open",
          readiness: "ready",
          action: "merge",
        },
      ],
      risks: ["see #7"],
      unblocks: ["D2"],
    },
    { id: "D2", name: "Deferred one", status: "deferred", extends: "x", telos: "y" },
  ],
  signalAudit: [{ ref: 3, title: "Hot issue", reactions: 9, comments: 2, disposition: "in:D1" }],
  structuralRisks: [{ label: "Dead recipe", note: "no producing flow" }],
  field: {
    kartas: [{ name: "Maintainer", kind: "maintainer", drives: "D1" }],
    figureOnGround: [{ dir: "D1", capability: "Core" }],
  },
});

test("esc neutralises markup in every field it touches", () => {
  assert.equal(esc('<a href="x">&</a>'), "&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;");
  assert.equal(esc(null), "");
  assert.equal(esc(undefined), "");
});

test("the page carries every section, with the data escaped and the refs linked", () => {
  const r = createRenderer(fixture());
  const html = r.appHtml();
  for (const id of ["map", "next", "product", "flow", "directions", "signal", "field"]) {
    assert.ok(html.includes(`<section id="${id}"`), `no section #${id}`);
  }
  assert.ok(
    html.includes("A &lt;b&gt;tag&lt;/b&gt; &amp; &quot;quotes&quot;"),
    "tagline not escaped",
  );
  assert.ok(!html.includes("<b>tag</b>"), "raw markup leaked from the tagline");
  assert.ok(
    html.includes('href="https://github.com/acme/thing/issues/12"'),
    "bare #12 in a next move must link to the repo",
  );
  assert.ok(
    html.includes("ISKRON#4220") && !html.includes("issues/4220"),
    "an internal ref must stay plain text",
  );
  assert.ok(html.includes("Speed &lt;up&gt;"), "driver title not escaped");
  assert.ok(html.includes("PR </a>") || html.includes("PR #12"), "a PR driver is labelled as PR");
  assert.ok(
    html.includes('data-status="deferred"'),
    "the deferred direction is filterable by status",
  );
  assert.ok(html.includes("→ D1"), "a signal disposition in:D1 renders as an arrow to D1");
  assert.equal(r.title(), "acme/thing — roadmap");
  assert.ok(r.barRepoHtml().includes("acme/thing"));
});

test("multi-repo mode: qualified refs link per repo, bare refs stay plain", () => {
  const R = fixture();
  R.repos = { backend: "https://github.com/acme/backend", ui: "https://github.com/acme/ui" };
  R.nextMoves = ["Fix backend#45 and #9 and other#1"];
  const r = createRenderer(R);
  const html = r.appHtml();
  assert.ok(
    html.includes('href="https://github.com/acme/backend/issues/45"'),
    "backend#45 must link to the backend repo",
  );
  assert.ok(!html.includes("issues/9"), "a bare #9 is ambiguous across repos and must stay plain");
  assert.ok(
    html.includes("other#1") && !html.includes('issues/1"'),
    "an unknown prefix is not a repo",
  );
  assert.ok(html.includes("assembled across 2 repos"));
});

test("the graph view draws a hinge diamond between repos and a box per stage", () => {
  const R = fixture();
  R.repos = { a: "https://github.com/x/a", b: "https://github.com/x/b" };
  R.estafeta = {
    name: "flow",
    steps: [
      { label: "Make", repo: "a" },
      { label: "◆ handoff", hinge: true },
      { label: "Ship", repo: "b" },
    ],
  };
  const svg = createRenderer(R).graphView();
  assert.ok(svg.startsWith("<svg"), "graph view is an inline svg");
  assert.equal(
    (svg.match(/<rect x="[\d.]+" y="\d+" width="[\d.]+" height="52"/g) ?? []).length,
    2,
    "one box per non-hinge stage",
  );
  assert.ok(svg.includes('<path d="M '), "the hinge is drawn as a diamond path");
  assert.ok(
    svg.includes("gv-hinge-lbl") && svg.includes("handoff") && !svg.includes("◆ handoff"),
    "the hinge label loses its marker",
  );
});

test("the shipped template inlines this renderer and keeps ROADMAP as its own script", () => {
  const html = readFileSync(TEMPLATE, "utf8");
  assert.ok(
    html.includes("const ROADMAP = {"),
    "the data object the skill replaces must stay in the template",
  );
  assert.ok(!html.includes("@@RENDER@@"), "the render placeholder must be replaced by the build");
  assert.ok(html.includes("assembled across"), "the built renderer must be inlined");
  // Two scripts, in this order: data first, renderer second — the renderer reads
  // the global the first one declares.
  const scripts = [...html.matchAll(/<script>/g)].length;
  assert.equal(scripts, 2, `expected exactly two <script> blocks, found ${scripts}`);
  assert.ok(
    html.indexOf("const ROADMAP = {") < html.indexOf("assembled across"),
    "the data script must precede the renderer",
  );
});
