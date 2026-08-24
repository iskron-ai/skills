#!/usr/bin/env bash
# Stop-хук незастывания (iskronify, Шаг 4): ход, кончившийся планом без
# перемены, блокируется один раз. Эвристика текстовая; ложный позитив
# безвреден — агент делает ход или честно переформулирует финал.
IN=$(cat)
[ "$(printf '%s' "$IN" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0
TP=$(printf '%s' "$IN" | jq -r '.transcript_path // ""')
[ -r "$TP" ] || exit 0

VERDICT=$(tail -n 400 "$TP" | jq -rs '
  # индекс последнего настоящего ввода пользователя (текст, не tool_result)
  ([ to_entries[]
     | select(.value.type=="user")
     | select(((.value.message.content|type)=="string")
              or ((.value.message.content|type)=="array"
                  and ((.value.message.content[0].type? // "")=="text")))
     | .key ] | last // 0) as $u
  | [ .[$u:][] | select(.type=="assistant") ] as $turn
  | ([ $turn[].message.content[]?
       | select(.type=="tool_use")
       | select((.name | test("^(Write|Edit|MultiEdit|NotebookEdit)$"))
                or (.name | test("^mcp__.*(add|update|arrow|batch|delete|channel|admin)"))) ]
     | length) as $writes
  | ([ $turn[].message.content[]? | select(.type=="text") | .text ] | last // "") as $final
  | if $writes==0
       and ($final
            | test("начну с|приступл|если ты не против|планирую (сделать|начать)|I'"'"'ll start|shall I|let me start"; "i"))
    then "BLOCK" else "OK" end
' 2>/dev/null)

if [ "$VERDICT" = "BLOCK" ]; then
  echo '{"decision":"block","reason":"Начало не объявляется — совершается: сделай первый ход выбранного, либо запиши вопрос адресату (вимарша + кадр) и скажи, что записал."}'
fi
exit 0
