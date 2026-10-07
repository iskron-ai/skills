#!/bin/sh
# Адаптер июльского плеча (README, «Два плеча базового прогона»): в копии ревизии 16793219
# имена тулов nks_* → iskron_* в skills/ и AGENTS.md — одной заменой, одинаково в каждом прогоне.
# Падает, если nks_* остался или читающий тул из разрешённого списка в скиллах не назван.
set -eu
copy=${1:?usage: adapt-july.sh <копия ревизии плеча>}
cd "$copy"
[ ! -d skills/iskron ] || { echo "adapt-july: в копии есть дверь iskron — это не июльское плечо" >&2; exit 1; }
files=$(grep -rlE '\bnks_' skills AGENTS.md || true)
[ -n "$files" ] || { echo "adapt-july: nks_* не найдено — это не копия июльского плеча" >&2; exit 1; }
# shellcheck disable=SC2086
perl -pi -e 's/\bnks_/iskron_/g' $files
if grep -rnE '\bnks_' skills AGENTS.md >&2; then
  echo "adapt-july: nks_* остался" >&2
  exit 1
fi
for t in iskron_look iskron_orient iskron_search iskron_semantic_search; do
  grep -rqw "$t" skills || { echo "adapt-july: $t в скиллах не назван" >&2; exit 1; }
done
echo "adapt-july: $(echo "$files" | wc -l | tr -d ' ') файлов, nks_* не осталось"
