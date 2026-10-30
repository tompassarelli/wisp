import { join } from "node:path";
import { Console, Data, Effect } from "effect";
import { captureProcess } from "../process/hostProcess";

export const ALLOWLIST = "clean-room-allowlist.tsv";

export const GAME_EXTENSIONS = [
  "mdx", "mdl", "blp", "dds", "tga", "wav", "mp3", "flac", "ogg", "opus", "w3x", "w3m", "w3n", "w3g", "mpq",
  "slk", "j", "ai", "fdf", "toc", "imp", "wts", "w3u", "w3t", "w3a", "w3b", "w3d", "w3h", "w3q", "w3e", "wpm",
  "doo", "shd", "mmp", "w3i", "w3r", "w3c", "w3s", "ttf", "otf", "png", "jpg", "jpeg", "gif", "webp", "bmp",
] as const;

const MAGIC = ["MDLX", "BLP1", "BLP2", "MPQ\x1a", "MPQ\x1b", "HM3W"];

export const JASS_DECLARATION = String.raw`^[[:space:]]*((constant[[:space:]]+)?native[[:space:]]+[A-Za-z0-9_]+[[:space:]]+takes[[:space:]]|function[[:space:]]+[A-Za-z0-9_]+[[:space:]]+takes[[:space:]].*[[:space:]]returns[[:space:]]|type[[:space:]]+[A-Za-z0-9_]+[[:space:]]+extends[[:space:]]|constant[[:space:]]+[A-Za-z0-9_]+[[:space:]]+[A-Za-z0-9_]+[[:space:]]*=)`;

export const JASS_LIMIT = 20;

export const JASS_SCAN_BYTES = 2_000_000;

export interface ContentRule {
  readonly name: string;
  readonly pattern: string;
  readonly minimumLines: number;
  readonly codeOnly: boolean;
  readonly exempt: readonly string[];
  readonly why: string;
}

export const LAN_PLUGIN_LOADER = "host/lan/plugin.ts";

// Split so this file and its tests never contain the tokens the published history is scanned for.
const MEMORY_CALLS = ["process_vm_" + "(?:readv|writev)", "(?<![A-Za-z])p" + "trace", "/proc/[^/\\s\"'`]+/m" + "em\\b", "(?:Read|Write)Process" + "Memory", "VirtualProtect" + "Ex", "CreateRemote" + "Thread"];

export const CONTENT_RULES: readonly ContentRule[] = [
  { name: "memory access", pattern: `(?i)(?:${MEMORY_CALLS.join("|")})`, minimumLines: 1, codeOnly: false, exempt: [], why: "names a call or path that reads or writes another process's memory" },
  { name: "binary address table", pattern: "(?i)\\w*(?:offset|r" + "va|addr|address|base|ptr|pointer)\\w*[\"']?\\s*[:=,]\\s*[\"']?0x[0-9a-f]{4,}", minimumLines: 3, codeOnly: false, exempt: [], why: "looks like a table of addresses or offsets inside the game binary" },
  { name: "decomp symbol", pattern: "\\b[a-zA-Z]{2,4}_80[0-9A-F]{6}\\b", minimumLines: 1, codeOnly: false, exempt: [], why: "names a decompiled function by its address" },
  { name: "private import", pattern: "(?:import|require)\\s*\\(?[^)\\n]*wisp-" + "private|\\bfrom\\s*[\"'`][^\"'`\\n]*wisp-" + "private|wisp-" + "private/[^\"'`\\s]*\\.(?:ts|js|mjs|cjs)\\b", minimumLines: 1, codeOnly: true, exempt: [LAN_PLUGIN_LOADER], why: `imports private code; only ${LAN_PLUGIN_LOADER} loads the private LAN plugin` },
];

const CODE_EXTENSIONS = ["ts", "tsx", "js", "mjs", "cjs", "lua"];

export const isCode = (path: string) => CODE_EXTENSIONS.includes(path.slice(path.lastIndexOf(".") + 1).toLowerCase());

export function contentRuleHits(path: string, text: string): string[] {
  return CONTENT_RULES.filter((rule) => !rule.exempt.includes(path) && (!rule.codeOnly || isCode(path))).filter((rule) => {
    const insensitive = rule.pattern.startsWith("(?i)");
    const expression = new RegExp(insensitive ? rule.pattern.slice(4) : rule.pattern, insensitive ? "i" : "");
    return text.split("\n").filter((line) => expression.test(line)).length >= rule.minimumLines;
  }).map((rule) => rule.name);
}

export type Origin = "original" | "generated" | "licensed" | "stock-path";

export interface Policy {

  readonly origins: readonly Origin[];
}

export interface Entry { readonly path: string; readonly origin: string; readonly how: string }

export function parseAllowlist(text: string): Entry[] {
  return text.split("\n").filter((line) => line.trim() !== "" && !line.startsWith("#")).map((line) => {
    const [path = "", origin = "", how = ""] = line.split("\t");
    return { path, origin, how };
  });
}

const fix = (policy: Policy) => "Delete it, regenerate it from our own source, or load it from the user's install at run time;"
  + ` if it is ours, add it to ${ALLOWLIST} as PATH<TAB>${policy.origins.join("|")}<TAB>HOW (wisp:docs/clean-room.md).`;

export function cleanRoomProblems(input: {
  readonly files: readonly { readonly path: string; readonly head: string }[];
  readonly jassLines: ReadonlyMap<string, number>;
  readonly allowlist: readonly Entry[];
  readonly policy: Policy;
  readonly contentHits?: ReadonlyMap<string, readonly string[]>;
}): string[] {
  const problems: string[] = [];
  const FIX = fix(input.policy);
  const allowed = new Map(input.allowlist.map((entry) => [entry.path, entry]));
  const tracked = new Set(input.files.map(({ path }) => path));
  for (const entry of input.allowlist) {
    if (!(input.policy.origins as readonly string[]).includes(entry.origin)) {
      problems.push(`${ALLOWLIST}: ${entry.path} names origin "${entry.origin}"; this repository allows ${input.policy.origins.join(", ")} (wisp:docs/clean-room.md)`);
    } else if (entry.how.trim() === "") {
      problems.push(`${ALLOWLIST}: ${entry.path} doesn't say how it was made (wisp:docs/clean-room.md)`);
    }
    if (!tracked.has(entry.path)) problems.push(`${ALLOWLIST}: ${entry.path} isn't committed; remove its row`);
  }
  for (const { path, head } of input.files) {
    if (allowed.has(path)) continue;
    const extension = path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
    const magic = MAGIC.some((bytes) => head.startsWith(bytes));

    const gameExtension = (GAME_EXTENSIONS as readonly string[]).includes(extension) && (extension !== "mdx" || head.startsWith("MDLX"));
    if (gameExtension || magic) problems.push(`clean room: ${path} is a game-format file. ${FIX}`);
  }
  for (const [path, lines] of input.jassLines) {
    if (lines > JASS_LIMIT && !allowed.has(path)) {
      problems.push(`clean room: ${path} has ${lines} JASS declaration lines (over ${JASS_LIMIT}), like a copy of common.j or blizzard.j. ${FIX}`);
    }
  }
  for (const [path, names] of input.contentHits ?? new Map<string, readonly string[]>()) {
    if (allowed.has(path)) continue;
    for (const name of names) {
      const rule = CONTENT_RULES.find((candidate) => candidate.name === name);
      problems.push(`clean room: ${path} ${rule?.why ?? name} (${name}). Wisp's behaviour comes from outside the game only; remove it (README, Principles; wisp:docs/clean-room.md).`);
    }
  }
  return problems;
}

export class CleanRoomError extends Data.TaggedError("CleanRoomError")<{ readonly message: string }> {}

const git = (root: string, args: readonly string[]) => captureProcess(`git ${args[0]}`, root, ["git", "-C", root, ...args]);

export const cleanRoom = (root: string, policy: Policy) => Effect.gen(function*() {
  const listed = yield* git(root, ["ls-files", "-z"]);
  if (listed.exitCode !== 0) return yield* new CleanRoomError({ message: `clean room: git ls-files failed: ${listed.stderr.trim()}` });
  const paths = listed.stdout.split("\0").filter((path) => path !== "");
  const files = yield* Effect.forEach(paths, (path) => Effect.promise(async () => {
    const file = Bun.file(join(root, path));
    const bytes = await file.slice(0, 4).bytes().catch(() => new Uint8Array());
    return { path, head: String.fromCharCode(...bytes), size: file.size };
  }), { concurrency: 64 });
  const scanned = files.filter(({ size }) => size <= JASS_SCAN_BYTES).map(({ path }) => path);
  const batches = Array.from({ length: Math.ceil(scanned.length / 1000) }, (_, n) => scanned.slice(n * 1000, n * 1000 + 1000));
  const jassLines = new Map<string, number>();
  for (const batch of batches) {

    const grep = yield* git(root, ["grep", "--cached", "-z", "-c", "-I", "-E", JASS_DECLARATION, "--", ...batch.map((path) => `:(literal)${path}`)]);
    if (grep.exitCode > 1) return yield* new CleanRoomError({ message: `clean room: git grep failed: ${grep.stderr.trim()}` });
    for (const line of grep.stdout.split("\n").filter((line) => line !== "")) {
      const [path = "", count = "0"] = line.split("\0");
      jassLines.set(path, Number(count));
    }
  }
  const contentHits = new Map<string, string[]>();
  for (const rule of CONTENT_RULES) {
    const candidates = scanned.filter((path) => !rule.exempt.includes(path) && (!rule.codeOnly || isCode(path)));
    for (let start = 0; start < candidates.length; start += 1000) {
      const batch = candidates.slice(start, start + 1000);
      const grep = yield* git(root, ["grep", "--cached", "-z", "-c", "-I", "-P", rule.pattern, "--", ...batch.map((path) => `:(literal)${path}`)]);
      if (grep.exitCode > 1) return yield* new CleanRoomError({ message: `clean room: git grep failed: ${grep.stderr.trim()}` });
      for (const line of grep.stdout.split("\n").filter((line) => line !== "")) {
        const [path = "", count = "0"] = line.split("\0");
        if (Number(count) >= rule.minimumLines) contentHits.set(path, [...(contentHits.get(path) ?? []), rule.name]);
      }
    }
  }
  const allowlistFile = Bun.file(join(root, ALLOWLIST));
  const allowlist = parseAllowlist((yield* Effect.promise(() => allowlistFile.exists())) ? yield* Effect.promise(() => allowlistFile.text()) : "");
  return cleanRoomProblems({ files, jassLines, allowlist, policy, contentHits });
});

export const runCleanRoom = (root: string, policy: Policy) => cleanRoom(root, policy).pipe(
  Effect.flatMap((problems) => problems.length === 0
    ? Console.log("clean room: no game files, copied game scripts, memory access, address tables or private imports outside the allowlist")
    : Effect.forEach(problems, (problem) => Console.error(problem), { discard: true }).pipe(Effect.andThen(Effect.sync(() => process.exit(1))))),
);

export const WISP_POLICY: Policy = { origins: ["original", "generated", "licensed"] };

if (import.meta.main) await Effect.runPromise(runCleanRoom(process.argv[2] ?? join(import.meta.dir, "../.."), WISP_POLICY));
