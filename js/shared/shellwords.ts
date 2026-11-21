// A shell line read as its simple commands (graph @nks/nks-dev, node #11288): words as the shell
// reads them — single and double quotes, backslashes — and a command ends at &&, ||, ;, |, &,
// a parenthesis or a newline outside quotes; a redirection (2>&1, &>file) is no separator, and #
// at a word's start comments out the rest of the line. Nothing is expanded or run.

const BLANK = new Set([" ", "\t"]);
const ENDS = new Set(["\n", ";", "(", ")"]);
const IN_DOUBLE = new Set(['"', "\\", "$", "`", "\n"]);

export function shellCommands(line: string): string[][] {
  const out: string[][] = [];
  let words: string[] = [];
  let word = "";
  let open = false; // a word has begun — an empty quoted word counts
  let quote = "";
  const endWord = (): void => {
    if (open) words.push(word);
    word = "";
    open = false;
  };
  const endCommand = (): void => {
    endWord();
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
      else if (c === "\\" && IN_DOUBLE.has(next)) word += line.charAt(++i);
      else word += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      open = true;
    } else if (c === "\\") {
      if (i + 1 < line.length) word += line.charAt(++i);
      open = true;
    } else if (c === "#" && !open) {
      while (i + 1 < line.length && line.charAt(i + 1) !== "\n") i++;
    } else if (BLANK.has(c)) endWord();
    else if (ENDS.has(c) && !(c === "(" && open)) endCommand();
    else if (c === "|") {
      if (next === "|") i++;
      endCommand();
    } else if (c === "&") {
      if (word.endsWith(">") || word.endsWith("<") || next === ">") {
        word += c;
        open = true;
        continue;
      }
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
