#!/usr/bin/env bash
# Regenerate <name>.skill bundles from skills/<name>/ (the source of truth).
#
# Each bundle is a zip whose single top-level entry is <name>/ (so it installs as
# ~/.claude/skills/<name>/ and uploads to claude.ai as a Skill). The .skill files are
# committed derived artifacts — never hand-edit them; edit skills/<name>/SKILL.md and rebuild.
#
# Детерминированно ПОПЕРЁК МАШИН, а не только на одной: упаковку делает
# scripts/pack-skill.mjs, а не системный `zip`. Замерено (граф nks-dev, вимарша
# про байты нетронутых бандлов): `zip -rqX` при тождественном входе даёт разные
# байты на разных машинах, потому что раскладка архива принадлежит реализации
# zip. Цена была тихой — коммит со второй машины тащил за собой чужие бандлы, и
# диф переставал показывать сделанное. Свой писатель убирает источник: порядок
# записей, время и метод фиксированы, сжатия нет вовсе (дефлейт вернул бы
# зависимость от версии zlib). Отсюда и гейт сильнее: check-bundles сверяет
# БАЙТЫ, а не распакованные деревья.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

for d in skills/*/; do
  name="$(basename "$d")"
  node "$root/scripts/pack-skill.mjs" "skills/$name" "$root/$name.skill"
done

echo "Built: $(ls -1 *.skill | tr '\n' ' ')"
