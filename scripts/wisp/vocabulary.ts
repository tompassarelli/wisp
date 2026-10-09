
export function vocabularyProblems(source: string, vocabulary: string): readonly string[] {
  const nouns = new Set([...vocabulary.matchAll(/^\| `([\w-]+)` \|/gm)].map((match) => match[1]));
  const flags = new Set([...vocabulary.matchAll(/^\| `(--[\w-]+)/gm)].map((match) => match[1]));
  const problems: string[] = [];
  for (const [, noun = "", usage = ""] of source.matchAll(/^  ["']?([\w-]+)["']?: \{\s*usage: "([^"]*)"/gm)) {
    if (!nouns.has(noun)) problems.push(`undeclared noun ${noun}`);
    for (const [flag] of usage.matchAll(/--[\w-]+/g)) if (!flags.has(flag)) problems.push(`${noun}: undeclared flag ${flag}`);
    if (/--profile(?:\]|\s*\|)|--profile (?:parity|visual|hfr)/.test(usage)) problems.push(`${noun}: --profile selects a map build profile`);
    if (/--clients (?!N\b)\w+/.test(usage)) problems.push(`${noun}: --clients is a count; use --clients-file for configuration`);
    if (/--pairs (?!N\b)\w+/.test(usage)) problems.push(`${noun}: --pairs is a count`);
  }
  return [...new Set(problems)];
}
