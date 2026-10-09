


import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const wispEntry = resolve(import.meta.dir, "../scripts/wisp/repo.ts");


const stub = (bin: string, name: string, body: string) => {
  const path = join(bin, name);
  writeFileSync(path, `#!${process.execPath}\nconst { appendFileSync, writeFileSync } = require("node:fs");\nconst { execFileSync } = require("node:child_process");\nconst args = process.argv.slice(2);\n${body}\n`);
  chmodSync(path, 0o755);
};

const isolatedGit = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

test("[repro #78] interleaved balance dispatches wait for and report their own run", async () => {
  const dir = mkdtempSync(join(tmpdir(), "host-tools-farm-interleaved-"));
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const log = join(dir, "calls.log");
    stub(bin, "gh", `
if (args[0] === "workflow") { process.exit(0); }
if (args[0] === "run" && args[1] === "list") {
  console.log(JSON.stringify([
    {databaseId:202,displayTitle:"Balance sylvanas sylvanas-tag",url:"https://example.test/202"},
    {databaseId:101,displayTitle:"Balance archer archer-tag",url:"https://example.test/101"},
  ])); process.exit(0);
}
if (args[0] === "run" && args[1] === "view") {
  appendFileSync(${JSON.stringify(log)}, "wait " + args[2] + "\\n");
  console.log(JSON.stringify({status:"completed",conclusion:"success",jobs:[]})); process.exit(0);
}
if (args[0] === "run" && args[1] === "download") {
  appendFileSync(${JSON.stringify(log)}, "download " + args[2] + "\\n");
  writeFileSync(require("node:path").join(args[args.indexOf("-D") + 1], "field.md"), args[2] === "101" ? "Archer 61%" : "Sylvanas 43%"); process.exit(0);
}
process.exit(1);`);
    const program = `
import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dispatch, waitFor, withArtifact } from "./scripts/wisp/farm";
const results = await Effect.runPromise(Effect.all(["archer", "sylvanas"].map(fighter => Effect.gen(function*() {
  const found = yield* dispatch("owner/repo", "balance.yml", {ref:fighter,tag:fighter+"-tag"});
  yield* waitFor("owner/repo", found.databaseId);
  const field = yield* withArtifact("owner/repo", found.databaseId, "balance-field", folder => Effect.sync(() => readFileSync(join(folder,"field.md"),"utf8")));
  return {fighter,id:found.databaseId,field};
})), {concurrency:2}));
console.log(JSON.stringify(results));`;
    const child = Bun.spawn([process.execPath, "--eval", program], { cwd: resolve(import.meta.dir, ".."), env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` }, stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(stderr).toContain("https://example.test/101");
    expect(stderr).toContain("https://example.test/202");
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toEqual([
      { fighter: "archer", id: 101, field: "Archer 61%" },
      { fighter: "sylvanas", id: 202, field: "Sylvanas 43%" },
    ]);
    expect(readFileSync(log, "utf8").trim().split("\n").sort()).toEqual(["download 101", "download 202", "wait 101", "wait 202"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);

test.each([
  ["safe-push", "push"],
  ["the dispatch", "dispatch"],
] as const)("[repro smashcraft#240] farm deletes its scratch branch when %s fails after the push", async (_, failing) => {
  const dir = mkdtempSync(join(tmpdir(), "host-tools-farm-"));
  try {
    const git = (cwd: string, ...args: string[]) => {
      const result = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, ...isolatedGit } });
      if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
      return result.stdout.toString().trim();
    };
    const origin = join(dir, "origin.git");
    const work = join(dir, "work");
    git(dir, "init", "-q", "--bare", "-b", "main", origin);
    git(dir, "clone", "-q", origin, work);
    git(work, "commit", "-q", "--allow-empty", "-m", "base");
    git(work, "push", "-q", "origin", "HEAD:main");
    git(work, "commit", "-q", "--allow-empty", "-m", "lane");
    const lane = git(work, "rev-parse", "HEAD");

    const bin = join(dir, "bin");
    mkdirSync(bin);
    const log = join(dir, "calls.log");
    const originGit = (args: string) => `execFileSync("git", ["--git-dir", ${JSON.stringify(origin)}, ${args}], { stdio: ["ignore", "pipe", "inherit"] }).toString().trim()`;
    stub(bin, "gh", `
const ref = (prefix) => args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
if (args[0] === "repo") { console.log("owner/repo"); process.exit(0); }
if (args[0] === "api" && args[1] === "graphql") { console.log(JSON.stringify([{data:{repository:{refs:{nodes:[]}}}}])); process.exit(0); }
if (args[0] === "run" && args[1] === "list") { console.log("[]"); process.exit(0); }
if (args[0] === "api" && args[2] === "POST") {
  ${originGit(`"update-ref", ref("ref="), ref("sha=")`)};
  appendFileSync(${JSON.stringify(log)}, "create " + ref("ref=") + "\\n");
  process.exit(0);
}
if (args[0] === "api" && args[2] === "DELETE") {
  const name = "refs/heads/" + args[3].split("/git/refs/heads/")[1];
  try { ${originGit(`"show-ref", "--verify", "-q", name`)}; } catch { process.exit(1); }
  ${originGit(`"update-ref", "-d", name`)};
  appendFileSync(${JSON.stringify(log)}, "delete " + name + "\\n");
  process.exit(0);
}
if (args[0] === "workflow") {
  appendFileSync(${JSON.stringify(log)}, "dispatch with " + ${originGit(`"for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/farm"`)} + "\\n");
  console.error("stand-in failure");
  process.exit(1);
}
process.exit(1);`);
    stub(bin, "safe-push", `
execFileSync("git", ["-c", "core.hooksPath=/dev/null", "push", "-q", "origin", "HEAD:refs/heads/" + args[1]], { stdio: "inherit" });
appendFileSync(${JSON.stringify(log)}, "push " + args[1] + "\\n");
if (${JSON.stringify(failing)} === "push") { console.error("stand-in failure"); process.exit(1); }`);

    const wisp = Bun.spawn([process.execPath, wispEntry, "farm", "test"], { cwd: work, env: { ...process.env, ...isolatedGit, PATH: `${bin}:${process.env["PATH"] ?? ""}` }, stdout: "pipe", stderr: "pipe" });
    const [code, stderr] = await Promise.all([wisp.exited, new Response(wisp.stderr).text()]);
    expect(stderr).toContain(failing === "push" ? "safe-push --to farm" : "stand-in failure");
    expect(code).toBe(1);
    const scratch = `refs/heads/farm/${lane.slice(0, 12)}`;
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      `create ${scratch}`,
      `push farm/${lane.slice(0, 12)}`,
      ...failing === "dispatch" ? [`dispatch with ${scratch} ${lane}`] : [],
      `delete ${scratch}`,
    ]);
    expect(git(dir, "--git-dir", origin, "for-each-ref", "refs/heads/farm")).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);

test("[repro #74] farm startup deletes stale refs and keeps recent and active-run refs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "host-tools-farm-sweep-"));
  const old = "2020-01-01T00:00:00Z";
  const refs = [
    { name: "stale", target: { oid: "1".repeat(40), committedDate: old } },
    { name: "queued", target: { oid: "2".repeat(40), committedDate: old } },
    { name: "running", target: { oid: "3".repeat(40), committedDate: old } },
    { name: "head", target: { oid: "4".repeat(40), committedDate: old } },
    { name: "recent", target: { oid: "5".repeat(40), committedDate: "2099-01-01T00:00:00Z" } },
  ];
  try {
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const log = join(dir, "calls.log");
    stub(bin, "gh", `
if (args[0] === "repo") { console.log("owner/repo"); process.exit(0); }
if (args[1] === "graphql") { console.log(${JSON.stringify(JSON.stringify([{ data: { repository: { refs: { nodes: refs.slice(0, 2) } } } }, { data: { repository: { refs: { nodes: refs.slice(2) } } } }]))}); process.exit(0); }
if (args.includes("--slurp") && args.includes("--jq")) { console.error("the --slurp option is not supported with --jq"); process.exit(1); }
if (args[1]?.includes("status=queued")) { console.log(JSON.stringify([{workflow_runs:[{head_branch:"farm/queued",head_sha:"main",display_title:"Queued"}]}])); process.exit(0); }
if (args[1]?.includes("status=in_progress")) { console.log(JSON.stringify([{workflow_runs:[{head_branch:"main",head_sha:"main",display_title:"Farm test ${"3".repeat(40)} tag"}]},{workflow_runs:[{head_branch:"main",head_sha:"${"4".repeat(40)}",display_title:"Running"}]}])); process.exit(0); }
if (args[0] === "api" && args[2] === "DELETE") { appendFileSync(${JSON.stringify(log)}, args[3] + "\\n"); process.exit(0); }
process.exit(1);`);
    const program = `import {Effect} from 'effect'; import {currentRepo} from './scripts/wisp/farm'; await Effect.runPromise(currentRepo);`;
    const child = Bun.spawn([process.execPath, "--eval", program], { cwd: resolve(import.meta.dir, ".."), env: { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` }, stdout: "pipe", stderr: "pipe" });
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["repos/owner/repo/git/refs/heads/farm/stale"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);
