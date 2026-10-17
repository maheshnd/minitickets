import { createInterface } from "node:readline/promises";

// Questions in the terminal. A new readline per question, closed right after, so the hidden input
// below (raw mode) never fights with it over the keyboard.

// 1. A free-text answer. Enter alone = the default (shown in brackets).
export async function ask(question: string, defaultValue?: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`  ? ${question}${defaultValue ? ` [${defaultValue}]` : ""} `)).trim();
    return answer || defaultValue || "";
  } finally {
    rl.close();
  }
}

// 2. Yes or no. Anything but y / yes is "no": a stray Enter never changes anything.
export async function confirm(question: string): Promise<boolean> {
  const answer = (await ask(`${question} (y/N)`)).toLowerCase();
  return answer === "y" || answer === "yes";
}

// 3. A stronger yes for risky moments: the person must type an exact word (e.g. the stack name).
export async function confirmWord(question: string, word: string): Promise<boolean> {
  return (await ask(`${question} Type "${word}" to continue, anything else stops:`)) === word;
}

// 4. A secret (email address, token): nothing is shown while typing or pasting, not even stars,
//    so neither the screen nor a screen recording ever holds it. Enter ends it, Ctrl+C stops the
//    whole script, Backspace deletes.
//    Not a terminal (input piped in): read one line instead.
export async function askSecret(question: string): Promise<string> {
  process.stdout.write(`  ? ${question} (hidden while you type) `);
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const rl = createInterface({ input: stdin });
    try {
      for await (const line of rl) return line.trim();
      return "";
    } finally {
      rl.close();
    }
  }

  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");
  return new Promise((resolve) => {
    let value = "";
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (char === "\u0003") {
          stdin.setRawMode(false);
          process.stdout.write("\nStopped (Ctrl+C). Nothing was saved from this answer.\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on("data", onData);
  });
}
