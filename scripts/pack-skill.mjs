#!/usr/bin/env node
// Детерминированная упаковка бандла — прототип для #3480.
//
// Дефект, который это чинит: `zip -rqX` даёт разные БАЙТЫ на разных машинах при
// тождественном содержимом, потому что раскладка архива принадлежит реализации
// zip, а не входу. Замерено: шесть нетронутых бандлов «изменились» после сборки
// на другой машине, и check-bundles этого не видит, потому что сравнивает
// распакованные деревья.
//
// Поэтому упаковку делает свой код, и в нём нет ничего машинно-зависимого:
//   — записи в отсортированном порядке (не в порядке обхода файловой системы);
//   — фиксированные дата и время в DOS-полях;
//   — метод ХРАНЕНИЯ, без сжатия: дефлейт вернул бы зависимость от версии zlib,
//     то есть тот же дефект под другим именем;
//   — никаких extra-полей и внешних атрибутов сверх необходимого.
// Тогда байты архива определяются только содержимым и этим файлом.
//
//   node pack-skill.mjs <директория-скилла> <выходной .skill>

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { crc32 } from "node:zlib";

const DOS_TIME = 0;      // 00:00:00
const DOS_DATE = 0x0021; // 1980-01-01 — самая ранняя дата, представимая в zip

function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, base, out);
    else if (st.isFile()) out.push(relative(base, p).split(sep).join("/"));
  }
  return out;
}

export function packSkill(skillDir, topName) {
  const files = walk(skillDir).sort(); // сортировка ещё раз: порядок — часть контракта
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const rel of files) {
    const data = readFileSync(join(skillDir, rel));
    const name = Buffer.from(`${topName}/${rel}`, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);   // сигнатура локального заголовка
    local.writeUInt16LE(10, 4);           // версия, нужная для распаковки (1.0 — хранение)
    local.writeUInt16LE(0, 6);            // флаги: ни одного
    local.writeUInt16LE(0, 8);            // метод: хранение
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);           // extra-поля: нет
    chunks.push(local, name, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(0x031e, 4);         // «создано в unix», версия 3.0 — фиксируем, не наследуем
    cen.writeUInt16LE(10, 6);
    cen.writeUInt16LE(0, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(DOS_TIME, 12);
    cen.writeUInt16LE(DOS_DATE, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt16LE(0, 30);
    cen.writeUInt16LE(0, 32);
    cen.writeUInt16LE(0, 34);
    cen.writeUInt16LE(0, 36);
    cen.writeUInt32LE(0, 38);
    cen.writeUInt32LE((0o100644 << 16) >>> 0, 38); // права: фиксированные, не с диска
    cen.writeUInt32LE(offset, 42);
    central.push(cen, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);              // комментарий архива: нет

  return Buffer.concat([...chunks, centralBuf, end]);
}

if (process.argv[2]) {
  const dir = process.argv[2];
  const top = dir.replace(/\/$/, "").split("/").pop();
  writeFileSync(process.argv[3], packSkill(dir, top));
}
