// Когда стартовал процесс под pid — чтобы отличить автора маркера потери от процесса,
// получившего его pid позже (marker.ts, #147 [100]). Без зависимостей, под Node и Bun:
// Linux — /proc/<pid>/stat (тики от загрузки) и btime из /proc/stat; macOS и прочие
// BSD — `ps -o lstart= -p <pid>` (секунды). Не узнали — null.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Тиков в секунду у /proc/<pid>/stat: USER_HZ ядра Linux — 100 на всех ходовых сборках. */
const CLK_TCK = 100;

function linuxStart(pid: number): number | null {
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  // Имя процесса в скобках может нести пробелы: поля считаются после последней «)».
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const ticks = Number(fields[19]); // поле 22 starttime; от «)» — 20-е, с нуля — 19
  const btime = Number(/^btime (\d+)$/m.exec(readFileSync("/proc/stat", "utf8"))?.[1]);
  return Number.isFinite(ticks) && btime ? (btime + ticks / CLK_TCK) * 1000 : null;
}

function psStart(pid: number): number | null {
  const out = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2000,
  }).trim();
  const at = Date.parse(out);
  return Number.isNaN(at) ? null : at;
}

/** Миг старта процесса, мс эпохи; процесса нет или узнать нечем — null. */
export function processStart(pid: number): number | null {
  try {
    return process.platform === "linux" ? linuxStart(pid) : psStart(pid);
  } catch {
    return null;
  }
}
