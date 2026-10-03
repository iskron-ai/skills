#!/usr/bin/env bash
# Замок закоммиченных выходов JS (граф nks-dev: #6650; дело №147 [145]): все каналы
# установки ставят main, и закоммиченные выходы — сборка выпуска, их пишет только
# джоб выпуска (make build-release в bundle-sync, ветка release-please--*). Ветка
# иного рода, изменившая их против своей базы, — выкат мимо релиза: отказ.
#
#   scripts/check-outputs-frozen.sh [база] [ветка]
#     база  — коммит, против которого сверять (по умолчанию origin/main)
#     ветка — имя ветки (по умолчанию текущая)
# В CI без аргументов — по событию (GITHUB_EVENT_NAME):
#   pull_request — база HEAD^1 (основание PR в его коммите слияния), ветка GITHUB_HEAD_REF;
#   push — ветка из GITHUB_REF; весь пуш, покоммитно, от PUSH_BEFORE (github.event.before)
#     до HEAD. Коммит, менявший выходы, — отказ, кроме коммита релизного PR: автор
#     github-actions[bot] (release-please открывает PR им, и squash-коммит слияния несёт
#     его автором), коммиттер noreply@github.com (слияние кнопкой GitHub — так у 7.2.5–7.2.8)
#     И заголовок `chore(main): release …`; автора и заголовок подделывает `git -c`,
#     коммиттер GitHub — только слияние на GitHub (№147 [160]). before пуст, нулевой
#     (новая ветка, force-push) или его нет в клоне — HEAD сверяется с последним релизным
#     коммитом своей истории: грязный предпоследний коммит иначе прошёл бы.
set -euo pipefail
cd "$(dirname "$0")/.."

RELEASE_AUTHOR="41898282+github-actions[bot]@users.noreply.github.com"
RELEASE_COMMITTER="noreply@github.com"
outputs=(
  skills/establish-mcp/scripts/iskron.mjs
  skills/establish-mcp/scripts/opencode-plugin.js
  extensions/iskron.js
  skills/product-roadmap/references/roadmap-template.html
)
release_branch() { [[ "$1" == release-please--* ]]; }
release_commit() {
  [[ "$(git log -1 --format=%ae "$1")" == "$RELEASE_AUTHOR" &&
    "$(git log -1 --format=%ce "$1")" == "$RELEASE_COMMITTER" &&
    "$(git log -1 --format=%s "$1")" == "chore(main): release "* ]]
}
last_release() {
  git log --format='%H%x09%ae%x09%ce%x09%s' HEAD |
    awk -F'\t' -v a="$RELEASE_AUTHOR" -v c="$RELEASE_COMMITTER" \
      '!found && $2 == a && $3 == c && index($4, "chore(main): release ") == 1 { print $1; found = 1 }'
  # без exit в awk: ранний выход рвал бы трубу git log (SIGPIPE под pipefail)
}

event="${GITHUB_EVENT_NAME:-}"
if [[ $# -eq 0 && "$event" == "push" ]]; then
  branch="${GITHUB_REF#refs/heads/}"
  if release_branch "$branch"; then
    echo "✓ ветка выпуска ($branch) — закоммиченные выходы пишет её джоб"
    exit 0
  fi
  before="${PUSH_BEFORE:-}"
  if [[ -z "$before" || "$before" =~ ^0+$ ]] || ! git rev-parse -q --verify "$before^{commit}" >/dev/null; then
    rel="$(last_release)"
    if [[ -z "$rel" ]]; then
      echo "✗ пуш без before, а релизного коммита в истории нет — сверять не с чем" >&2
      exit 1
    fi
    changed="$(git diff --name-only "$rel" HEAD -- "${outputs[@]}")"
    if [[ -n "$changed" ]]; then
      echo "✗ пуш без before: выходы JS расходятся с последним выпуском $(git log -1 --format='%h %s' "$rel"):" >&2
      echo "$changed" | sed 's/^/    /' >&2
      exit 1
    fi
    echo "✓ пуш без before: выходы JS = последний выпуск $(git log -1 --format='%h %s' "$rel")"
    exit 0
  fi
  bad=0
  for c in $(git rev-list --reverse "$before..HEAD"); do
    if release_commit "$c"; then
      echo "✓ $(git log -1 --format=%h "$c") — коммит релизного PR, выходы пишет джоб выпуска"
      continue
    fi
    changed="$(git diff --name-only "$c^1" "$c" -- "${outputs[@]}")"
    if [[ -n "$changed" ]]; then
      bad=1
      echo "✗ $(git log -1 --format='%h %s' "$c") меняет закоммиченные выходы JS — их пишет только джоб выпуска:" >&2
      echo "$changed" | sed 's/^/    /' >&2
    fi
  done
  if ((bad)); then exit 1; fi
  echo "✓ пуш $(git rev-parse --short "$before")..$(git rev-parse --short HEAD): выходы JS вне выпуска не тронуты"
  exit 0
fi

if [[ $# -eq 0 && "$event" == "pull_request" ]]; then set -- HEAD^1 "${GITHUB_HEAD_REF:-}"; fi
base="${1:-origin/main}"
branch="${2:-$(git rev-parse --abbrev-ref HEAD)}"
if release_branch "$branch"; then
  echo "✓ ветка выпуска ($branch) — закоммиченные выходы пишет её джоб"
  exit 0
fi
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
