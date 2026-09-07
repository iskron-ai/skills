// Рендер роадмапа — чистые функции: данные → html. Ни document, ни window: то,
// что здесь, проверяется пробой в Node на фикстуре, а в браузере монтируется
// main.ts. Схема данных задокументирована в template.html над объектом ROADMAP.

export interface Driver {
  ref: number;
  repo?: string;
  kind?: "issue" | "pr";
  title: string;
  author?: string;
  assoc?: string;
  weight?: string;
  state?: string;
  readiness?: string;
  action?: string;
}

export interface Direction {
  id: string;
  name: string;
  status: string;
  repos?: string[];
  after?: string[] | string;
  extends?: string;
  telos?: string;
  karta?: string;
  kartaKind?: string;
  anga?: string;
  unblocks?: string[];
  risks?: string[];
  drivers?: Driver[];
}

export interface Step {
  label: string;
  repo?: string;
  primitive?: string;
  hinge?: boolean;
}

export interface Roadmap {
  repo: string;
  repoUrl: string;
  version?: string;
  generated?: string;
  tagline?: string;
  repos?: Record<string, string>;
  nextMoves?: string[];
  product: {
    summary?: string;
    subsystems?: {
      name: string;
      repo?: string;
      primitive?: string;
      capabilities?: { name: string; primitive?: string }[];
    }[];
    entities?: { name: string; primitive?: string }[];
  };
  estafeta?: { name?: string; steps?: Step[] };
  directions?: Direction[];
  signalAudit?: {
    ref: number;
    repo?: string;
    kind?: "issue" | "pr";
    title: string;
    reactions?: number;
    comments?: number;
    disposition?: string;
  }[];
  structuralRisks?: { label: string; note?: string; seam?: string }[];
  field?: {
    kartas?: { name: string; kind?: string; drives?: string }[];
    figureOnGround?: { dir: string; capability?: string }[];
  };
}

export const esc = (s: unknown): string =>
  String(s == null ? "" : s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  );

const statusLabel: Record<string, string> = {
  committed: "Committed",
  ready: "Ready",
  "in-flight": "In flight",
  deferred: "Deferred",
};
const rdLabel: Record<string, string> = {
  ready: "ready",
  conflicting: "needs rebase",
  ci: "CI pending",
  review: "needs review",
  draft: "draft",
  merged: "merged",
  closed: "closed",
  na: "",
};
const kartaIcon: Record<string, string> = { maintainer: "●", contributor: "◐", community: "○" };

/* multi-repo aware: a driver/signal ref may carry repo:'<key>' resolved via R.repos[key];
   single-repo runs omit repo and resolve via R.repoUrl. */
export function createRenderer(R: Roadmap) {
  const repoUrlOf = (repo?: string): string =>
    repo && R.repos && R.repos[repo] ? R.repos[repo] : R.repoUrl;
  const gh = (n: number | string, repo?: string): string => `${repoUrlOf(repo)}/issues/${n}`;
  const ref = (n: number, k?: string, repo?: string): string =>
    `<a class="ref" href="${gh(n, repo)}" target="_blank" rel="noopener">${k === "pr" ? "PR " : ""}${repo ? esc(repo) + "#" : "#"}${n}</a>`;
  const who = (login?: string, assoc?: string): string =>
    login
      ? `<span class="who ${/OWNER|MEMBER|COLLABORATOR/.test(assoc || "") ? "maintainer" : ""}"><a href="https://github.com/${esc(login)}" target="_blank" rel="noopener">${esc(login)}</a>${assoc ? `<span class="assoc">${esc(assoc)}</span>` : ""}</span>`
      : '<span class="who"></span>';
  const stBadge = (s: string): string =>
    `<span class="badge st st-${s}">${statusLabel[s] || esc(s)}</span>`;

  /* free-text refs: qualified 'backend#45' links if 'backend' is a known R.repos key;
     an unknown prefix (e.g. internal 'ISKRON#1120') is left as plain text — it is NOT a GitHub ref;
     a bare '#45' links via R.repoUrl in single-repo mode, but is left plain in multi-repo mode (ambiguous). */
  function linkRefs(s: string): string {
    return esc(s).replace(
      /([A-Za-z][\w.-]*)#(\d+)|#(\d+)/g,
      (m: string, repo: string | undefined, qn: string, bare: string) => {
        if (repo) {
          return R.repos && R.repos[repo]
            ? `<a class="ref" href="${repoUrlOf(repo)}/issues/${qn}" target="_blank" rel="noopener">${esc(repo)}#${qn}</a>`
            : m;
        }
        return R.repos
          ? m
          : `<a class="ref" href="${gh(bare)}" target="_blank" rel="noopener">#${bare}</a>`;
      },
    );
  }

  function dispBadge(d?: string): string {
    if (!d) return "";
    if (/^in:/.test(d)) return `<span class="disp disp-in">→ ${esc(d.slice(3))}</span>`;
    if (d === "deferred") return '<span class="disp disp-deferred">deferred</span>';
    return `<span class="disp disp-out">${esc(d)}</span>`;
  }

  /* ---------------------------------------------- cross-repo graph (SVG) ----
     Hand-rolled, zero-dep. Theme-safe: every fill is an oklch tint with an
     oklch border and var(--ink) text, so it reads on both paper and near-black.
     Renders from R.estafeta.steps / R.structuralRisks / R.directions / R.repos. */
  const GRAPH_HUES = [150, 75, 245, 300, 25, 190];
  function repoHueMap(): Record<string, number> {
    const m: Record<string, number> = {};
    const keys = R.repos && typeof R.repos === "object" ? Object.keys(R.repos) : [];
    keys.forEach((k, i) => {
      m[k] = GRAPH_HUES[i % GRAPH_HUES.length];
    });
    return m;
  }

  function graphView(): string {
    const W = 1080,
      MX = 24;
    const hues = repoHueMap();
    const repoKeys = Object.keys(hues);
    const isHinge = (s: Step): boolean =>
      !!s &&
      (s.hinge === true ||
        (typeof s.label === "string" && s.label.trim().charCodeAt(0) === 0x25c6)); /* ◆ */
    const cleanLabel = (l: unknown): string => String(l == null ? "" : l).replace(/^\s*◆\s*/, "");
    const fillFor = (h: number): string => `oklch(0.64 0.11 ${h} / 0.17)`;
    const strokeFor = (h: number): string => `oklch(0.58 0.13 ${h})`;
    const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));
    const cpw = (px: number, ppc: number): number => Math.max(3, Math.floor(px / ppc)); // char budget for a pixel width
    const txt = (
      x: number,
      y: number,
      cls: string,
      full: unknown,
      maxC: number,
      attrs = "",
    ): string => {
      // clip to width; clipped labels carry data-full for a custom instant tooltip
      const s = String(full == null ? "" : full).trim();
      const c = s.length <= maxC ? s : s.slice(0, Math.max(1, maxC - 1)).trimEnd() + "…";
      const df = c !== s ? ` data-full="${esc(s)}"` : "";
      return `<text x="${x}" y="${y}" class="${cls}${df ? " gv-clip" : ""}"${df}${attrs ? " " + attrs : ""}>${esc(c)}</text>`;
    };
    let svg = "",
      y = 18;

    /* ---- band 1: cross-repo spine ---- */
    const steps = R.estafeta && Array.isArray(R.estafeta.steps) ? R.estafeta.steps : [];
    const stages = steps.filter((s) => !isHinge(s));
    const hinges = steps.filter((s) => isHinge(s));
    if (stages.length) {
      svg += `<text x="${MX}" y="${y}" class="gv-band">The product, assembled — one item end to end across the repos</text>`;
      y += 18;
      const n = stages.length;
      const boxH = 52;
      const bw = clamp((W - 2 * MX) / n - 14, 150, 210);
      const slot = (W - 2 * MX) / n;
      const rowY = y;
      const cy = rowY + boxH / 2;
      const xOf = (i: number): number => MX + slot * i + (slot - bw) / 2;
      // arrows + hinges between stages first (under the boxes)
      for (let i = 0; i < n - 1; i++) {
        const x1 = xOf(i) + bw,
          x2 = xOf(i + 1);
        svg += `<line x1="${x1}" y1="${cy}" x2="${x2}" y2="${cy}" class="gv-edge" marker-end="url(#gv-arrow)"/>`;
        const h = hinges[i];
        if (h) {
          const hx = (x1 + x2) / 2,
            d = 7;
          svg += txt(
            hx,
            cy - 16,
            "gv-hinge-lbl",
            cleanLabel(h.label),
            cpw(x2 - x1 + 30, 5.2),
            'text-anchor="middle"',
          );
          svg += `<path d="M ${hx} ${cy - d} L ${hx + d} ${cy} L ${hx} ${cy + d} L ${hx - d} ${cy} Z" fill="var(--bg-sunk)" stroke="var(--line)" stroke-width="1.2"/>`;
        }
      }
      const single = repoKeys.length === 0; // single-repo: one neutral accent for all stages
      const ACC_HUE = 235;
      stages.forEach((s, i) => {
        const x = xOf(i),
          key = s.repo;
        const h = key != null && hues[key] != null ? hues[key] : single ? ACC_HUE : null;
        const fill = h != null ? fillFor(h) : "var(--panel)";
        const stroke = h != null ? strokeFor(h) : "var(--line)";
        svg += `<rect x="${x}" y="${rowY}" width="${bw}" height="${boxH}" rx="9" fill="${fill}" stroke="${stroke}" stroke-width="1.3"/>`;
        if (key != null && hues[key] != null) {
          // multi-repo box: repo key as title, step label as subtitle
          svg += txt(x + 11, rowY + 20, "gv-box-t", String(key), cpw(bw - 22, 7.3));
          svg += txt(x + 11, rowY + 38, "gv-box-s", s.label, cpw(bw - 22, 6.0));
        } else {
          // single-repo / repo-less step: label is the title
          svg += txt(x + 11, rowY + 31, "gv-box-t", s.label, cpw(bw - 22, 7.3));
        }
      });
      y = rowY + boxH + 34;
    }

    /* ---- band 2: findings strip ---- */
    const risks = (Array.isArray(R.structuralRisks) ? R.structuralRisks : []).slice(0, 6);
    if (risks.length) {
      svg += `<text x="${MX}" y="${y}" class="gv-band">Findings — what no single repo's tracker can see</text>`;
      y += 16;
      const perRow = 4;
      const rows = Math.ceil(risks.length / perRow);
      const pillH = 50,
        gap = 12;
      const fHue = fillFor(25),
        fStroke = strokeFor(25);
      for (let r = 0; r < rows; r++) {
        const rowItems = risks.slice(r * perRow, r * perRow + perRow);
        const pw = (W - 2 * MX - gap * (perRow - 1)) / perRow;
        const rowY = y + r * (pillH + 10);
        rowItems.forEach((risk, i) => {
          const x = MX + i * (pw + gap);
          svg += `<rect x="${x}" y="${rowY}" width="${pw}" height="${pillH}" rx="8" fill="${fHue}" stroke="${fStroke}" stroke-width="1.2"/>`;
          svg += txt(x + 10, rowY + 19, "gv-find-t", risk.label, cpw(pw - 20, 6.0));
          const sub = risk.seam || risk.note;
          svg += txt(x + 10, rowY + 37, "gv-find-s", sub, cpw(pw - 20, 6.0));
        });
      }
      y += rows * (pillH + 10) + 22;
    }

    /* ---- band 3: directions ---- */
    const dirs = Array.isArray(R.directions) ? R.directions : [];
    if (dirs.length) {
      svg += `<text x="${MX}" y="${y}" class="gv-band">Directions — where the product goes next</text>`;
      y += 16;
      const perRow = 5;
      const rows = Math.ceil(dirs.length / perRow);
      const boxH = 62,
        gap = 12;
      const greenHues: Record<string, boolean> = { ready: true, committed: true };
      for (let r = 0; r < rows; r++) {
        const rowItems = dirs.slice(r * perRow, r * perRow + perRow);
        const bw = (W - 2 * MX - gap * (perRow - 1)) / perRow;
        const rowY = y + r * (boxH + 12);
        rowItems.forEach((d, i) => {
          const x = MX + i * (bw + gap);
          const green = greenHues[d.status];
          const fill = green ? fillFor(150) : "var(--bg-sunk)";
          const stroke = green ? strokeFor(150) : "var(--line)";
          svg += `<rect x="${x}" y="${rowY}" width="${bw}" height="${boxH}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>`;
          svg += `<text x="${x + 10}" y="${rowY + 18}" class="gv-dir-id">${esc(d.id)}</text>`;
          svg += txt(x + 10, rowY + 34, "gv-dir-n", d.name, cpw(bw - 20, 6.0));
          // repo dots
          const dr = Array.isArray(d.repos) ? d.repos : [];
          dr.forEach((k, j) => {
            const dh = hues[k];
            const cx = x + 12 + j * 13,
              cyd = rowY + 48;
            svg += `<circle cx="${cx}" cy="${cyd}" r="4" fill="${dh != null ? strokeFor(dh) : "var(--ink-3)"}"/>`;
          });
          let after = "";
          if (Array.isArray(d.after)) after = d.after.join(", ");
          else if (typeof d.after === "string") after = d.after;
          if (after) {
            svg += `<text x="${x + bw - 9}" y="${rowY + boxH - 7}" class="gv-dir-a" text-anchor="end">after ${esc(after)}</text>`;
          }
        });
      }
      y += rows * (boxH + 12) + 22;
    }

    /* ---- band 4: legend ---- */
    svg += `<text x="${MX}" y="${y}" class="gv-band">Legend</text>`;
    y += 16;
    let lx = MX;
    const legend: { label: string; hue: number }[] = [];
    repoKeys.forEach((k) => legend.push({ label: k, hue: hues[k] }));
    legend.push({ label: "graph finding — in no issue tracker", hue: 25 });
    legend.push({ label: "ready now", hue: 150 });
    legend.forEach((item) => {
      const tw = 8 + String(item.label).length * 6.4 + 18;
      if (lx + tw > W - MX) {
        lx = MX;
        y += 22;
      }
      svg += `<rect x="${lx}" y="${y - 9}" width="12" height="12" rx="3" fill="${fillFor(item.hue)}" stroke="${strokeFor(item.hue)}" stroke-width="1.2"/>`;
      svg += `<text x="${lx + 18}" y="${y + 1}" class="gv-leg">${esc(item.label)}</text>`;
      lx += tw + 8;
    });
    y += 18;

    const H = Math.ceil(y);
    const defs = `<defs><marker id="gv-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-3)"/></marker></defs>`;
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cross-repo product graph">${defs}${svg}</svg>`;
  }

  function dirCard(d: Direction): string {
    return `<details class="dir" data-status="${esc(d.status)}"${d.status === "committed" ? " open" : ""}>
    <summary>
      ${stBadge(d.status)}
      <span class="did">${esc(d.id)}</span>
      <span class="dname">${esc(d.name)}</span>
      ${d.repos && d.repos.length ? `<span class="drepos">${d.repos.map((r) => `<span class="rchip">${esc(r)}</span>`).join("")}</span>` : ""}
      <span class="chev">›</span>
    </summary>
    <div class="body">
      <p class="extends"><b>Extends:</b> ${esc(d.extends)}</p>
      <p class="telos">${esc(d.telos)}</p>
      <div class="meta">
        <span><span class="lbl">Driven by</span> ${esc(d.karta || "—")}</span>
        ${d.anga ? `<span class="anga"><span class="lbl">Question:</span> ${esc(d.anga)}</span>` : ""}
      </div>
      ${
        d.drivers?.length
          ? `<table class="drv">
        <thead><tr><th>Ref</th><th>Title</th><th>Author</th><th>Weight</th><th>State</th><th>Action</th></tr></thead>
        <tbody>${d.drivers
          .map(
            (p) => `<tr>
          <td class="ref">${ref(p.ref, p.kind, p.repo)}</td>
          <td class="ttl">${esc(p.title)}</td>
          <td>${who(p.author, p.assoc)}</td>
          <td><span class="wt wt-${esc(p.weight)}">${esc(p.weight)}</span></td>
          <td>${p.readiness && p.readiness !== "na" ? `<span class="rd rd-${esc(p.readiness)}">${rdLabel[p.readiness] || esc(p.readiness)}</span>` : `<span class="rd rd-draft">${esc(p.state)}</span>`}</td>
          <td class="act">${esc(p.action || "")}</td></tr>`,
          )
          .join("")}</tbody></table>`
          : ""
      }
      ${d.risks?.length ? `<p class="note-h">Open risks</p><ul class="lst">${d.risks.map((r) => `<li>${linkRefs(r)}</li>`).join("")}</ul>` : ""}
      ${d.unblocks?.length ? `<p class="note-h">Unblocks</p><ul class="lst">${d.unblocks.map((u) => `<li>${linkRefs(u)}</li>`).join("")}</ul>` : ""}
    </div>
  </details>`;
  }

  const repoCount = R.repos && typeof R.repos === "object" ? Object.keys(R.repos).length : 0;
  const mapHeading = repoCount
    ? `The product, assembled across ${repoCount} repos`
    : `The product, assembled across the codebase`;

  function appHtml(): string {
    return `
  <section id="map" style="margin-top:1.4rem">
    <h2>${esc(mapHeading)}</h2>
    <p class="sec-sub">Lead with the assembled picture and what no single repo's tracker can see.</p>
    <div class="gv-wrap">${graphView()}</div>
  </section>

  <section id="next">
    <p class="eyebrow">Maintainer roadmap</p>
    <h1 class="title">${esc(R.repo)}</h1>
    <p class="tagline">${esc(R.tagline || "")}</p>
    <ol class="moves" aria-label="Next moves">${(R.nextMoves || []).map((m) => `<li>${linkRefs(m)}</li>`).join("")}</ol>
  </section>

  <section id="product">
    <h2>What this product is today</h2>
    <p class="sec-sub">The verified ground every direction transforms — each line cited to a real primitive.</p>
    <p class="prose">${esc(R.product.summary || "")}</p>
    <div class="subsys">${(R.product.subsystems || [])
      .map(
        (s) => `
      <div class="sub">
        <div class="sub-h"><b>${esc(s.name)}</b> ${s.primitive ? `<span class="prim">${esc(s.primitive)}</span>` : ""}</div>
        <ul class="caps">${(s.capabilities || []).map((c) => `<li><b>${esc(c.name)}</b> ${c.primitive ? `<span class="prim">${esc(c.primitive)}</span>` : ""}</li>`).join("")}</ul>
      </div>`,
      )
      .join("")}</div>
    ${R.product.entities?.length ? `<div class="entities">${R.product.entities.map((e) => `<span class="ent">${esc(e.name)}${e.primitive ? ` <span class="mono">${esc(e.primitive)}</span>` : ""}</span>`).join("")}</div>` : ""}
  </section>

  <section id="flow">
    <h2>How it works today</h2>
    <p class="sec-sub">${esc(R.estafeta?.name || "Core flow")} — the relay a single item travels, end to end.</p>
    <div class="flow">${(R.estafeta?.steps || [])
      .map(
        (s, i, a) => `
      <div class="step"><span class="k">${esc(s.label)}</span>${s.primitive ? `<span class="p">${esc(s.primitive)}</span>` : ""}</div>
      ${i < a.length - 1 ? '<span class="arr">→</span>' : ""}`,
      )
      .join("")}</div>
  </section>

  <section id="directions">
    <h2>Directions</h2>
    <p class="sec-sub">In dependency order. Each transforms a capability the product already ships.</p>
    <div class="filter" role="group" aria-label="Filter directions">
      <button data-f="all" aria-pressed="true">All</button>
      <button data-f="committed" aria-pressed="false">Committed</button>
      <button data-f="ready" aria-pressed="false">Ready</button>
      <button data-f="in-flight" aria-pressed="false">In flight</button>
      <button data-f="deferred" aria-pressed="false">Deferred</button>
    </div>
    <div id="dirs">${(R.directions || []).map(dirCard).join("")}</div>
  </section>

  <section id="signal">
    <h2>Signal audit</h2>
    <p class="sec-sub">The most-reacted and most-commented open issues, computed over the full set — each marked included, deferred, or out of scope.</p>
    <div class="tbl-wrap"><table class="audit">
      <thead><tr><th>Issue</th><th>Title</th><th class="num">👍</th><th class="num">💬</th><th>Disposition</th></tr></thead>
      <tbody>${(R.signalAudit || [])
        .map(
          (s) => `<tr>
        <td>${ref(s.ref, s.kind || "issue", s.repo)}</td><td>${esc(s.title)}</td>
        <td class="num">${s.reactions ?? ""}</td><td class="num">${s.comments ?? ""}</td>
        <td>${dispBadge(s.disposition)}</td></tr>`,
        )
        .join("")}</tbody>
    </table></div>
  </section>

  <section id="field">
    <h2>Reading of the field</h2>
    <p class="sec-sub">What the graph bought — the part a flat ticket list can't produce.</p>
    <div class="field">
      <div class="panel"><h3>Driving roles</h3>
        <ul class="kartas">${(R.field?.kartas || []).map((k) => `<li><span class="karta">${kartaIcon[k.kind ?? ""] || "•"} <b>${esc(k.name)}</b></span> <span class="lbl" style="color:var(--ink-3)">drives ${esc(k.drives)}</span></li>`).join("")}</ul>
      </div>
      <div class="panel"><h3>Figure on ground</h3>
        <ul class="fog">${(R.field?.figureOnGround || []).map((f) => `<li><b>${esc(f.dir)}</b> <span class="to">extends</span> ${esc(f.capability)}</li>`).join("")}</ul>
      </div>
      <div class="panel full"><h3>Structural risks</h3>
        <ul class="srisk">${(R.structuralRisks || []).map((r) => `<li><b>${esc(r.label)}</b><span>${esc(r.note)}</span></li>`).join("")}</ul>
      </div>
    </div>
  </section>`;
  }

  return {
    appHtml,
    graphView,
    dirCard,
    linkRefs,
    dispBadge,
    barRepoHtml: (): string =>
      `<a href="${R.repoUrl}" target="_blank" rel="noopener">${esc(R.repo)}</a>`,
    title: (): string => `${R.repo} — roadmap`,
  };
}
