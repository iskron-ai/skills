#!/usr/bin/env bash
# Verify every committed <name>.skill bundle is in sync with its source skills/<name>/.
#
# Сверяются БАЙТЫ: бандл пересобирается во временный файл и сравнивается с
# закоммиченным целиком. Прежде здесь стояло сравнение распакованных деревьев, и
# стояло по честной причине — вывод системного `zip` не воспроизводился между
# машинами. Причина снята: упаковку делает scripts/pack-skill.mjs, чей выход
# определяется содержимым и этим кодом, а не реализацией zip на машине.
#
# Что байтовая сверка ловит сверх прежней: бандл, собранный ЧУЖИМ инструментом и
# закоммиченный как наш. Для сравнения деревьев такой бандл неотличим от
# правильного, а для потребителя — уже другой артефакт.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

fail=0
for d in skills/*/; do
  name="$(basename "$d")"
  bundle="$name.skill"
  if [[ ! -f "$bundle" ]]; then
    echo "✗ $bundle: missing (run 'make build')"
    fail=1
    continue
  fi
  tmp="$(mktemp -d)"
  node "$root/scripts/pack-skill.mjs" "skills/$name" "$tmp/$name.skill"
  if ! cmp -s "$bundle" "$tmp/$name.skill"; then
    echo "✗ $bundle: расходится с пересборкой из skills/$name/ — прогони 'make build' и закоммить"
    echo "    (закоммичено $(wc -c < "$bundle" | tr -d ' ') байт, пересобрано $(wc -c < "$tmp/$name.skill" | tr -d ' '))"
    fail=1
  fi
  rm -rf "$tmp"
done

if [[ $fail -ne 0 ]]; then
  echo ""
  echo "Bundles are out of sync. Run 'make build' (or enable the hook with 'make hooks') and commit."
  exit 1
fi

echo "✓ all .skill bundles byte-identical to a fresh build from skills/"
