// Монтирование рендера в страницу: единственное место, знающее document.
// ROADMAP — глобальная константа из соседнего <script> шаблона; её и только
// её заменяет скилл product-roadmap.
import { createRenderer, type Roadmap } from "./render.ts";

declare const ROADMAP: Roadmap;

const R = ROADMAP;
const render = createRenderer(R);

const byId = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`template: no #${id}`);
  return el;
};

byId("bar-repo").innerHTML = render.barRepoHtml();
byId("bar-ver").textContent = R.version || "";
byId("ft-date").textContent = R.generated || "";
document.title = render.title();
byId("app").innerHTML = render.appHtml();

/* ---- filter + theme ---- */
document.querySelector(".filter")?.addEventListener("click", (e) => {
  const b = (e.target as HTMLElement).closest("button");
  if (!b) return;
  document
    .querySelectorAll(".filter button")
    .forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  const f = b.dataset.f;
  document.querySelectorAll<HTMLElement>("#dirs > .dir").forEach((d) => {
    d.style.display = f === "all" || d.dataset.status === f ? "" : "none";
  });
});
const root = document.documentElement;
byId("tgl").addEventListener("click", () => {
  const cur =
    root.getAttribute("data-theme") ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  root.setAttribute("data-theme", cur === "dark" ? "light" : "dark");
});

/* ---- graph-view tooltip (instant, styled — replaces the slow native SVG <title>) ---- */
(function () {
  const map = document.getElementById("map");
  if (!map) return;
  const tip = document.createElement("div");
  tip.className = "gv-tip";
  tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  let cur: Element | null = null;
  const place = (cx: number, cy: number) => {
    let x = cx + 14,
      y = cy + 16;
    const w = tip.offsetWidth,
      h = tip.offsetHeight;
    if (x + w > innerWidth - 8) x = cx - w - 14;
    if (y + h > innerHeight - 8) y = cy - h - 14;
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  };
  map.addEventListener("mousemove", (e) => {
    const target = e.target as Element | null;
    const t = target?.closest ? target.closest("[data-full]") : null;
    if (t) {
      if (t !== cur) {
        cur = t;
        tip.textContent = t.getAttribute("data-full");
        tip.classList.add("on");
      }
      place(e.clientX, e.clientY);
    } else if (cur) {
      cur = null;
      tip.classList.remove("on");
    }
  });
  map.addEventListener("mouseleave", () => {
    cur = null;
    tip.classList.remove("on");
  });
})();
