// Формы прозы сервера о доске стояний и списке вебхуков (граф @nks/nks-dev:
// форма доски #4514, поля вместо прозы #6637, двуязычие разбора #6809): запасной
// путь, пока сервер не дал полей. Мост на английской поверхности просит
// accept-language: en, поэтому формы двуязычны независимо от языка сессии;
// русские наблюдены (#4514), английские — предположены, не наблюдены.
export const BOARD_FORM = {
  boardHeader: /^\s*(?:Каналы|Channels)(?:\s*\((\d+)\))?(?:\s|:|$)/m,
  boardEmpty:
    /^\s*(?:Ни одна роль этого графа (?:не держит канала|нигде не стоит)|No role (?:of|in) this graph (?:holds a channel|stands anywhere))/m,
  listens: /(^|·)\s*(?:слушает|listening)/,
  alive: /живой|слушает|\blive\b|listening/,
  undelivered: /(?:не доставлено|undelivered)\s+(\d+)/,
  hooksHeader: /^\s*(?:Вебхуки|Webhooks)(?:\s|:|\(|$)/m,
  hooksEmpty: /вебхуки не зарегистрированы|no webhooks (?:are )?registered/i,
  hookActive: /активен|\bactive\b/,
  hookState: /активен|пауза|\bactive\b|\bpaused\b/,
  seatId:
    /(?:id этого места|id of this (?:seat|place))[^\n]*\n\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
};
