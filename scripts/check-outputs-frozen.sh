#!/usr/bin/env bash
# Замок закоммиченных выходов JS (граф nks-dev: #6650; дело №147 [145]): все каналы
# установки ставят main, и закоммиченные выходы — сборка выпуска, их пишет только
# джоб выпуска (make build-release в bundle-sync, ветка release-please--*). Ветка
# иного рода, изменившая их против своей базы, — выкат мимо релиза: отказ.
#
#   scripts/check-outputs-frozen.sh [база] [ветка]
#     база  — коммит, против которого сверять (по умолчанию origin/main; в CI PR — HEAD^1)
#     ветка — имя ветки (по умолчанию текущая; в CI PR — GITHUB_HEAD_REF)
set -euo pipefail
cd "$(dirname "$0")/.."

base="${1:-origin/main}"
branch="${2:-$(git rev-parse --abbrev-ref HEAD)}"
outputs=(
  skills/establish-mcp/scripts/iskron.mjs
  skills/establish-mcp/scripts/opencode-plugin.js
  extensions/iskron.js
  skills/product-roadmap/references/roadmap-template.html
)

case "$branch" in
  release-please--*)
    echo "✓ ветка выпуска ($branch) — закоммиченные выходы пишет её джоб"
    exit 0
    ;;
esac
if ! git rev-parse -q --verify "$base^{commit}" >/dev/null; then
  echo "✗ базы $base нет — git fetch origin main и повтори" >&2
  exit 1
fi
from="$(git merge-base "$base" HEAD)"
# Против рабочего дерева: и закоммиченное в ветке, и ещё не закоммиченное.
changed="$(git diff --name-only "$from" -- "${outputs[@]}")"
if [[ -n "$changed" ]]; then
  echo "✗ закоммиченные выходы JS изменены против $base — их пишет только джоб выпуска (make build-release):" >&2
  echo "$changed" | sed 's/^/    /' >&2
  echo "  верни: git checkout $from -- ${outputs[*]}; пробы гонят dev-сборку dist/dev (make build-js)" >&2
  exit 1
fi
echo "✓ закоммиченные выходы JS не тронуты против $base"
