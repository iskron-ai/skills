// A shell line read as its simple commands (graph @nks/nks-dev, node #11288): words as the shell
// reads them — single and double quotes, backslashes — and a command ends at &&, ||, ;, |, &,
// a parenthesis or a newline outside quotes; a backslash before a newline joins the lines (save in
// single quotes, where it stays as written); # at a word's start comments out the rest of the
// line. A redirection (>, >>, <, <<, &>, &>>, N>, N>&M, >&N…) leaves the command with its target,
// written into it or as the next word, wherever it stands; a here-document's body is skipped to
// its delimiter. Nothing is expanded or run.

const BLANK = new Set([" ", "\t"]);
const ENDS = new Set([";", "(", ")"]);
const IN_DOUBLE = new Set(['"', "\\", "$", "`", "\n"]);
const REDIRECT = /^(?:&>>?|>>|>&|>\||>|<<<|<<-|<<|<&|<>|<)/;

interface Heredoc {
  delim: string;
  tabs: boolean;
}

/** Past the bodies of the here-documents begun on the line ending at `i`: the index of the
 * newline closing the last delimiter (or the line's end). */
function skipHeredocs(line: string, i: number, docs: Heredoc[]): number {
  for (let d = docs.shift(); d; d = docs.shift()) {
    while (i < line.length) {
      const end = line.indexOf("\n", i + 1);
      const body = line.slice(i + 1, end < 0 ? line.length : end);
      i = end < 0 ? line.length : end;
      if ((d.tabs ? body.replace(/^\t+/, "") : body) === d.delim) break;
    }
  }
  return i;
}

export function shellCommands(line: string): string[][] {
  const out: string[][] = [];
  const docs: Heredoc[] = [];
  let words: string[] = [];
  let word = "";
  let open = false; // a word has begun — an empty quoted word counts
  let quoted = false; // the word holds a quoted or escaped part: never a descriptor
  let quote = "";
  let target = ""; // the next word is a redirection's target; "<<"/"<<-" — a heredoc's delimiter
  const endWord = (): void => {
    if (open && target) {
      if (target !== "word") docs.push({ delim: word, tabs: target === "<<-" });
      target = "";
    } else if (open) words.push(word);
    word = "";
    open = quoted = false;
  };
  const endCommand = (): void => {
    endWord();
    target = "";
    if (words.length) out.push(words);
    words = [];
  };
  for (let i = 0; i < line.length; i++) {
    const c = line.charAt(i);
    const next = line.charAt(i + 1);
    if (quote === "'") {
      if (c === "'") quote = "";
      else word += c;
    } else if (quote === '"') {
      if (c === '"') quote = "";
      else if (c === "\\" && next === "\n") i++;
      else if (c === "\\" && IN_DOUBLE.has(next)) word += line.charAt(++i);
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      open = quoted = true;
    } else if (c === "\\" && next === "\n") i++;
    else if (c === "\\") {
      if (i + 1 < line.length) word += line.charAt(++i);
      open = quoted = true;
    } else if (c === "#" && !open) {
      while (i + 1 < line.length && line.charAt(i + 1) !== "\n") i++;
    } else if (c === ">" || c === "<" || (c === "&" && next === ">")) {
      // N> takes the word's digits as its descriptor; any other word ends before the operator.
      if (open && !quoted && /^\d+$/.test(word) && !target) word = "";
      else endWord();
      open = false;
      const op = REDIRECT.exec(line.slice(i))?.[0] ?? c;
      i += op.length - 1;
      target = op === "<<" || op === "<<-" ? op : "word";
    } else if (c === "\n") {
      endCommand();
      i = skipHeredocs(line, i, docs);
    } else if (BLANK.has(c)) endWord();
    else if (ENDS.has(c) && !(c === "(" && open)) endCommand();
    else if (c === "|") {
      if (next === "|") i++;
      endCommand();
    } else if (c === "&") {
      if (next === "&") i++;
      endCommand();
    } else {
      word += c;
      open = true;
    }
  }
  endCommand();
  return out;
}
